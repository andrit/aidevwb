/**
 * Scaffold service — handles project creation and import.
 *
 * Two modes:
 *   scaffold: new project, empty directory → write all template files
 *   import:   existing project → create .workbench/ only, offer to append to CLAUDE.md
 *
 * Also handles:
 *   reconnect: .workbench/ already exists → restore DB if needed
 *   seed docs: ingested into the project's knowledgebase (DB, not filesystem)
 */
import { readFile, writeFile, mkdir, copyFile, readdir, access } from "fs/promises";
import { join, basename } from "path";
import { scanProjectDirectory, readExistingClaudeMd, determineMode } from "../lib/scanner.js";
import { renderTemplate, deepMerge } from "../lib/templates.js";
import { resolveFramework, frameworkLabel } from "../lib/frameworks.js";
import type { ScanResult } from "../lib/scanner.js";

const TEMPLATES_DIR = "/app/templates";

export interface ScaffoldResult {
  mode: "scaffold" | "import" | "reconnect";
  filesCreated: string[];
  filesSkipped: string[];
  appendOffered: string | null;
  seedDocsFound: number;
}

export interface ScaffoldOptions {
  name: string;
  directory: string;
  type: string;
  framework?: string;
}

/**
 * Run the full scaffold/import flow for a project.
 * Returns what was done — does not modify CLAUDE.md without explicit confirmation.
 */
export async function scaffoldProject(
  opts: ScaffoldOptions
): Promise<ScaffoldResult> {
  const scan = await scanProjectDirectory(opts.directory);
  const mode = scan.exists ? determineMode(scan) : "scaffold";

  const result: ScaffoldResult = {
    mode,
    filesCreated: [],
    filesSkipped: [],
    appendOffered: null,
    seedDocsFound: 0,
  };

  // Ensure directory exists
  if (!scan.exists) {
    await mkdir(opts.directory, { recursive: true });
  }

  // Load template config (base + type override)
  const projectConfig = await loadProjectConfig(opts.type);

  // Create .workbench/ directory (always safe — it's ours)
  const workbenchDir = join(opts.directory, ".workbench");
  await mkdir(workbenchDir, { recursive: true });

  // Write .workbench/project.json
  const projectJson = {
    ...projectConfig,
    name: opts.name,
    framework: opts.framework ?? null,
    created_at: new Date().toISOString(),
  };
  await writeFile(
    join(workbenchDir, "project.json"),
    JSON.stringify(projectJson, null, 2)
  );
  result.filesCreated.push(".workbench/project.json");

  // Mode-specific handling
  switch (mode) {
    case "scaffold":
      await handleScaffold(opts, projectConfig, result);
      break;
    case "import":
      await handleImport(opts, scan, result);
      break;
    case "reconnect":
      // .workbench/ already exists — just update project.json
      result.filesCreated = [".workbench/project.json"];
      break;
  }

  // Count seed docs (they'll be ingested separately via the API)
  result.seedDocsFound = await countSeedDocs(opts.type, opts.framework);

  return result;
}

/**
 * Scaffold mode — write all template files to an empty directory.
 */
async function handleScaffold(
  opts: ScaffoldOptions,
  config: Record<string, unknown>,
  result: ScaffoldResult
): Promise<void> {
  const framework = resolveFramework(opts.framework);
  const vars = {
    PROJECT_NAME: opts.name,
    PROJECT_DESCRIPTION: (config.description as string) || `${opts.type} project`,
    ROADMAP: (config.roadmap as string) || "Define your development plan here.",
    FRAMEWORK: frameworkLabel(framework),
  };

  // Write CLAUDE.md from base template
  try {
    const template = await readFile(join(TEMPLATES_DIR, "_base", "scaffold", "CLAUDE.md"), "utf-8");
    const rendered = renderTemplate(template, vars);
    await writeFile(join(opts.directory, "CLAUDE.md"), rendered);
    result.filesCreated.push("CLAUDE.md");
  } catch {
    result.filesSkipped.push("CLAUDE.md (template not found)");
  }

  // Create documents/ directory for RAG source files
  await mkdir(join(opts.directory, "documents"), { recursive: true });
  result.filesCreated.push("documents/");

  // For agent projects: copy framework-specific scaffold files
  if (opts.type === "agent") {
    await copyFrameworkScaffold(opts.directory, framework, vars, result);
  }

  // For multi-agent projects: copy patterns library + scaffold files
  if (opts.type === "multi-agent") {
    await copyTypeScaffold(opts.directory, "multi-agent", vars, result);
  }
}

/**
 * Import mode — create .workbench/ only, prepare append block for CLAUDE.md.
 * NEVER overwrites existing files.
 */
async function handleImport(
  opts: ScaffoldOptions,
  scan: ScanResult,
  result: ScaffoldResult
): Promise<void> {
  // Check if CLAUDE.md exists and needs the workbench section
  if (scan.hasClaudeMd) {
    const existing = await readExistingClaudeMd(opts.directory);
    if (existing && !existing.hasWorkbenchSection) {
      // Load the append block — but don't write it yet
      // Return it so the caller can present it for user confirmation
      try {
        const appendBlock = await readFile(
          join(TEMPLATES_DIR, "_base", "import", "claude-md-append.md"),
          "utf-8"
        );
        result.appendOffered = appendBlock;
      } catch {
        // Template not found
      }
    } else {
      result.filesSkipped.push("CLAUDE.md (already has workbench section)");
    }
  }

  // Log what was skipped
  for (const conflict of scan.conflicts) {
    if (conflict !== ".workbench" && !result.filesSkipped.some((s) => s.startsWith(conflict))) {
      result.filesSkipped.push(`${conflict} (exists, not modified)`);
    }
  }
}

