/**
 * Export service — generates a self-contained production stack.
 *
 * Reads templates from /app/templates/_export/, renders variables,
 * copies migrations, and optionally dumps the project database.
 *
 * The exported stack has zero references to the workbench.
 */
import { readFile, writeFile, mkdir, readdir, copyFile, access, stat } from "fs/promises";
import { join, basename } from "path";
import { exec } from "child_process";
import { renderTemplate, type TemplateVars } from "../lib/templates.js";
import { config } from "../config.js";
import type { ExportResult, ExportFormat } from "../schemas/index.js";

const EXPORT_TEMPLATES = "/app/templates/_export";
const MIGRATIONS_DIR = "/app/migrations";

export async function exportStack(
  projectName: string,
  projectDir: string,
  format: ExportFormat,
  includeData: boolean,
  outputDirOverride?: string
): Promise<ExportResult> {
  const outputDir = outputDirOverride ?? join(projectDir, "stack");

  // Safety: never overwrite an existing stack/ without checking
  try {
    await access(outputDir);
    // Directory exists — check if it has files
    const existing = await readdir(outputDir);
    if (existing.length > 0) {
      // Non-empty — append a timestamp to avoid collision
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const newDir = `${outputDir}-${ts}`;
      await mkdir(newDir, { recursive: true });
      return doExport(projectName, newDir, format, includeData);
    }
  } catch {
    // Doesn't exist — create it
  }

  await mkdir(outputDir, { recursive: true });
  return doExport(projectName, outputDir, format, includeData);
}

async function doExport(
  projectName: string,
  outputDir: string,
  format: ExportFormat,
  includeData: boolean
): Promise<ExportResult> {
  const vars: TemplateVars = {
    PROJECT_NAME: projectName,
    EMBEDDING_MODEL: config.embeddingModel,
    EMBEDDING_DIMENSIONS: String(config.embeddingDimensions),
    CLAUDE_MODEL: config.claudeModel,
  };

  const filesCreated: string[] = [];

  switch (format) {
    case "compose":
      await exportCompose(outputDir, vars, filesCreated);
      break;
    case "terraform":
      await exportTerraform(outputDir, vars, filesCreated);
      break;
    case "migrations-only":
      // Just copy migrations
      break;
  }

  // Always copy migrations
  await exportMigrations(outputDir, filesCreated);

  // Optionally export data
  let dataSize: number | undefined;
  if (includeData) {
    dataSize = await exportData(projectName, outputDir, filesCreated);
  }

  return {
    format,
    output_dir: outputDir,
    files_created: filesCreated,
    data_exported: includeData,
    data_size_bytes: dataSize,
  };
}

async function exportCompose(
  outputDir: string,
  vars: TemplateVars,
  filesCreated: string[]
): Promise<void> {
  const templateDir = join(EXPORT_TEMPLATES, "compose");
  const files = await readdir(templateDir);

  for (const file of files) {
    const content = await readFile(join(templateDir, file), "utf-8");
    const rendered = renderTemplate(content, vars);

    const outName = file === "env.example" ? ".env.example" : file;
    await writeFile(join(outputDir, outName), rendered);
    filesCreated.push(outName);
  }
}

async function exportTerraform(
  outputDir: string,
  vars: TemplateVars,
  filesCreated: string[]
): Promise<void> {
  const tfDir = join(outputDir, "terraform");
  await mkdir(tfDir, { recursive: true });

  const templateDir = join(EXPORT_TEMPLATES, "terraform");
  const files = await readdir(templateDir);

  for (const file of files) {
    const content = await readFile(join(templateDir, file), "utf-8");
    const rendered = renderTemplate(content, vars);
    await writeFile(join(tfDir, file), rendered);
    filesCreated.push(`terraform/${file}`);
  }
}

async function exportMigrations(
  outputDir: string,
  filesCreated: string[]
): Promise<void> {
  const migrationsOut = join(outputDir, "migrations");
  await mkdir(migrationsOut, { recursive: true });

  try {
    const files = await readdir(MIGRATIONS_DIR);
    for (const file of files.filter((f) => f.endsWith(".sql")).sort()) {
      await copyFile(join(MIGRATIONS_DIR, file), join(migrationsOut, file));
      filesCreated.push(`migrations/${file}`);
    }
  } catch {
    // Migrations dir not accessible
  }
}

async function exportData(
  projectName: string,
  outputDir: string,
  filesCreated: string[]
): Promise<number | undefined> {
  const dumpPath = join(outputDir, "seed-data.sql.gz");

  return new Promise<number | undefined>((resolve) => {
    const cmd = `pg_dump -h ${config.pgHost} -p ${config.pgPort} -U ${config.pgUser} --no-owner --no-privileges "${projectName}" | gzip > "${dumpPath}"`;

    exec(cmd, { env: { ...process.env, PGPASSWORD: config.pgPassword } }, async (err) => {
      if (err) {
        resolve(undefined);
        return;
      }
      filesCreated.push("seed-data.sql.gz");
      try {
        const stats = await stat(dumpPath);
        resolve(stats.size);
      } catch {
        resolve(undefined);
      }
    });
  });
}
