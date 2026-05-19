import { describe, it, expect } from "vitest";
import { spanAttrs } from "../../lib/tracing.js";

describe("spanAttrs factories", () => {
  describe("rag", () => {
    it("returns project and operation attributes", () => {
      const attrs = spanAttrs.rag("nexus", "hybrid_search");
      expect(attrs["workbench.project"]).toBe("nexus");
      expect(attrs["workbench.operation"]).toBe("hybrid_search");
      expect(attrs["workbench.category"]).toBe("rag");
    });
  });

  describe("embedding", () => {
    it("returns model and count attributes", () => {
      const attrs = spanAttrs.embedding("voyage/voyage-3", 10);
      expect(attrs["embedding.model"]).toBe("voyage/voyage-3");
      expect(attrs["embedding.input_count"]).toBe(10);
      expect(attrs["workbench.category"]).toBe("embedding");
    });
  });

  describe("llm", () => {
    it("returns model and operation attributes", () => {
      const attrs = spanAttrs.llm("claude-sonnet-4-20250514", "generate_answer");
      expect(attrs["llm.model"]).toBe("claude-sonnet-4-20250514");
      expect(attrs["llm.operation"]).toBe("generate_answer");
      expect(attrs["workbench.category"]).toBe("llm");
    });
  });

  describe("agentTool", () => {
    it("returns project and tool name", () => {
      const attrs = spanAttrs.agentTool("nexus", "rag_query");
      expect(attrs["workbench.project"]).toBe("nexus");
      expect(attrs["agent.tool"]).toBe("rag_query");
      expect(attrs["workbench.category"]).toBe("agent");
    });
  });

  describe("memory", () => {
    it("returns project, operation, and key", () => {
      const attrs = spanAttrs.memory("nexus", "set", "user:name");
      expect(attrs["workbench.project"]).toBe("nexus");
      expect(attrs["memory.operation"]).toBe("set");
      expect(attrs["memory.key"]).toBe("user:name");
      expect(attrs["workbench.category"]).toBe("memory");
    });
  });

  describe("conversation", () => {
    it("returns project and operation", () => {
      const attrs = spanAttrs.conversation("nexus", "create");
      expect(attrs["workbench.project"]).toBe("nexus");
      expect(attrs["conversation.operation"]).toBe("create");
      expect(attrs["workbench.category"]).toBe("conversation");
    });
  });

  describe("all factories", () => {
    it("always include workbench.category", () => {
      const all = [
        spanAttrs.rag("p", "op"),
        spanAttrs.embedding("m", 1),
        spanAttrs.llm("m", "op"),
        spanAttrs.agentTool("p", "t"),
        spanAttrs.memory("p", "op", "k"),
        spanAttrs.conversation("p", "op"),
      ];
      for (const attrs of all) {
        expect(attrs).toHaveProperty("workbench.category");
      }
    });
  });
});
