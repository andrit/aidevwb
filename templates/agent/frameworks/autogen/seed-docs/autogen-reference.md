# AutoGen (AG2) — Framework Reference

## Overview

AutoGen v0.4+ (AG2) is Microsoft's framework for building multi-agent AI systems. It provides agent abstractions, conversation patterns, tool registration, and code execution sandboxing.

## Core Concepts

### AssistantAgent
The primary agent type. Takes a system message, tools, and a model client. Processes messages and can call tools autonomously.

```python
from autogen_agentchat.agents import AssistantAgent

agent = AssistantAgent(
    name="assistant",
    model_client=model_client,
    system_message="You are a helpful assistant.",
    tools=[my_tool_function],
)
```

### Tools
Tools are async Python functions decorated or registered with the agent. AutoGen infers the JSON schema from type hints and docstrings.

```python
async def search_docs(query: str, top_k: int = 5) -> str:
    """Search the knowledgebase for relevant documents."""
    # ... implementation ...
    return result
```

The function signature becomes the tool's input schema. The docstring becomes the description Claude sees.

### Model Clients
AutoGen supports multiple LLM providers through model clients:

```python
from autogen_ext.models.openai import OpenAIChatCompletionClient

# Anthropic Claude (via OpenAI-compatible endpoint)
client = OpenAIChatCompletionClient(
    model="claude-sonnet-4-20250514",
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="https://api.anthropic.com/v1/",
)
```

### Termination Conditions
Control when the agent loop stops:

```python
from autogen_agentchat.task import TextMentionTermination, MaxMessageTermination

# Stop when agent says "DONE"
TextMentionTermination("DONE")

# Stop after N messages
MaxMessageTermination(10)

# Combine conditions
TextMentionTermination("DONE") | MaxMessageTermination(20)
```

## Multi-Agent Patterns

### RoundRobinGroupChat
Agents take turns in a fixed order:

```python
from autogen_agentchat.teams import RoundRobinGroupChat

team = RoundRobinGroupChat(
    [researcher, writer, reviewer],
    termination_condition=TextMentionTermination("APPROVED"),
)
await team.run(task="Write a report on Q3 revenue")
```

### SelectorGroupChat
A model-based selector chooses which agent speaks next:

```python
from autogen_agentchat.teams import SelectorGroupChat

team = SelectorGroupChat(
    [planner, coder, tester],
    model_client=selector_model,
    termination_condition=MaxMessageTermination(15),
)
```

## Connecting to the Workbench

The agent calls the workbench RAG API via HTTP. This keeps the agent framework-independent at the infrastructure level — the workbench doesn't know or care that AutoGen is running.

```python
import httpx

http = httpx.Client(
    base_url="http://mcp-server:3100",     # Inside Docker network
    headers={"X-Project": "my-project"},    # Project scoping
)

async def rag_query(question: str) -> str:
    resp = http.post("/query", json={"question": question})
    return resp.json()["answer"]
```

## Testing Agents

### Conversation Tests
Define expected behaviors as test cases:

```python
def test_agent_answers_from_docs():
    result = asyncio.run(main("What is our refund policy?"))
    assert "30 days" in result.lower()

def test_agent_uses_memory():
    asyncio.run(main("Remember that my name is Alice"))
    result = asyncio.run(main("What is my name?"))
    assert "alice" in result.lower()
```

### Deterministic Testing
Set temperature=0 and use a fixed seed for reproducible outputs. Even with deterministic settings, LLM outputs can vary — test for semantic correctness, not exact strings.

## Common Pitfalls

1. **Infinite loops**: Always set a MaxMessageTermination as a safety net.
2. **Tool errors crashing the loop**: Wrap tool implementations in try/catch and return error strings instead of raising exceptions.
3. **Context window overflow**: Long conversations exceed the model's context. Use summarization or sliding window.
4. **Cost management**: Multi-agent conversations can make many LLM calls. Log token usage and set budget limits.
