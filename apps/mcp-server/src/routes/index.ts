/**
 * Route index — registers all route modules.
 *
 * Structure:
 *   /health                       — always available, no project context
 *   /projects/*                   — project management (CRUD)
 *   /ingest, /query, /status, ... — project-scoped ops (from header/env)
 *   /conversations/*              — conversation history (project-scoped)
 *   /memory/*                     — agent memory (project-scoped)
 *   /eval                         — search quality eval (project-scoped)
 *   /p/:project/*                 — all above with explicit project in URL
 */
import { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.js";
import { registerProjectRoutes } from "./projects.js";
import { registerScaffoldRoutes } from "./scaffold.js";
import { registerExportRoutes } from "./export.js";
import { registerRagRoutes } from "./rag.js";
import { registerConversationRoutes } from "./conversations.js";
import { registerMemoryRoutes } from "./memory.js";
import { registerEvalRoutes } from "./eval.js";
import { registerBusRoutes } from "./bus.js";
import { registerDebugRoutes } from "./debug.js";
import { registerAgentEvalRoutes } from "./agent-eval.js";
import { registerProjectMiddleware } from "../middleware/project.js";

/**
 * Register all project-scoped routes on a Fastify instance.
 * Called twice: once at root level, once under /p/:project prefix.
 */
async function registerProjectScopedRoutes(app: FastifyInstance): Promise<void> {
  await registerRagRoutes(app);
  await registerConversationRoutes(app);
  await registerMemoryRoutes(app);
  await registerEvalRoutes(app);
  await registerBusRoutes(app);
  await registerDebugRoutes(app);
  await registerAgentEvalRoutes(app);
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Health check — no middleware, always available
  await registerHealthRoutes(app);

  // Project management — no project middleware (operates on registry)
  await registerProjectRoutes(app);

  // Scaffold/import — no project middleware (creates the project)
  await registerScaffoldRoutes(app);

  // Export — no project middleware (operates on named project)
  await registerExportRoutes(app);

  // Project resolution middleware — applies to all below
  registerProjectMiddleware(app);

  // Project-scoped routes at root level (project from header/env)
  await registerProjectScopedRoutes(app);

  // Same routes with explicit project in URL
  app.register(
    async (scoped) => {
      await registerProjectScopedRoutes(scoped);
    },
    { prefix: "/p/:project" }
  );
}
