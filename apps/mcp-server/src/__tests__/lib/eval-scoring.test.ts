import { describe, it, expect } from "vitest";
import { evaluateExpectation, aggregateToolUsage, type CapturedTurn } from "../../lib/eval-scoring.js";

function captured(text: string, tools: Array<{ name: string; args: Record<string, unknown> }> = []): CapturedTurn {
  return { response_text: text, tool_calls: tools };
}

describe("evaluateExpectation", () => {
  describe("tool_called", () => {
    it("passes when the tool was called", () => {
      const results = evaluateExpectation(
        { tool_called: "rag_query" },
        captured("answer", [{ name: "rag_query", args: { question: "test" } }])
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when the tool was not called", () => {
      const results = evaluateExpectation(
        { tool_called: "rag_query" },
        captured("answer", [])
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("did not call");
    });

    it("fails when a different tool was called", () => {
      const results = evaluateExpectation(
        { tool_called: "rag_query" },
        captured("answer", [{ name: "agent_remember", args: {} }])
      );
      expect(results[0].passed).toBe(false);
    });
  });

  describe("tool_not_called", () => {
    it("passes when the tool was not called", () => {
      const results = evaluateExpectation(
        { tool_not_called: "rag_query" },
        captured("answer", [])
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when the tool was called", () => {
      const results = evaluateExpectation(
        { tool_not_called: "rag_query" },
        captured("answer", [{ name: "rag_query", args: {} }])
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("shouldn't have");
    });
  });

  describe("tool_args_contain", () => {
    it("passes when args match (string, case-insensitive)", () => {
      const results = evaluateExpectation(
        { tool_called: "rag_query", tool_args_contain: { question: "refund" } },
        captured("answer", [{ name: "rag_query", args: { question: "What is the Refund policy?" } }])
      );
      const argsCheck = results.find((r) => r.check.includes("tool_args_contain"));
      expect(argsCheck?.passed).toBe(true);
    });

    it("fails when args don't match", () => {
      const results = evaluateExpectation(
        { tool_called: "rag_query", tool_args_contain: { question: "refund" } },
        captured("answer", [{ name: "rag_query", args: { question: "shipping policy" } }])
      );
      const argsCheck = results.find((r) => r.check.includes("tool_args_contain"));
      expect(argsCheck?.passed).toBe(false);
    });
  });

  describe("response_contains", () => {
    it("passes when all strings are present (case-insensitive)", () => {
      const results = evaluateExpectation(
        { response_contains: ["30 days", "refund"] },
        captured("The refund policy allows returns within 30 days.")
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when a string is missing", () => {
      const results = evaluateExpectation(
        { response_contains: ["30 days", "warranty"] },
        captured("The refund policy allows returns within 30 days.")
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("warranty");
    });
  });

  describe("response_not_contains", () => {
    it("passes when no forbidden strings are present", () => {
      const results = evaluateExpectation(
        { response_not_contains: ["I don't know", "I'm not sure"] },
        captured("The refund policy allows returns within 30 days.")
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when a forbidden string is present", () => {
      const results = evaluateExpectation(
        { response_not_contains: ["I don't know"] },
        captured("I don't know the answer to that.")
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("I don't know");
    });
  });

  describe("max_tool_calls", () => {
    it("passes when under the limit", () => {
      const results = evaluateExpectation(
        { max_tool_calls: 2 },
        captured("answer", [{ name: "rag_query", args: {} }])
      );
      expect(results[0].passed).toBe(true);
    });

    it("passes when exactly at the limit", () => {
      const results = evaluateExpectation(
        { max_tool_calls: 1 },
        captured("answer", [{ name: "rag_query", args: {} }])
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when over the limit", () => {
      const results = evaluateExpectation(
        { max_tool_calls: 0 },
        captured("answer", [{ name: "rag_query", args: {} }])
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("1 tool calls");
    });
  });

  describe("multiple checks in one expectation", () => {
    it("evaluates all checks independently", () => {
      const results = evaluateExpectation(
        {
          tool_called: "rag_query",
          response_contains: ["30 days"],
          response_not_contains: ["I don't know"],
          max_tool_calls: 2,
        },
        captured("The refund policy allows returns within 30 days.", [
          { name: "rag_query", args: { question: "refund" } },
        ])
      );
      expect(results.length).toBe(4);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it("reports partial failures correctly", () => {
      const results = evaluateExpectation(
        {
          tool_called: "rag_query",
          response_contains: ["warranty"],  // will fail
        },
        captured("The refund policy.", [
          { name: "rag_query", args: {} },  // will pass
        ])
      );
      expect(results.find((r) => r.check.includes("tool_called"))?.passed).toBe(true);
      expect(results.find((r) => r.check.includes("response_contains"))?.passed).toBe(false);
    });
  });
});

describe("aggregateToolUsage", () => {
  it("counts tools across scenarios", () => {
    const result = aggregateToolUsage([
      ["rag_query", "agent_remember"],
      ["rag_query", "rag_query"],
      ["agent_recall"],
    ]);
    expect(result).toEqual({
      rag_query: 3,
      agent_remember: 1,
      agent_recall: 1,
    });
  });

  it("returns empty for no tool calls", () => {
    expect(aggregateToolUsage([[], []])).toEqual({});
  });
});
