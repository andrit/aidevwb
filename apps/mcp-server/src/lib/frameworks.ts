/**
 * Framework resolver — determines which framework templates to use.
 *
 * Maps framework names to template directories and validates availability.
 * Pure functions — no side effects, no filesystem access.
 */

export const SUPPORTED_FRAMEWORKS = ["autogen", "crewai", "langgraph", "custom"] as const;
export type FrameworkName = (typeof SUPPORTED_FRAMEWORKS)[number];

export function isValidFramework(name: string): name is FrameworkName {
  return (SUPPORTED_FRAMEWORKS as readonly string[]).includes(name);
}

/**
 * Resolve the framework to use for an agent project.
 * Returns "custom" if no framework specified or framework is unrecognized.
 */
export function resolveFramework(framework?: string): FrameworkName {
  if (!framework) return "custom";
  const normalized = framework.toLowerCase().trim();
  if (isValidFramework(normalized)) return normalized;
  return "custom";
}

/**
 * Get human-readable framework label for templates.
 */
export function frameworkLabel(framework: FrameworkName): string {
  const labels: Record<FrameworkName, string> = {
    autogen: "AutoGen (AG2)",
    crewai: "CrewAI",
    langgraph: "LangGraph",
    custom: "Custom (no framework)",
  };
  return labels[framework];
}
