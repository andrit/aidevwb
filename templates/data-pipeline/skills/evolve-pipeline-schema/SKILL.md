---
name: evolve-pipeline-schema
description: Change the schema of records flowing through a pipeline without breaking stages — use backward and forward compatibility rules, schema versioning, and rolling upgrade strategies from DDIA Chapter 4
domain: data-pipeline
type: data-pipeline
triggers:
  - "schema change"
  - "schema evolution"
  - "change a field"
  - "rename a column"
  - "add a field to the pipeline"
  - "backward compatible"
  - "breaking schema change"
  - "schema version"
  - "pipeline schema migration"
---

# Evolve a Pipeline Schema

## When to use

When the shape of records flowing through a pipeline needs to change — adding a field, removing a field, renaming, or changing a type. Pipeline schema changes are riskier than database schema changes because they affect in-flight records, multiple downstream stages, and consumers that may be deployed at different versions. Activate when a user says "I need to add a field to the pipeline", "can I rename this column", or "a new field is required in the output."

## Prerequisites

- Existing pipeline with Zod-validated input/output schemas (see `add-pipeline-stage`)
- Understanding of which downstream stages consume the field being changed
- Deployment plan: will all stages be updated simultaneously or rolling?

## Compatibility Rules (from DDIA Chapter 4)

Before touching any schema, classify the change:

| Change | Backward compatible? | Forward compatible? | Strategy |
|--------|---------------------|--------------------|---------| 
| Add optional field | ✓ Yes | ✓ Yes | Safe — do it |
| Add required field | ✗ No | ✓ Yes | Add as optional first, backfill, make required later |
| Remove field | ✓ Yes | ✗ No | Keep old field for one version, then remove |
| Rename field | ✗ No | ✗ No | Add new name + keep old name, migrate consumers, remove old name |
| Change type (string→int) | ✗ No | ✗ No | Add new field with new type, migrate, remove old |
| Narrow enum values | ✗ No | ✗ No | Same as rename — add new enum, migrate |
| Widen enum values | ✓ Yes | ✗ No | Consumers must handle unknown values |

**Backward compatible** = old readers can read new data.  
**Forward compatible** = new readers can read old data (in-flight or from an earlier run).

## Step 1 — Add a `schemaVersion` Field

Add a version field to every pipeline record schema. This makes evolution explicit and testable.

```typescript
// src/schemas/pipeline/user-record.ts

// Version 1 — original
export const UserRecordV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  userId: z.string().uuid(),
  email: z.string().email(),
  signupDate: z.coerce.date(),
});

// Version 2 — added emailDomain (optional for backward compat), removed nothing
export const UserRecordV2 = z.object({
  schemaVersion: z.literal(2).default(2),
  userId: z.string().uuid(),
  email: z.string().email(),
  signupDate: z.coerce.date(),
  emailDomain: z.string().optional(),   // optional in V2 — present in new records, absent in old
});

// Union parser: handles both versions
export const UserRecord = z.discriminatedUnion("schemaVersion", [
  UserRecordV1,
  UserRecordV2,
]);

export type UserRecordV1 = z.infer<typeof UserRecordV1>;
export type UserRecordV2 = z.infer<typeof UserRecordV2>;
export type UserRecord = z.infer<typeof UserRecord>;
```

## Step 2 — Safe Change: Add an Optional Field (No Disruption)

```typescript
// Stage that produces V2 records
export function createEnrichStage(): Stage<UserRecordV1 | UserRecordV2, UserRecordV2> {
  return async (records, context) => {
    const results: UserRecordV2[] = [];
    for (const record of records) {
      results.push({
        ...record,
        schemaVersion: 2,
        emailDomain: record.email.split("@")[1],
      });
    }
    return { records: results, errors: [], skipped: 0 };
  };
}

// Downstream stages: use .optional() and handle absence
function processEmailDomain(record: UserRecordV2): void {
  const domain = record.emailDomain ?? record.email.split("@")[1]; // fallback for old records
}
```

**Deployment:** Update producer stage first. Consumers already tolerate absent field (optional). No coordination required.

## Step 3 — Unsafe Change: Rename a Field (Requires Migration Window)

Never rename in one step. Use a three-phase migration:

```typescript
// Phase 1: Add the new name alongside the old name
export const UserRecordV3 = z.object({
  schemaVersion: z.literal(3).default(3),
  userId: z.string().uuid(),
  email: z.string().email(),
  signupDate: z.coerce.date(),
  emailDomain: z.string().optional(),   // old name — kept for compatibility
  domain: z.string().optional(),         // new name — added in V3
});

// Phase 2: Producer writes BOTH fields (so any consumer — old or new — can read it)
function upgradeRecord(record: UserRecordV2): UserRecordV3 {
  return {
    ...record,
    schemaVersion: 3,
    emailDomain: record.emailDomain,          // old — still present
    domain: record.emailDomain,               // new — added
  };
}

// Phase 3 (after ALL consumers migrated to read `domain`):
// Remove `emailDomain` in a new version bump
export const UserRecordV4 = z.object({
  schemaVersion: z.literal(4).default(4),
  userId: z.string().uuid(),
  email: z.string().email(),
  signupDate: z.coerce.date(),
  domain: z.string(),                          // required now — old field gone
});
```

