---
name: idempotency-and-incremental-loads
description: Make a pipeline idempotent and incremental — use watermarks to process only new data, use upserts to make re-runs safe, and track what has been processed to avoid duplicates
domain: data-pipeline
type: data-pipeline
triggers:
  - "idempotent pipeline"
  - "incremental load"
  - "avoid duplicates"
  - "watermark"
  - "only process new data"
  - "re-run safe"
  - "deduplication"
  - "upsert"
  - "change data capture"
  - "cursor"
---

# Idempotency and Incremental Loads

## When to use

When a pipeline needs to run repeatedly (scheduled cron, event-triggered, or manually re-run) without producing duplicate data or reprocessing records already handled. Activate when the user asks "how do I avoid duplicates?", "can I re-run the pipeline safely?", "how do I only process new records?", or when a pipeline is doing full-table scans on every run.

## Prerequisites

- Existing pipeline with at least one working stage (see `add-pipeline-stage` skill)
- Source data has a timestamp or monotonically increasing ID that indicates record age/order
- Destination table exists with a natural or surrogate key for upserts

## Two Problems, Two Solutions

| Problem | Solution |
|---------|----------|
| Processing records that have already been processed | **Watermarks** — track the high-water mark and only fetch newer records |
| Re-running a stage producing duplicate output | **Idempotent writes** — upserts that replace rather than insert |

Both are needed. A pipeline is idempotent if re-running it produces the same final state. It is incremental if it processes only the new data since the last run.

## Step 1 — Create a Pipeline Run Log

Every pipeline execution needs a record. This enables watermarks, audit trails, and safe re-runs.

```sql
-- supabase/migrations/009_pipeline_runs.sql
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  watermark_from TIMESTAMPTZ,   -- the watermark this run started from
  watermark_to TIMESTAMPTZ,     -- the watermark this run advanced to
  records_processed INT DEFAULT 0,
  records_errored INT DEFAULT 0,
  error_message TEXT
);

CREATE INDEX ON pipeline_runs(pipeline_name, status);
CREATE INDEX ON pipeline_runs(pipeline_name, completed_at DESC);
```

```typescript
// src/services/pipeline-runs.ts
export async function startRun(
  db: Db,
  pipelineName: string,
  watermarkFrom: Date | null
): Promise<string> {
  const { id } = await db.one<{ id: string }>(
    `INSERT INTO pipeline_runs (pipeline_name, watermark_from)
     VALUES ($1, $2) RETURNING id`,
    [pipelineName, watermarkFrom]
  );
  return id;
}

export async function completeRun(
  db: Db,
  runId: string,
  watermarkTo: Date,
  counts: { processed: number; errored: number }
): Promise<void> {
  await db.none(
    `UPDATE pipeline_runs
     SET status='completed', completed_at=NOW(),
         watermark_to=$2, records_processed=$3, records_errored=$4
     WHERE id=$1`,
    [runId, watermarkTo, counts.processed, counts.errored]
  );
}

export async function failRun(db: Db, runId: string, error: Error): Promise<void> {
  await db.none(
    `UPDATE pipeline_runs
     SET status='failed', completed_at=NOW(), error_message=$2
     WHERE id=$1`,
    [runId, error.message]
  );
}

export async function getLastCompletedWatermark(
  db: Db,
  pipelineName: string
): Promise<Date | null> {
  const row = await db.oneOrNone<{ watermark_to: Date }>(
    `SELECT watermark_to FROM pipeline_runs
     WHERE pipeline_name=$1 AND status='completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [pipelineName]
  );
  return row?.watermark_to ?? null;
}
```

## Step 2 — Extract Only New Records Using a Watermark

```typescript
// src/services/extract.ts

export async function extractNewUsers(
  db: Db,
  watermarkFrom: Date | null,
  watermarkTo: Date
): Promise<User[]> {
  if (watermarkFrom === null) {
    // First run: process everything up to watermarkTo
    return db.any<User>(
      "SELECT * FROM source_users WHERE created_at <= $1 ORDER BY created_at",
      [watermarkTo]
    );
  }

  // Subsequent runs: only records created after the last completed run
  return db.any<User>(
    "SELECT * FROM source_users WHERE created_at > $1 AND created_at <= $2 ORDER BY created_at",
    [watermarkFrom, watermarkTo]
  );
}

