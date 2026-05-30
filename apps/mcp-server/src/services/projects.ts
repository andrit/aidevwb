/**
 * Project management service.
 *
 * Manages the project registry (workbench database) and
 * per-project database lifecycle (create, drop, migrate).
 *
 * Each project gets its own PostgreSQL database with the
 * full RAG schema (documents, chunks, hybrid_search).
 */
import { readFile } from "fs/promises";
import { join } from "path";
import postgres from "postgres";
import { config } from "../config.js";
import { getRegistryDb, getProjectDb, closeProjectDb, type Db } from "./db.js";
import type { CreateProjectInput, Project, CapabilityProvider } from "../schemas/index.js";

const MIGRATION_DIR = "/app/migrations";
const MIGRATION_FILES = [
  "001_extensions.sql",
  "002_documents.sql",
  "003_chunks.sql",
  "004_hybrid_search.sql",
  "005_conversations.sql",
  "006_memory_eval.sql",
];

// ── Registry CRUD ────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const db = getRegistryDb();
  const rows = await db`
    SELECT name, directory, type, framework, config,
           created_at::text, updated_at::text
    FROM projects ORDER BY created_at DESC
  `;
  return rows as unknown as Project[];
}

export async function getProject(name: string): Promise<Project | null> {
  const db = getRegistryDb();
  const rows = await db`
    SELECT name, directory, type, framework, config,
           created_at::text, updated_at::text
    FROM projects WHERE name = ${name}
  `;
  return rows.length > 0 ? (rows[0] as unknown as Project) : null;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const db = getRegistryDb();

  // Check for existing
  const existing = await getProject(input.name);
  if (existing) {
    throw new Error(`Project '${input.name}' already exists`);
  }

  // Create the project database
  await createProjectDatabase(input.name);

  // Register in the workbench registry
  const rows = await db`
    INSERT INTO projects (name, directory, type, framework)
    VALUES (${input.name}, ${input.directory}, ${input.type}, ${input.framework ?? null})
    RETURNING name, directory, type, framework, config,
              created_at::text, updated_at::text
  `;

  return rows[0] as unknown as Project;
}

export async function deleteProject(name: string): Promise<void> {
  const db = getRegistryDb();

  // Close connection pool first
  await closeProjectDb(name);

  // Drop the project database
  await dropProjectDatabase(name);

  // Remove from registry
  await db`DELETE FROM projects WHERE name = ${name}`;
}

export async function updateProjectConfig(
  name: string,
  config: Record<string, unknown>
): Promise<Project> {
  const db = getRegistryDb();
  const rows = await db`
    UPDATE projects
    SET config = ${JSON.stringify(config)}::jsonb, updated_at = now()
    WHERE name = ${name}
    RETURNING name, directory, type, framework, config,
              created_at::text, updated_at::text
  `;
  if (rows.length === 0) throw new Error(`Project '${name}' not found`);
  return rows[0] as unknown as Project;
}

export async function listCapabilities(capability?: string): Promise<CapabilityProvider[]> {
  const db = getRegistryDb();
  // provides[] is a plain string-token array: ["hybrid_search", "document_ingestion", ...]
  // elem #>> '{}' extracts the unquoted string value from a jsonb text element
  const rows = capability
    ? await db`
        SELECT
          p.name        AS project,
          p.type,
          elem #>> '{}' AS capability
        FROM projects p,
          jsonb_array_elements(COALESCE(p.config->'provides', '[]'::jsonb)) elem
        WHERE elem #>> '{}' = ${capability}
        ORDER BY p.name
      `
    : await db`
        SELECT
          p.name        AS project,
          p.type,
          elem #>> '{}' AS capability
        FROM projects p,
          jsonb_array_elements(COALESCE(p.config->'provides', '[]'::jsonb)) elem
        WHERE jsonb_array_length(COALESCE(p.config->'provides', '[]'::jsonb)) > 0
        ORDER BY elem #>> '{}', p.name
      `;
  return rows as unknown as CapabilityProvider[];
}

// ── Database Lifecycle ───────────────────────────────────

async function createProjectDatabase(name: string): Promise<void> {
  const db = getRegistryDb();

  // CREATE DATABASE can't run inside a transaction
  // postgres.js wraps in transactions by default, so use unsafe
  await db.unsafe(`CREATE DATABASE "${name}"`);

  // Run migrations on the new database
  const projectDb = getProjectDb(name);
  await runMigrations(projectDb);
}

async function dropProjectDatabase(name: string): Promise<void> {
  const db = getRegistryDb();

  // Terminate active connections to the project database
  await db`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${name} AND pid <> pg_backend_pid()
  `;

  await db.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
}

export async function runMigrations(db: Db): Promise<string[]> {
  const applied: string[] = [];
  for (const file of MIGRATION_FILES) {
    try {
      const sql = await readFile(join(MIGRATION_DIR, file), "utf-8");
      await db.unsafe(sql);
      applied.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignore "already exists" errors (idempotent migrations)
      if (!msg.includes("already exists")) {
        throw new Error(`Migration ${file} failed: ${msg}`);
      }
      applied.push(`${file} (already applied)`);
    }
  }
  return applied;
}

/**
 * Ensure the workbench registry database and schema exist.
 * Called once on server startup.
 */
export async function ensureRegistry(): Promise<void> {
  // First, try connecting to the registry database.
  // If it doesn't exist, create it from the default 'postgres' database.
  try {
    const db = getRegistryDb();
    await db`SELECT 1`;
  } catch {
    // Registry DB doesn't exist — create it from 'postgres' database
    const bootstrap = postgres({
      host: config.pgHost,
      port: config.pgPort,
      user: config.pgUser,
      password: config.pgPassword,
      database: "postgres",
    });
    await bootstrap.unsafe(`CREATE DATABASE "${config.pgRegistryDb}"`);
    await bootstrap.end();
  }

  // Now ensure the projects table exists
  const db = getRegistryDb();
  await db`
    CREATE TABLE IF NOT EXISTS projects (
      name        text PRIMARY KEY,
      directory   text NOT NULL,
      type        text NOT NULL DEFAULT 'custom',
      framework   text,
      config      jsonb DEFAULT '{}'::jsonb,
      created_at  timestamptz DEFAULT now(),
      updated_at  timestamptz DEFAULT now()
    )
  `;
}
