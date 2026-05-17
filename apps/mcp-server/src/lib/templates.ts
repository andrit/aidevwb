/**
 * Template renderer — reads template files and substitutes {{VARIABLES}}.
 *
 * Pure functions for string interpolation.
 * Template variables use double-brace syntax: {{PROJECT_NAME}}, {{ROADMAP}}.
 */

export type TemplateVars = Record<string, string>;

/**
 * Replace all {{VARIABLE}} placeholders in a string.
 * Unknown variables are left as-is (not removed).
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return vars[key] ?? match;
  });
}

/**
 * Deep-merge two plain objects. Right side wins on conflict.
 * Used to merge base project.json with type-specific overrides.
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (result as Record<string, unknown>)[key] === "object" &&
      !Array.isArray((result as Record<string, unknown>)[key])
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (result as Record<string, unknown>)[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
