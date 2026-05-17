/**
 * MCP Server — TypeScript version of the stdio bridge.
 * Functionally identical to configs/mcp/bridge/index.js.
 * Use the bridge in production (no build step needed in claude-code).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  IngestSchema,
  QuerySchema,
  ReindexSchema,
  TestRunSchema,
  zodToJsonSchema,
} from "../schemas/index.js";

const API = process.env.API_URL || "http://mcp-server:3100";
const PROJECT = process.env.WORKBENCH_PROJECT || "";

async function api(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (PROJECT) headers["X-Project"] = PROJECT;

  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

const server = new Server(
  { name: "ai-dev-workbench", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "rag_ingest",
      description: "Ingest a document into the project knowledgebase.",
      inputSchema: zodToJsonSchema(IngestSchema),
    },
    {
      name: "rag_query",
      description: "Hybrid search the project knowledgebase and generate an answer.",
      inputSchema: zodToJsonSchema(QuerySchema),
    },
    {
      name: "rag_status",
      description: "Show project knowledgebase stats.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "rag_reindex",
      description: "Re-embed all documents. Requires confirm: true.",
      inputSchema: zodToJsonSchema(ReindexSchema),
    },
    {
      name: "project_test",
      description: "Run the project's test suite.",
      inputSchema: zodToJsonSchema(TestRunSchema),
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  let result: unknown;

  switch (name) {
    case "rag_ingest": {
      const parsed = IngestSchema.parse(args);
      result = await api("/ingest", "POST", parsed);
      break;
    }
    case "rag_query": {
      const parsed = QuerySchema.parse(args);
      result = await api("/query", "POST", parsed);
      break;
    }
    case "rag_status":
      result = await api("/status");
      break;
    case "rag_reindex": {
      const parsed = ReindexSchema.parse(args);
      result = await api("/reindex", "POST", parsed);
      break;
    }
    case "project_test": {
      const parsed = TestRunSchema.parse(args);
      result = await api("/test", "POST", parsed);
      break;
    }
    default:
      return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }] };
  }

  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
