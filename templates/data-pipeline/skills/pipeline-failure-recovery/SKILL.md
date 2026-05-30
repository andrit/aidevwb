---
name: pipeline-failure-recovery
description: Make a pipeline recoverable — handle partial failures with dead-letter queues, implement retry logic with backoff, resume from the last successful checkpoint, and alert on systemic failures
domain: data-pipeline
type: data-pipeline
triggers:
  - "pipeline failure"
  - "pipeline recovery"
  - "retry failed records"
  - "dead letter queue"
  - "DLQ"
  - "resume pipeline"
  - "partial failure"
  - "pipeline crashed"
  - "reprocess errors"
  - "pipeline alert"
---

# Pipeline Failure Recovery

## When to use

When a pipeline needs to handle failures gracefully — retrying transient errors, quarantining bad records without aborting the batch, resuming after a crash, and alerting when error rates exceed acceptable thresholds. Activate when a user says "the pipeline crashed", "some records failed to process", "how do I retry failed records?", or when a pipeline stops on the first error.

## Prerequisites

- Pipeline runs logged in `pipeline_runs` table (see `idempotency-and-incremental-loads` skill)
- Stage errors saved to `pipeline_errors` table (see `add-pipeline-stage` skill)
- Per-record error tracking already in each stage

## Failure Taxonomy

Treat different failures differently:

| Failure type | Example | Strategy |
|-------------|---------|----------|
| **Transient** | Network timeout, DB connection drop | Retry with exponential backoff |
| **Recoverable** | Rate limit hit on enrichment API | Retry after a delay |
| **Bad data** | Malformed record, schema violation | Dead-letter queue — do NOT retry |
| **Systemic** | Source DB down, credentials expired | Fail the run, alert, wait for operator |
| **Logic bug** | Code throws on a specific pattern | Dead-letter queue until bug is fixed |

## Step 1 — Retry Transient Errors with Exponential Backoff

Wrap calls to external systems (APIs, databases, queues) in a retry helper.

```typescript
// src/lib/retry.ts

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryOn?: (error: Error) => boolean;  // defaults to always retry
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs, retryOn } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Don't retry if the error is not retryable
      if (retryOn && !retryOn(lastError)) throw lastError;

      // Don't sleep after the last attempt
      if (attempt === maxAttempts) break;

      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,  // jitter
        maxDelayMs
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError!;
}

// Classify which errors are retryable
export function isRetryable(err: Error): boolean {
  const message = err.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("rate limit") ||
    (err as any).status === 429 ||
    (err as any).status === 503
  );
}
```

```typescript
// Usage in a stage
const tier = await withRetry(
  () => callTierLookupApi(email),
  {
    maxAttempts: 3,
    initialDelayMs: 200,
    maxDelayMs: 5000,
    retryOn: isRetryable,  // only retry network/rate limit errors, not 400 Bad Request
  }
);
```

## Step 2 — Dead-Letter Queue for Unrecoverable Records

A dead-letter queue (DLQ) holds records that cannot be processed — bad data, repeated API failures, logic bugs. They are quarantined rather than blocking the pipeline or being silently dropped.

```sql
-- supabase/migrations/010_pipeline_dlq.sql
CREATE TABLE pipeline_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  record JSONB NOT NULL,
  error_message TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,       -- set when manually resolved
  resolution_note TEXT           -- what was done to fix it
);

CREATE INDEX ON pipeline_dlq(pipeline_name, stage_name, resolved_at);
CREATE INDEX ON pipeline_dlq(last_failed_at) WHERE resolved_at IS NULL;
```

```typescript
// src/services/dlq.ts
export async function sendToDlq(
  db: Db,
  pipelineName: string,
  stageName: string,
  record: unknown,
  error: Error
): Promise<void> {
  // Upsert: if this record already failed before, increment attempt count
  await db.none(
    `INSERT INTO pipeline_dlq
       (pipeline_name, stage_name, record, error_message)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pipeline_name, stage_name, (record::text))
     DO UPDATE SET
       attempt_count = pipeline_dlq.attempt_count + 1,
       last_failed_at = NOW(),
       error_message = EXCLUDED.error_message`,
    [pipelineName, stageName, JSON.stringify(record), error.message]
  );
}

export async function getDlqItems(
  db: Db,
  pipelineName: string,
  stageName?: string
): Promise<DlqItem[]> {
  return db.any<DlqItem>(
    `SELECT * FROM pipeline_dlq
     WHERE pipeline_name = $1
       AND ($2::text IS NULL OR stage_name = $2)
       AND resolved_at IS NULL
     ORDER BY last_failed_at DESC`,
    [pipelineName, stageName ?? null]
  );
}

export async function resolveDlqItem(
  db: Db,
  dlqId: string,
  note: string
): Promise<void> {
  await db.none(
    "UPDATE pipeline_dlq SET resolved_at=NOW(), resolution_note=$2 WHERE id=$1",
    [dlqId, note]
  );
}
```

