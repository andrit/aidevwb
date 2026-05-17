/**
 * Project & Test Runner Schemas.
 */
import { z } from "zod";

// ── Project ───────────────────────────────────────────────
export const ProjectNameSchema = z
  .string()
  .min(1)
  .max(63) // Postgres DB name limit
  .regex(/^[a-z][a-z0-9_-]*$/, "Lowercase alphanumeric, hyphens, underscores. Must start with letter.")
  .describe("Project identifier (becomes the database name)");

export const CreateProjectSchema = z.object({
  name: ProjectNameSchema,
  directory: z.string().describe("Absolute path to the project directory on the host"),
  type: z
    .enum(["fullstack", "mobile", "pwa", "cli", "rag", "agent", "multi-agent", "data-pipeline", "api-integration", "custom"])
    .default("custom")
    .describe("Project type — determines scaffolding, preloaded context, and available tools"),
  framework: z.string().optional().describe("Agent framework (autogen, crewai, langgraph) — only for agent types"),
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
