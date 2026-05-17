# RAG Application — Reference Guide

## Retrieval Quality Tuning

### Chunk Size Selection
- 256-500 chars: high precision, good for FAQ and specific lookups
- 500-1000 chars: balanced, good for documentation and articles
- 1000-2000 chars: high context, good for complex topics that need surrounding detail
- Rule of thumb: chunks should be self-contained enough to answer a question without needing the chunk before or after

### Overlap Selection
- 0: no overlap, fastest ingestion, risk of splitting sentences at boundaries
- 10-20% of chunk size: standard, catches boundary sentences
- 30%+: heavy overlap, good for very precise retrieval but doubles storage

### Search Weight Tuning
- 70/30 vector/keyword (default): good for natural language questions
- 50/50: good when exact terms matter (error codes, product names, technical IDs)
- 90/10: good for semantic-heavy queries (conceptual questions, paraphrases)
- Run /eval before and after changing weights to measure impact

### Embedding Model Selection
- Voyage voyage-3 (1024 dim, $0.06/M): strong general-purpose, good multilingual
- OpenAI text-embedding-3-small (1536 dim, $0.02/M): cheapest, good for English
- BGE-M3 (1024 dim, $0.01/M): cheapest with good quality, open-source model
- Match the model to your domain: test with /eval on real queries

## Evaluation Best Practices

### Building a Query Set
Write 10-20 queries that represent real user questions. Include:
- Simple factual lookups ("What is the return policy?")
- Semantic paraphrases ("Can I get my money back?" for the same content)
- Specific technical terms ("Error E-4012 resolution")
- Cross-document questions ("Compare feature X across plans")

### Interpreting Scores
- MRR > 0.8: excellent, top result is usually correct
- MRR 0.5-0.8: good, correct answer is in top 3
- MRR < 0.5: poor, consider reindexing, different model, or more documents
- Keyword coverage < 50%: chunks may be too small or documents are missing

## Production RAG Patterns

### Reranking
After initial retrieval, use a cross-encoder to rerank the top-K results. This is more expensive but significantly improves precision. Cohere Rerank and BGE-reranker are popular choices.

### Query Expansion
Before searching, expand the query with synonyms or related terms. "How do I cancel?" becomes "How do I cancel? (refund, cancellation, unsubscribe, terminate)". This improves keyword recall.

### Metadata Filtering
Add metadata to documents (category, date, author) and filter at query time. "What's the latest pricing?" should only search documents tagged with category=pricing, sorted by date.

### Hybrid with Structured Data
Not everything belongs in RAG. Product prices, inventory counts, user settings — these are structured data that belong in regular database tables. Use RAG for unstructured knowledge, SQL for structured data, and combine in the answer.
