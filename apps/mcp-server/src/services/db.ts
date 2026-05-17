/**
 * Database connection pool manager.
 *
 * Uses postgres.js for direct PostgreSQL connections.
 * Maintains one connection pool per project database.
 *
 * Registry DB ("workbench") stores the project list.
 * Each project gets its own database with RAG tables.
 *
 * Usage:
 *   const db = getProjectDb("nexus");
 *   const rows = await db`SELECT * FROM documents`;
 *
 *   const registry = getRegistryDb();
 *   const projects = await registry`SELECT * FROM projects`;
 */
import postgres, { type Sql } from "postgres";
import { config } from "../config.js";

export type Db = Sql;

const pools = new Map<string, Db>();

function createPool(database: string): Db {
  return postgres({
    host: config.pgHost,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database,
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}

/**
 * Get connection pool for the workbench registry database.
 * Contains the `projects` table. Shared across all projects.
 */
export function getRegistryDb(): Db {
  const key = config.pgRegistryDb;
  if (!pools.has(key)) {
    pools.set(key, createPool(key));
  }
  return pools.get(key)!;
}

/**
 * Get connection pool for a specific project database.
 * Contains that project's documents, chunks, embeddings.
 */
export function getProjectDb(projectName: string): Db {
  if (!projectName) throw new Error("Project name is required");
  const key = `project:${projectName}`;
  if (!pools.has(key)) {
    pools.set(key, createPool(projectName));
  }
  return pools.get(key)!;
}

/**
 * Close a specific project's connection pool.
 * Called when dropping a project or shutting down.
 */
export async function closeProjectDb(projectName: string): Promise<void> {
  const key = `project:${projectName}`;
  const pool = pools.get(key);
  if (pool) {
    await pool.end();
    pools.delete(key);
  }
}

/**
 * Close all connection pools. Called on graceful shutdown.
 */
export async function closeAllDbs(): Promise<void> {
  const closing = [...pools.values()].map((p) => p.end());
  await Promise.all(closing);
  pools.clear();
}

/**
 * Test a database connection by running a simple query.
 */
export async function testConnection(db: Db): Promise<boolean> {
  try {
    await db`SELECT 1 AS ok`;
    return true;
  } catch {
    return false;
  }
}
