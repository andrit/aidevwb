import { describe, it, expect } from "vitest";
import {
  IngestSchema,
  QuerySchema,
  ReindexSchema,
  CreateProjectSchema,
  ProjectNameSchema,
  TestRunSchema,
  zodToJsonSchema,
} from "../../schemas/index.js";

describe("RAG schemas", () => {
  describe("IngestSchema", () => {
    it("accepts valid filepath", () => {
      const result = IngestSchema.safeParse({ filepath: "/workspace/documents/test.txt" });
      expect(result.success).toBe(true);
    });

    it("rejects missing filepath", () => {
      const result = IngestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("QuerySchema", () => {
    it("accepts question with default top_k", () => {
      const result = QuerySchema.safeParse({ question: "What is X?" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.top_k).toBe(5);
      }
    });

    it("accepts custom top_k", () => {
      const result = QuerySchema.safeParse({ question: "What?", top_k: 10 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.top_k).toBe(10);
    });

    it("rejects empty question", () => {
      const result = QuerySchema.safeParse({ question: "" });
      expect(result.success).toBe(false);
    });

    it("rejects top_k out of range", () => {
      expect(QuerySchema.safeParse({ question: "X", top_k: 0 }).success).toBe(false);
      expect(QuerySchema.safeParse({ question: "X", top_k: 21 }).success).toBe(false);
    });
  });

  describe("ReindexSchema", () => {
    it("defaults confirm to false", () => {
      const result = ReindexSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.confirm).toBe(false);
    });
  });
});

describe("Project schemas", () => {
  describe("ProjectNameSchema", () => {
    it("accepts valid names", () => {
      expect(ProjectNameSchema.safeParse("nexus").success).toBe(true);
      expect(ProjectNameSchema.safeParse("my-project").success).toBe(true);
      expect(ProjectNameSchema.safeParse("app_v2").success).toBe(true);
    });

    it("rejects invalid names", () => {
      expect(ProjectNameSchema.safeParse("").success).toBe(false);
      expect(ProjectNameSchema.safeParse("123abc").success).toBe(false); // must start with letter
      expect(ProjectNameSchema.safeParse("My Project").success).toBe(false); // no spaces/uppercase
      expect(ProjectNameSchema.safeParse("a".repeat(64)).success).toBe(false); // too long
    });
  });

  describe("CreateProjectSchema", () => {
    it("accepts minimal valid project", () => {
      const result = CreateProjectSchema.safeParse({
        name: "nexus",
        directory: "/home/user/code/nexus",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("custom");
        expect(result.data.framework).toBeUndefined();
      }
    });

    it("accepts full project with type and framework", () => {
      const result = CreateProjectSchema.safeParse({
        name: "my-agent",
        directory: "/home/user/code/my-agent",
        type: "agent",
        framework: "autogen",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid type", () => {
      const result = CreateProjectSchema.safeParse({
        name: "test",
        directory: "/tmp",
        type: "nonexistent",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TestRunSchema", () => {
    it("defaults timeout to 120", () => {
      const result = TestRunSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.timeout).toBe(120);
    });

    it("accepts custom command and timeout", () => {
      const result = TestRunSchema.safeParse({ command: "pytest -v", timeout: 60 });
      expect(result.success).toBe(true);
    });

    it("rejects timeout out of range", () => {
      expect(TestRunSchema.safeParse({ timeout: 0 }).success).toBe(false);
      expect(TestRunSchema.safeParse({ timeout: 601 }).success).toBe(false);
    });
  });
});

describe("zodToJsonSchema", () => {
  it("converts IngestSchema correctly", () => {
    const json = zodToJsonSchema(IngestSchema);
    expect(json).toHaveProperty("type", "object");
    expect(json).toHaveProperty("required", ["filepath"]);
    expect((json as Record<string, Record<string, unknown>>).properties.filepath).toHaveProperty("type", "string");
  });

  it("preserves descriptions through defaults", () => {
    const json = zodToJsonSchema(QuerySchema) as Record<string, Record<string, Record<string, unknown>>>;
    expect(json.properties.top_k.description).toBe("Number of chunks to retrieve");
    expect(json.properties.top_k.default).toBe(5);
  });

  it("marks required fields correctly (not optional, not defaulted)", () => {
    const json = zodToJsonSchema(QuerySchema) as Record<string, unknown>;
    expect(json).toHaveProperty("required", ["question"]);
  });

  it("handles enum types", () => {
    const json = zodToJsonSchema(CreateProjectSchema) as Record<string, Record<string, Record<string, unknown>>>;
    expect(json.properties.type.enum).toContain("fullstack");
    expect(json.properties.type.enum).toContain("agent");
  });
});
