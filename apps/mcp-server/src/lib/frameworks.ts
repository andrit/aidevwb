/**
 * Framework resolver — determines which framework templates to use.
 *
 * Handles two project types with framework choices:
 *   agent:         autogen, crewai, langgraph, custom
 *   microservices: swarm, k8s, k8s-eks, k8s-gke, k8s-aks
 *
 * Pure functions — no side effects, no filesystem access.
 */

// ── Agent Frameworks ─────────────────────────────────────

export const AGENT_FRAMEWORKS = ["autogen", "crewai", "langgraph", "custom"] as const;
export type AgentFramework = (typeof AGENT_FRAMEWORKS)[number];

// ── Microservices Orchestrators ──────────────────────────

export const MICROSERVICES_FRAMEWORKS = ["swarm", "k8s", "k8s-eks", "k8s-gke", "k8s-aks"] as const;
export type MicroservicesFramework = (typeof MICROSERVICES_FRAMEWORKS)[number];

// ── Combined ─────────────────────────────────────────────

export const SUPPORTED_FRAMEWORKS = [...AGENT_FRAMEWORKS, ...MICROSERVICES_FRAMEWORKS] as const;
export type FrameworkName = AgentFramework | MicroservicesFramework;

const DEFAULTS: Record<string, string> = {
  agent: "custom",
  "multi-agent": "custom",
  microservices: "k8s",
};

export function isValidFramework(name: string): name is FrameworkName {
  return (SUPPORTED_FRAMEWORKS as readonly string[]).includes(name);
}

/**
 * Resolve the framework for a project type.
 * Returns the default for that type if unspecified or unrecognized.
 */
export function resolveFramework(framework?: string, projectType?: string): FrameworkName {
  if (!framework) {
    const def = DEFAULTS[projectType ?? ""] ?? "custom";
    return def as FrameworkName;
  }
  const normalized = framework.toLowerCase().trim();
  if (isValidFramework(normalized)) return normalized;
  const def = DEFAULTS[projectType ?? ""] ?? "custom";
  return def as FrameworkName;
}

/**
 * Get human-readable framework label for templates.
 */
export function frameworkLabel(framework: FrameworkName): string {
  const labels: Record<string, string> = {
    autogen: "AutoGen (AG2)",
    crewai: "CrewAI",
    langgraph: "LangGraph",
    custom: "Custom (no framework)",
    swarm: "Docker Swarm",
    k8s: "Kubernetes",
    "k8s-eks": "AWS EKS (Kubernetes)",
    "k8s-gke": "Google GKE (Kubernetes)",
    "k8s-aks": "Azure AKS (Kubernetes)",
  };
  return labels[framework] ?? framework;
}

/**
 * Get the template subdirectory for a framework within a project type.
 * Agent frameworks:       templates/agent/frameworks/<framework>/
 * Microservices frameworks: templates/microservices/frameworks/<framework>/
 */
export function frameworkTemplateDir(projectType: string, framework: FrameworkName): string {
  return `${projectType}/frameworks/${framework}`;
}

/**
 * Check if a project type uses the framework parameter.
 */
export function typeUsesFramework(projectType: string): boolean {
  return ["agent", "multi-agent", "microservices"].includes(projectType);
}
