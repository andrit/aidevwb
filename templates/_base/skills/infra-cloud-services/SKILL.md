---
name: infra-cloud-services
description: Cloud SDK patterns across AWS/GCP/Azure — S3/GCS for document storage alongside workbench ingest, SQS/Pub-Sub for async work, Secrets Manager for API keys at startup, and IAM least-privilege templates
domain: infrastructure
type: cross-cutting
triggers:
  - "AWS"
  - "GCP"
  - "Azure"
  - "cloud storage"
  - "S3"
  - "cloud services"
  - "secrets manager"
  - "GCS"
  - "SQS"
  - "Pub/Sub"
  - "IAM"
  - "cloud deployment"
---

# Cloud SDK Patterns (AWS / GCP / Azure)

## When to use

When a workbench project needs to reach beyond the local Docker stack to cloud services:

- **Document storage at scale** — store source documents in S3/GCS before or after ingesting them into the RAG pipeline (the workbench `rag_ingest` tool pulls from `/workspace/documents`; upload to cloud first when files come from external sources)
- **API keys and secrets** — fetch `ANTHROPIC_API_KEY`, `POSTGRES_PASSWORD`, etc. from Secrets Manager at container startup instead of from `.env` (required for production deployments)
- **Async work queues** — offload long-running tasks (RAG ingest batches, agent runs) to SQS/Pub-Sub consumers running outside the workbench
- **Cross-region or multi-tenant deployments** — when the workbench's single-host Docker stack is not enough

## Prerequisites

- Cloud CLI installed and authenticated on the host:
  - AWS: `aws configure` or instance profile / IAM role
  - GCP: `gcloud auth application-default login`
  - Azure: `az login`
- Required packages installed in your project:
  - AWS: `npm install @aws-sdk/client-s3 @aws-sdk/client-secrets-manager @aws-sdk/client-sqs`
  - GCP: `npm install @google-cloud/storage @google-cloud/secret-manager @google-cloud/pubsub`
  - Azure: `npm install @azure/storage-blob @azure/keyvault-secrets @azure/service-bus @azure/identity`
- IAM role or service account with least-privilege permissions (see Step 4)

## Step 1 — S3 document storage (AWS)

Upload a document to S3 and then ingest it into the workbench RAG pipeline.

```typescript
// src/lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_DOCUMENTS_BUCKET ?? 'workbench-documents';

/** Upload a local file to S3, return the S3 key */
export async function uploadDocument(
  localPath: string,
  projectName: string,
): Promise<string> {
  const key = `${projectName}/${path.basename(localPath)}`;
  const { readFile } = await import('fs/promises');
  const body = await readFile(localPath);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: inferContentType(localPath),
    Metadata: {
      'workbench-project': projectName,
      'ingested-at': new Date().toISOString(),
    },
  }));

  return key;
}

/** Download an S3 object to a local path for workbench ingest */
export async function downloadDocument(
  s3Key: string,
  localDir: string,
): Promise<string> {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  if (!response.Body) throw new Error(`No body for S3 key: ${s3Key}`);

  const localPath = path.join(localDir, path.basename(s3Key));
  await pipeline(
    response.Body as NodeJS.ReadableStream,
    createWriteStream(localPath),
  );
  return localPath;
}

/** Check if a key already exists (avoid redundant uploads) */
export async function exists(s3Key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
    return true;
  } catch {
    return false;
  }
}

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf':  'application/pdf',
    '.md':   'text/markdown',
    '.txt':  'text/plain',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}
```

## Step 2 — GCS document storage (GCP equivalent)

```typescript
// src/lib/gcs.ts
import { Storage } from '@google-cloud/storage';
import path from 'path';

const storage = new Storage();  // uses GOOGLE_APPLICATION_CREDENTIALS or ADC
const BUCKET_NAME = process.env.GCS_DOCUMENTS_BUCKET ?? 'workbench-documents';

/** Upload a local file to GCS, return the GCS URI */
export async function uploadDocument(
  localPath: string,
  projectName: string,
): Promise<string> {
  const destination = `${projectName}/${path.basename(localPath)}`;
  await storage.bucket(BUCKET_NAME).upload(localPath, {
    destination,
    metadata: {
      metadata: {
        'workbench-project': projectName,
        'ingested-at': new Date().toISOString(),
      },
    },
  });
  return `gs://${BUCKET_NAME}/${destination}`;
}

