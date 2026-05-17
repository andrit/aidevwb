import { describe, it, expect } from "vitest";
import {
  CreateConversationSchema,
  AppendMessagesSchema,
  MemoryKeySchema,
  MemorySetSchema,
  MemoryListSchema,
  RunEvalSchema,
  EvalQuerySchema,
  zodToJsonSchema,
} from "../../schemas/index.js";

describe("Conversation schemas", () => {
  describe("CreateConversationSchema", () => {
    it("accepts empty object (title optional)", () => {
      const result = CreateConversationSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts title with messages", () => {
      const result = CreateConversationSchema.safeParse({
        title: "Test chat",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid role", () => {
      const result = CreateConversationSchema.safeParse({
        messages: [{ role: "invalid", content: "Hello" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty content", () => {
      const result = CreateConversationSchema.safeParse({
        messages: [{ role: "user", content: "" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("AppendMessagesSchema", () => {
    it("requires at least one message", () => {
      expect(AppendMessagesSchema.safeParse({ messages: [] }).success).toBe(false);
      expect(
        AppendMessagesSchema.safeParse({
          messages: [{ role: "user", content: "Hi" }],
        }).success
      ).toBe(true);
    });

    it("accepts all valid roles", () => {
      for (const role of ["user", "assistant", "system", "tool"]) {
        const result = AppendMessagesSchema.safeParse({
          messages: [{ role, content: "test" }],
        });
        expect(result.success).toBe(true);
      }
    });
  });
});

describe("Memory schemas", () => {
  describe("MemoryKeySchema", () => {
    it("accepts valid keys", () => {
      expect(MemoryKeySchema.safeParse("agent:name").success).toBe(true);
      expect(MemoryKeySchema.safeParse("user/profile").success).toBe(true);
      expect(MemoryKeySchema.safeParse("config.setting").success).toBe(true);
      expect(MemoryKeySchema.safeParse("simple-key").success).toBe(true);
    });

    it("rejects invalid keys", () => {
      expect(MemoryKeySchema.safeParse("").success).toBe(false);
      expect(MemoryKeySchema.safeParse("has spaces").success).toBe(false);
      expect(MemoryKeySchema.safeParse("has@symbol").success).toBe(false);
    });
  });

  describe("MemorySetSchema", () => {
    it("accepts string value", () => {
      const result = MemorySetSchema.safeParse({ key: "name", value: "Alice" });
      expect(result.success).toBe(true);
    });

    it("accepts object value", () => {
      const result = MemorySetSchema.safeParse({
        key: "agent:state",
        value: { step: 3, status: "running" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts array value", () => {
      const result = MemorySetSchema.safeParse({
        key: "history",
        value: [1, 2, 3],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("MemoryListSchema", () => {
    it("accepts empty (list all)", () => {
      expect(MemoryListSchema.safeParse({}).success).toBe(true);
    });

    it("accepts prefix filter", () => {
      const result = MemoryListSchema.safeParse({ prefix: "agent:" });
      expect(result.success).toBe(true);
    });
  });
});

describe("Eval schemas", () => {
  describe("EvalQuerySchema", () => {
    it("accepts minimal query", () => {
      const result = EvalQuerySchema.safeParse({ question: "What is X?" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.min_score).toBe(0.5);
    });

    it("accepts full query with expectations", () => {
      const result = EvalQuerySchema.safeParse({
        question: "What is the refund policy?",
        expected_keywords: ["refund", "30 days"],
        expected_document_id: "abc-123",
        min_score: 0.7,
      });
      expect(result.success).toBe(true);
    });

    it("rejects min_score out of range", () => {
      expect(
        EvalQuerySchema.safeParse({ question: "X", min_score: -0.1 }).success
      ).toBe(false);
      expect(
        EvalQuerySchema.safeParse({ question: "X", min_score: 1.1 }).success
      ).toBe(false);
    });
  });

  describe("RunEvalSchema", () => {
    it("requires name and at least one query", () => {
      expect(RunEvalSchema.safeParse({ name: "test", queries: [] }).success).toBe(
        false
      );
      expect(
        RunEvalSchema.safeParse({
          name: "test",
          queries: [{ question: "What?" }],
        }).success
      ).toBe(true);
    });

    it("defaults top_k to 5", () => {
      const result = RunEvalSchema.safeParse({
        name: "test",
        queries: [{ question: "What?" }],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.top_k).toBe(5);
    });
  });

  describe("zodToJsonSchema for new schemas", () => {
    it("converts MemorySetSchema", () => {
      const json = zodToJsonSchema(MemorySetSchema) as Record<string, unknown>;
      expect(json).toHaveProperty("required");
      expect(json.required).toContain("key");
    });

    it("converts RunEvalSchema", () => {
      const json = zodToJsonSchema(RunEvalSchema) as Record<string, unknown>;
      expect(json).toHaveProperty("required");
      expect(json.required).toContain("name");
      expect(json.required).toContain("queries");
    });
  });
});
