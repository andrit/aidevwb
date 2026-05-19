/**
 * Message Bus routes — inter-agent communication.
 *
 * Three access patterns:
 *   1. MCP tools (polling):  bus_read(since_id) via POST /bus/read
 *   2. HTTP SSE (streaming): GET /bus/:channel/stream — for standalone agents
 *   3. Redis pub/sub:        direct subscription (see services/bus.ts)
 *
 * Polling for Claude Code (turn-based). SSE for standalone agents
 * that can hold an open connection. Redis pub/sub for agents with
 * direct Redis access.
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import {
  BusPublishSchema,
  BusReadSchema,
  BusChannelsSchema,
} from "../schemas/index.js";
import {
  busPublish,
  busRead,
  busListChannels,
  busClearChannel,
  busSubscribe,
} from "../services/bus.js";

export async function registerBusRoutes(app: FastifyInstance): Promise<void> {

  // ── Publish ────────────────────────────────────────────
  app.post("/bus/publish", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const parsed = BusPublishSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const message = await busPublish(
      project,
      parsed.data.channel,
      parsed.data.sender,
      parsed.data.content,
      parsed.data.metadata
    );
    return reply.status(201).send(message);
  });

  // ── Read (polling) ─────────────────────────────────────
  app.post("/bus/read", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const parsed = BusReadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const messages = await busRead(
      project,
      parsed.data.channel,
      parsed.data.since_id,
      parsed.data.limit
    );
    return { channel: parsed.data.channel, messages, count: messages.length };
  });

  // ── List channels ──────────────────────────────────────
  app.get("/bus/channels", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const { prefix } = request.query as { prefix?: string };
    const channels = await busListChannels(project, prefix);
    return { channels };
  });

  // ── Clear channel ──────────────────────────────────────
  app.delete("/bus/:channel", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const { channel } = request.params as { channel: string };
    const cleared = await busClearChannel(project, channel);
    return { status: cleared ? "cleared" : "not_found", channel };
  });

  // ── SSE Stream (for standalone agents) ─────────────────
  //
  // Standalone agents (AutoGen, CrewAI, etc.) can hold an open
  // HTTP connection and receive messages in real-time via SSE.
  //
  // Usage from Python:
  //   import httpx
  //   with httpx.stream("GET", "http://mcp-server:3100/bus/planning/stream",
  //                      headers={"X-Project": "nexus"}) as r:
  //       for line in r.iter_lines():
  //           if line.startswith("data: "):
  //               msg = json.loads(line[6:])
  //
  app.get("/bus/:channel/stream", async (request, reply) => {
    const project = request.projectName;
    if (!project) return reply.status(400).send({ error: "No project context" });

    const { channel } = request.params as { channel: string };

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial keepalive
    reply.raw.write(": connected\n\n");

    // Subscribe via Redis pub/sub
    const unsubscribe = await busSubscribe(project, channel, (message) => {
      reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
    });

    // Clean up on disconnect
    request.raw.on("close", async () => {
      await unsubscribe();
    });

    // Keep the connection open (don't return — Fastify will end the response)
    await new Promise(() => {});
  });
}
