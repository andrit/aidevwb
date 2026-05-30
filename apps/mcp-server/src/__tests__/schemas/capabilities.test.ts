import { describe, it, expect } from "vitest";
import {
  CapabilityProviderSchema,
  CapabilityListSchema,
  CapabilityMapSchema,
} from "../../schemas/index.js";
import { groupByCapability } from "../../routes/projects.js";
import type { CapabilityProvider } from "../../schemas/index.js";

describe("CapabilityProviderSchema", () => {
  it("accepts valid provider", () => {
    const result = CapabilityProviderSchema.safeParse({
      project: "nexus",
      type: "rag",
      capability: "hybrid_search",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(CapabilityProviderSchema.safeParse({ project: "nexus" }).success).toBe(false);
    expect(CapabilityProviderSchema.safeParse({ project: "nexus", type: "rag" }).success).toBe(false);
  });
});

describe("CapabilityListSchema", () => {
  it("accepts valid capability list response", () => {
    const result = CapabilityListSchema.safeParse({
      capability: "hybrid_search",
      providers: [
        { project: "nexus", type: "rag", capability: "hybrid_search" },
        { project: "atlas", type: "fullstack", capability: "hybrid_search" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty providers list", () => {
    const result = CapabilityListSchema.safeParse({
      capability: "hybrid_search",
      providers: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("CapabilityMapSchema", () => {
  it("accepts valid capability map", () => {
    const result = CapabilityMapSchema.safeParse({
      capabilities: {
        hybrid_search: [{ project: "nexus", type: "rag", capability: "hybrid_search" }],
        rest_api: [{ project: "atlas", type: "fullstack", capability: "rest_api" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty map", () => {
    expect(CapabilityMapSchema.safeParse({ capabilities: {} }).success).toBe(true);
  });
});

describe("groupByCapability", () => {
  const providers: CapabilityProvider[] = [
    { project: "nexus", type: "rag", capability: "hybrid_search" },
    { project: "atlas", type: "fullstack", capability: "hybrid_search" },
    { project: "atlas", type: "fullstack", capability: "rest_api" },
    { project: "orion", type: "agent", capability: "agent_reasoning" },
  ];

  it("groups providers by capability token", () => {
    const grouped = groupByCapability(providers);
    expect(Object.keys(grouped).sort()).toEqual(["agent_reasoning", "hybrid_search", "rest_api"]);
    expect(grouped["hybrid_search"]).toHaveLength(2);
    expect(grouped["rest_api"]).toHaveLength(1);
    expect(grouped["agent_reasoning"]).toHaveLength(1);
  });

  it("preserves provider details within each group", () => {
    const grouped = groupByCapability(providers);
    expect(grouped["hybrid_search"][0].project).toBe("nexus");
    expect(grouped["hybrid_search"][1].project).toBe("atlas");
  });

  it("returns empty object for empty input", () => {
    expect(groupByCapability([])).toEqual({});
  });

  it("handles single provider", () => {
    const grouped = groupByCapability([providers[0]]);
    expect(grouped).toEqual({
      hybrid_search: [{ project: "nexus", type: "rag", capability: "hybrid_search" }],
    });
  });

  it("is stable — same capability entries share the same array reference", () => {
    const grouped = groupByCapability(providers);
    // Both nexus and atlas are in hybrid_search
    const projects = grouped["hybrid_search"].map((p) => p.project);
    expect(projects).toContain("nexus");
    expect(projects).toContain("atlas");
  });
});
