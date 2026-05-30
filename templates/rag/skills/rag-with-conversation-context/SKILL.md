---
name: rag-with-conversation-context
description: Build multi-turn RAG conversations — use workbench conversation history to refine queries across turns, deduplicate chunks, maintain user context with agent_remember, and prevent context window overflow
domain: rag
type: rag
triggers:
  - "multi-turn RAG"
  - "conversation context"
  - "follow-up questions"
  - "RAG chatbot"
  - "remember what we discussed"
  - "contextual retrieval"
  - "the agent forgets what we talked about"
  - "RAG with memory"
  - "conversation history for search"
  - "stateful RAG"
---

# RAG with Conversation Context

## When to use

When building a multi-turn RAG chatbot where follow-up questions depend on earlier answers. Without conversation context, every query is cold: "What is it?" doesn't know what "it" refers to. Activate when the user says "it should remember what we talked about", "follow-up questions don't work", or "build a chatbot over my documents."

## Prerequisites

- Documents ingested and searchable (see `ingest-and-validate`)
- Workbench services running — uses `conversation_*` and `agent_remember`/`agent_recall` MCP tools
- Python application code (agent or API layer) where queries originate

## The Two Problems Multi-Turn RAG Solves

**Problem 1: Pronoun and reference resolution.** Users ask follow-ups that reference earlier context:
```
Turn 1: "What are the pricing tiers?"
Turn 2: "What's included in the middle one?"  ← "middle one" is undefined without history
Turn 3: "Does it have API access?"             ← "it" is undefined
```

Without context, turns 2 and 3 fail retrieval or hallucinate. With context, they're rewritten to standalone queries before hitting the search index.

**Problem 2: Context window overflow.** A naïve approach appends every retrieved chunk to every subsequent call. By turn 5, the LLM context is full of repeated, outdated chunks from turn 1.

## Architecture Overview

```
User message
     ↓
[1] Load conversation history (conversation_get)
     ↓
[2] Contextual query rewriting (Claude: "given this history, what is the user asking?")
     ↓
[3] Retrieve chunks (rag_query with rewritten query)
     ↓
[4] Deduplicate chunks (filter out chunk_ids seen in prior turns)
     ↓
[5] Generate answer (Claude with: history + new chunks + citation rules)
     ↓
[6] Persist turn (conversation_append + agent_remember for session facts)
```

## Implementation

### The ConversationalRAG class