/**
 * Append the workbench section to an existing CLAUDE.md.
 * Called only after user confirms.
 */
export async function appendToClaudeMd(
  directory: string,
  appendBlock: string
): Promise<boolean> {
  const claudeMdPath = join(directory, "CLAUDE.md");
  try {
    const existing = await readFile(claudeMdPath, "utf-8");
    if (existing.includes("Added by AI Dev Workbench")) {
      return false; // Already has the section
    }
    await writeFile(claudeMdPath, existing + "\n" + appendBlock);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and merge project config from base + type-specific template.
 */
async function loadProjectConfig(type: string): Promise<Record<string, unknown>> {
  let base: Record<string, unknown> = {};
  let typeConfig: Record<string, unknown> = {};

  try {
    const baseContent = await readFile(join(TEMPLATES_DIR, "_base", "project.json"), "utf-8");
    base = JSON.parse(baseContent);
  } catch {
    // No base template
  }

  try {
    const typeContent = await readFile(join(TEMPLATES_DIR, type, "project.json"), "utf-8");
    typeConfig = JSON.parse(typeContent);
  } catch {
    // No type-specific template — use base
  }

  return deepMerge(base, typeConfig);
}

/**
 * List seed doc files for a project type.
 */
/**
 * Copy framework-specific scaffold files into the project directory.
 * Renders {{VARIABLE}} placeholders in file contents.
 */
async function copyFrameworkScaffold(
  projectDir: string,
  framework: string,
  vars: Record<string, string>,
  result: ScaffoldResult
): Promise<void> {
  const scaffoldDir = join(TEMPLATES_DIR, "agent", "frameworks", framework, "scaffold");

  try {
    const files = await readdir(scaffoldDir);
    for (const file of files) {
      const srcPath = join(scaffoldDir, file);
      const destPath = join(projectDir, file);

      // Read, render variables, write
      const content = await readFile(srcPath, "utf-8");
      const rendered = renderTemplate(content, vars);
      await writeFile(destPath, rendered);
      result.filesCreated.push(file);
    }
  } catch {
    result.filesSkipped.push(`framework scaffold (${framework} templates not found)`);
  }
}

/**
 * Copy type-specific scaffold files into the project directory.
 * Used for project types that have their own scaffold/ directory
 * (e.g., multi-agent with patterns.py and main.py).
 */
async function copyTypeScaffold(
  projectDir: string,
  type: string,
  vars: Record<string, string>,
  result: ScaffoldResult
): Promise<void> {
  const scaffoldDir = join(TEMPLATES_DIR, type, "scaffold");

  try {
    const files = await readdir(scaffoldDir);
    for (const file of files) {
      const srcPath = join(scaffoldDir, file);
      const destPath = join(projectDir, file);

      const content = await readFile(srcPath, "utf-8");
      const rendered = renderTemplate(content, vars);
      await writeFile(destPath, rendered);
      result.filesCreated.push(file);
    }
  } catch {
    result.filesSkipped.push(`type scaffold (${type} templates not found)`);
  }
}

/**
 * List seed doc files for a project type + optional framework.
 * Returns type-level seed docs first, then framework-specific ones.
 */
export async function listSeedDocs(type: string, framework?: string): Promise<string[]> {
  const paths: string[] = [];

  // Type-specific seed docs
  const typeDir = join(TEMPLATES_DIR, type, "seed-docs");
  try {
    const files = await readdir(typeDir);
    for (const f of files) {
      if (f.endsWith(".md") || f.endsWith(".txt")) {
        paths.push(join(typeDir, f));
      }
    }
  } catch {
    // No seed docs for this type
  }

  // Framework-specific seed docs (for agent projects)
  if (framework) {
    const fwDir = join(TEMPLATES_DIR, type, "frameworks", framework, "seed-docs");
    try {
      const files = await readdir(fwDir);
      for (const f of files) {
        if (f.endsWith(".md") || f.endsWith(".txt")) {
          paths.push(join(fwDir, f));
        }
      }
    } catch {
      // No framework-specific seed docs
    }
  }

  return paths;
}

async function countSeedDocs(type: string, framework?: string): Promise<number> {
  return (await listSeedDocs(type, framework)).length;
}

/**
 * Ingest all seed docs for a project type into the project's knowledgebase.
 * Called after project creation so the knowledgebase has preloaded context.
 * Returns the count of successfully ingested docs.
 */
export async function ingestSeedDocs(
  projectName: string,
  type: string,
  framework?: string
): Promise<{ ingested: number; errors: string[] }> {
  const { getProjectDb } = await import("./db.js");
  const { ingestDocument } = await import("./ingest.js");

  const db = getProjectDb(projectName);
  const docs = await listSeedDocs(type, framework);
  let ingested = 0;
  const errors: string[] = [];

  for (const filepath of docs) {
    try {
      const result = await ingestDocument(db, filepath);
      if (result.status === "ingested" || result.status === "skipped") {
        ingested++;
      } else if (result.status === "error") {
        errors.push(`${basename(filepath)}: ${result.reason}`);
      }
    } catch (err) {
      errors.push(`${basename(filepath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ingested, errors };
}
