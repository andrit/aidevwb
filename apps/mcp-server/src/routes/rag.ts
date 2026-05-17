/**
 * RAG routes — project-scoped operations.
 *
 * All routes require project context (via middleware).
 * The project's database connection is on request.projectDb.
 *
 * Two URL patterns supported (same handlers):
 *   /p/:project/ingest  — explicit project in URL
 *   /ingest             — project from X-Project header or env
 *
 * POST /ingest   — ingest a document
 * POST /query    — hybrid search + Claude answer
 * GET  /status   — knowledgebase statistics
 * POST /reindex  — re-embed all documents
 * POST /test     — run project test suite
 */
import { FastifyInstance } from "fastify";
import {
  IngestSchema,
  QuerySchema,
  ReindexSchema,
  TestRunSchema,
} from "../schemas/index.js";
import { ingestDocument } from "../services/ingest.js";
import { hybridSearch } from "../services/search.js";
import { getQueueStats, enqueueReindex } from "../services/queue.js";
import { runTests, detectTestCommand } from "../services/test-runner.js";
import { getProject } from "../services/projects.js";
import { config } from "../config.js";

export async function registerRagRoutes(app: FastifyInstance): Promise<void> {

  // ── Ingest ─────────────────────────────────────────────
  app.post("/ingest", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const parsed = IngestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    return ingestDocument(db, parsed.data.filepath);
  });

  // ── Query ──────────────────────────────────────────────
  app.post("/query", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const parsed = QuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    return hybridSearch(db, parsed.data.question, {
      topK: parsed.data.top_k,
    });
  });

  // ── Status ─────────────────────────────────────────────
  app.get("/status", async (request, reply) => {
    const db = request.projectDb;
    const projectName = request.projectName;
    if (!db || !projectName) {
      return reply.status(400).send({ error: "No project context" });
    }

    const [docsResult, chunksResult, queueStats] = await Promise.all([
      db`SELECT count(*)::int as count FROM documents`,
      db`SELECT count(*)::int as count FROM document_chunks`,
      getQueueStats(),
    ]);

    return {
      project: projectName,
      total_documents: docsResult[0].count,
      total_chunks: chunksResult[0].count,
      embedding_model: config.embeddingModel,
      embedding_dimensions: config.embeddingDimensions,
      queue_waiting: queueStats.waiting,
      queue_active: queueStats.active,
    };
  });

  // ── Reindex ────────────────────────────────────────────
  app.post("/reindex", async (request, reply) => {
    const parsed = ReindexSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    if (!parsed.data.confirm) {
      return reply.status(400).send({
        error: "Reindex requires confirm: true. This re-embeds every chunk.",
      });
    }

    const jobId = await enqueueReindex();
    return { status: "queued", job_id: jobId, message: "Reindex job enqueued" };
  });

  // ── Test Runner ────────────────────────────────────────
  app.post("/test", async (request, reply) => {
    const projectName = request.projectName;
    if (!projectName) {
      return reply.status(400).send({ error: "No project context" });
    }

    const parsed = TestRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    // Resolve project directory
    const project = await getProject(projectName);
    if (!project) {
      return reply.status(404).send({ error: `Project '${projectName}' not found` });
    }

    // Resolve test command: explicit > project config > auto-detect
    let command: string | undefined = parsed.data.command;
    if (!command) {
      const projectConfig = project.config as Record<string, unknown> | null;
      command = (projectConfig?.test_command as string) ?? undefined;
    }
    if (!command) {
      command = (await detectTestCommand(project.directory)) ?? undefined;
    }
    if (!command) {
      return reply.status(400).send({
        error: "No test command found. Pass command explicitly, set test_command in project config, or add a recognized test config file.",
      });
    }

    return runTests(project.directory, command, parsed.data.timeout);
  });
}