/** Download a GCS object to a local path */
export async function downloadDocument(
  gcsUri: string,
  localDir: string,
): Promise<string> {
  // gcsUri: gs://bucket/path/to/file.pdf
  const [, , bucketName, ...parts] = gcsUri.split('/');
  const objectPath = parts.join('/');
  const localPath = path.join(localDir, path.basename(objectPath));
  await storage.bucket(bucketName).file(objectPath).download({ destination: localPath });
  return localPath;
}
```

## Step 3 — Secrets Manager at startup

Fetch secrets from the cloud provider once at startup and merge into `process.env`. Call this before the Fastify server initializes.

```typescript
// src/lib/secrets.ts
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/**
 * Load workbench secrets from AWS Secrets Manager into process.env.
 * Secret value must be a JSON object: { "ANTHROPIC_API_KEY": "sk-...", ... }
 *
 * Call once at startup before any service that reads process.env.
 */
export async function loadSecrets(secretArn: string): Promise<void> {
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  const raw = response.SecretString ?? Buffer.from(response.SecretBinary ?? '', 'base64').toString();
  const secrets = JSON.parse(raw) as Record<string, string>;

  for (const [key, value] of Object.entries(secrets)) {
    if (!process.env[key]) {
      process.env[key] = value;  // never overwrite host env (host takes precedence)
    }
  }
}
```

GCP equivalent (Secret Manager):

```typescript
// src/lib/gcp-secrets.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export async function loadSecrets(secretName: string): Promise<void> {
  // secretName: projects/my-project/secrets/workbench-secrets/versions/latest
  const [version] = await client.accessSecretVersion({ name: secretName });
  const raw = version.payload?.data?.toString() ?? '{}';
  const secrets = JSON.parse(raw) as Record<string, string>;

  for (const [key, value] of Object.entries(secrets)) {
    if (!process.env[key]) process.env[key] = value;
  }
}
```

Usage in `src/index.ts` (before server start):

```typescript
// src/index.ts — call before fastify.listen()
if (process.env.AWS_SECRETS_ARN) {
  await loadSecrets(process.env.AWS_SECRETS_ARN);
}
```

## Step 4 — SQS async work queue (AWS)

```typescript
// src/lib/sqs.ts
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const QUEUE_URL = process.env.SQS_INGEST_QUEUE_URL ?? '';

export async function enqueueIngestJob(job: {
  projectName: string;
  s3Key: string;
  priority?: number;
}): Promise<void> {
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(job),
    MessageGroupId: job.projectName,       // FIFO queue: one group per project
    MessageDeduplicationId: job.s3Key,    // deduplicate by S3 key
    MessageAttributes: {
      priority: {
        DataType: 'Number',
        StringValue: String(job.priority ?? 5),
      },
    },
  }));
}

/** Poll for one batch and process. Returns number of messages processed. */
export async function pollIngestQueue(
  handler: (job: { projectName: string; s3Key: string }) => Promise<void>
): Promise<number> {
  const response = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20,              // long-polling — reduces empty receive cost
    MessageAttributeNames: ['All'],
  }));

  const messages = response.Messages ?? [];
  for (const msg of messages) {
    try {
      await handler(JSON.parse(msg.Body!));
      await sqs.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: msg.ReceiptHandle!,
      }));
    } catch (err) {
      console.error('[sqs] Handler failed, message will return to queue:', err);
      // Do NOT delete — SQS visibility timeout will return it for retry
    }
  }
  return messages.length;
}
```

## Step 5 — IAM least-privilege policy templates

### AWS IAM policy — minimum for workbench document bucket + secrets

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkbenchS3Documents",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:HeadObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::workbench-documents",
        "arn:aws:s3:::workbench-documents/*"
      ]
    },
    {
      "Sid": "WorkbenchSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:workbench/*"
    },
    {
      "Sid": "WorkbenchSQS",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:*:workbench-*"
    }
  ]
}
```

