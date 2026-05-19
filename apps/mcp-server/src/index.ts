/**
 * AI Dev Workbench — MCP Server Entry Point
 *
 * Fastify HTTP server with multi-project support.
 * On startup: ensures the workbench registry database exists.
 */
import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { ensureRegistry } from "./services/projects.js";
import { closeAllDbs } from "./services/db.js";
import { closeAllRedis } from "./services/redis.js";
import { backupAllProjects } from "./services/lifecycle.js";
import { initTracing } from "./lib/tracing.js";
import { registerTracingHooks } from "./middleware/tracing.js";

// Initialize tracing before anything else
initTracing();

const app = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  },
});

// Graceful shutdown — auto-backup all projects before closing
const shutdown = async () => {
  app.log.info("Shutting down — backing up projects...");
  try {
    const results = await backupAllProjects();
    for (const r of results) {
      app.log.info(`  ${r.name}: ${r.status}`);
    }
  } catch (err) {
    app.log.warn("Auto-backup failed (non-fatal): " + (err instanceof Error ? err.message : String(err)));
  }
  await closeAllDbs();
  await closeAllRedis();
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start
try {
  // Ensure workbench registry database + projects table
  await ensureRegistry();
  app.log.info("Workbench registry initialized");

  // Register tracing hooks (must be before routes)
  registerTracingHooks(app);

  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║  AI Dev Workbench — MCP Server v2.0              ║
  ║  REST API:  http://0.0.0.0:${config.port}               ║
  ║  Model:     ${config.embeddingModel.padEnd(33)}║
  ║  Multi-project: enabled                          ║
  ╚══════════════════════════════════════════════════╝
  `);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
