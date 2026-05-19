/**
 * Agent Eval Schemas — behavioral testing for agents.
 *
 * Scenarios define multi-turn conversations with expectation checkpoints.
 * The runner executes scenarios against the Claude API and scores behavior.
 */
import { z } from "zod";

// ── Expectation Checks ───────────────────────────────────

export const ExpectationSchema = z.object({
  tool_called: z.string().optional().describe("Agent MUST call this tool"),
  tool_not_called: z.string().optional().describe("Agent must NOT call this tool"),
  tool_args_contain: z
    .record(z.unknown())
    .optional()
    .describe("Tool call args must include these key-value pairs"),
  response_contains: z
    .array(z.string())
    .optional()
    .describe("Response must contain ALL of these strings (case-insensitive)"),
  response_not_contains: z
    .array(z.string())
    .optional()
    .describe("Response must contain NONE of these strings (case-insensitive)"),
  max_tool_calls: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Maximum number of tool calls allowed this turn"),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

// ── Scenario Turns ───────────────────────────────────────

export const ScenarioTurnSchema = z.union([
  z.object({
    role: z.literal("user"),
    content: z.string().min(1),
  }),
  z.object({
    expect: ExpectationSchema,
  }),
]);
export type ScenarioTurn = z.infer<typeof ScenarioTurnSchema>;

// ── Scenario ─────────────────────────────────────────────

export const AgentScenarioSchema = z.object({
  name: z.string().min(1).describe("Scenario name (e.g. 'uses-rag-for-docs')"),
  description: z.string().optional(),
  turns: z.array(ScenarioTurnSchema).min(1).describe("Alternating user messages and expectation checks"),
});
export type AgentScenario = z.infer<typeof AgentScenarioSchema>;

// ── Run Input ────────────────────────────────────────────

export const RunAgentEvalSchema = z.object({
  name: z.string().min(1).describe("Name for this eval run (e.g. 'support-bot-v1')"),
  system_prompt: z.string().min(1).describe("The agent's system prompt to evaluate"),
  tools: z
    .array(z.string())
    .default(["rag_query", "agent_remember", "agent_recall"])
    .describe("Which workbench tools the agent has access to"),
  scenarios: z.array(AgentScenarioSchema).min(1).describe("Test scenarios to run"),
  model: z.string().default("claude-sonnet-4-20250514").describe("Model to use for the agent"),
});
export type RunAgentEvalInput = z.infer<typeof RunAgentEvalSchema>;

// ── Check Result ─────────────────────────────────────────

export const CheckResultSchema = z.object({
  check: z.string().describe("What was checked (e.g. 'tool_called: rag_query')"),
  passed: z.boolean(),
  detail: z.string().optional().describe("Why it failed, if it failed"),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

// ── Scenario Result ──────────────────────────────────────

export const ScenarioResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  checks: z.array(CheckResultSchema),
  tool_calls: z.array(z.string()).describe("Tools called during this scenario"),
  turn_count: z.number(),
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

// ── Run Result ───────────────────────────────────────────

export const AgentEvalResultSchema = z.object({
  name: z.string(),
  total_scenarios: z.number(),
  passed: z.number(),
  failed: z.number(),
  pass_rate: z.number(),
  scenarios: z.array(ScenarioResultSchema),
  tool_usage: z.record(z.number()).describe("Tool name → call count across all scenarios"),
});
export type AgentEvalResult = z.infer<typeof AgentEvalResultSchema>;
