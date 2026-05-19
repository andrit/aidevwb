/**
 * Agent eval scoring — pure functions for checking expectations.
 *
 * Separated from the runner so scoring logic is independently testable
 * without LLM calls or database access.
 */
import type { Expectation, CheckResult } from "../schemas/agent-eval.js";

export interface CapturedTurn {
  response_text: string;
  tool_calls: Array<{ name: string; args: Record<string, unknown> }>;
}

/**
 * Evaluate all checks in an expectation against a captured turn.
 * Returns an array of check results (one per check in the expectation).
 */
export function evaluateExpectation(
  expect: Expectation,
  captured: CapturedTurn
): CheckResult[] {
  const results: CheckResult[] = [];
  const toolNames = captured.tool_calls.map((tc) => tc.name);
  const responseLower = captured.response_text.toLowerCase();

  // tool_called
  if (expect.tool_called !== undefined) {
    const found = toolNames.includes(expect.tool_called);
    results.push({
      check: `tool_called: ${expect.tool_called}`,
      passed: found,
      detail: found ? undefined : `Agent did not call ${expect.tool_called}. Called: [${toolNames.join(", ") || "none"}]`,
    });
  }

  // tool_not_called
  if (expect.tool_not_called !== undefined) {
    const found = toolNames.includes(expect.tool_not_called);
    results.push({
      check: `tool_not_called: ${expect.tool_not_called}`,
      passed: !found,
      detail: !found ? undefined : `Agent called ${expect.tool_not_called} but shouldn't have`,
    });
  }

  // tool_args_contain
  if (expect.tool_args_contain !== undefined && expect.tool_called !== undefined) {
    const matchingCall = captured.tool_calls.find((tc) => tc.name === expect.tool_called);
    if (matchingCall) {
      const missingKeys: string[] = [];
      for (const [key, expectedValue] of Object.entries(expect.tool_args_contain)) {
        const actualValue = matchingCall.args[key];
        if (typeof expectedValue === "string" && typeof actualValue === "string") {
          if (!actualValue.toLowerCase().includes(expectedValue.toLowerCase())) {
            missingKeys.push(`${key}: expected "${expectedValue}", got "${actualValue}"`);
          }
        } else if (actualValue !== expectedValue) {
          missingKeys.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
        }
      }
      results.push({
        check: `tool_args_contain: ${JSON.stringify(expect.tool_args_contain)}`,
        passed: missingKeys.length === 0,
        detail: missingKeys.length > 0 ? `Mismatched args: ${missingKeys.join("; ")}` : undefined,
      });
    }
  }

  // response_contains
  if (expect.response_contains !== undefined) {
    const missing = expect.response_contains.filter(
      (s) => !responseLower.includes(s.toLowerCase())
    );
    results.push({
      check: `response_contains: [${expect.response_contains.join(", ")}]`,
      passed: missing.length === 0,
      detail: missing.length > 0 ? `Missing from response: [${missing.join(", ")}]` : undefined,
    });
  }

  // response_not_contains
  if (expect.response_not_contains !== undefined) {
    const found = expect.response_not_contains.filter(
      (s) => responseLower.includes(s.toLowerCase())
    );
    results.push({
      check: `response_not_contains: [${expect.response_not_contains.join(", ")}]`,
      passed: found.length === 0,
      detail: found.length > 0 ? `Found in response (should be absent): [${found.join(", ")}]` : undefined,
    });
  }

  // max_tool_calls
  if (expect.max_tool_calls !== undefined) {
    const count = captured.tool_calls.length;
    results.push({
      check: `max_tool_calls: ${expect.max_tool_calls}`,
      passed: count <= expect.max_tool_calls,
      detail:
        count > expect.max_tool_calls
          ? `Agent made ${count} tool calls, max allowed ${expect.max_tool_calls}`
          : undefined,
    });
  }

  return results;
}

/**
 * Aggregate tool usage counts across all scenarios.
 */
export function aggregateToolUsage(
  allToolCalls: string[][]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scenario of allToolCalls) {
    for (const tool of scenario) {
      counts[tool] = (counts[tool] || 0) + 1;
    }
  }
  return counts;
}
