# Knowledgebases — Common Use Cases

## What a Knowledgebase Replaces

Before RAG knowledgebases, the alternatives for giving AI access to custom data were:

- **Fine-tuning** — expensive, slow, requires ML expertise, hard to update
- **Prompt stuffing** — paste docs into the prompt context. Works for small docs, fails at scale (context window limits)
- **Manual search** — human finds the info, pastes it into the chat. Doesn't scale.

A RAG knowledgebase replaces all three with a searchable store that the AI queries on demand. Updates are instant (re-ingest a file), costs are low (embedding API calls), and there's no model training involved.

## Use Case 1: Internal Documentation Q&A

### The Problem
Your team has documentation scattered across wikis, Google Docs, Confluence, README files, and Slack threads. New team members spend days hunting for answers. Even experienced team members can't remember where things are.

### The Pattern

```
Ingest: company wiki export, onboarding docs, runbooks, FAQs
Query: "How do I set up my dev environment?"
       "What's our process for incident response?"
       "Where do I find the API keys for staging?"
```

### Code Pattern: Bulk Ingest from a Directory

```bash
# Ingest everything in a directory
for file in documents/wiki-export/*.md; do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"/workspace/$file\"}"
done
```

### Why This Pattern Works

The hybrid search (70% semantic, 30% keyword) handles both natural questions ("how do I deploy?") and specific lookups ("what's the runbook for Redis failover?"). The keyword component ensures exact terms like service names and error codes are matched even when the semantic model doesn't understand them.

### Why Not a Search Engine (Elasticsearch, Algolia)

Traditional search engines find documents — RAG finds *answers*. Elasticsearch returns "here are 10 pages mentioning 'deploy'" and the human reads them. RAG returns "To deploy to staging, run `make deploy-staging` which triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`." The LLM synthesis step is the difference.

## Use Case 2: Codebase Understanding

### The Problem
You inherit a 200K-line codebase. Reading it top-to-bottom would take weeks. You need to understand specific patterns, find where things are defined, and understand architectural decisions.

### The Pattern

```
Ingest: source code files, architecture docs, ADRs, commit messages, PR descriptions
Query: "How does the auth middleware work?"
       "What pattern does this codebase use for database access?"
       "Where is the payment processing logic?"
```

### Code Pattern: Selective Code Ingestion

```bash
# Ingest only the files that matter for understanding architecture
find /workspace/src -name "*.ts" -path "*/services/*" | while read f; do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"$f\"}"
done

# Ingest architecture decision records
for f in /workspace/docs/adr/*.md; do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"$f\"}"
done
```

### Why This Pattern and Not Full-Codebase Indexing

Ingesting every file in a large codebase creates noise. Test files, generated code, and vendored dependencies dilute search results. Selective ingestion (services, routes, models, config, docs) gives higher-quality retrieval because every chunk is relevant.

### Why Not GitHub Copilot's Codebase Indexing

Copilot's `@workspace` feature does something similar, but it's closed, you can't control what's indexed, and you can't combine it with non-code documents. A local knowledgebase lets you mix code, documentation, Slack exports, and meeting notes in one searchable store.

## Use Case 3: Research & Literature Review

### The Problem
You have 50 research papers, whitepapers, or technical reports. You need to find cross-cutting themes, compare approaches, and synthesize findings.

### The Pattern

```
Ingest: PDF papers, technical reports, slide decks
Query: "What approaches have been tried for reducing transformer inference latency?"
       "Compare the results of papers that use distillation vs quantization"
       "What are the common limitations mentioned across these papers?"
```

### Code Pattern: PDF Batch Ingestion (Queued)

```bash
# PDFs go through the async worker for multimodal processing
for pdf in documents/papers/*.pdf; do
  result=$(curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"/workspace/$pdf\"}")
  echo "$pdf: $(echo $result | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"status\",\"?\"))')"
done

# Monitor ingestion progress
watch -n 5 'curl -s http://localhost:3100/status | python3 -m json.tool'
```

### Why RAG and Not a Citation Manager (Zotero, Mendeley)

Citation managers organize references. RAG lets you *query across all papers simultaneously*. "What do papers X, Y, and Z say about approach A?" requires cross-document retrieval that citation managers can't do.

## Use Case 4: Customer Support / Helpdesk

### The Problem
Support agents answer the same questions repeatedly. Knowledge is locked in past tickets, not easily searchable.

