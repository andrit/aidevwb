/**
 * MCP Bridge v2: stdio ↔ HTTP, project-aware.
 *
 * Reads WORKBENCH_PROJECT env var and passes it as X-Project header.
 * Includes test runner tool alongside RAG tools.
 *
 * Tools: rag_ingest, rag_query, rag_status, rag_reindex, project_test
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = process.env.API_URL || "http://mcp-server:3100";
const PROJECT = process.env.WORKBENCH_PROJECT || "";

async function api(path, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (PROJECT) headers["X-Project"] = PROJECT;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

const server = new Server(
  { name: "ai-dev-workbench", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ─────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "rag_ingest",
      description:
        "Ingest a document into the project knowledgebase. " +
        "Skips unchanged files via SHA256. Multimodal files queued for async processing.",
      inputSchema: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "Absolute path to file (e.g. /workspace/documents/file.txt)",
          },
        },
        required: ["filepath"],
      },
    },
    {
      name: "rag_query",
      description:
        "Hybrid search (semantic + keyword) the project knowledgebase " +
        "and generate a Claude-powered answer.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to answer" },
          top_k: { type: "number", description: "Chunks to retrieve (default 5)", default: 5 },
        },
        required: ["question"],
      },
    },
    {
      name: "rag_status",
      description: "Show project knowledgebase stats: documents, chunks, model, queue depth.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "rag_reindex",
      description: "Re-embed all documents after changing embedding model. Requires confirm: true.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", description: "Must be true to proceed", default: false },
        },
      },
    },
    {
      name: "project_test",
      description:
        "Run the project's test suite. Auto-detects npm test, pytest, cargo test, etc. " +
        "Returns pass/fail status, output, and duration.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Override test command (optional)" },
          timeout: { type: "number", description: "Timeout in seconds (default 120)", default: 120 },
        },
      },
    },
    // ── Agent Memory ─────────────────────────────────────
    {
      name: "agent_remember",
      description: "Store a key-value pair in persistent memory. Survives across sessions.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key (e.g. 'user:name', 'agent:state')" },
          value: { description: "Any JSON value to store" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "agent_recall",
      description: "Retrieve a value from persistent memory by key.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key to retrieve" },
        },
        required: ["key"],
      },
    },
    {
      name: "agent_forget",
      description: "Delete a key from persistent memory.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key to delete" },
        },
        required: ["key"],
      },
    },
    {
      name: "agent_memories",
      description: "List all memory keys, optionally filtered by prefix.",
      inputSchema: {
        type: "object",
        properties: {
          prefix: { type: "string", description: "Filter keys by prefix (e.g. 'agent:')" },
        },
      },
    },
    // ── Conversations ────────────────────────────────────
    {
      name: "conversation_create",
      description: "Create a new conversation thread with optional initial messages.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Conversation title (optional)" },
          messages: {
            type: "array",
            description: "Initial messages to seed",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant", "system", "tool"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
        },
      },
    },
    {
      name: "conversation_list",
      description: "List recent conversations with message counts.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "conversation_get",
      description: "Get a conversation with all its messages by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Conversation UUID" },
        },
        required: ["id"],
      },
    },
    {
      name: "conversation_append",
      description: "Append messages to an existing conversation.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Conversation UUID" },
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant", "system", "tool"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
        },
        required: ["id", "messages"],
      },
    },
    // ── Search Eval ──────────────────────────────────────
    {
      name: "rag_eval",
      description:
        "Evaluate search quality by running test queries and scoring retrieval. " +
        "Returns pass rate, MRR, and per-query results.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for this eval run" },
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                expected_keywords: { type: "array", items: { type: "string" } },
                min_score: { type: "number", default: 0.5 },
              },
              required: ["question"],
            },
          },
          top_k: { type: "number", default: 5 },
        },
        required: ["name", "queries"],
      },
    },
  ],
}));

// ── Tool Execution ───────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  let result;

  try {
    switch (name) {
      case "rag_ingest":
        result = await api("/ingest", "POST", { filepath: args.filepath });
        break;
      case "rag_query":
        result = await api("/query", "POST", { question: args.question, top_k: args.top_k || 5 });
        break;
      case "rag_status":
        result = await api("/status");
        break;
      case "rag_reindex":
        result = await api("/reindex", "POST", { confirm: args.confirm });
        break;
      case "project_test":
        result = await api("/test", "POST", { command: args.command, timeout: args.timeout || 120 });
        break;
      // ── Memory ─────────────────────────────────────────
      case "agent_remember":
        result = await api(`/memory/${encodeURIComponent(args.key)}`, "PUT", { value: args.value });
        break;
      case "agent_recall":
        result = await api(`/memory/${encodeURIComponent(args.key)}`);
        break;
      case "agent_forget":
        result = await api(`/memory/${encodeURIComponent(args.key)}`, "DELETE");
        break;
      case "agent_memories":
        result = await api(`/memory${args.prefix ? `?prefix=${encodeURIComponent(args.prefix)}` : ""}`);
        break;
      // ── Conversations ──────────────────────────────────
      case "conversation_create":
        result = await api("/conversations", "POST", { title: args.title, messages: args.messages });
        break;
      case "conversation_list":
        result = await api("/conversations");
        break;
      case "conversation_get":
        result = await api(`/conversations/${args.id}`);
        break;
      case "conversation_append":
        result = await api(`/conversations/${args.id}/messages`, "POST", { messages: args.messages });
        break;
      // ── Eval ───────────────────────────────────────────
      case "rag_eval":
        result = await api("/eval", "POST", { name: args.name, queries: args.queries, top_k: args.top_k });
        break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error calling ${name}: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