// src/services/pipeline.ts — the orchestrator
export async function runUserPipeline(db: Db): Promise<PipelineReport> {
  const pipelineName = "user-enrichment";

  // 1. Determine the watermark window for this run
  const watermarkFrom = await getLastCompletedWatermark(db, pipelineName);
  const watermarkTo = new Date();  // process everything up to "now"

  // 2. Register this run
  const runId = await startRun(db, pipelineName, watermarkFrom);

  try {
    // 3. Extract only new records
    const rawUsers = await extractNewUsers(db, watermarkFrom, watermarkTo);

    if (rawUsers.length === 0) {
      await completeRun(db, runId, watermarkTo, { processed: 0, errored: 0 });
      return { runId, status: "completed", message: "No new records to process" };
    }

    // 4. Run the stages
    const context = buildContext(pipelineName, runId);
    const normalized = await normalizeEmailStage(rawUsers, context);
    const enriched = await enrichUserStage(normalized.records, context);

    // 5. Load with upsert (see Step 3)
    await upsertUsers(db, enriched.records);

    // 6. Advance the watermark only if everything succeeded
    await completeRun(db, runId, watermarkTo, {
      processed: enriched.records.length,
      errored: enriched.errors.length,
    });

    return buildReport(runId, watermarkFrom, watermarkTo, [normalized, enriched]);
  } catch (err) {
    await failRun(db, runId, err as Error);
    throw err;
  }
}
```

**Important:** Only advance the watermark after a successful run. If the run fails halfway through, the next run re-processes from the last successful watermark. This guarantees at-least-once processing — the idempotent load (Step 3) handles the duplicates.

## Step 3 — Load with Upserts (Idempotent Writes)

An upsert means: insert if the record doesn't exist, update if it does. Re-running produces the same final state.

```typescript
// src/services/load.ts

export async function upsertUsers(db: Db, users: EnrichedUser[]): Promise<void> {
  if (users.length === 0) return;

  // Batch upsert for performance
  // ON CONFLICT: identifies the unique key (userId is the natural key)
  // DO UPDATE SET: lists every non-key column that should be overwritten
  const values = users.map((u) => [
    u.userId, u.email, u.emailDomain, u.accountAgeDays, u.tier ?? null, new Date()
  ]);

  await db.none(
    `INSERT INTO enriched_users
       (user_id, email, email_domain, account_age_days, tier, updated_at)
     VALUES ${values.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`).join(",")}
     ON CONFLICT (user_id)
     DO UPDATE SET
       email = EXCLUDED.email,
       email_domain = EXCLUDED.email_domain,
       account_age_days = EXCLUDED.account_age_days,
       tier = EXCLUDED.tier,
       updated_at = EXCLUDED.updated_at`,
    values.flat()
  );
}
```

**When upserts are not enough:** If the source can delete records, you also need to handle deletes. Options:
- **Soft deletes**: add a `deleted_at` column to the destination, upsert with `deleted_at = source.deleted_at`
- **Full refresh of a time window**: delete + re-insert for the watermark window (safe if the window is deterministic)
- **CDC (Change Data Capture)**: stream inserts, updates, AND deletes from the source DB (Debezium, Fivetran). Overkill for most cases.

## Step 4 — Handle Overlapping Watermark Windows

For sources where records can be updated after creation (not just inserted), use an `updated_at` watermark instead of `created_at`:

```typescript
export async function extractUpdatedUsers(
  db: Db,
  watermarkFrom: Date | null,
  watermarkTo: Date
): Promise<User[]> {
  // Uses updated_at — catches records modified after the last run, even if created before
  const since = watermarkFrom ?? new Date(0);
  return db.any<User>(
    "SELECT * FROM source_users WHERE updated_at > $1 AND updated_at <= $2",
    [since, watermarkTo]
  );
}
```

**Add a buffer to the watermark** for distributed systems where clock skew is possible:

```typescript
// Watermark with 5-minute buffer: re-process records from the last 5 minutes
// to catch any that were written slightly after the previous run's watermark_to
const watermarkFrom = lastWatermark
  ? new Date(lastWatermark.getTime() - 5 * 60 * 1000)
  : null;
```

The upsert handles duplicates from the overlap; the buffer ensures no records fall through the gap.

## Step 5 — Make Individual Stages Idempotent

Beyond the load step, individual stages can be idempotent by caching results:

