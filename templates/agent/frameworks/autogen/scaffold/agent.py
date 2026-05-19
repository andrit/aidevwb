"""
{{PROJECT_NAME}} — AutoGen Agent

Starter agent using AutoGen (AG2) v0.4+.
Uses the workbench RAG API as a tool for grounded answers.

Usage:
  python agent.py "What does our API documentation say about authentication?"

Customize:
  - SYSTEM_PROMPT: change the agent's personality and constraints
  - tools: add more tools via @assistant.register_tool
  - model_client: swap LLM provider in config
"""
import asyncio
import os
import sys

import httpx
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.task import Console, TextMentionTermination
from autogen_ext.models.openai import OpenAIChatCompletionClient
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
WORKBENCH_PROJECT = os.environ.get("WORKBENCH_PROJECT", "{{PROJECT_NAME}}")

SYSTEM_PROMPT = """You are a helpful assistant for the {{PROJECT_NAME}} project.
You have access to tools that let you search the project knowledgebase,
remember things across sessions, and run tests.

Guidelines:
- Use the rag_query tool to ground your answers in project documentation.
- Use agent_remember/agent_recall for state that should persist.
- Be specific and cite sources when answering from the knowledgebase.
- If you don't have enough information, say so clearly.
"""

# ── Tools (call the workbench API) ────────────────────────

http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={"X-Project": WORKBENCH_PROJECT},
    timeout=30.0,
)


async def rag_query(question: str, top_k: int = 5) -> str:
    """Search the project knowledgebase and get an answer grounded in documents."""
    resp = http.post("/query", json={"question": question, "top_k": top_k})
    data = resp.json()
    return data.get("answer", "No results found.")


async def agent_remember(key: str, value: str) -> str:
    """Store a key-value pair in persistent memory (survives across sessions)."""
    resp = http.put(f"/memory/{key}", json={"value": value})
    return f"Remembered: {key}"


async def agent_recall(key: str) -> str:
    """Retrieve a value from persistent memory by key."""
    resp = http.get(f"/memory/{key}")
    if resp.status_code == 404:
        return f"No memory found for key: {key}"
    return str(resp.json().get("value", ""))


async def run_tests(command: str = "") -> str:
    """Run the project's test suite. Optionally pass a specific test command."""
    payload = {"command": command} if command else {}
    resp = http.post("/test", json=payload)
    data = resp.json()
    status = data.get("status", "unknown")
    output = data.get("stdout", "")[:2000]
    return f"Tests {status}.\n{output}"


# ── Agent Setup ───────────────────────────────────────────

async def main(user_message: str):
    model_client = OpenAIChatCompletionClient(
        model="claude-sonnet-4-20250514",
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url="https://api.anthropic.com/v1/",
    )

    assistant = AssistantAgent(
        name="assistant",
        model_client=model_client,
        system_message=SYSTEM_PROMPT,
        tools=[rag_query, agent_remember, agent_recall, run_tests],
    )

    termination = TextMentionTermination("DONE")

    # Run a single turn
    result = await Console(
        assistant.run_stream(task=user_message),
        output_stats=True,
    )

    await model_client.close()
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python agent.py 'your question or task'")
        sys.exit(1)

    asyncio.run(main(sys.argv[1]))
