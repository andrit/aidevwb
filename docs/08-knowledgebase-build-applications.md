# Knowledgebases — What They Help You Build

## The Core Idea

A knowledgebase isn't just for Q&A. It's a **retrieval primitive** — a building block you embed in larger systems. Anywhere your application needs to find relevant information from a corpus, a knowledgebase is the foundation.

This document covers concrete things you can build on top of the workbench's RAG infrastructure, with patterns and reasoning for each.

## Build 1: AI-Powered Documentation Site

### What You're Building
A documentation website where users can ask questions in natural language instead of browsing a table of contents. The search bar becomes a conversation.

### Architecture

```
User → "How do I configure SSO?" → Your Frontend
         ↓
     POST /query to MCP server
         ↓
     Hybrid search → retrieve relevant docs sections
         ↓
     Claude generates answer with links to source sections
         ↓
     Frontend renders answer + "Read more" links
```

### Pattern: Document-Anchored Responses

```typescript
// In your frontend's API call
const response = await fetch('http://localhost:3100/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: userInput,
    top_k: 3,  // Fewer chunks = more focused answers
  }),
});

const { answer, sources } = await response.json();

// Map chunk IDs back to document paths for "Read more" links
const docLinks = sources.map(s => ({
  score: s.hybrid_score,
  path: documentPathFromId(s.document_id),  // Your lookup
}));
```

### Why This Pattern
Traditional docs search (Algolia DocSearch, built-in search) returns *pages*. Users still have to read and find the answer. RAG returns *answers*, with source links for users who want to go deeper. The hybrid search ensures both conceptual questions ("how does auth work?") and specific lookups ("SAML metadata URL") are covered.

### Why Not Fine-Tuning the LLM on Your Docs
Fine-tuning bakes knowledge into model weights. When your docs change, you'd need to re-fine-tune ($$$, hours of compute). With RAG, you re-ingest the changed files (seconds, cents). Fine-tuning also can't cite sources — the model doesn't know *where* it learned something.

## Build 2: Intelligent Code Review Assistant

### What You're Building
A tool that reviews pull requests by checking proposed changes against your team's coding standards, architecture decisions, and past review comments.

### Architecture

```
Knowledgebase contents:
  - Architecture Decision Records (ADRs)
  - Code style guides
  - Past PR review comments (exported)
  - Security guidelines

PR submitted → diff extracted → key changes identified
    ↓
For each significant change:
    → /query "Does this change align with our auth architecture?"
    → /query "Does this pattern match our error handling guidelines?"
    ↓
Compile findings into review comment
```

### Pattern: Multi-Query Synthesis

```typescript
// Review a PR by querying multiple aspects
const queries = [
  `Does using ${pattern} align with our architecture for ${module}?`,
  `What does our style guide say about ${codeConstruct}?`,
  `Have we had issues with this pattern before?`,
];

const findings = await Promise.all(
  queries.map(q =>
    fetch('http://localhost:3100/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, top_k: 3 }),
    }).then(r => r.json())
  )
);

// Synthesize findings into a review
const review = findings
  .filter(f => f.sources.length > 0 && f.sources[0].hybrid_score > 0.6)
  .map(f => f.answer)
  .join('\n\n');
```

### Why Multi-Query Instead of One Big Query
A single query like "Review this PR against all our standards" is too vague — the retrieval step would return a random mix of guidelines. Multiple focused queries each retrieve the most relevant chunks for that specific aspect. The pattern is: decompose the review into specific questions, query each independently, synthesize the results.

## Build 3: Onboarding Copilot

### What You're Building
A chatbot that new team members interact with during their first weeks. It answers questions about company processes, technical setup, team norms, and project context — things that would normally require interrupting a senior engineer.

### Architecture

```
Knowledgebase contents:
  - Onboarding checklist
  - Setup guides (dev environment, access requests, tools)
  - Team norms doc ("how we do things here")
  - Org chart and role descriptions
  - Project briefs and roadmaps
  - Past onboarding Q&A (aggregated)

New hire → "Where do I request AWS access?"
        → Knowledgebase retrieves relevant onboarding docs
        → Claude answers with specific steps and links
```

### Pattern: Context-Enriched System Prompts

```typescript
// Customize the LLM's system prompt for onboarding context
const systemPrompt = `You are an onboarding assistant for the engineering team.
Answer questions using ONLY the provided context from company documentation.
Be specific about tools, URLs, and people to contact.
If you don't know, say "I'm not sure — ask in #engineering-help on Slack."
Never make up URLs, people's names, or processes.`;

// Override the default system prompt in llm.ts
const response = await client.messages.create({
  model: config.claudeModel,
  max_tokens: 2048,
  system: systemPrompt,
  messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }],
});
```

### Why a Custom System Prompt
The default knowledgebase system prompt is generic ("answer based on context"). An onboarding copilot needs a specific persona: it should direct people to Slack channels, it should know the company name, and it should never hallucinate internal URLs. The system prompt shapes the answer style without changing the retrieval logic.

## Build 4: Compliance Checker

### What You're Building
A tool that checks whether proposed business actions, marketing copy, or product features comply with regulatory requirements, company policies, or contractual obligations.

### Architecture

```
Knowledgebase contents:
  - Regulatory documents (GDPR, HIPAA, SOC2)
  - Internal compliance policies
  - Contractual obligations by client
  - Past compliance reviews and decisions

