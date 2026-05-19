import { describe, it, expect } from "vitest";
import {
  ChannelNameSchema,
  BusPublishSchema,
  BusReadSchema,
  BusChannelsSchema,
  zodToJsonSchema,
} from "../../schemas/index.js";

describe("Message Bus schemas", () => {
  describe("ChannelNameSchema", () => {
    it("accepts valid channel names", () => {
      expect(ChannelNameSchema.safeParse("planning").success).toBe(true);
      expect(ChannelNameSchema.safeParse("agent-to-agent").success).toBe(true);
      expect(ChannelNameSchema.safeParse("results.final").success).toBe(true);
      expect(ChannelNameSchema.safeParse("step_3").success).toBe(true);
    });

    it("rejects invalid channel names", () => {
      expect(ChannelNameSchema.safeParse("").success).toBe(false);
      expect(ChannelNameSchema.safeParse("has spaces").success).toBe(false);
      expect(ChannelNameSchema.safeParse("has/slash").success).toBe(false);
      expect(ChannelNameSchema.safeParse("has:colon").success).toBe(false);
    });
  });

  describe("BusPublishSchema", () => {
    it("accepts valid publish input", () => {
      const result = BusPublishSchema.safeParse({
        channel: "planning",
        sender: "researcher",
        content: "I found three relevant papers.",
      });
      expect(result.success).toBe(true);
    });

    it("accepts object content", () => {
      const result = BusPublishSchema.safeParse({
        channel: "results",
        sender: "analyzer",
        content: { findings: ["a", "b"], score: 0.95 },
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional metadata", () => {
      const result = BusPublishSchema.safeParse({
        channel: "planning",
        sender: "agent",
        content: "hello",
        metadata: { priority: "high" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      expect(BusPublishSchema.safeParse({ channel: "x" }).success).toBe(false);
      expect(BusPublishSchema.safeParse({ sender: "x" }).success).toBe(false);
    });
  });

  describe("BusReadSchema", () => {
    it("defaults since_id to 0 and limit to 20", () => {
      const result = BusReadSchema.safeParse({ channel: "planning" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.since_id).toBe(0);
        expect(result.data.limit).toBe(20);
      }
    });

    it("accepts custom since_id and limit", () => {
      const result = BusReadSchema.safeParse({
        channel: "planning",
        since_id: 42,
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it("rejects limit out of range", () => {
      expect(BusReadSchema.safeParse({ channel: "x", limit: 0 }).success).toBe(false);
      expect(BusReadSchema.safeParse({ channel: "x", limit: 101 }).success).toBe(false);
    });

    it("rejects negative since_id", () => {
      expect(BusReadSchema.safeParse({ channel: "x", since_id: -1 }).success).toBe(false);
    });
  });

  describe("BusChannelsSchema", () => {
    it("accepts empty (list all)", () => {
      expect(BusChannelsSchema.safeParse({}).success).toBe(true);
    });

    it("accepts prefix filter", () => {
      const result = BusChannelsSchema.safeParse({ prefix: "agent-" });
      expect(result.success).toBe(true);
    });
  });

  describe("zodToJsonSchema for bus schemas", () => {
    it("converts BusPublishSchema with required fields", () => {
      const json = zodToJsonSchema(BusPublishSchema) as Record<string, unknown>;
      expect(json.required).toContain("channel");
      expect(json.required).toContain("sender");
    });

    it("converts BusReadSchema with defaults", () => {
      const json = zodToJsonSchema(BusReadSchema) as Record<string, Record<string, Record<string, unknown>>>;
      expect(json.properties.since_id.default).toBe(0);
      expect(json.properties.limit.default).toBe(20);
    });
  });
});