### GCP service account roles (minimum)

```bash
# Create workbench service account
gcloud iam service-accounts create workbench-sa \
  --display-name="Workbench Service Account"

SA="workbench-sa@$PROJECT_ID.iam.gserviceaccount.com"

# Storage: read/write to documents bucket only
gcloud storage buckets add-iam-policy-binding gs://workbench-documents \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectUser"

# Secrets: read workbench secrets only
gcloud secrets add-iam-policy-binding workbench-secrets \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"

# Generate key (or use Workload Identity for GKE — preferred)
gcloud iam service-accounts keys create ./workbench-sa-key.json \
  --iam-account="$SA"
```

## Step 6 — Add cloud config to .env.example

```bash
# Cloud provider (aws | gcp | azure | none)
CLOUD_PROVIDER=aws

# AWS
AWS_REGION=us-east-1
AWS_SECRETS_ARN=arn:aws:secretsmanager:us-east-1:123456789:secret:workbench/prod
S3_DOCUMENTS_BUCKET=workbench-documents
SQS_INGEST_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789/workbench-ingest.fifo

# GCP
GOOGLE_CLOUD_PROJECT=my-project-id
GCS_DOCUMENTS_BUCKET=workbench-documents
GCP_SECRET_NAME=projects/my-project-id/secrets/workbench-secrets/versions/latest
```

## Checklist

- [ ] IAM role / service account created with least-privilege policy (no wildcard `*` actions)
- [ ] `loadSecrets()` called before `fastify.listen()` so all env vars are populated
- [ ] S3/GCS bucket has versioning enabled (protects against accidental overwrites)
- [ ] S3/GCS bucket **not** public — access via signed URLs or presigned S3 URLs only
- [ ] SQS FIFO queue used when order matters (ingest per project); standard queue for high-volume fan-out
- [ ] `AWS_SECRETS_ARN` / `GCP_SECRET_NAME` in `.env.example` but never in `.env` checked into git
- [ ] Cloud credentials never hardcoded — always from env, IAM role, or ADC
- [ ] Downloaded documents land in `/workspace/documents` for `rag_ingest` to pick up

## Files involved

| File | Action |
|------|--------|
| `src/lib/s3.ts` | Create: upload, download, exists helpers |
| `src/lib/gcs.ts` | Create: GCP Storage equivalent |
| `src/lib/secrets.ts` | Create: load secrets from Secrets Manager at startup |
| `src/lib/sqs.ts` | Create: enqueue and poll SQS ingest queue |
| `src/index.ts` | Update: call `loadSecrets()` before `fastify.listen()` |
| `.env.example` | Update: add cloud config variables |
| `iam/workbench-policy.json` | Create: least-privilege AWS IAM policy document |

## Common mistakes

**Hardcoding AWS credentials in environment variables inside docker-compose.yml** — `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in compose files often end up in git. Use IAM instance profiles (EC2), IAM task roles (ECS/Fargate), or Workload Identity (GKE) instead. On developer machines, `aws configure` writes to `~/.aws/credentials` which the SDK reads automatically.

**Fetching secrets on every request** — `loadSecrets()` should be called once at startup, not on each request. Secrets Manager calls are rate-limited and add latency. Cache the values in `process.env` (or a module-level Map) for the lifetime of the process.

**Uploading to S3 before downloading to local for ingest** — the workbench `rag_ingest` MCP tool reads from `/workspace/documents`. If you put files directly in S3, you must download them to that directory first. The pattern is: external source → S3 (durable storage) → local `/workspace/documents` → `rag_ingest`.

**Overly broad IAM permissions** — `"Action": "s3:*"` or `"Resource": "*"` is never correct for a production service account. Use the templates in Step 5 as your starting ceiling and scope `Resource` to the specific bucket ARN.

**Not handling `SecretBinary` in Secrets Manager responses** — secrets stored as binary (rare but valid) come in `SecretBinary`, not `SecretString`. The `loadSecrets()` template handles both but custom code often only checks `SecretString` and silently gets `undefined`.
