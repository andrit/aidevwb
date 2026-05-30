---
name: db-neo4j
description: Neo4j for graph-enhanced RAG — node and relationship modeling, Cypher queries, Node.js driver setup, and the GraphRAG hybrid pattern combining Neo4j graph traversal with pgvector similarity search
domain: database
type: cross-cutting
triggers:
  - "neo4j"
  - "graph database"
  - "cypher"
  - "GraphRAG"
  - "entity relationships"
  - "knowledge graph"
  - "graph traversal"
  - "entity extraction"
  - "knowledge graph RAG"
---

# Neo4j Graph Database (GraphRAG)

## When to use

Neo4j extends the workbench's pgvector RAG pipeline with **entity-relationship context**. Reach for it when:

- Documents contain named entities (people, companies, products, concepts) that relate to each other and those relationships are part of what users query
- Pure vector similarity misses answers that require graph traversal ("What companies did the CEO of Company X previously work at?")
- You are building a knowledge graph from a corpus and want to query it with Cypher alongside semantic search
- Your RAG queries need to follow chains of reasoning across multiple hops (entity → related entities → their documents)

When to **not** add Neo4j:
- Simple Q&A over unstructured text with no entity structure — pgvector alone is faster and simpler
- Relational data with fixed schemas — PostgreSQL is better
- The graph has fewer than ~1000 nodes — a plain PostgreSQL join or an in-memory adjacency list is sufficient

The workbench already includes Neo4j in `docker-compose.yml` under the `neo4j` profile. This skill covers connecting, modeling, and querying it for GraphRAG.

## Prerequisites

- Workbench running with Neo4j profile: `docker compose --profile neo4j up -d`
- Neo4j browser available at http://localhost:7474 (user: `neo4j`, password from `POSTGRES_PASSWORD`)
- Node.js project with `neo4j-driver`: `npm install neo4j-driver`
- An entity extraction step in your ingest pipeline (LLM call or spaCy NER) — you need to extract entities and relationships from documents before storing them in Neo4j

## Step 1 — Driver setup (Node.js)

```typescript
// src/lib/neo4j.ts
import neo4j, { Driver, Session, QueryResult } from 'neo4j-driver';

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri      = process.env.NEO4J_URI      ?? 'bolt://neo4j:7687';
    const user     = process.env.NEO4J_USER     ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'password';

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionLifetime: 3 * 60 * 60 * 1000,   // 3 hours
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 2_000,
      logging: neo4j.logging.console('warn'),
    });
  }
  return driver;
}

/** Run a single Cypher query and return all records */
export async function runCypher(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult> {
  const session: Session = getNeo4jDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

/** Read-only Cypher query (routes to read replica if available) */
export async function readCypher(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult> {
  const session: Session = getNeo4jDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
```

## Step 2 — Node and relationship model

Design the graph schema before writing Cypher. This example models a corpus of research documents:

```
(:Document {id, title, projectName, url, ingestedAt})
    -[:MENTIONS]->
(:Entity {name, type})           // type: PERSON | ORG | CONCEPT | PRODUCT | PLACE
    -[:RELATED_TO {weight}]->
(:Entity)

(:Entity)-[:APPEARS_IN {chunkId, score}]->(:Document)
(:Entity)-[:WORKED_AT | :FOUNDED | :ACQUIRED | :COMPETED_WITH | ...]->(:Entity)
```

Constraints and indexes (run once at startup):

```typescript
// src/lib/neo4j-schema.ts
import { runCypher } from './neo4j.js';

export async function ensureNeo4jSchema(): Promise<void> {
  // Unique constraints (also create an index)
  await runCypher('CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE');
  await runCypher('CREATE CONSTRAINT entity_name_type IF NOT EXISTS FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE');

  // Indexes for lookup patterns
  await runCypher('CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)');
  await runCypher('CREATE INDEX doc_project IF NOT EXISTS FOR (d:Document) ON (d.projectName)');
}
```

Call `ensureNeo4jSchema()` at application startup alongside `runMigrations()`.

## Step 3 — Cypher query templates

### MERGE a document node (idempotent)

```typescript
await runCypher(`
  MERGE (d:Document {id: $id})
  ON CREATE SET
    d.title       = $title,
    d.projectName = $projectName,
    d.url         = $url,
    d.ingestedAt  = $ingestedAt
  ON MATCH SET
    d.title       = $title
  RETURN d
`, {
  id: documentId,
  title,
  projectName,
  url,
  ingestedAt: new Date().toISOString(),
});
```

### MERGE an entity and link it to a document

```typescript
await runCypher(`
  MERGE (e:Entity {name: $name, type: $type})
  WITH e
  MATCH (d:Document {id: $docId})
  MERGE (e)-[r:APPEARS_IN {chunkId: $chunkId}]->(d)
  ON CREATE SET r.score = $score