Marketing copy draft → extract claims and data usage
    ↓
For each claim:
    → /query "What are our obligations regarding [claim topic]?"
    → /query "Are there contractual restrictions on [data type] usage?"
    ↓
Flag potential issues with source references
```

### Pattern: Threshold-Based Flagging

```typescript
const result = await fetch('http://localhost:3100/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: `What compliance requirements apply to sharing ${dataType} with third parties?`,
    top_k: 5,
  }),
}).then(r => r.json());

// Flag if we found relevant compliance requirements
const hasComplianceHits = result.sources.some(s => s.hybrid_score > 0.7);
if (hasComplianceHits) {
  console.log(`⚠️ Compliance review needed for ${dataType}:`);
  console.log(result.answer);
}
```

### Why Hybrid Score Thresholds
Not every query returns relevant results. If you ask about "sharing biometric data with advertisers" and your compliance docs don't mention biometrics, the results will have low scores. The threshold (0.7 in this example) filters out weak matches, so you only flag genuine compliance concerns.

## Build 5: Intelligent Form Pre-Fill / Data Extraction

### What You're Building
A system that reads incoming documents (invoices, applications, reports) and extracts structured data to pre-fill forms or populate databases.

### Architecture

```
Incoming PDF invoice → ingest into knowledgebase
    ↓
/query "What is the total amount on this invoice?"
/query "What is the vendor name?"
/query "What is the invoice number?"
/query "What is the due date?"
    ↓
Structured output → populate database or form
```

### Pattern: Structured Extraction via Query

```typescript
const fields = ['vendor name', 'invoice number', 'total amount', 'due date', 'line items'];

const extracted: Record<string, string> = {};
for (const field of fields) {
  const result = await fetch('http://localhost:3100/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: `What is the ${field} in this document? Reply with just the value.`,
      top_k: 2,
    }),
  }).then(r => r.json());

  extracted[field] = result.answer;
}
```

### Why RAG for Extraction Instead of OCR + Templates
OCR + template matching (e.g., "total is always at coordinates X,Y") breaks when invoice formats change. RAG understands the *meaning* of the document — it finds "Total Due: $1,234.56" regardless of where it appears on the page, what font it uses, or whether the label says "Total", "Amount Due", or "Grand Total."

## Build 6: Change Impact Analysis

### What You're Building
A tool that, given a proposed technical change, identifies what else in the system might be affected.

### Architecture

```
Knowledgebase contents:
  - API schemas and contracts
  - Service dependency maps
  - Database schemas
  - Integration documentation
  - Past incident reports

Proposed change: "Rename the `user_id` field to `account_id` in the Users API"
    ↓
/query "What services consume the user_id field from the Users API?"
/query "What database tables reference user_id?"
/query "Are there any downstream integrations that depend on user_id?"
    ↓
Impact report with affected services, tables, and integrations
```

### Pattern: Dependency Graph Queries

```typescript
const change = "Renaming user_id to account_id in the Users API";
const impactQueries = [
  `What services call the Users API and reference user_id?`,
  `What database migrations or schemas define user_id?`,
  `What integration tests validate user_id?`,
  `Have we had incidents related to user_id field changes before?`,
];

const impacts = await Promise.all(
  impactQueries.map(q =>
    fetch('http://localhost:3100/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, top_k: 5 }),
    }).then(r => r.json())
  )
);
```

### Why a Knowledgebase Instead of Static Analysis
Static analysis tools (like `grep` or language-specific dependency analyzers) find code references. They can't find documentation references, architecture diagrams mentioning the field, Slack discussions about it, or past incidents related to it. A knowledgebase searches across all artifact types — code, docs, notes, and history — simultaneously.

## Meta-Pattern: The RAG Application Template

Every build above follows the same meta-pattern:

```
1. CURATE    — select and organize source documents for your domain
2. INGEST    — feed them into the knowledgebase
3. QUERY     — ask domain-specific questions programmatically
4. INTERPRET — apply business logic to the results (thresholds, formatting, routing)
5. ACT       — take action based on interpreted results (display, flag, update)
```

The workbench provides steps 1-3. Steps 4-5 are your application logic. This separation means you can build any of the above applications (or others) using the same knowledgebase infrastructure — you just change the documents you ingest and the questions you ask.

## Files Referenced

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/routes/index.ts` | POST /query and POST /ingest endpoints |
| `apps/mcp-server/src/services/search.ts` | hybridSearch() — the retrieval primitive |
| `apps/mcp-server/src/services/llm.ts` | generateAnswer() — customize system prompts here |
| `apps/mcp-server/src/services/ingest.ts` | ingestDocument() — the ingestion primitive |
| `apps/mcp-server/src/config.ts` | matchThreshold, matchCount — tune retrieval behavior |
| `supabase/migrations/004_hybrid_search.sql` | hybrid_search() — vector_weight and text_weight |