**Deployment order for rename:**
1. Deploy Phase 1 (add new field): producers write both, consumers still read old
2. Deploy consumers to read new field
3. Deploy Phase 2: producers write both + old is now optional
4. Wait for all in-flight records to drain (one full pipeline run)
5. Deploy Phase 3: remove old field

## Step 4 — Unsafe Change: Remove a Field

```typescript
// Phase 1: Mark the field as optional (so consumers handle its absence)
export const UserRecordV3 = UserRecordV2.extend({
  schemaVersion: z.literal(3).default(3),
  internalScore: z.number().optional(),   // was required, now optional — safe for consumers
});

// Phase 2: After all consumers no longer read internalScore, remove it entirely
export const UserRecordV4 = z.object({
  schemaVersion: z.literal(4).default(4),
  userId: z.string().uuid(),
  email: z.string().email(),
  // internalScore removed
});
```

**Never remove a field in one step if consumers are in production.** Make it optional first, wait one full deploy cycle, then remove.

## Step 5 — Upgrade In-Flight Records

When a pipeline run starts, some records may have been written by an earlier stage at an older schema version. The upgrade step normalizes them.

```typescript
// src/lib/schema-upgrade.ts

export function upgradeUserRecord(raw: unknown): UserRecordV4 {
  const versioned = z.object({ schemaVersion: z.number().default(1) }).parse(raw);

  switch (versioned.schemaVersion) {
    case 1: {
      const v1 = UserRecordV1.parse(raw);
      return upgradeUserRecord({ ...v1, schemaVersion: 2, emailDomain: v1.email.split("@")[1] });
    }
    case 2: {
      const v2 = UserRecordV2.parse(raw);
      return upgradeUserRecord({ ...v2, schemaVersion: 3, domain: v2.emailDomain });
    }
    case 3: {
      const v3 = UserRecordV3.parse(raw);
      return { ...v3, schemaVersion: 4 };
    }
    case 4:
      return UserRecordV4.parse(raw);
    default:
      throw new Error(`Unknown schema version: ${versioned.schemaVersion}`);
  }
}

// At the start of each stage, upgrade any records from older schema versions:
export function createMyStage(): Stage<unknown, UserRecordV4> {
  return async (records, context) => {
    const upgraded = records.map(upgradeUserRecord);
    // ... rest of stage logic using V4
  };
}
```

## Step 6 — Test All Versions

```typescript
// src/__tests__/lib/schema-upgrade.test.ts

it("upgrades a V1 record to V4", () => {
  const v1 = { userId: "...", email: "a@b.com", signupDate: "2024-01-01" };
  const result = upgradeUserRecord(v1);
  expect(result.schemaVersion).toBe(4);
  expect(result.domain).toBe("b.com");
  expect((result as any).emailDomain).toBeUndefined();
});

it("passes through a V4 record unchanged", () => {
  const v4 = { schemaVersion: 4, userId: "...", email: "a@b.com", signupDate: new Date(), domain: "b.com" };
  expect(upgradeUserRecord(v4)).toEqual(v4);
});

it("rejects an unknown schema version", () => {
  expect(() => upgradeUserRecord({ schemaVersion: 99 })).toThrow("Unknown schema version");
});
```

## Schema Evolution Checklist

Before making any schema change, answer:

```
1. Is this backward compatible?
   → Old readers (downstream stages not yet deployed) can handle new records?

2. Is this forward compatible?
   → New readers can handle old records (in-flight, or from a failed run being retried)?

3. Are there in-flight records from a previous run that use the old schema?
   → Write an upgrade function for them.

4. Do any external consumers (other services, analytics systems) depend on this schema?
   → Coordinate with them before changing.

5. Is the change in the source (input schema) or output (destination schema)?
   → Source changes need upgrade functions. Destination changes need migration scripts.
```

## Checklist

- [ ] `schemaVersion` field added to all pipeline record schemas
- [ ] New change classified: backward compatible? forward compatible?
- [ ] Unsafe changes (rename, remove, type change) use the three-phase migration
- [ ] `upgradeUserRecord()` function handles all historical versions
- [ ] Tests cover: V1→current, V(current)→current (no-op), unknown version throws
- [ ] In-flight records from older runs are upgraded at stage entry, not rejected
- [ ] Deployment order documented if change requires coordinated rollout

## Files involved

| File | Action |
|------|--------|
| `src/schemas/pipeline/<record>.ts` | Update: add new version, keep old version as discriminated union |
| `src/lib/schema-upgrade.ts` | Create/update: `upgrade<Record>()` chain across all versions |
| `src/lib/stages/*.ts` | Update: call `upgrade<Record>()` at stage entry |
| `src/__tests__/lib/schema-upgrade.test.ts` | Create/update: version upgrade tests |

## Common mistakes

**Renaming a field in one step** — the old field disappears from new records, any consumer still reading the old field gets `undefined`, and in-flight records from a previous stage have the old field name. Use the dual-field migration window.

**Skipping `schemaVersion` on early builds** — "we can add it later." Later means every record in every table has no version, and the upgrade function has to guess what version it is based on which fields are present. Add `schemaVersion` from the first record.

**Assuming all stages are deployed simultaneously** — in production, deploys are rolling. Stage 1 may be on the new version while Stage 2 is still on the old. The records in between must be valid for both.
