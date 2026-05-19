"""
{{PROJECT_NAME}} — Custom Agent (No Framework)

A minimal agent loop using the Anthropic SDK directly.
No framework dependency — full control over the agent lifecycle.
Uses the workbench RAG API and memory API as tools.

Usage:
  python agent.py "What does our documentation say about error handling?"

Customize:
  - SYSTEM_PROMPT: agent personality and constraints
  - TOOLS: add/remove tool definitions
  - tool handlers: implement new capabilities
  - max_turns: control the agent loop length
"""
import os
import sys
import json

import anthropic
import httpx
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
WORKBENCH_PROJECT = os.environ.get("WORKBENCH_PROJECT", "{{PROJECT_NAME}}")

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={"X-Project": WORKBENCH_PROJECT},
    timeout=30.0,
)

SYSTEM_PROMPT = """You are a helpful assistant for the {{PROJECT_NAME}} project.
You have access to tools for searching documentation, remembering things, and running tests.
Always ground your answers in the knowledgebase when possible."""

MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
MAX_TURNS = 10

# ── Tool Definitions (Anthropic format) ───────────────────

TOOLS = [
    {
        "name": "rag_query",
        "description": "Search the project knowledgebase for relevant information and get an answer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The search question"},
            },
            "required": ["question"],
        },
    },
    {
        "name": "agent_remember",
        "description": "Store a key-value pair in persistent memory (survives across sessions).",
        "input_schema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Memory key"},
                "value": {"type": "string", "description": "Value to store"},
            },
            "required": ["key", "value"],
        },
    },
    {
        "name": "agent_recall",
        "description": "Retrieve a value from persistent memory by key.",
        "input_schema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Memory key to look up"},
            },
            "required": ["key"],
        },
    },
]

# ── Tool Handlers ─────────────────────────────────────────


def handle_tool(name: str, inputs: dict) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        # Step-through debug: hold for approval if debug mode is enabled
        decision = http.post("/debug/hold", json={
            "agent": "assistant",
            "tool": name,
            "args": inputs,
            "context": f"Agent wants to call {name}",
        }).json()

        if decision.get("decision") == "rejected":
            return f"Action rejected: {decision.get('reason', 'no reason given')}"

        if name == "rag_query":
            resp = http.post("/query", json={"question": inputs["question"], "top_k": 5})
            return resp.json().get("answer", "No results found.")

        elif name == "agent_remember":
            http.put(f"/memory/{inputs['key']}", json={"value": inputs["value"]})
            return f"Remembered: {inputs['key']}"

        elif name == "agent_recall":
            resp = http.get(f"/memory/{inputs['key']}")
            if resp.status_code == 404:
                return f"No memory found for: {inputs['key']}"
            return str(resp.json().get("value", ""))

        else:
            return f"Unknown tool: {name}"
    except Exception as e:
        return f"Tool error: {e}"


# ── Agent Loop ────────────────────────────────────────────


def run_agent(user_message: str) -> str:
    """
    Simple ReAct-style agent loop.
    Sends a message, checks for tool calls, executes them,
    feeds results back, repeats until the model responds with text.
    """
    messages = [{"role": "user", "content": user_message}]

    for turn in range(MAX_TURNS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Check if the model wants to use tools
        tool_calls = [b for b in response.content if b.type == "tool_use"]

        if not tool_calls:
            # No tools — model is done, extract text response
            text_blocks = [b.text for b in response.content if b.type == "text"]
            return "\n".join(text_blocks)

        # Execute tools and feed results back
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for tc in tool_calls:
            result = handle_tool(tc.name, tc.input)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tc.id,
                "content": result,
            })

        messages.append({"role": "user", "content": tool_results})

    return "Agent reached maximum turns without completing."


# ── Entry Point ───────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python agent.py 'your question or task'")
        sys.exit(1)

    result = run_agent(sys.argv[1])
    print(result)
