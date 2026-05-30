/**
 * Project & Test Runner Schemas.
 */
import { z } from "zod";

// ── Project ───────────────────────────────────────────────
const RESERVED_DB_NAMES = ["workbench", "postgres", "template0", "template1"] as const;

export const ProjectNameSchema = z
  .string()
  .min(1)
  .max(63) // Postgres DB name limit
  .regex(/^[a-z][a-z0-9_-]*$/, "Lowercase alphanumeric, hyphens, underscores. Must start with letter.")
  .refine(
    (name) => !RESERVED_DB_NAMES.includes(name as (typeof RESERVED_DB_NAMES)[number]),
    { message: `Reserved database name — choose a different project name (reserved: ${RESERVED_DB_NAMES.join(", ")})` }
  )
  .describe("Project identifier (becomes the database name)");

export const CreateProjectSchema = z.object({
  name: ProjectNameSchema,
  directory: z.string().describe("Absolute path to the project directory on the host"),
  type: z
    .enum(["fullstack", "mobile", "pwa", "cli", "rag", "agent", "multi-agent", "data-pipeline", "api-integration", "microservices", "custom"])
    .default("custom")
    .describe("Project type — determines scaffolding, preloaded context, and available tools"),
  framework: z.string().optional().describe("Framework or orchestrator. Agent types: autogen, crewai, langgraph. Microservices: swarm, k8s, k8s-eks, k8s-gke, k8s-aks."),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const ProjectSchema = z.object({
  name: z.string(),
  directory: z.string(),
  type: z.string(),
  framework: z.string().nullable(),
  config: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

// ── Capability Registry ───────────────────────────────────

export const CapabilityProviderSchema = z.object({
  project: z.string(),
  type: z.string(),
  capability: z.string(),
});
export type CapabilityProvider = z.infer<typeof CapabilityProviderSchema>;

export const CapabilityListSchema = z.object({
  capability: z.string(),
  providers: z.array(CapabilityProviderSchema),
});

export const CapabilityMapSchema = z.object({
  capabilities: z.record(z.array(CapabilityProviderSchema)),
});

// ── Test Runner ───────────────────────────────────────────
export const TestRunSchema = z.object({
  command: z
    .string()
    .optional()
    .describe("Test command to run. Defaults to project config or auto-detected (npm test, pytest, etc.)"),
  timeout: z
    .number()
    .min(1)
    .max(600)
    .default(120)
    .describe("Timeout in seconds"),
});
export type TestRunInput = z.infer<typeof TestRunSchema>;

export const TestResultSchema = z.object({
  status: z.enum(["passed", "failed", "error", "timeout"]),
  command: z.string(),
  exit_code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
});
export type TestResult = z.infer<typeof TestResultSchema>;