### The Pattern

```
Ingest: FAQ documents, product manuals, past ticket resolutions, troubleshooting guides
Query: "Customer says their widget isn't syncing after the update"
       "What's the fix for error E-4012?"
       "How do I escalate a billing dispute?"
```

### Code Pattern: Structured FAQ Ingestion

```markdown
<!-- documents/faq.md -->
## Error E-4012: Widget Sync Failure

**Symptoms:** Widget shows "sync failed" after updating to v3.2+

**Root Cause:** The v3.2 update changed the sync protocol from WebSocket to SSE.
Widgets running firmware < 2.1 don't support SSE.

**Resolution:**
1. Check widget firmware: Settings → About → Firmware Version
2. If < 2.1: update firmware via the companion app
3. If >= 2.1: factory reset the widget and re-pair
```

This format works well because:
- Each section is self-contained (good chunk boundaries)
- Error codes are keyword-searchable (the 30% keyword weight catches "E-4012")
- Resolution steps are concrete (the LLM can relay them directly)

### Why Not a Traditional Knowledge Base Tool (Zendesk, Notion)

Traditional KB tools require manual search by support agents. RAG gives *answers*, not links. An agent describes a customer's symptoms in natural language, and the system returns the specific resolution steps — no searching, no reading through articles.

## Use Case 5: Contract & Legal Document Analysis

### The Problem
You have contracts, policies, compliance documents, and legal agreements. You need to quickly find specific clauses, compare terms across contracts, and check for inconsistencies.

### The Pattern

```
Ingest: contracts (PDF), policy documents, regulatory filings
Query: "What are the termination clauses in the Acme Corp contract?"
       "Do any of our contracts have non-compete provisions exceeding 2 years?"
       "What are our data retention obligations under the MSA?"
```

### Code Pattern: Document-Aware Queries

```bash
# After ingesting contracts, query with document context
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the liability caps in our vendor contracts?",
    "top_k": 10
  }' | python3 -m json.tool
```

Using `top_k: 10` instead of the default 5 retrieves more context, which is important when the answer may span multiple contract sections.

### Why RAG and Not Ctrl+F

Ctrl+F finds exact text. RAG finds *meaning*. Searching for "termination" in a contract might miss clauses that say "either party may exit the agreement" or "this agreement shall cease upon..." The semantic search component catches these variations.

## Use Case 6: Meeting Notes & Decision Tracking

### The Problem
Decisions are made in meetings, recorded in notes, and then forgotten. "Didn't we already decide this?" is a recurring question.

### The Pattern

```
Ingest: meeting transcripts, decision logs, action items
Query: "What did we decide about the pricing model in Q2?"
       "Who is responsible for the migration timeline?"
       "What were the arguments for and against Option B?"
```

### Code Pattern: Append-Only Ingestion

```bash
# After each meeting, save the transcript and ingest
echo "$MEETING_NOTES" > documents/meetings/2026-05-14-sprint-review.md

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/meetings/2026-05-14-sprint-review.md"}'
```

### Why This Pattern Over Notion/Confluence Search

Notion and Confluence search is keyword-based. "What did we decide about pricing?" requires knowing which page to search. RAG searches across all meetings simultaneously and synthesizes: "In the March 12 sprint review, the team decided to go with tiered pricing. This was revisited on April 3 where usage-based billing was considered but rejected due to complexity."

## Common Patterns Across All Use Cases

### Pattern: Organize by Source Type

```
documents/
├── code/          ← source code files
├── docs/          ← markdown documentation
├── papers/        ← research PDFs
├── contracts/     ← legal documents
├── meetings/      ← transcripts and notes
└── support/       ← FAQ and troubleshooting
```

This organization helps with selective ingestion and lets you rebuild specific subsets of the knowledgebase if needed.

### Pattern: Metadata-Rich Document Names

```
documents/2026-05-14_sprint-review_pricing-decision.md
documents/acme-corp_msa_2025-renewal.pdf
```

Descriptive filenames become document titles in the database, making `/status` output and source attribution more useful.

### Pattern: Periodic Re-Ingestion for Living Documents

```bash
# Cron job or script: re-ingest docs that may have changed
for f in documents/wiki/*.md; do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"/workspace/$f\"}" > /dev/null
done
# SHA256 dedup ensures only changed files are re-processed
```

This is safe to run frequently because the SHA256 check makes it a no-op for unchanged files.
