import { describe, it, expect } from "vitest";
import { chunkText } from "../../lib/chunker.js";

describe("chunkText", () => {
  it("splits text into chunks of the given size", () => {
    const text = "a".repeat(1000);
    const chunks = chunkText(text, { size: 500, overlap: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[1]).toHaveLength(500);
  });

  it("applies overlap between chunks", () => {
    const text = "a".repeat(1000);
    const chunks = chunkText(text, { size: 500, overlap: 50 });
    // 1000 / (500 - 50) = 2.22 → 3 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("returns single chunk for short text", () => {
    const chunks = chunkText("hello world", { size: 500, overlap: 50 });
    expect(chunks).toEqual(["hello world"]);
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("", { size: 500, overlap: 50 })).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(chunkText("   ", { size: 500, overlap: 50 })).toEqual([]);
  });

  it("trims whitespace from chunks", () => {
    const text = "hello   " + " ".repeat(500) + "world";
    const chunks = chunkText(text, { size: 10, overlap: 0 });
    // All chunks should be trimmed
    chunks.forEach((c) => expect(c).toBe(c.trim()));
  });

  it("uses default options when none provided", () => {
    const text = "a".repeat(600);
    const chunks = chunkText(text);
    // Default: size=500, overlap=50 → ~2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("throws on invalid size", () => {
    expect(() => chunkText("hello", { size: 0, overlap: 0 })).toThrow("positive");
    expect(() => chunkText("hello", { size: -1, overlap: 0 })).toThrow("positive");
  });

  it("throws on negative overlap", () => {
    expect(() => chunkText("hello", { size: 10, overlap: -1 })).toThrow("non-negative");
  });

  it("throws when overlap >= size", () => {
    expect(() => chunkText("hello", { size: 10, overlap: 10 })).toThrow("less than");
    expect(() => chunkText("hello", { size: 10, overlap: 15 })).toThrow("less than");
  });

  it("preserves content — concatenated chunks cover the full text", () => {
    const text = "The quick brown fox jumps over the lazy dog and other animals in the park";
    const chunks = chunkText(text, { size: 20, overlap: 5 });
    // Every character in the original should appear in at least one chunk
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char.trim() === "") continue;
      const found = chunks.some((c) => c.includes(char));
      expect(found).toBe(true);
    }
  });
});