```typescript
// If an enrichment API call is expensive, cache results by input hash
export async function idempotentEnrich(
  db: Db,
  userId: string,
  email: string
): Promise<{ tier: string | null }> {
  // Check cache first
  const cached = await db.oneOrNone<{ tier: string }>(
    "SELECT tier FROM enrichment_cache WHERE user_id = $1 AND expires_at > NOW()",
    [userId]
  );
  if (cached) return cached;

  // Call the expensive API
  const tier = await callTierLookupApi(email);

  // Cache the result (expire after 24 hours)
  await db.none(
    `INSERT INTO enrichment_cache (user_id, tier, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '24 hours')
     ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, expires_at = EXCLUDED.expires_at`,
    [userId, tier]
  );

  return { tier };
}
```

## Testing Idempotency

```typescript
// src/__tests__/services/pipeline.test.ts

it("produces the same result when run twice on the same data", async () => {
  await runUserPipeline(db);
  const firstRunCount = await db.one<{count: string}>("SELECT COUNT(*) FROM enriched_users");

  // Re-run with same data
  await runUserPipeline(db);
  const secondRunCount = await db.one<{count: string}>("SELECT COUNT(*) FROM enriched_users");

  // Count must be identical — no duplicates
  expect(secondRunCount.count).toBe(firstRunCount.count);
});

it("processes only new records on the second run", async () => {
  await runUserPipeline(db); // run 1: processes 10 records
  const run1 = await getLastCompletedRun(db, "user-enrichment");
  expect(run1.records_processed).toBe(10);

  // Insert 3 new records
  await insertTestUsers(db, 3, { createdAt: new Date() });

  await runUserPipeline(db); // run 2: should process only 3
  const run2 = await getLastCompletedRun(db, "user-enrichment");
  expect(run2.records_processed).toBe(3);
});

it("re-processes a window if the previous run failed", async () => {
  // First run fails mid-way
  vi.spyOn(enrichUserStage, "run").mockRejectedValueOnce(new Error("network timeout"));
  await expect(runUserPipeline(db)).rejects.toThrow();

  const failedRun = await getLastRun(db, "user-enrichment");
  expect(failedRun.status).toBe("failed");
  // Watermark was NOT advanced
  expect(failedRun.watermark_to).toBeNull();

  // Second run re-processes the same window
  vi.restoreAllMocks();
  await runUserPipeline(db);
  const successRun = await getLastRun(db, "user-enrichment");
  expect(successRun.status).toBe("completed");
});
```

## Checklist

- [ ] `pipeline_runs` table exists with `watermark_from`, `watermark_to`, `status` columns
- [ ] Extract query uses `watermark_from` / `watermark_to` bounds (not full-table scan)
- [ ] Watermark is only advanced after successful completion (not before, not on failure)
- [ ] Load step uses `INSERT ... ON CONFLICT DO UPDATE` (never blind INSERT)
- [ ] All non-key destination columns are included in the `DO UPDATE SET` clause
- [ ] Watermark uses `updated_at` if records can be modified after creation
- [ ] Optional: 5-minute buffer on watermark for clock skew in distributed systems
- [ ] Three tests: idempotent re-run, incremental (only new records), failed-run re-processes

## Files involved

| File | Action |
|------|--------|
| `supabase/migrations/009_pipeline_runs.sql` | Create: `pipeline_runs` table |
| `src/services/pipeline-runs.ts` | Create: `startRun`, `completeRun`, `failRun`, `getLastCompletedWatermark` |
| `src/services/extract.ts` | Update: add `watermarkFrom`/`watermarkTo` parameters to extract queries |
| `src/services/load.ts` | Update: replace INSERT with `INSERT ... ON CONFLICT DO UPDATE` |
| `src/services/pipeline.ts` | Update: orchestrate run log + watermark + error handling |

## Common mistakes

**Advancing the watermark before the load completes** — if you save `watermark_to` before the upsert finishes and the upsert fails, the next run skips those records. Always advance the watermark as the last action in a successful run.

**Full table scans on every run** — `SELECT * FROM source_users` on a table with 100M rows every hour is how you create resource contention, slow pipelines, and expensive cloud bills. Always filter by the watermark window.

**Blind INSERT without ON CONFLICT** — if a record was processed by a previous run and is re-fetched due to the buffer window, a plain INSERT will fail with a unique constraint violation or produce a duplicate row. Upserts are the contract.

**Watermark on `created_at` when records can be updated** — if a user's email changes after creation, an `updated_at` watermark catches it; a `created_at` watermark misses it forever. Know your source data's update pattern.

**One watermark for a pipeline that reads multiple sources** — if your pipeline extracts from two tables with different update frequencies, each source needs its own watermark tracked independently. Don't share a single `watermark_to` across sources with different semantics.
