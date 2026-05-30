---
name: add-pipeline-stage
description: Add a new processing stage to an existing data pipeline — define the stage contract, implement the transform, wire it into the pipeline, and test it in isolation before integration
domain: data-pipeline
type: data-pipeline
triggers:
  - "add pipeline stage"
  - "new stage"
  - "add transform"
  - "add step"
  - "extend the pipeline"
  - "add processing step"
  - "ETL stage"
  - "data transformation"
---

# Add a Pipeline Stage

## When to use

When an existing pipeline needs a new processing step — a new transformation, validation pass, enrichment, or filter. Activate when the user says "add a step that...", "we need to also process X", "before loading, we need to...", or "add an enrichment stage."

## Prerequisites

- Existing pipeline with at least one stage working end-to-end
- Clear definition of: what data comes in, what should come out, what the stage does when input is invalid
- Test data (sample input rows) available

## Pipeline Stage Contract

Every stage in the workbench follows the same shape: it receives a batch of records, transforms them, and returns a result that includes successes, failures, and a count. Stages never write to the final destination — that's the load step.

```typescript
// The contract every stage must satisfy
interface StageResult<TOut> {
  records: TOut[];          // successfully transformed records
  errors: StageError[];     // records that failed, with reason
  skipped: number;          // records intentionally dropped (filtered out)
}

interface StageError {
  record: unknown;           // the original record that failed
  reason: string;            // human-readable reason
  stage: string;             // which stage failed
}

// A stage function
type Stage<TIn, TOut> = (
  records: TIn[],
  context: StageContext
) => Promise<StageResult<TOut>>;

interface StageContext {
  pipelineId: string;        // for logging / tracing
  runId: string;             // unique per pipeline execution
  logger: Logger;
}
```

## Steps

### 1. Define the input and output schemas

Before writing any logic, define what comes in and what goes out. Use Zod for both.

```typescript
// src/schemas/pipeline/<stage-name>.ts
import { z } from "zod";

// What this stage receives
export const EnrichmentInputSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  signupDate: z.coerce.date(),
});

// What this stage produces
export const EnrichmentOutputSchema = EnrichmentInputSchema.extend({
  emailDomain: z.string(),           // derived field
  accountAgeDays: z.number().int(),  // derived field
  tier: z.enum(["free", "pro", "enterprise"]).optional(), // enriched from external
});

export type EnrichmentInput = z.infer<typeof EnrichmentInputSchema>;
export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;
```

### 2. Implement the stage as a pure function

Put all transformation logic in `src/lib/stages/<stage-name>.ts`. Keep it pure — no database calls, no API calls directly in this file. Side-effectful dependencies come in through `context` or as injected functions.

```typescript
// src/lib/stages/enrich-user.ts
import type { Stage, StageResult } from "../pipeline";
import type { EnrichmentInput, EnrichmentOutput } from "../../schemas/pipeline/enrich-user";

export function createEnrichUserStage(
  // Inject side-effectful dependencies so the pure logic is testable
  lookupTier: (email: string) => Promise<string | null>
): Stage<EnrichmentInput, EnrichmentOutput> {
  return async (records, context): Promise<StageResult<EnrichmentOutput>> => {
    const results: EnrichmentOutput[] = [];
    const errors = [];

    for (const record of records) {
      try {
        const emailDomain = record.email.split("@")[1];
        const accountAgeDays = Math.floor(
          (Date.now() - record.signupDate.getTime()) / 86_400_000
        );
        const tier = await lookupTier(record.email) ?? undefined;

        results.push({ ...record, emailDomain, accountAgeDays, tier });
      } catch (err) {
        errors.push({
          record,
          reason: err instanceof Error ? err.message : String(err),
          stage: "enrich-user",
        });
        context.logger.warn({ record, err }, "enrich-user: failed to process record");
      }
    }

    context.logger.info(
      { processed: results.length, failed: errors.length },
      "enrich-user: stage complete"
    );

    return { records: results, errors, skipped: 0 };
  };
}
```

