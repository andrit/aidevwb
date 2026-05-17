# Data Pipeline — Reference Guide

## ETL Patterns

### Extract-Transform-Load (ETL)
Extract raw data from sources, transform in a staging area, load into the destination. Best when transformations are complex and you want to validate before loading.

### Extract-Load-Transform (ELT)
Extract and load raw data into the destination, then transform in-place using the destination's compute (e.g., SQL transforms in a data warehouse). Best when the destination is powerful (BigQuery, Snowflake, Redshift).

## Data Quality

### Schema Validation
Validate incoming data against an expected schema before processing. Reject or quarantine records that don't match. Log schema violations for investigation.

### Idempotent Processing
Design pipelines so re-running them produces the same result. Use upserts (INSERT ON CONFLICT UPDATE) instead of blind inserts. Track processed records to avoid duplicates.

### Data Freshness
Track when data was last updated. Alert when data is stale beyond a threshold. Use watermarks for streaming pipelines.

## Testing Data Pipelines

### Row Count Assertions
After a pipeline run, verify expected row counts. A sudden 50% drop in rows indicates a problem.

### Value Range Checks
Verify that numeric columns are within expected ranges. Prices shouldn't be negative. Dates shouldn't be in the future (unless expected).

### Referential Integrity
Foreign key relationships should hold after loading. Every order should have a valid customer_id.