`, {
  name: entityName,
  type: entityType,     // 'PERSON' | 'ORG' | 'CONCEPT' etc.
  docId: documentId,
  chunkId,
  score: relevanceScore,
});
```

### CREATE a relationship between two entities

```typescript
await runCypher(`
  MERGE (a:Entity {name: $fromName, type: $fromType})
  MERGE (b:Entity {name: $toName, type: $toType})
  MERGE (a)-[r:$relType]->(b)
  ON CREATE SET r.weight = $weight, r.extractedAt = $extractedAt
`, {
  fromName, fromType,
  toName, toType,
  relType: 'WORKED_AT',   // NOTE: relationship type cannot be parameterized in Cypher —
                           // validate $relType against an allowlist before interpolating
  weight: 1.0,
  extractedAt: new Date().toISOString(),
});
```

Note: relationship types in Cypher cannot be passed as parameters. Use an allowlist and string interpolation:

```typescript
const ALLOWED_REL_TYPES = new Set(['WORKED_AT','FOUNDED','ACQUIRED','RELATED_TO','COMPETED_WITH']);
if (!ALLOWED_REL_TYPES.has(relType)) throw new Error(`Invalid rel type: ${relType}`);
await runCypher(`MERGE (a)-[:${relType}]->(b)`, params);
```

### Shortest path between two entities

```typescript
const result = await readCypher(`
  MATCH (a:Entity {name: $fromName}),
        (b:Entity {name: $toName})
  MATCH path = shortestPath((a)-[*..6]-(b))
  RETURN [node IN nodes(path) | node.name] AS pathNames,
         length(path) AS hops
  LIMIT 5
`, { fromName, toName });

const paths = result.records.map(r => ({
  names: r.get('pathNames') as string[],
  hops:  (r.get('hops') as neo4j.Integer).toNumber(),
}));
```

### Entity lookup — all entities in a document

```typescript
const result = await readCypher(`
  MATCH (e:Entity)-[:APPEARS_IN]->(d:Document {id: $docId})
  RETURN e.name AS name, e.type AS type
  ORDER BY e.type, e.name
`, { docId });

const entities = result.records.map(r => ({
  name: r.get('name') as string,
  type: r.get('type') as string,
}));
```

## Step 4 — GraphRAG hybrid search pattern

This is the core pattern: combine pgvector semantic similarity with Neo4j graph traversal to get richer, more connected context for the LLM.

```typescript
// src/services/graph-rag.ts
import { readCypher } from '../lib/neo4j.js';
import { hybridSearch } from './rag.js';   // existing workbench pgvector search

interface GraphRagContext {
  vectorChunks: Array<{ content: string; docId: string; score: number }>;
  relatedEntities: Array<{ name: string; type: string; relType: string }>;
  connectedDocIds: string[];
}

/**
 * GraphRAG query:
 * 1. Vector search → top-K chunks
 * 2. Extract entities mentioned in those chunks (from Neo4j)
 * 3. Traverse 1-hop relationships from those entities
 * 4. Fetch documents those related entities appear in
 * 5. Return all context for the LLM
 */
export async function graphRagSearch(
  projectName: string,
  query: string,
  topK: number = 5,
): Promise<GraphRagContext> {
  // Step 1: Vector + keyword hybrid search (existing workbench pipeline)
  const vectorChunks = await hybridSearch(projectName, query, topK);
  const docIds = [...new Set(vectorChunks.map(c => c.docId))];

  if (docIds.length === 0) {
    return { vectorChunks, relatedEntities: [], connectedDocIds: [] };
  }

  // Step 2 & 3: Get entities from those docs, traverse 1 hop
  const entityResult = await readCypher(`
    MATCH (e:Entity)-[:APPEARS_IN]->(d:Document)
    WHERE d.id IN $docIds AND d.projectName = $projectName
    WITH e LIMIT 20
    OPTIONAL MATCH (e)-[r]-(neighbor:Entity)
    RETURN
      e.name       AS name,
      e.type       AS type,
      type(r)      AS relType,
      neighbor.name AS neighborName
    ORDER BY e.type
  `, { docIds, projectName });

  const relatedEntities = entityResult.records.map(rec => ({
    name:    rec.get('neighborName') as string ?? rec.get('name') as string,
    type:    rec.get('type') as string,
    relType: rec.get('relType') as string ?? 'MENTIONED',
  })).filter(e => e.name);

  // Step 4: Fetch docs those neighbors appear in (expand context)
  const neighborNames = [...new Set(relatedEntities.map(e => e.name))];
  let connectedDocIds: string[] = [];

  if (neighborNames.length > 0) {
    const connResult = await readCypher(`
      MATCH (e:Entity)-[:APPEARS_IN]->(d:Document {projectName: $projectName})
      WHERE e.name IN $neighborNames
        AND NOT d.id IN $docIds
      RETURN DISTINCT d.id AS docId
      LIMIT 10
    `, { neighborNames, docIds, projectName });

    connectedDocIds = connResult.records.map(r => r.get('docId') as string);
  }

  return { vectorChunks, relatedEntities, connectedDocIds };
}
```