```typescript
// In a stage: send to DLQ instead of silent drop
for (const record of records) {
  try {
    results.push(await processRecord(record));
  } catch (err) {
    const error = err as Error;

    if (isRetryable(error)) {
      // Retried already (by withRetry) and still failed — transient but persistent
      await sendToDlq(db, pipelineName, "enrich", record, error);
    } else {
      // Bad data or logic error — send to DLQ immediately, no retry
      await sendToDlq(db, pipelineName, "enrich", record, error);
    }

    errors.push({ record, reason: error.message, stage: "enrich" });
  }
}
```

## Step 3 — Resume From Checkpoint After a Crash

A pipeline that processes 1M records and crashes at record 800k should not restart from zero. Use checkpoints.

```sql
-- Add to pipeline_runs table (or create pipeline_checkpoints table)
ALTER TABLE pipeline_runs ADD COLUMN checkpoint_offset INT DEFAULT 0;
ALTER TABLE pipeline_runs ADD COLUMN checkpoint_watermark TIMESTAMPTZ;
```

```typescript
// src/services/pipeline.ts — checkpointed pipeline orchestrator
export async function runUserPipelineWithCheckpoints(db: Db): Promise<void> {
  const BATCH_SIZE = 1000;
  const pipelineName = "user-enrichment";

  const watermarkFrom = await getLastCompletedWatermark(db, pipelineName);
  const watermarkTo = new Date();
  const runId = await startRun(db, pipelineName, watermarkFrom);

  try {
    let offset = 0;
    let totalProcessed = 0;
    let totalErrors = 0;

    while (true) {
      // Fetch next batch
      const batch = await extractUsersBatch(db, watermarkFrom, watermarkTo, offset, BATCH_SIZE);
      if (batch.length === 0) break;

      // Process the batch through all stages
      const result = await processBatch(db, batch, runId);
      totalProcessed += result.processed;
      totalErrors += result.errored;

      // Save checkpoint — if we crash here, resume from this offset
      offset += batch.length;
      await db.none(
        "UPDATE pipeline_runs SET checkpoint_offset=$2, checkpoint_watermark=$3 WHERE id=$1",
        [runId, offset, watermarkTo]
      );
    }

    await completeRun(db, runId, watermarkTo, { processed: totalProcessed, errored: totalErrors });
  } catch (err) {
    await failRun(db, runId, err as Error);
    throw err;
  }
}

// For resuming a failed run instead of starting fresh:
export async function resumeFailedRun(db: Db, runId: string): Promise<void> {
  const run = await db.one(
    "SELECT * FROM pipeline_runs WHERE id=$1 AND status='failed'",
    [runId]
  );

  // Resume from where the last checkpoint left off
  await runUserPipelineWithCheckpoints(db, {
    watermarkFrom: run.watermark_from,
    startOffset: run.checkpoint_offset ?? 0,
    runId, // reuse the same run ID
  });
}
```

## Step 4 — Alert on Systemic Failures

A pipeline that silently fails half the records is worse than one that fails loudly.

```typescript
// src/lib/pipeline-alerts.ts

interface AlertThresholds {
  maxErrorRatePercent: number;   // fail the pipeline if errors > this % of records
  maxDlqUnresolved: number;      // alert if unresolved DLQ items exceed this count
  maxRunDurationMs: number;      // alert if pipeline takes longer than this
}

const THRESHOLDS: AlertThresholds = {
  maxErrorRatePercent: 5,
  maxDlqUnresolved: 100,
  maxRunDurationMs: 30 * 60 * 1000, // 30 minutes
};

export function assertErrorRate(processed: number, errored: number): void {
  if (processed === 0) return;
  const rate = (errored / processed) * 100;
  if (rate > THRESHOLDS.maxErrorRatePercent) {
    throw new Error(
      `Pipeline error rate ${rate.toFixed(1)}% exceeds threshold ${THRESHOLDS.maxErrorRatePercent}%`
    );
  }
}

export async function checkDlqHealth(db: Db, pipelineName: string): Promise<void> {
  const { count } = await db.one<{ count: number }>(
    "SELECT COUNT(*) as count FROM pipeline_dlq WHERE pipeline_name=$1 AND resolved_at IS NULL",
    [pipelineName]
  );
  if (count > THRESHOLDS.maxDlqUnresolved) {
    await sendAlert(
      `⚠️ Pipeline ${pipelineName}: ${count} unresolved DLQ items — manual review required`
    );
  }
}

async function sendAlert(message: string): Promise<void> {
  // Integrate with your alerting system: PagerDuty, Slack, email
  // In the workbench, you can use rag_ingest to log alerts or bus_publish to an alerts channel
  await fetch(process.env.ALERT_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}
```

