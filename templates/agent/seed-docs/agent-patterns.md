# AI Agent Development — Reference Guide

## Agent Architecture Patterns

### ReAct (Reasoning + Acting)
The agent reasons about what to do, takes an action (calls a tool), observes the result, then reasons again. This loop continues until the task is complete or the agent decides it can't proceed.

```
Think: I need to find the user's account details
Act: call lookup_user(email="alice@example.com")
Observe: {"id": 123, "plan": "pro", "status": "active"}
Think: The user is on the Pro plan. Now I can answer their billing question.
Act: respond("Your Pro plan is $29/month, billed annually...")
```

Best for: single-agent tasks with clear tool sets.

### Plan-and-Execute
The agent creates a full plan before executing any steps. Each step can be a tool call or a sub-task. The plan can be revised if a step fails or produces unexpected results.

Best for: complex multi-step tasks where the order matters (research, analysis, workflows).

### Reflection
After producing an output, the agent reviews its own work and iterates. A separate "critic" prompt evaluates the output against the original goal and suggests improvements.

Best for: writing, code generation, and any task where quality improves with iteration.

## Tool Design Principles

### Single Responsibility
Each tool does one thing. `search_users` searches, `update_user` updates. Don't combine "search and update if found" into one tool — the agent can compose them.

### Clear Descriptions
The tool description is the agent's documentation. Be specific about what the tool does, what parameters mean, and what it returns. The agent reads this to decide when and how to use the tool.

### Structured Input and Output
Use JSON schemas for inputs (the agent generates structured calls). Return structured JSON (the agent parses the result). Avoid returning raw text that the agent has to parse.

### Idempotent When Possible
Tools that can be safely called twice with the same input are easier for agents to use. If a tool creates a resource, have it check for existing resources first.

### Error Messages for the Agent
Error responses should tell the agent what went wrong and what to do differently. "User not found" is better than "404". "Email must be a valid email address" is better than "Validation failed".

## Memory Strategies

### Short-Term (Conversation Context)
The conversation history IS the short-term memory. The agent sees what was said and done in this session. Limited by the LLM's context window.

### Working Memory (Agent Memory Key-Value)
Structured state that the agent explicitly stores and retrieves:
```
/remember task:current "Researching Q3 revenue trends"
/remember findings:revenue "Revenue grew 12% QoQ, driven by enterprise sales"
```
Survives across sessions. The agent must actively manage it.

### Long-Term (RAG Knowledgebase)
Unstructured knowledge the agent can search but doesn't manage directly. Documents are ingested separately. The agent queries when it needs background information.

### When to Use Which
- "What did the user just say?" → conversation context (automatic)
- "What's the user's name?" → agent memory (explicit key-value)
- "What does our API documentation say about rate limits?" → RAG (search)

## Safety and Guardrails

### Tool Permissions
Not every tool should be available in every context. A customer-facing agent shouldn't have database write access. Define tool sets per deployment context.

### Output Validation
Validate the agent's tool calls before executing them. Check for SQL injection in database queries, path traversal in file operations, and rate limits on external API calls.

### Conversation Boundaries
Define what the agent should and shouldn't discuss. Use the system prompt to set boundaries. Monitor for boundary violations in production.

### Human-in-the-Loop
For high-stakes actions (sending emails, making purchases, modifying data), require human confirmation before executing. The agent proposes the action, the human approves.

## Framework Comparison

| Framework | Language | Strengths | Considerations |
|-----------|----------|-----------|---------------|
| AutoGen (AG2) | Python | Multi-agent, GroupChat, code execution sandbox | Heavy, opinionated API |
| CrewAI | Python | Role-based agents, simple API, good docs | Less flexible than AutoGen |
| LangGraph | Python | Graph-based workflows, good for complex flows | Tied to LangChain ecosystem |
| Semantic Kernel | Python/C# | Microsoft-backed, enterprise focus | Newer, smaller community |
| Custom | Any | Full control, no framework overhead | More code to write |

The workbench supports all of these as project dependencies. See `make scaffold TYPE=agent FRAMEWORK=<name>` for framework-specific starter code.
