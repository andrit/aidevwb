import { describe, it, expect } from "vitest";
import { renderTemplate, deepMerge } from "../../lib/templates.js";
import { determineMode, type ScanResult } from "../../lib/scanner.js";

describe("renderTemplate", () => {
  it("replaces known variables", () => {
    expect(renderTemplate("Hello {{NAME}}", { NAME: "World" })).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = renderTemplate("{{A}} and {{B}}", { A: "X", B: "Y" });
    expect(result).toBe("X and Y");
  });

  it("leaves unknown variables as-is", () => {
    expect(renderTemplate("Hello {{UNKNOWN}}", {})).toBe("Hello {{UNKNOWN}}");
  });

  it("handles empty template", () => {
    expect(renderTemplate("", { NAME: "test" })).toBe("");
  });

  it("handles template with no variables", () => {
    expect(renderTemplate("plain text", { NAME: "test" })).toBe("plain text");
  });

  it("replaces same variable multiple times", () => {
    expect(renderTemplate("{{X}} and {{X}}", { X: "A" })).toBe("A and A");
  });
});

describe("deepMerge", () => {
  it("merges flat objects", () => {
    expect(deepMerge({ a: 1, b: 0 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("override wins on conflict", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("deep merges nested objects", () => {
    const base = { config: { a: 1, b: 2 } } as Record<string, unknown>;
    const override = { config: { b: 3, c: 4 } } as Record<string, unknown>;
    expect(deepMerge(base, override)).toEqual({ config: { a: 1, b: 3, c: 4 } });
  });

  it("arrays are replaced not merged", () => {
    expect(deepMerge({ items: [1, 2] }, { items: [3] })).toEqual({ items: [3] });
  });

  it("handles empty override", () => {
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
  });
});

describe("determineMode", () => {
  const base: ScanResult = {
    exists: true,
    hasProject: false,
    hasWorkbench: false,
    hasClaudeMd: false,
    conflicts: [],
    indicators: [],
  };

  it("returns scaffold for empty directory", () => {
    expect(determineMode(base)).toBe("scaffold");
  });

  it("returns import for directory with existing project files", () => {
    expect(determineMode({ ...base, hasProject: true, indicators: ["package.json"] })).toBe("import");
  });

  it("returns reconnect if .workbench already exists", () => {
    expect(determineMode({ ...base, hasWorkbench: true, hasProject: true })).toBe("reconnect");
  });

  it("reconnect takes priority over import", () => {
    expect(
      determineMode({ ...base, hasWorkbench: true, hasProject: true, hasClaudeMd: true })
    ).toBe("reconnect");
  });
});
