"""
{{PROJECT_NAME}} — CrewAI Agent

Starter agent using CrewAI's role-based crew pattern.
Defines agents with roles, goals, and backstories,
then assigns them tasks in a crew.

Usage:
  python agent.py "Research and summarize our API rate limiting approach"

Customize:
  - agents: change roles, goals, backstories
  - tasks: define what each agent does
  - tools: add workbench RAG and memory tools
"""
import os
import sys

import httpx
from crewai import Agent, Crew, Task, Process
from crewai.tools import BaseTool
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

# ── Tools ─────────────────────────────────────────────────


class RAGSearchTool(BaseTool):
    name: str = "Search Knowledgebase"
    description: str = "Search the project knowledgebase for relevant information. Input is the search question."

    def _run(self, question: str) -> str:
        resp = http.post("/query", json={"question": question, "top_k": 5})
        data = resp.json()
        return data.get("answer", "No results found.")


class MemoryStoreTool(BaseTool):
    name: str = "Remember"
    description: str = "Store a key-value pair in persistent memory. Input format: 'key: value'"

    def _run(self, input_text: str) -> str:
        parts = input_text.split(":", 1)
        if len(parts) != 2:
            return "Error: format must be 'key: value'"
        key, value = parts[0].strip(), parts[1].strip()
        http.put(f"/memory/{key}", json={"value": value})
        return f"Remembered: {key}"


class MemoryRecallTool(BaseTool):
    name: str = "Recall"
    description: str = "Retrieve a value from persistent memory by key."

    def _run(self, key: str) -> str:
        resp = http.get(f"/memory/{key.strip()}")
        if resp.status_code == 404:
            return f"No memory found for: {key}"
        return str(resp.json().get("value", ""))


# ── Agents ────────────────────────────────────────────────

researcher = Agent(
    role="Researcher",
    goal="Find accurate, relevant information from the project knowledgebase",
    backstory="You are a thorough researcher who always grounds findings in documentation.",
    tools=[RAGSearchTool()],
    verbose=True,
)

writer = Agent(
    role="Writer",
    goal="Synthesize research into clear, actionable summaries",
    backstory="You are a technical writer who produces concise, well-structured content.",
    tools=[MemoryStoreTool()],
    verbose=True,
)

# ── Tasks ─────────────────────────────────────────────────


def build_tasks(topic: str) -> list[Task]:
    research_task = Task(
        description=f"Research the following topic using the knowledgebase: {topic}",
        expected_output="A detailed list of findings with sources",
        agent=researcher,
    )

    summary_task = Task(
        description="Synthesize the research findings into a clear summary. Store key findings in memory.",
        expected_output="A concise summary with key points",
        agent=writer,
        context=[research_task],
    )

    return [research_task, summary_task]


# ── Crew ──────────────────────────────────────────────────


def main(topic: str):
    crew = Crew(
        agents=[researcher, writer],
        tasks=build_tasks(topic),
        process=Process.sequential,
        verbose=True,
    )

    result = crew.kickoff()
    print("\n" + "=" * 60)
    print("RESULT:")
    print("=" * 60)
    print(result)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python agent.py 'your topic or task'")
        sys.exit(1)

    main(sys.argv[1])
