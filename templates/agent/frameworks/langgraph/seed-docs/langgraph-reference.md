# LangGraph — Framework Reference

## Overview

LangGraph models agent workflows as directed graphs. Nodes are processing steps (LLM calls, tool execution, custom logic). Edges define the flow between steps, including conditional routing. State is passed through the graph as a typed dictionary.

This graph-based approach makes complex workflows explicit and debuggable — you can see exactly which path the agent took and why.

## Core Concepts

### State
A TypedDict that flows through the graph. Every node reads from and writes to this shared state.

```python
from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    # Add your own fields:
    findings: list[str]
    iteration_count: int
```

The `add_messages` annotation tells LangGraph to append new messages rather than replace the list. Custom fields are replaced by default.

### Nodes
Functions that take state and return a partial state update. The returned dict is merged into the current state.

```python
def research_node(state: AgentState) -> dict:
    # Read from state
    question = state["messages"][-1].content
    # Do work
    results = search(question)
    # Return state update (merged, not replaced)
    return {"findings": results}
```

### Edges
Define transitions between nodes. Three types:

**Normal edges**: always follow this path.
```python
graph.add_edge("research", "summarize")
```

**Conditional edges**: a function decides the next node.
```python
def route(state: AgentState) -> str:
    if state["iteration_count"] > 3:
        return "final_answer"
    return "research"

graph.add_conditional_edges("evaluate", route, {
    "research": "research",
    "final_answer": "final_answer",
})
```

**Entry point**: where the graph starts.
```python
graph.set_entry_point("research")
```

### Compilation
After defining nodes and edges, compile the graph into a runnable application:

```python
app = graph.compile()
result = app.invoke({"messages": [HumanMessage(content="...")]})
```

## Common Patterns

### ReAct Loop (Agent + Tools)
The most common pattern: an agent node decides to use tools or finish, a tool node executes tools, then control returns to the agent.

```python
graph.add_node("agent", agent_node)
graph.add_node("tools", ToolNode(tools))
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")
```

### Plan-then-Execute
A planner creates steps, an executor runs them one at a time.

```python
graph.add_node("plan", create_plan)
graph.add_node("execute_step", execute_next_step)
graph.add_node("check_done", check_if_complete)
graph.set_entry_point("plan")
graph.add_edge("plan", "execute_step")
graph.add_edge("execute_step", "check_done")
graph.add_conditional_edges("check_done", is_done, {
    "continue": "execute_step",
    "done": END,
})
```

### Reflection
Generate output, critique it, optionally revise.

```python
graph.add_node("generate", generate_draft)
graph.add_node("critique", critique_draft)
graph.add_node("revise", revise_based_on_critique)
graph.set_entry_point("generate")
graph.add_edge("generate", "critique")
graph.add_conditional_edges("critique", needs_revision, {
    "revise": "revise",
    "accept": END,
})
graph.add_edge("revise", "critique")
```

## Connecting to the Workbench

Use LangChain's `@tool` decorator for functions that call the workbench API. LangGraph's `ToolNode` handles execution automatically.

```python
from langchain_core.tools import tool

@tool
def search_docs(question: str) -> str:
    """Search the project knowledgebase."""
    resp = http.post("/query", json={"question": question})
    return resp.json()["answer"]

# ToolNode wraps all tools for the graph
tool_node = ToolNode([search_docs, remember, recall])
```

## Debugging

LangGraph's graph structure makes debugging visual. Use `app.get_graph().print_ascii()` to see the flow:

```
     +---------+
     | agent   |
     +---------+
       *    *
      /      \
     /        \
+---------+ +-----+
|  tools  | | END |
+---------+ +-----+
     *
     |
     |
+---------+
|  agent  |
+---------+
```

## Common Pitfalls

1. **State mutation**: never mutate state in place. Return a new dict with updates. LangGraph merges it for you.
2. **Missing END edges**: every conditional must have a path to END or the graph can loop forever.
3. **Tool errors**: ToolNode catches exceptions but the error message goes back to the LLM. Make error messages helpful.
4. **Large state**: state is serialized between nodes. Keep it small — store large data externally (in the workbench DB via memory tools).
