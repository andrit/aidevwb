/**
 * Agent eval service — runs behavioral test scenarios.
 *
 * Executes each scenario by sending user messages to the Claude API
 * with the provided system prompt and tools, capturing tool calls
 * and responses, then scoring against expectations.
 *
 * Uses the eval-scoring lib for pure scoring logic.
 * Stores results in the project's eval_runs table.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { evaluateExpectation, aggregateToolUsage, type CapturedTurn } from "../lib/eval-scoring.js";
import { withSpan, spanAttrs } from "../lib/tracing.js";
import type { Db } from "./db.js";
import type {
  RunAgentEvalInput,
  AgentScenario,
  ScenarioResult,
  AgentEvalResult,
  CheckResult,
} from "../schemas/index.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * Map workbench tool names to Anthropic tool definitions.
 * These are the tools the agent can call during the eval.
 */
const TOOL_DEFS: Record<string, Anthropic.Tool> = {
  rag_query: {
    name: "rag_query",
    description: "Search the project knowledgebase.",
    input_schema: {
      type: "object" as const,
      properties: { question: { type: "string" }, top_k: { type: "number" } },
      required: ["question"],
    },
  },
  agent_remember: {
    name: "agent_remember",
    description: "Store a key-value pair in persistent memory.",
    input_schema: {
      type: "object" as const,
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  agent_recall: {
    name: "agent_recall",
    description: "Retrieve a value from persistent memory.",
    input_schema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  agent_forget: {
    name: "agent_forget",
    description: "Delete a key from persistent memory.",
    input_schema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
};

/**
 * Run a full agent eval: execute all scenarios and score results.
 */
export async function runAgentEval(
  db: Db,
  input: RunAgentEvalInput
): Promise<AgentEvalResult> {
  return withSpan(
    "agent_eval.run",
    { "eval.name": input.name, "eval.scenario_count": input.scenarios.length },
    async (span) => {
      const tools = input.tools
        .map((name) => TOOL_DEFS[name])
        .filter(Boolean);

      const scenarioResults: ScenarioResult[] = [];
      const allToolCalls: string[][] = [];

      for (const scenario of input.scenarios) {
        const result = await runScenario(
          scenario,
          input.system_prompt,
          tools,
          input.model
        );
        scenarioResults.push(result);
        allToolCalls.push(result.tool_calls);
      }

      const passed = scenarioResults.filter((r) => r.passed).length;
      const passRate = scenarioResults.length > 0
        ? Number((passed / scenarioResults.length).toFixed(4))
        : 0;

      const evalResult: AgentEvalResult = {
        name: input.name,
        total_scenarios: scenarioResults.length,
        passed,
        failed: scenarioResults.length - passed,
        pass_rate: passRate,
        scenarios: scenarioResults,
        tool_usage: aggregateToolUsage(allToolCalls),
      };

      // Store in database
      await db`
        INSERT INTO eval_runs (query_set_name, results, summary)
        VALUES (
          ${"agent:" + input.name},
          ${JSON.stringify(scenarioResults)}::jsonb,
          ${JSON.stringify(evalResult)}::jsonb
        )
      `;

      span.setAttribute("eval.passed", passed);
      span.setAttribute("eval.failed", scenarioResults.length - passed);
      span.setAttribute("eval.pass_rate", passRate);

      return evalResult;
    }
  );
}

/**
 * Run a single scenario: send user messages, capture agent behavior, score.
 */
async function runScenario(
  scenario: AgentScenario,
  systemPrompt: string,
  tools: Anthropic.Tool[],
  model: string
): Promise<ScenarioResult> {
  const messages: Anthropic.MessageParam[] = [];
  const allChecks: CheckResult[] = [];
  const toolsCalled: string[] = [];
  let turnCount = 0;

  for (const turn of scenario.turns) {
    if ("role" in turn && turn.role === "user") {
      // User message — add to history
      messages.push({ role: "user", content: turn.content });
      turnCount++;

      // Call Claude with the accumulated history
      const captured = await executeAgentTurn(
        systemPrompt,
        messages,
        tools,
        model
      );

      // Track tool calls
      for (const tc of captured.tool_calls) {
        toolsCalled.push(tc.name);
      }

      // Add assistant response to history for multi-turn
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (captured.response_text) {
        contentBlocks.push({ type: "text", text: captured.response_text });
      }
      for (const tc of captured.tool_calls) {
        contentBlocks.push({
          type: "tool_use",
          id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: tc.name,
          input: tc.args,
        });
      }
      if (contentBlocks.length > 0) {
        messages.push({ role: "assistant", content: contentBlocks });
      }

      // Add mock tool results to continue the conversation
      if (captured.tool_calls.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = captured.tool_calls.map((tc) => ({
          type: "tool_result" as const,
          tool_use_id: (contentBlocks.find(
            (b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlockParam).name === tc.name
          ) as Anthropic.ToolUseBlockParam)?.id || "unknown",
          content: mockToolResult(tc.name, tc.args),
        }));
        messages.push({ role: "user", content: toolResults });
      }

      // Store captured turn for the next expect block
      (messages as unknown as Record<string, unknown>).__lastCaptured = captured;

    } else if ("expect" in turn) {
      // Expectation — evaluate against the last captured turn
      const captured = (messages as unknown as Record<string, unknown>).__lastCaptured as CapturedTurn | undefined;
      if (!captured) {
        allChecks.push({
          check: "expect block without preceding user message",
          passed: false,
          detail: "No captured turn to evaluate",
        });
        continue;
      }

      const checks = evaluateExpectation(turn.expect, captured);
      allChecks.push(...checks);
    }
  }

  return {
    name: scenario.name,
    passed: allChecks.every((c) => c.passed),
    checks: allChecks,
    tool_calls: toolsCalled,
    turn_count: turnCount,
  };
}

/**
 * Execute one agent turn: call Claude API, capture response and tool calls.
 */
async function executeAgentTurn(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  model: string
): Promise<CapturedTurn> {
  const apiParams: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  };

  const response = await client.messages.create(apiParams);

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const toolUseBlocks = response.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );

  return {
    response_text: textBlocks.map((b) => b.text).join("\n"),
    tool_calls: toolUseBlocks.map((b) => ({
      name: b.name,
      args: b.input as Record<string, unknown>,
    })),
  };
}

/**
 * Generate mock tool results for eval scenarios.
 * In live mode, these would call the real workbench API.
 * In eval mode, we return plausible mock data so the conversation continues.
 */
function mockToolResult(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "rag_query":
      return "Based on the documentation: The refund policy allows returns within 30 days of purchase.";
    case "agent_remember":
      return `Remembered: ${args.key}`;
    case "agent_recall":
      return String(args.value ?? args.key ?? "stored value");
    case "agent_forget":
      return `Deleted: ${args.key}`;
    default:
      return `Tool ${toolName} executed successfully.`;
  }
}

/**
 * List past agent eval runs.
 */
export async function listAgentEvalRuns(
  db: Db,
  limit = 10
): Promise<Array<{ id: string; query_set_name: string; summary: unknown; created_at: string }>> {
  const rows = await db`
    SELECT id, query_set_name, summary, created_at::text
    FROM eval_runs
    WHERE query_set_name LIKE 'agent:%'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as Array<{
    id: string;
    query_set_name: string;
    summary: unknown;
    created_at: string;
  }>;
}