```python
# app/conversational_rag.py
import json
import httpx
import anthropic
from dataclasses import dataclass, field

workbench = httpx.Client(base_url="http://localhost:3100", timeout=30)
llm = anthropic.Anthropic()


@dataclass
class ConversationalRAG:
    project: str
    conversation_id: str | None = None
    seen_chunk_ids: set = field(default_factory=set)
    turn_count: int = 0
    max_history_turns: int = 6   # keep last N turns to avoid context overflow

    def start_session(self, title: str = "RAG Conversation") -> str:
        """Create a new conversation and return its ID."""
        resp = workbench.post("/conversations",
                              json={"title": title},
                              headers={"X-Project": self.project})
        resp.raise_for_status()
        self.conversation_id = resp.json()["id"]
        self.seen_chunk_ids = set()
        self.turn_count = 0
        return self.conversation_id

    def _get_history(self) -> list[dict]:
        """Return last N turns of conversation history."""
        if not self.conversation_id:
            return []
        resp = workbench.get(f"/conversations/{self.conversation_id}",
                             headers={"X-Project": self.project})
        if resp.status_code != 200:
            return []
        messages = resp.json().get("messages", [])
        # Return last max_history_turns pairs (user + assistant)
        return messages[-(self.max_history_turns * 2):]

    def _rewrite_query(self, user_message: str, history: list[dict]) -> str:
        """
        Rewrite user message into a standalone query using conversation history.
        Returns the rewritten query (or original if history is empty).
        """
        if not history:
            return user_message

        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in history[-4:]
        )

        response = llm.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system=(
                "Rewrite the user's message as a standalone search query, "
                "resolving any pronouns or references using the conversation history. "
                "Return only the rewritten query — no explanation. "
                "If the message is already standalone, return it unchanged."
            ),
            messages=[{
                "role": "user",
                "content": f"Conversation history:\n{history_text}\n\nUser message: {user_message}",
            }],
        )
        return response.content[0].text.strip()

    def _retrieve_new_chunks(self, query: str, top_k: int = 5) -> list[dict]:
        """Retrieve chunks, filtering out ones already shown in this session."""
        resp = workbench.post("/query",
                              json={"question": query, "top_k": top_k + len(self.seen_chunk_ids)},
                              headers={"X-Project": self.project})
        resp.raise_for_status()
        result = resp.json()

        # Filter chunks already seen in this conversation
        new_sources = [
            s for s in result.get("sources", [])
            if s["chunk_id"] not in self.seen_chunk_ids
        ]

        # Register these chunks as seen
        for s in new_sources[:top_k]:
            self.seen_chunk_ids.add(s["chunk_id"])

        return new_sources[:top_k]

    def _format_history_for_context(self, history: list[dict]) -> str:
        """Format conversation history for the generation prompt."""
        if not history:
            return ""
        parts = []
        for m in history:
            role = "User" if m["role"] == "user" else "Assistant"
            parts.append(f"{role}: {m['content'][:500]}")  # truncate long turns
        return "Previous conversation:\n" + "\n".join(parts)

    def chat(self, user_message: str, top_k: int = 5) -> dict:
        """Process one turn of conversation."""
        if not self.conversation_id:
            self.start_session()

        # 1. Load history
        history = self._get_history()

        # 2. Rewrite query using context
        rewritten_query = self._rewrite_query(user_message, history)

        # 3. Retrieve new (unseen) chunks
        new_sources = self._retrieve_new_chunks(rewritten_query, top_k)

        if not new_sources:
            # No new chunks — answer from history context only
            answer = self._answer_from_history(user_message, history)
            retrieval_used = False
        else:
            # 4. Build context: history summary + new chunks
            history_context = self._format_history_for_context(history)
            chunk_context = "\n\n---\n\n".join(
                f"[Chunk from document {s['document_id'][:8]}...]\n{s.get('content', '')}"
                for s in new_sources
            )

            # 5. Generate answer
            answer = self._generate_answer(
                user_message=user_message,
                rewritten_query=rewritten_query,
                history_context=history_context,
                chunk_context=chunk_context,
            )
            retrieval_used = True

        # 6. Persist the turn
        workbench.post(f"/conversations/{self.conversation_id}/messages",
                       json={"role": "user", "content": user_message},
                       headers={"X-Project": self.project})
        workbench.post(f"/conversations/{self.conversation_id}/messages",
                       json={"role": "assistant", "content": answer},
                       headers={"X-Project": self.project})
        self.turn_count += 1

        return {
            "answer": answer,
            "rewritten_query": rewritten_query if rewritten_query != user_message else None,
            "new_chunks_retrieved": len(new_sources),
            "total_chunks_seen": len(self.seen_chunk_ids),
            "retrieval_used": retrieval_used,
            "turn": self.turn_count,
        }

    def _generate_answer(self, user_message, rewritten_query, history_context, chunk_context):
        system = (
            "You are a knowledgebase assistant in a multi-turn conversation. "
            "Answer using the provided source documents. "
            "Reference the conversation history when the user asks follow-up questions. "
            "If the documents don't contain the answer, say so clearly."
        )

        context_block = ""
        if history_context:
            context_block += history_context + "\n\n"
        context_block += f"Relevant documents:\n{chunk_context}"

        response = llm.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            messages=[{
                "role": "user",
                "content": f"{context_block}\n\nCurrent question: {user_message}",
            }],
        )
        return response.content[0].text

    def _answer_from_history(self, user_message: str, history: list[dict]) -> str:
        history_context = self._format_history_for_context(history)
        response = llm.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system="Answer based on the conversation history. If you can't answer, say so.",
            messages=[{
                "role": "user",
                "content": f"{history_context}\n\nQuestion: {user_message}",
            }],
        )
        return response.content[0].text
```

### Session-level memory with agent_remember

For facts that should persist across sessions (user preferences, domain context), use `agent_remember`:

```python
# Persist session context for future conversations
def remember_session_context(project: str, key: str, value: str):
    workbench.post("/memory",
                   json={"key": key, "value": value},
                   headers={"X-Project": project})

def recall_session_context(project: str, key: str) -> str | None:
    resp = workbench.get(f"/memory/{key}",
                         headers={"X-Project": project})
    if resp.status_code == 200:
        return resp.json().get("value")
    return None

# Example: remember the user's role for filtering
remember_session_context(project, "user:role", "engineering manager")
remember_session_context(project, "user:focus", "pricing and billing")

# At the start of each new session, load remembered context
user_role = recall_session_context(project, "user:role")
user_focus = recall_session_context(project, "user:focus")
# Prepend to system prompt or first message to orient retrieval
```

### Usage example

```python
rag = ConversationalRAG(project="my-docs")
rag.start_session("Support conversation")

turn1 = rag.chat("What pricing plans do you offer?")
print(turn1["answer"])
# "We offer three plans: Starter ($9/mo), Pro ($29/mo), and Enterprise..."

turn2 = rag.chat("What's included in the middle one?")
# rewritten_query: "What is included in the Pro plan?"
print(turn2["rewritten_query"])   # "What is included in the Pro plan?"
print(turn2["answer"])

turn3 = rag.chat("Does it have an API?")
# rewritten_query: "Does the Pro plan include API access?"
print(turn3["new_chunks_retrieved"])  # fresh chunks only, not repeats from turn 1
```