### 3. Wire the stage into the pipeline runner

```typescript
// src/services/pipeline.ts
import { createEnrichUserStage } from "../lib/stages/enrich-user";
import { lookupUserTier } from "./tier-lookup"; // the real side-effectful implementation

export async function runUserPipeline(db: Db, runId: string): Promise<PipelineReport> {
  const context: StageContext = {
    pipelineId: "user-enrichment",
    runId,
    logger: createLogger({ pipeline: "user-enrichment", runId }),
  };

  // Extract
  const rawUsers = await extractUsers(db, runId);

  // Stage 1 (existing): normalize emails
  const normalized = await normalizeEmailStage(rawUsers, context);
  await recordStageMetrics(db, runId, "normalize", normalized);

  // Stage 2 (new): enrich with tier and derived fields
  const enrichStage = createEnrichUserStage(lookupUserTier);
  const enriched = await enrichStage(normalized.records, context);
  await recordStageMetrics(db, runId, "enrich", enriched);

  // Handle errors from new stage before proceeding
  if (enriched.errors.length > 0) {
    await saveErrorBatch(db, runId, "enrich", enriched.errors);
  }

  // Load (only successful records)
  await loadUsers(db, enriched.records);

  return buildReport(runId, [normalized, enriched]);
}
```

### 4. Record stage metrics

Every stage should record its output so you can monitor for regressions without digging through logs.

```sql
-- supabase/migrations/008_pipeline_stage_metrics.sql
CREATE TABLE pipeline_stage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  records_in INT NOT NULL,
  records_out INT NOT NULL,
  errors INT NOT NULL,
  skipped INT NOT NULL,
  duration_ms INT,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  record JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON pipeline_stage_metrics(run_id);
CREATE INDEX ON pipeline_errors(run_id, stage_name);
```

```typescript
// src/services/pipeline-metrics.ts
export async function recordStageMetrics(
  db: Db,
  runId: string,
  stageName: string,
  result: StageResult<unknown>,
  durationMs?: number
): Promise<void> {
  await db.none(
    `INSERT INTO pipeline_stage_metrics
       (run_id, stage_name, records_in, records_out, errors, skipped, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [runId, stageName, result.records.length + result.errors.length + result.skipped,
     result.records.length, result.errors.length, result.skipped, durationMs ?? null]
  );
}
```

### 5. Test the stage in isolation

Test the pure stage function directly — no pipeline runner, no database needed.

```typescript
// src/__tests__/lib/stages/enrich-user.test.ts
import { createEnrichUserStage } from "../../../lib/stages/enrich-user";

