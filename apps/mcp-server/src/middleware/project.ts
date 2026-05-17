/**
 * Project resolution middleware.
 *
 * Resolves the current project from the request and attaches
 * the project's database connection to the Fastify request object.
 *
 * Resolution order:
 *   1. URL parameter :project (for /p/:project/... routes)
 *   2. X-Project header (for MCP bridge)
 *   3. WORKBENCH_PROJECT env var (for single-project mode)
 *
 * If no project can be resolved, returns 400.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getProjectDb, type Db } from "../services/db.js";
import { getProject } from "../services/projects.js";

// Extend Fastify request type to include project context
declare module "fastify" {
  interface FastifyRequest {
    projectName?: string;
    projectDb?: Db;
  }
}

export function resolveProject(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
): void {
  const name =
    (request.params as Record<string, string>)?.project ??
    (request.headers["x-project"] as string) ??
    process.env.WORKBENCH_PROJECT;

  if (!name) {
    reply.status(400).send({
      error: "No project specified. Use X-Project header, :project URL param, or WORKBENCH_PROJECT env var.",
    });
    return done();
  }

  // Validate project exists in registry (async in preHandler)
  request.projectName = name;
  request.projectDb = getProjectDb(name);
  done();
}

/**
 * Register the project middleware as a Fastify preHandler
 * on a scoped set of routes (the /p/:project prefix).
 */
export function registerProjectMiddleware(app: FastifyInstance): void {
  // Scoped routes under /p/:project get automatic project resolution
  app.addHook("preHandler", async (request, reply) => {
    // Only apply to routes that have :project param or need project context
    const url = request.url;
    if (
      url.startsWith("/p/") ||
      request.headers["x-project"] ||
      process.env.WORKBENCH_PROJECT
    ) {
      return new Promise<void>((resolve) => {
        resolveProject(request, reply, (err) => {
          if (err) reply.status(500).send({ error: err.message });
          resolve();
        });
      });
    }
  });
}
