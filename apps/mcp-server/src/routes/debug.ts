/**
 * Debug routes — step-through debugging for agents.
 *
 * POST /debug/mode         — enable/disable debug mode
 * GET  /debug/mode         — check if debug mode is on
 * GET  /debug/pending      — list actions awaiting approval
 * POST /debug/approve/:id  — approve a pending action
 * POST /debug/reject/:id   — reject a pending action
 * POST /debug/approve-all  — approve all pending actions
 * POST /debug/hold         — agent submits an action for approval (blocks until decided)
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import {
  setDebugMode,
  isDebugEnabled,
  debugListPending,
  debugApprove,
  debugReject,
  debugApproveAll,
  debugHold,
} from "../services/debug.js";

export async function registerDebugRoutes(app: FastifyInstance): Promise<void> {

  // ── Mode Control ───────────────────────────────────────

  app.post("/debug/mode", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const body = request.body as { enabled?: boolean } | null;
    const enabled = body?.enabled ?? true;
    await setDebugMode(project, enabled);
    return { debug_mode: enabled ? "enabled" : "disabled", project };
  });

  app.get("/debug/mode", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const enabled = await isDebugEnabled(project);
    return { debug_mode: enabled, project };
  });

  // ── Approver Endpoints ─────────────────────────────────

  app.get("/debug/pending", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const pending = await debugListPending(project);
    return { pending, count: pending.length };
  });

  app.post("/debug/approve/:id", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const { id } = request.params as { id: string };
    const approved = await debugApprove(project, id);
    if (!approved) {
      return reply.status(404).send({ error: `Action '${id}' not found or expired` });
    }
    return { status: "approved", action_id: id };
  });

  app.post("/debug/reject/:id", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string } | null;
    const rejected = await debugReject(project, id, body?.reason);
    if (!rejected) {
      return reply.status(404).send({ error: `Action '${id}' not found or expired` });
    }
    return { status: "rejected", action_id: id, reason: body?.reason };
  });

  app.post("/debug/approve-all", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const count = await debugApproveAll(project);
    return { status: "approved_all", count };
  });

  // ── Agent Endpoint (blocks until decided) ──────────────

  app.post("/debug/hold", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const body = request.body as {
      agent?: string;
      tool?: string;
      args?: Record<string, unknown>;
      context?: string;
      timeout?: number;
    } | null;

    if (!body?.agent || !body?.tool) {
      return reply.status(400).send({ error: "Required: agent, tool" });
    }

    const decision = await debugHold(
      project,
      body.agent,
      body.tool,
      body.args ?? {},
      body.context ?? "",
      body.timeout ?? 300
    );

    return decision;
  });
}
