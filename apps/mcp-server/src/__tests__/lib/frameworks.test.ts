import { describe, it, expect } from "vitest";
import {
  resolveFramework,
  isValidFramework,
  frameworkLabel,
  typeUsesFramework,
  frameworkTemplateDir,
  SUPPORTED_FRAMEWORKS,
  AGENT_FRAMEWORKS,
  MICROSERVICES_FRAMEWORKS,
} from "../../lib/frameworks.js";

describe("resolveFramework", () => {
  describe("agent frameworks", () => {
    it("returns the framework if valid", () => {
      expect(resolveFramework("autogen", "agent")).toBe("autogen");
      expect(resolveFramework("crewai", "agent")).toBe("crewai");
      expect(resolveFramework("langgraph", "agent")).toBe("langgraph");
      expect(resolveFramework("custom", "agent")).toBe("custom");
    });

    it("normalizes case", () => {
      expect(resolveFramework("AutoGen", "agent")).toBe("autogen");
      expect(resolveFramework("CREWAI", "agent")).toBe("crewai");
    });

    it("defaults to custom for unknown agent framework", () => {
      expect(resolveFramework("unknown", "agent")).toBe("custom");
    });

    it("defaults to custom when no framework specified for agent", () => {
      expect(resolveFramework(undefined, "agent")).toBe("custom");
      expect(resolveFramework("", "agent")).toBe("custom");
    });
  });

  describe("microservices frameworks", () => {
    it("returns the framework if valid", () => {
      expect(resolveFramework("swarm", "microservices")).toBe("swarm");
      expect(resolveFramework("k8s", "microservices")).toBe("k8s");
      expect(resolveFramework("k8s-eks", "microservices")).toBe("k8s-eks");
      expect(resolveFramework("k8s-gke", "microservices")).toBe("k8s-gke");
      expect(resolveFramework("k8s-aks", "microservices")).toBe("k8s-aks");
    });

    it("defaults to k8s for unknown microservices framework", () => {
      expect(resolveFramework("docker", "microservices")).toBe("k8s");
    });

    it("defaults to k8s when no framework specified for microservices", () => {
      expect(resolveFramework(undefined, "microservices")).toBe("k8s");
    });
  });

  describe("backward compatibility", () => {
    it("works without projectType (defaults to custom)", () => {
      expect(resolveFramework("autogen")).toBe("autogen");
      expect(resolveFramework()).toBe("custom");
    });
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

  it("includes both agent and microservices frameworks", () => {
    expect(isValidFramework("autogen")).toBe(true);
    expect(isValidFramework("k8s-eks")).toBe(true);
    expect(isValidFramework("swarm")).toBe(true);
  });
});

describe("frameworkLabel", () => {
  it("returns agent framework labels", () => {
    expect(frameworkLabel("autogen")).toBe("AutoGen (AG2)");
    expect(frameworkLabel("custom")).toBe("Custom (no framework)");
  });

  it("returns microservices framework labels", () => {
    expect(frameworkLabel("swarm")).toBe("Docker Swarm");
    expect(frameworkLabel("k8s")).toBe("Kubernetes");
    expect(frameworkLabel("k8s-eks")).toBe("AWS EKS (Kubernetes)");
    expect(frameworkLabel("k8s-gke")).toBe("Google GKE (Kubernetes)");
    expect(frameworkLabel("k8s-aks")).toBe("Azure AKS (Kubernetes)");
  });
});

describe("typeUsesFramework", () => {
  it("returns true for types with framework choices", () => {
    expect(typeUsesFramework("agent")).toBe(true);
    expect(typeUsesFramework("multi-agent")).toBe(true);
    expect(typeUsesFramework("microservices")).toBe(true);
  });

  it("returns false for types without framework choices", () => {
    expect(typeUsesFramework("fullstack")).toBe(false);
    expect(typeUsesFramework("cli")).toBe(false);
    expect(typeUsesFramework("custom")).toBe(false);
  });
});

describe("frameworkTemplateDir", () => {
  it("builds correct path for agent", () => {
    expect(frameworkTemplateDir("agent", "autogen")).toBe("agent/frameworks/autogen");
  });

  it("builds correct path for microservices", () => {
    expect(frameworkTemplateDir("microservices", "k8s-eks")).toBe("microservices/frameworks/k8s-eks");
  });
});

describe("framework constants", () => {
  it("agent frameworks are a subset of supported", () => {
    for (const fw of AGENT_FRAMEWORKS) {
      expect(SUPPORTED_FRAMEWORKS).toContain(fw);
    }
  });

  it("microservices frameworks are a subset of supported", () => {
    for (const fw of MICROSERVICES_FRAMEWORKS) {
      expect(SUPPORTED_FRAMEWORKS).toContain(fw);
    }
  });
});
