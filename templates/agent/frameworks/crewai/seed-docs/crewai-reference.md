# CrewAI — Framework Reference

## Overview

CrewAI is a role-based agent framework. You define agents with roles, goals, and backstories, then organize them into a crew that executes tasks. The role-based abstraction makes it natural to model teams: a researcher finds information, a writer synthesizes it, a reviewer checks quality.

## Core Concepts

### Agent
An agent has a role (what it does), a goal (what it's trying to achieve), a backstory (context that shapes its behavior), and tools (what it can use).

```python
from crewai import Agent

researcher = Agent(
    role="Researcher",
    goal="Find accurate, relevant information",
    backstory="You are a meticulous researcher who cites sources.",
    tools=[search_tool],
    verbose=True,
    allow_delegation=False,  # Don't let this agent delegate to others
)
```

The backstory is more than flavor text — it shapes how the LLM approaches the task. A "meticulous researcher who cites sources" behaves differently from a "fast-moving generalist."

### Task
A task is a specific piece of work assigned to an agent. It has a description, expected output format, and optional context from other tasks.

```python
from crewai import Task

task = Task(
    description="Research the competitive landscape for AI coding tools",
    expected_output="A list of 5 competitors with key differentiators",
    agent=researcher,
    context=[previous_task],  # This task can see previous task's output
)
```

### Crew
A crew orchestrates agents and tasks. It runs tasks in sequence or in parallel.

```python
from crewai import Crew, Process

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,  # or Process.hierarchical
)
result = crew.kickoff()
```

### Process Types

**Sequential**: Tasks run in order. Each task can see the output of previous tasks via the `context` parameter. Simple, predictable, good for linear workflows.

**Hierarchical**: A manager agent decides which agent handles each task and can reassign work. More flexible but harder to predict. Requires a manager_llm.

## Custom Tools

CrewAI tools extend `BaseTool`. The `name` and `description` are what the LLM sees when deciding to use the tool. The `_run` method is the implementation.

```python
from crewai.tools import BaseTool

class DatabaseQueryTool(BaseTool):
    name: str = "Query Database"
    description: str = "Run a read-only SQL query. Input is the SQL query string."

    def _run(self, query: str) -> str:
        # implementation
        return results
```

## Connecting to the Workbench

Use `httpx` to call the workbench REST API from tool implementations. The workbench handles project scoping via the `X-Project` header.

```python
http = httpx.Client(
    base_url="http://mcp-server:3100",
    headers={"X-Project": "my-project"},
)

class KnowledgebaseTool(BaseTool):
    name: str = "Search Knowledgebase"
    description: str = "Search project documentation."

    def _run(self, question: str) -> str:
        resp = http.post("/query", json={"question": question})
        return resp.json()["answer"]
```

## Testing Crews

Test individual agents with isolated tasks before testing the full crew. Mock tools for unit tests, use real tools for integration tests.

```python
def test_researcher_finds_info():
    task = Task(
        description="Find our API rate limits",
        expected_output="Rate limit information",
        agent=researcher,
    )
    crew = Crew(agents=[researcher], tasks=[task])
    result = crew.kickoff()
    assert "rate limit" in result.raw.lower()
```

## Common Pitfalls

1. **Vague goals**: "Be helpful" gives the agent no direction. "Find the top 3 competitors and their pricing" is actionable.
2. **Missing context links**: Tasks don't automatically see other tasks' output. Use `context=[previous_task]` explicitly.
3. **Too many agents**: Start with 2 agents and add more only when a single agent can't handle the task. Each agent adds latency and cost.
4. **Overly complex hierarchies**: Sequential process covers 80% of use cases. Use hierarchical only when tasks genuinely need dynamic routing.