## Step 5 — Reprocess DLQ Items After a Fix

When the bug causing DLQ entries is fixed, reprocess them:

```typescript
// src/services/dlq-reprocess.ts
export async function reprocessDlq(
  db: Db,
  pipelineName: string,
  stageName: string
): Promise<{ reprocessed: number; stillFailing: number }> {
  const items = await getDlqItems(db, pipelineName, stageName);

  let reprocessed = 0;
  let stillFailing = 0;

  for (const item of items) {
    try {
      // Run the record through the fixed stage
      const result = await processRecord(item.record);
      await upsertRecord(db, result);
      await resolveDlqItem(db, item.id, "Reprocessed successfully after bug fix");
      reprocessed++;
    } catch (err) {
      // Still failing — leave in DLQ, update attempt count
      await sendToDlq(db, pipelineName, stageName, item.record, err as Error);
      stillFailing++;
    }
  }

  return { reprocessed, stillFailing };
}
```

## Monitoring Queries

```sql
-- Current DLQ status by pipeline and stage
SELECT pipeline_name, stage_name, COUNT(*) as unresolved, MAX(last_failed_at) as last_failure
FROM pipeline_dlq
WHERE resolved_at IS NULL
GROUP BY pipeline_name, stage_name
ORDER BY last_failure DESC;

-- Recent pipeline run health
SELECT pipeline_name, status, records_processed, records_errored,
       ROUND(100.0 * records_errored / NULLIF(records_processed, 0), 2) as error_rate_pct,
       ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60, 1) as duration_min,
       started_at
FROM pipeline_runs
ORDER BY started_at DESC
LIMIT 20;

-- Most common error reasons
SELECT stage_name, error_message, COUNT(*) as occurrences
FROM pipeline_dlq
WHERE pipeline_name = 'user-enrichment' AND resolved_at IS NULL
GROUP BY stage_name, error_message
ORDER BY occurrences DESC;
```

## Checklist

- [ ] `withRetry` wraps all calls to external systems (APIs, queues), with `isRetryable` classification
- [ ] Retry uses exponential backoff with jitter — not a fixed sleep
- [ ] `pipeline_dlq` table exists; all per-record failures write to it (not just logged)
- [ ] DLQ entries are never silently dropped — they require explicit resolution
- [ ] Pipeline run log updated to checkpoint offset on each batch
- [ ] `assertErrorRate()` called after each stage — fails the run if error rate exceeds threshold
- [ ] `checkDlqHealth()` runs after each completed pipeline — alerts on accumulation
- [ ] `reprocessDlq()` function exists and is tested
- [ ] All three failure types tested: transient (retried), bad data (DLQ), systemic (run fails)

## Files involved

| File | Action |
|------|--------|
| `src/lib/retry.ts` | Create: `withRetry`, `isRetryable` |
| `src/lib/pipeline-alerts.ts` | Create: `assertErrorRate`, `checkDlqHealth`, `sendAlert` |
| `src/services/dlq.ts` | Create: `sendToDlq`, `getDlqItems`, `resolveDlqItem` |
| `src/services/dlq-reprocess.ts` | Create: `reprocessDlq` |
| `supabase/migrations/010_pipeline_dlq.sql` | Create: `pipeline_dlq` table |
| `src/services/pipeline.ts` | Update: add checkpoints, `assertErrorRate`, `checkDlqHealth` |
| `src/lib/stages/*.ts` | Update: replace `errors.push()` with `sendToDlq()` for unrecoverable errors |

## Common mistakes

**Retrying bad data** — a record that fails Zod validation will fail every time. Retrying it wastes time and inflates error counts. Classify errors: only retry transient ones, DLQ everything else immediately.

**Fixed sleep between retries** — `sleep(1000)` between retries means 1000 concurrent failures all retry at the same second, amplifying load on an already-struggling system. Exponential backoff with jitter spreads the load.

**Silent drops** — `catch (err) { continue; }` is the worst failure mode. The record disappears, there's no count, no log, no way to recover it. Every caught error must end up in either a retry, a DLQ entry, or a counted error in the run log.

**No error rate threshold** — a pipeline where 30% of records fail every run might still "complete successfully" if the code never checks the rate. Add `assertErrorRate()` as a mandatory step, not an optional check.

**DLQ that grows forever** — a DLQ is not a graveyard. Set up a weekly review or an alert at 100+ unresolved items. DLQ items represent real data that didn't reach its destination; ignoring them means the system is reporting false completeness.
