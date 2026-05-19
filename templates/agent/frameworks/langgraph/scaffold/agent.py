"""
{{PROJECT_NAME}} — LangGraph Agent

Starter agent using LangGraph's state machine pattern.
Defines a graph with nodes (actions) and edges (transitions).

Usage:
  python agent.py "Research and answer: What are our API rate limits?"

Customize:
  - AgentState: add fields for your workflow's state
  - nodes: add processing steps
  - edges: define the flow between steps
  - tools: connect to workbench RAG and memory
"""
import os
import sys
from typing import Annotated, TypedDict

import httpx
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
WORKBENCH_PROJECT = os.environ.get("WORKBENCH_PROJECT", "{{PROJECT_NAME}}")

http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={"X-Project": WORKBENCH_PROJECT},
    timeout=30.0,
)

SYSTEM_PROMPT = """You are a helpful assistant for the {{PROJECT_NAME}} project.
Use tools to search documentation and remember important findings."""

# ── Tools ─────────────────────────────────────────────────


@tool
def rag_query(question: str) -> str:
    """Search the project knowledgebase for relevant information."""
    resp = http.post("/query", json={"question": question, "top_k": 5})
    return resp.json().get("answer", "No results found.")


@tool
def agent_remember(key: str, value: str) -> str:
    """Store a key-value pair in persistent memory."""
    http.put(f"/memory/{key}", json={"value": value})
    return f"Remembered: {key} = {value}"


@tool
def agent_recall(key: str) -> str:
    """Retrieve a value from persistent memory."""
    resp = http.get(f"/memory/{key}")
    if resp.status_code == 404:
        return f"No memory for: {key}"
    return str(resp.json().get("value", ""))


tools = [rag_query, agent_remember, agent_recall]

# ── State ─────────────────────────────────────────────────


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


# ── Graph Nodes ───────────────────────────────────────────

model = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    api_key=os.environ["ANTHROPIC_API_KEY"],
).bind_tools(tools)


def agent_node(state: AgentState) -> dict:
    """The main agent — decides what to do next."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
    response = model.invoke(messages)
    return {"messages": [response]}


def should_continue(state: AgentState) -> str:
    """Route: if the last message has tool calls, go to tools. Otherwise, end."""
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return END


# ── Build Graph ───────────────────────────────────────────

tool_node = ToolNode(tools)

graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
graph.add_node("tools", tool_node)

graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")

app = graph.compile()


# ── Run ───────────────────────────────────────────────────


def main(user_message: str):
    result = app.invoke({
        "messages": [HumanMessage(content=user_message)],
    })

    # Print the final response
    for msg in result["messages"]:
        if hasattr(msg, "content") and msg.content and not hasattr(msg, "tool_calls"):
            print(msg.content)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python agent.py 'your question or task'")
        sys.exit(1)

    main(sys.argv[1])