## Context Window Management

Without management, a long conversation exhausts the context window. The class above handles this with two mechanisms:

1. **`max_history_turns`** — only the last N turns of conversation are passed to Claude. Older context is stored in the workbench conversations DB but not sent to the LLM.

2. **Chunk deduplication** — `seen_chunk_ids` tracks what's been retrieved. Subsequent turns only fetch chunks not yet shown. This prevents the same refund policy paragraph from appearing in every answer.

For very long sessions (20+ turns), add a summary step:

```python
def _summarize_history(self, history: list[dict]) -> str:
    """Compress old history to a summary when it gets too long."""
    if len(history) <= self.max_history_turns * 2:
        return ""
    old_history = history[:-(self.max_history_turns * 2)]
    old_text = "\n".join(f"{m['role']}: {m['content'][:300]}" for m in old_history)
    resp = llm.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": f"Summarize this conversation history in 3-4 sentences:\n{old_text}",
        }],
    )
    return "Earlier in this conversation: " + resp.content[0].text
```

## Testing Multi-Turn Behavior

```python
# tests/test_conversational_rag.py
import pytest
from app.conversational_rag import ConversationalRAG

@pytest.fixture
def rag_session():
    rag = ConversationalRAG(project="test-project")
    rag.start_session("test")
    return rag

def test_pronoun_resolution(rag_session):
    rag_session.chat("What pricing plans are available?")
    result = rag_session.chat("What's included in the cheapest one?")
    assert result["rewritten_query"] is not None, "Follow-up should be rewritten"
    assert "cheapest" not in result["rewritten_query"].lower(), \
        "Pronoun 'cheapest one' should be resolved to a specific plan name"

def test_chunk_deduplication(rag_session):
    r1 = rag_session.chat("Tell me about refund policy")
    r2 = rag_session.chat("Tell me more about refunds")
    # Second turn should not re-retrieve chunks already shown in turn 1
    assert r2["new_chunks_retrieved"] < r1["new_chunks_retrieved"] or \
           r2["new_chunks_retrieved"] == 0, \
           "Should not repeat chunks already shown"

def test_history_bounded(rag_session):
    # Pump 10 turns
    for i in range(10):
        rag_session.chat(f"Question {i}")
    # History sent to LLM should be bounded
    history = rag_session._get_history()
    # ConversationalRAG only passes last max_history_turns * 2 messages
    assert len(history) <= rag_session.max_history_turns * 2 * 2  # DB stores all; we cap what we send
```

## Checklist

- [ ] `start_session()` called at the beginning of each conversation — not shared across users
- [ ] Query rewriting step handles pronouns: turn 2+ questions produce a meaningful `rewritten_query`
- [ ] Chunk deduplication active: `seen_chunk_ids` tracks retrieved chunks within a session
- [ ] History capped at `max_history_turns` before passing to Claude (context window protection)
- [ ] Turns persisted to workbench conversation API (`/conversations/:id/messages`)
- [ ] `agent_remember` used for cross-session user preferences (not in-session state)
- [ ] Multi-turn test: pronoun resolution verified on a real document
- [ ] Chunk deduplication test: turn 2 doesn't repeat turn 1's chunks

## Files involved

| File | Action |
|------|--------|
| `app/conversational_rag.py` | Create: `ConversationalRAG` class |
| `tests/test_conversational_rag.py` | Create: pronoun resolution, deduplication, history bounds tests |

## Common mistakes

**One `ConversationalRAG` instance shared across all users** — `seen_chunk_ids` and conversation state is per-user. A shared instance means user A's chunks pollute user B's deduplication set. Instantiate one per user session.

**Rewriting every query unconditionally** — turn 1 is always a standalone question and doesn't need rewriting (no history exists yet). The `if not history: return user_message` check avoids an unnecessary LLM call on the first turn.

**No history cap** — appending all history to every prompt eventually overflows the context window. A 20-turn conversation with 5 chunks retrieved per turn can easily exceed 100K tokens. Cap history and use summaries for older context.

**Storing full chunk content in conversation messages** — persisting raw chunk text in the conversation DB inflates storage and makes the history unreadable. Store only the answer in the conversation record; retrieve fresh chunks from the search index as needed each turn.

**Not testing pronoun resolution** — "Does it have X?" failing silently is the most common multi-turn RAG bug. The test that verifies `rewritten_query != user_message` for a follow-up question is the most important test in this skill.