Compose the LLM prompt with graph context:

```typescript
function buildGraphRagPrompt(query: string, ctx: GraphRagContext): string {
  const chunkTexts = ctx.vectorChunks.map(c => c.content).join('\n\n---\n\n');
  const entityList = ctx.relatedEntities
    .slice(0, 10)
    .map(e => `${e.name} (${e.type}) [${e.relType}]`)
    .join(', ');

  return [
    `Query: ${query}`,
    '',
    `Relevant document excerpts:\n${chunkTexts}`,
    '',
    entityList ? `Related entities found in graph: ${entityList}` : '',
    '',
    'Answer the query using the excerpts and entity relationships above.',
  ].filter(Boolean).join('\n');
}
```

## Step 5 — Entity extraction helper (LLM-assisted)

```typescript
// src/lib/entity-extractor.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ExtractedEntity {
  name: string;
  type: 'PERSON' | 'ORG' | 'CONCEPT' | 'PRODUCT' | 'PLACE';
}

interface ExtractedRelationship {
  from: string;
  fromType: string;
  to: string;
  toType: string;
  relType: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export async function extractEntities(text: string): Promise<ExtractionResult> {
  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract named entities and relationships from this text. Return JSON only.

Text: ${text.slice(0, 3000)}

Return:
{
  "entities": [{"name": "...", "type": "PERSON|ORG|CONCEPT|PRODUCT|PLACE"}],
  "relationships": [{"from": "...", "fromType": "...", "to": "...", "toType": "...", "relType": "WORKED_AT|FOUNDED|RELATED_TO|ACQUIRED|MENTIONS"}]
}`,
    }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { entities: [], relationships: [] };

  try {
    return JSON.parse(jsonMatch[0]) as ExtractionResult;
  } catch {
    return { entities: [], relationships: [] };
  }
}
```

## Checklist

- [ ] Neo4j started via `docker compose --profile neo4j up -d`
- [ ] `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` in `.env` (or defaults work with `POSTGRES_PASSWORD`)
- [ ] `ensureNeo4jSchema()` called at startup — constraints and indexes created
- [ ] MERGE used for all node/relationship upserts (never raw CREATE — causes duplicates)
- [ ] Relationship type validated against allowlist before string interpolation into Cypher
- [ ] `session.close()` always called (use try/finally as in the driver template)
- [ ] `closeNeo4j()` called on process SIGTERM
- [ ] Graph visible in Neo4j browser at http://localhost:7474 after ingest
- [ ] GraphRAG hybrid search returning enriched context vs pure vector search

## Files involved

| File | Action |
|------|--------|
| `docker-compose.yml` | Already has neo4j under `neo4j` profile — no change needed |
| `apps/mcp-server/src/lib/neo4j.ts` | Create: driver singleton, `runCypher()`, `readCypher()` |
| `apps/mcp-server/src/lib/neo4j-schema.ts` | Create: `ensureNeo4jSchema()` with constraints/indexes |
| `apps/mcp-server/src/lib/entity-extractor.ts` | Create: LLM-assisted entity/relationship extraction |
| `apps/mcp-server/src/services/graph-rag.ts` | Create: `graphRagSearch()` combining pgvector + Neo4j |
| `apps/mcp-server/src/index.ts` | Update: call `ensureNeo4jSchema()` at startup |
| `.env.example` | Add `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` |

## Common mistakes

**Using CREATE instead of MERGE for nodes** — `CREATE` always creates a new node. Running ingest twice doubles every node. Always use `MERGE` for nodes and relationships. Use `ON CREATE SET` / `ON MATCH SET` to handle initial vs update logic.

**Passing relationship type as a Cypher parameter** — Cypher does not support parameterized relationship types (`MERGE (a)-[$r]->(b)` is invalid). The type must be a literal string in the query. Validate against an allowlist and use string interpolation — but never interpolate user input without the allowlist check.

**Not closing sessions** — `driver.session()` opens a connection. If `session.close()` is never called (because an exception was thrown), the pool exhausts itself and all subsequent queries time out. Always use `try/finally { await session.close() }`.

**Unbounded relationship traversal** — `MATCH (a)-[*]->(b)` with no hop limit will traverse the entire graph. Always bound traversal depth: `[*..4]` (up to 4 hops). For shortest path, `shortestPath()` handles this automatically but `allShortestPaths()` still needs a bound.

**Running entity extraction on every chunk** — extracting entities with an LLM call per chunk multiplies ingest cost. Batch entity extraction at the document level (not per chunk), then link extracted entities to chunks by matching names in chunk text. This reduces LLM calls from N_chunks to N_documents.
