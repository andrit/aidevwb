import { describe, it, expect } from "vitest";
import {
  resolveFramework,
  isValidFramework,
  frameworkLabel,
  SUPPORTED_FRAMEWORKS,
} from "../../lib/frameworks.js";

describe("resolveFramework", () => {
  it("returns the framework if valid", () => {
    expect(resolveFramework("autogen")).toBe("autogen");
    expect(resolveFramework("crewai")).toBe("crewai");
    expect(resolveFramework("langgraph")).toBe("langgraph");
    expect(resolveFramework("custom")).toBe("custom");
  });

  it("normalizes case", () => {
    expect(resolveFramework("AutoGen")).toBe("autogen");
    expect(resolveFramework("CrewAI")).toBe("crewai");
    expect(resolveFramework("LANGGRAPH")).toBe("langgraph");
  });

  it("returns custom for unrecognized frameworks", () => {
    expect(resolveFramework("unknown")).toBe("custom");
    expect(resolveFramework("pytorch")).toBe("custom");
  });

  it("returns custom when no framework specified", () => {
    expect(resolveFramework()).toBe("custom");
    expect(resolveFramework(undefined)).toBe("custom");
    expect(resolveFramework("")).toBe("custom");
  });
});

describe("isValidFramework", () => {
  it("returns true for all supported frameworks", () => {
    for (const fw of SUPPORTED_FRAMEWORKS) {
      expect(isValidFramework(fw)).toBe(true);
    }
  });

  it("returns false for invalid names", () => {
    expect(isValidFramework("invalid")).toBe(false);
    expect(isValidFramework("")).toBe(false);
  });
});

describe("frameworkLabel", () => {
  it("returns human-readable labels", () => {
    expect(frameworkLabel("autogen")).toBe("AutoGen (AG2)");
    expect(frameworkLabel("crewai")).toBe("CrewAI");
    expect(frameworkLabel("langgraph")).toBe("LangGraph");
    expect(frameworkLabel("custom")).toBe("Custom (no framework)");
  });
});
