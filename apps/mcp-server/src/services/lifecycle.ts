/**
 * Project lifecycle — backup and restore for portability.
 *
 * Handles the .workbench/backup.sql.gz file:
 *   - backupProject: pg_dump the project DB into .workbench/
 *   - restoreProject: restore from .workbench/ if DB is missing
 *   - checkAndRestore: auto-detect and restore on project open
 *
 * Uses child_process to call pg_dump/psql (same approach as the
 * Makefile targets, but accessible from the API).
 */
import { exec } from "child_process";
import { access, mkdir } from "fs/promises";
import { join } from "path";
import { config } from "../config.js";
import { getRegistryDb, testConnection, getProjectDb } from "./db.js";

const BACKUP_FILENAME = "backup.sql.gz";

function pgEnv(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    PGHOST: config.pgHost,
    PGPORT: String(config.pgPort),
    PGUSER: config.pgUser,
    PGPASSWORD: config.pgPassword,
  };
}

function run(cmd: string, env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    exec(cmd, { env, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        code: err ? (err as NodeJS.ErrnoException & { code?: number }).code as unknown as number ?? 1 : 0,
      });
    });
  });
}

/**
 * Backup a project's database to .workbench/backup.sql.gz.
 */
export async function backupProject(
  projectName: string,
  projectDir: string
): Promise<{ status: string; path: string; size_bytes?: number }> {
  const workbenchDir = join(projectDir, ".workbench");
  await mkdir(workbenchDir, { recursive: true });

  const backupPath = join(workbenchDir, BACKUP_FILENAME);
  const cmd = `pg_dump --no-owner --no-privileges --clean --if-exists "${projectName}" | gzip > "${backupPath}"`;

  const result = await run(cmd, pgEnv());
  if (result.stderr && !result.stderr.includes("NOTICE")) {
    return { status: "error", path: backupPath, size_bytes: 0 };
  }

  // Get file size
  try {
    const { statSync } = await import("fs");
    const stats = statSync(backupPath);
    return { status: "ok", path: `.workbench/${BACKUP_FILENAME}`, size_bytes: stats.size };
  } catch {
    return { status: "ok", path: `.workbench/${BACKUP_FILENAME}` };
  }
}

/**
 * Restore a project's database from .workbench/backup.sql.gz.
 * The database must already exist (created via project registration).
 */
export async function restoreProject(
  projectName: string,
  projectDir: string
): Promise<{ status: string; reason?: string }> {
  const backupPath = join(projectDir, ".workbench", BACKUP_FILENAME);

  try {
    await access(backupPath);
  } catch {
    return { status: "skipped", reason: "No backup found at .workbench/backup.sql.gz" };
  }

  const cmd = `gunzip -c "${backupPath}" | psql -d "${projectName}" --quiet 2>&1 | head -5`;
  const result = await run(cmd, pgEnv());

  if (result.code !== 0 && result.code !== null) {
    return { status: "error", reason: result.stderr || "Restore failed" };
  }

  return { status: "restored" };
}

/**
 * Check if a project's database has data. If empty and a backup exists,
 * auto-restore. Called during project open (reconnect mode).
 */
export async function checkAndRestore(
  projectName: string,
  projectDir: string
): Promise<{ action: string; reason?: string }> {
  // Check if the database exists and has documents
  try {
    const db = getProjectDb(projectName);
    const ok = await testConnection(db);
    if (!ok) {
      // DB doesn't exist or can't connect — try to restore
      return await tryRestore(projectName, projectDir);
    }

    const rows = await db`SELECT count(*)::int as count FROM documents`;
    if (rows[0].count > 0) {
      return { action: "none", reason: "Database has data" };
    }

    // DB exists but is empty — check for backup
    return await tryRestore(projectName, projectDir);
  } catch {
    return await tryRestore(projectName, projectDir);
  }
}

async function tryRestore(
  projectName: string,
  projectDir: string
): Promise<{ action: string; reason?: string }> {
  const backupPath = join(projectDir, ".workbench", BACKUP_FILENAME);
  try {
    await access(backupPath);
  } catch {
    return { action: "none", reason: "No backup available" };
  }

  const result = await restoreProject(projectName, projectDir);
  return {
    action: result.status === "restored" ? "restored" : "failed",
    reason: result.reason,
  };
}

/**
 * Backup all registered projects. Called on graceful shutdown.
 */
export async function backupAllProjects(): Promise<Array<{ name: string; status: string }>> {
  const db = getRegistryDb();
  const results: Array<{ name: string; status: string }> = [];

  try {
    const projects = await db`SELECT name, directory FROM projects`;
    for (const project of projects) {
      try {
        const result = await backupProject(project.name as string, project.directory as string);
        results.push({ name: project.name as string, status: result.status });
      } catch {
        results.push({ name: project.name as string, status: "error" });
      }
    }
  } catch {
    // Registry not available — skip
  }

  return results;
}
