import { describe, it, expect } from "vitest";
import {
  ExpectationSchema,
  AgentScenarioSchema,
  RunAgentEvalSchema,
} from "../../schemas/index.js";

describe("Agent eval schemas", () => {
  describe("ExpectationSchema", () => {
    it("accepts tool_called only", () => {
      expect(ExpectationSchema.safeParse({ tool_called: "rag_query" }).success).toBe(true);
    });

    it("accepts response_contains only", () => {
      expect(ExpectationSchema.safeParse({ response_contains: ["hello"] }).success).toBe(true);
    });

    it("accepts all checks combined", () => {
      const result = ExpectationSchema.safeParse({
        tool_called: "rag_query",
        tool_not_called: "agent_forget",
        tool_args_contain: { question: "test" },
        response_contains: ["answer"],
        response_not_contains: ["error"],
        max_tool_calls: 2,
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty (no checks — always passes)", () => {
      expect(ExpectationSchema.safeParse({}).success).toBe(true);
    });
  });

  describe("AgentScenarioSchema", () => {
    it("accepts minimal scenario", () => {
      const result = AgentScenarioSchema.safeParse({
        name: "test",
        turns: [{ role: "user", content: "Hello" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts user turn + expect turn", () => {
      const result = AgentScenarioSchema.safeParse({
        name: "test",
        turns: [
          { role: "user", content: "Hello" },
          { expect: { response_contains: ["hi"] } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty turns", () => {
      expect(AgentScenarioSchema.safeParse({ name: "test", turns: [] }).success).toBe(false);
    });

    it("rejects missing name", () => {
      expect(AgentScenarioSchema.safeParse({ turns: [{ role: "user", content: "x" }] }).success).toBe(false);
    });
  });

  describe("RunAgentEvalSchema", () => {
    it("accepts full eval run input", () => {
      const result = RunAgentEvalSchema.safeParse({
        name: "support-bot-v1",
        system_prompt: "You are a helpful support agent.",
        scenarios: [
          {
            name: "basic-question",
            turns: [
              { role: "user", content: "What is the refund policy?" },
              { expect: { tool_called: "rag_query", response_contains: ["30 days"] } },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("defaults tools and model", () => {
      const result = RunAgentEvalSchema.safeParse({
        name: "test",
        system_prompt: "You are helpful.",
        scenarios: [{ name: "s1", turns: [{ role: "user", content: "hi" }] }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tools).toContain("rag_query");
        expect(result.data.model).toContain("claude");
      }
    });

    it("rejects missing system_prompt", () => {
      expect(RunAgentEvalSchema.safeParse({
        name: "test",
        scenarios: [{ name: "s1", turns: [{ role: "user", content: "hi" }] }],
      }).success).toBe(false);
    });

    it("rejects empty scenarios", () => {
      expect(RunAgentEvalSchema.safeParse({
        name: "test",
        system_prompt: "prompt",
        scenarios: [],
      }).success).toBe(false);
    });
  });
});
