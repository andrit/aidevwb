/**
 * Eval routes — search quality measurement.
 *
 * POST /eval     — run an eval query set and score results
 * GET  /eval     — list historical eval runs
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import { RunEvalSchema } from "../schemas/index.js";
import { runEval, listEvalRuns } from "../services/eval.js";

export async function registerEvalRoutes(
  app: FastifyInstance
): Promise<void> {

  app.post("/eval", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const parsed = RunEvalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const result = await runEval(db, parsed.data.name, parsed.data.queries, parsed.data.top_k);
    return result;
  });

  app.get("/eval", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { limit } = request.query as { limit?: string };
    return listEvalRuns(db, Number(limit) || 10);
  });
}
