import { describe, it, expect } from "vitest";
import { formatConversationContext } from "../../services/conversations.js";
import type { Message } from "../../schemas/index.js";

function msg(role: string, content: string): Message {
  return {
    id: "test",
    conversation_id: "test",
    role: role as Message["role"],
    content,
    metadata: null,
    created_at: "2026-01-01",
  };
}

describe("formatConversationContext", () => {
  it("formats messages with role prefixes", () => {
    const result = formatConversationContext([
      msg("user", "Hello"),
      msg("assistant", "Hi there!"),
    ]);
    expect(result).toBe("user: Hello\n\nassistant: Hi there!");
  });

  it("returns empty string for no messages", () => {
    expect(formatConversationContext([])).toBe("");
  });

  it("handles single message", () => {
    expect(formatConversationContext([msg("system", "You are helpful")])).toBe(
      "system: You are helpful"
    );
  });

  it("preserves all four roles", () => {
    const context = formatConversationContext([
      msg("system", "Be helpful"),
      msg("user", "Question"),
      msg("assistant", "Answer"),
      msg("tool", '{"result": 42}'),
    ]);
    expect(context).toContain("system: Be helpful");
    expect(context).toContain("user: Question");
    expect(context).toContain("assistant: Answer");
    expect(context).toContain('tool: {"result": 42}');
  });
});
