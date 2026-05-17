/**
 * Scaffold routes — project setup and import.
 *
 * POST /scaffold          — scaffold a new project or import an existing one
 * POST /scaffold/append   — confirm appending workbench section to CLAUDE.md
 * GET  /scaffold/seed-docs/:type — list seed docs for a project type
 *
 * These are NOT project-scoped (they create the project).
 */
import { FastifyInstance } from "fastify";
import { CreateProjectSchema } from "../schemas/index.js";
import { scaffoldProject, appendToClaudeMd, listSeedDocs, ingestSeedDocs } from "../services/scaffold.js";
import { createProject, getProject } from "../services/projects.js";
import { checkAndRestore, backupProject } from "../services/lifecycle.js";

export async function registerScaffoldRoutes(
  app: FastifyInstance
): Promise<void> {

  /**
   * POST /scaffold
   * Scans the directory, determines mode (scaffold/import/reconnect),
   * creates .workbench/, registers the project, returns what was done.
   */
  app.post("/scaffold", async (request, reply) => {
    const parsed = CreateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    // Run the scaffold/import flow
    const scaffoldResult = await scaffoldProject({
      name: parsed.data.name,
      directory: parsed.data.directory,
      type: parsed.data.type,
      framework: parsed.data.framework,
    });

    // Register the project in the database (creates the DB + runs migrations)
    let project;
    const existing = await getProject(parsed.data.name);
    if (existing) {
      project = existing;
    } else {
      try {
        project = await createProject(parsed.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists")) {
          project = await getProject(parsed.data.name);
        } else {
          throw err;
        }
      }
    }

    // Reconnect mode: auto-restore from .workbench/backup.sql.gz if DB is empty
    let restoreResult: { action: string; reason?: string } = { action: "none" };
    if (scaffoldResult.mode === "reconnect" || existing) {
      restoreResult = await checkAndRestore(parsed.data.name, parsed.data.directory);
    }

    // Auto-ingest seed docs (only for new projects, not reconnects)
    let seedResult = { ingested: 0, errors: [] as string[] };
    if (scaffoldResult.seedDocsFound > 0 && project && scaffoldResult.mode !== "reconnect") {
      seedResult = await ingestSeedDocs(parsed.data.name, parsed.data.type);
    }

    return {
      project,
      scaffold: scaffoldResult,
      seed_docs: seedResult,
      restore: restoreResult,
      next_steps: buildNextSteps(scaffoldResult, seedResult),
    };
  });

  /**
   * POST /scaffold/append
   * Confirm appending the workbench section to an existing CLAUDE.md.
   * Only call this after the user has seen the append block and approved.
   */
  app.post("/scaffold/append", async (request, reply) => {
    const body = request.body as { directory: string; content: string } | null;
    if (!body?.directory || !body?.content) {
      return reply.status(400).send({
        error: "Required: directory (project path) and content (append block)",
      });
    }

    const appended = await appendToClaudeMd(body.directory, body.content);
    return {
      status: appended ? "appended" : "skipped",
      reason: appended ? "Workbench section added to CLAUDE.md" : "Section already exists or file not found",
    };
  });

  /**
   * GET /scaffold/seed-docs/:type
   * List available seed docs for a project type.
   */
  app.get("/scaffold/seed-docs/:type", async (request) => {
    const { type } = request.params as { type: string };
    const docs = await listSeedDocs(type);
    return {
      type,
      count: docs.length,
      files: docs.map((f) => f.split("/").pop()),
    };
  });

  /**
   * POST /projects/:name/backup
   * Backup a project's database to .workbench/backup.sql.gz.
   */
  app.post("/projects/:name/backup", async (request, reply) => {
    const { name } = request.params as { name: string };
    const project = await getProject(name);
    if (!project) {
      return reply.status(404).send({ error: `Project '${name}' not found` });
    }
    return backupProject(name, project.directory);
  });

  /**
   * POST /projects/:name/restore
   * Restore a project's database from .workbench/backup.sql.gz.
   */
  app.post("/projects/:name/restore", async (request, reply) => {
    const { name } = request.params as { name: string };
    const project = await getProject(name);
    if (!project) {
      return reply.status(404).send({ error: `Project '${name}' not found` });
    }
    return checkAndRestore(name, project.directory);
  });
}

function buildNextSteps(
  result: ReturnType<typeof scaffoldProject> extends Promise<infer T> ? T : never,
  seedResult?: { ingested: number; errors: string[] }
): string[] {
  const steps: string[] = [];

  if (result.mode === "scaffold") {
    steps.push("Project directory scaffolded with CLAUDE.md and documents/");
  } else if (result.mode === "import") {
    steps.push("Existing project detected — .workbench/ created, no files overwritten");
  } else {
    steps.push("Project reconnected — .workbench/project.json updated");
  }

  if (result.appendOffered) {
    steps.push(
      "CLAUDE.md exists but doesn't have the workbench section. " +
      "Call POST /scaffold/append to add it (after reviewing the content)."
    );
  }

  if (seedResult && seedResult.ingested > 0) {
    steps.push(
      `${seedResult.ingested} seed doc(s) auto-ingested into the knowledgebase. ` +
      "Try /query to search them."
    );
  }
  if (seedResult && seedResult.errors.length > 0) {
    steps.push(`${seedResult.errors.length} seed doc(s) failed to ingest: ${seedResult.errors.join(", ")}`);
  }

  steps.push("Set WORKBENCH_PROJECT=" + "your-project-name to start working");

  return steps;
}
