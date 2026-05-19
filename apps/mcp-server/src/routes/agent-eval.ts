/**
 * Agent eval routes — behavioral testing for agents.
 *
 * POST /agent-eval     — run a behavioral eval suite
 * GET  /agent-eval     — list past agent eval runs
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import { RunAgentEvalSchema } from "../schemas/index.js";
import { runAgentEval, listAgentEvalRuns } from "../services/agent-eval.js";

export async function registerAgentEvalRoutes(
  app: FastifyInstance
): Promise<void> {

  app.post("/agent-eval", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const parsed = RunAgentEvalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const result = await runAgentEval(db, parsed.data);
    return result;
  });

  app.get("/agent-eval", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { limit } = request.query as { limit?: string };
    return listAgentEvalRuns(db, Number(limit) || 10);
  });
}