const mockLookupTier = vi.fn();
const mockContext = {
  pipelineId: "test",
  runId: "test-run-1",
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

describe("enrich-user stage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enriches a record with email domain and account age", async () => {
    mockLookupTier.mockResolvedValue("pro");
    const stage = createEnrichUserStage(mockLookupTier);

    const result = await stage([{
      userId: "00000000-0000-0000-0000-000000000001",
      email: "alice@acme.com",
      signupDate: new Date(Date.now() - 30 * 86_400_000), // 30 days ago
    }], mockContext);

    expect(result.errors).toHaveLength(0);
    expect(result.records[0].emailDomain).toBe("acme.com");
    expect(result.records[0].accountAgeDays).toBe(30);
    expect(result.records[0].tier).toBe("pro");
  });

  it("records an error and continues when tier lookup throws", async () => {
    mockLookupTier.mockRejectedValue(new Error("timeout"));
    const stage = createEnrichUserStage(mockLookupTier);

    const result = await stage([{
      userId: "00000000-0000-0000-0000-000000000002",
      email: "bob@example.com",
      signupDate: new Date(),
    }], mockContext);

    expect(result.records).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain("timeout");
    expect(result.errors[0].stage).toBe("enrich-user");
  });

  it("processes multiple records and handles partial failures", async () => {
    mockLookupTier
      .mockResolvedValueOnce("free")
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce("enterprise");

    const stage = createEnrichUserStage(mockLookupTier);
    const result = await stage(
      [/* 3 records */],
      mockContext
    );

    expect(result.records).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });
});
```

### 6. Add a data quality assertion for the new stage

After adding the stage, add a quality check that runs post-load:

```typescript
// src/lib/pipeline-assertions.ts
export async function assertEnrichmentQuality(db: Db, runId: string): Promise<void> {
  const { nullEmailDomains } = await db.one<{ nullEmailDomains: number }>(
    "SELECT COUNT(*) as \"nullEmailDomains\" FROM enriched_users WHERE email_domain IS NULL"
  );
  if (nullEmailDomains > 0) {
    throw new Error(`Data quality failure: ${nullEmailDomains} rows with null email_domain after enrichment`);
  }

  const { errorRate } = await db.one<{ errorRate: number }>(
    `SELECT (errors::float / NULLIF(records_in, 0)) as "errorRate"
     FROM pipeline_stage_metrics WHERE run_id = $1 AND stage_name = 'enrich'`,
    [runId]
  );
  if (errorRate > 0.05) {
    throw new Error(`Error rate too high in enrich stage: ${(errorRate * 100).toFixed(1)}%`);
  }
}
```

## Templates

### Stage function skeleton

```typescript
// src/lib/stages/<stage-name>.ts
import type { Stage, StageResult } from "../pipeline";
import type { InputType, OutputType } from "../../schemas/pipeline/<stage-name>";

export function create<StageName>Stage(/* injected deps */): Stage<InputType, OutputType> {
  return async (records, context): Promise<StageResult<OutputType>> => {
    const results: OutputType[] = [];
    const errors = [];

    for (const record of records) {
      try {
        // transform here
        results.push({ ...record /* + derived fields */ });
      } catch (err) {
        errors.push({
          record,
          reason: err instanceof Error ? err.message : String(err),
          stage: "<stage-name>",
        });
      }
    }

    context.logger.info({ processed: results.length, failed: errors.length }, "<stage-name>: done");
    return { records: results, errors, skipped: 0 };
  };
}
```

## Checklist

- [ ] Input and output Zod schemas defined before implementation
- [ ] Stage implemented as a pure function — side effects injected, not imported directly
- [ ] Stage never throws; all per-record failures go to `errors` array
- [ ] Stage wired into pipeline runner after existing stages
- [ ] `recordStageMetrics()` called after each stage execution
- [ ] Errors saved to `pipeline_errors` table for later inspection
- [ ] At least 3 unit tests: happy path, single failure, partial batch failure
- [ ] Data quality assertion added for the new stage's output
- [ ] Pipeline ran end-to-end with real data and metrics verified in the DB

## Files involved

| File | Action |
|------|--------|
| `src/schemas/pipeline/<stage-name>.ts` | Create: input + output Zod schemas |
| `src/lib/stages/<stage-name>.ts` | Create: pure stage function |
| `src/services/pipeline.ts` | Update: wire new stage into the runner |
| `src/__tests__/lib/stages/<stage-name>.test.ts` | Create: isolation tests |
| `supabase/migrations/008_pipeline_stage_metrics.sql` | Create (if not exists): metrics tables |

## Common mistakes

**Throwing on per-record errors** — a single bad record should not abort the entire batch. Catch per-record errors, add them to the `errors` array, and continue. Let the pipeline decide at the end whether the error rate is acceptable.

**Side effects directly in the pure function** — `import { db } from "../../services/db"` inside a stage function makes it untestable without a real database. Inject dependencies through the constructor or the `context` argument.

**No error rate threshold** — 100% of records failing is hard to miss, but 5% failing silently over millions of rows costs real money or causes real data quality issues. Always add an assertion that fails the pipeline if error rate exceeds a threshold.

**Stages that know about downstream stages** — a stage should produce its output without knowing what comes next. If a stage starts making decisions based on "what the loader will do with this", it's coupling the pipeline in a way that makes reordering or replacing stages impossible.
