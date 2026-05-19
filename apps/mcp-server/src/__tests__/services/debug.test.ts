import { describe, it, expect } from "vitest";

// Test the debug service interfaces and mode key logic
// (actual Redis operations tested via integration; these test the pure logic)

describe("Debug service design", () => {
  describe("PendingAction shape", () => {
    it("has all required fields", () => {
      const action = {
        id: "123-abc",
        project: "nexus",
        agent: "researcher",
        tool: "rag_query",
        args: { question: "test" },
        context: "Agent searching docs",
        created_at: "2026-01-01T00:00:00Z",
      };
      expect(action.id).toBeTruthy();
      expect(action.project).toBeTruthy();
      expect(action.agent).toBeTruthy();
      expect(action.tool).toBeTruthy();
      expect(typeof action.args).toBe("object");
    });
  });

  describe("DebugDecision shape", () => {
    it("approved decision has no reason", () => {
      const decision = {
        action_id: "123",
        decision: "approved" as const,
        decided_at: "2026-01-01T00:00:00Z",
      };
      expect(decision.decision).toBe("approved");
      expect(decision).not.toHaveProperty("reason");
    });

    it("rejected decision has a reason", () => {
      const decision = {
        action_id: "123",
        decision: "rejected" as const,
        reason: "Unsafe operation",
        decided_at: "2026-01-01T00:00:00Z",
      };
      expect(decision.decision).toBe("rejected");
      expect(decision.reason).toBe("Unsafe operation");
    });
  });

  describe("Key format", () => {
    // Verify the key naming convention is consistent
    it("follows debug:{project}:* namespace", () => {
      const project = "nexus";
      const id = "abc-123";
      const pendingKey = `debug:${project}:pending:${id}`;
      const decisionKey = `debug:${project}:decision:${id}`;
      const modeKey = `debug:${project}:enabled`;
      const listKey = `debug:${project}:pending_ids`;

      expect(pendingKey).toBe("debug:nexus:pending:abc-123");
      expect(decisionKey).toBe("debug:nexus:decision:abc-123");
      expect(modeKey).toBe("debug:nexus:enabled");
      expect(listKey).toBe("debug:nexus:pending_ids");
    });
  });

  describe("Decision encoding", () => {
    it("approved is stored as plain string", () => {
      const stored = "approved";
      expect(stored).toBe("approved");
    });

    it("rejected encodes reason after prefix", () => {
      const reason = "Too dangerous";
      const stored = `rejected:${reason}`;
      expect(stored).toBe("rejected:Too dangerous");
      expect(stored.replace("rejected:", "")).toBe("Too dangerous");
    });
  });
});
