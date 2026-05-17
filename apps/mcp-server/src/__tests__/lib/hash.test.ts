import { describe, it, expect } from "vitest";
import { sha256 } from "../../lib/hash.js";

describe("sha256", () => {
  it("produces a 64-char hex string", () => {
    const hash = sha256("hello");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("differs for different inputs", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("accepts Buffer input", () => {
    const buf = Buffer.from("hello", "utf-8");
    const hash = sha256(buf);
    expect(hash).toBe(sha256("hello"));
  });

  it("produces known hash for empty string", () => {
    // SHA256 of empty string is a well-known constant
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
