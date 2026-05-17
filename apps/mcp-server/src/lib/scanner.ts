/**
 * Project scanner — detects existing project files.
 *
 * Pure functions that inspect a directory and report what exists.
 * Used to determine import-vs-scaffold mode and detect conflicts.
 */
import { access, readdir, readFile } from "fs/promises";
import { join } from "path";

/** Files the workbench might want to create or modify */
const WORKBENCH_TOUCHPOINTS = [
  "CLAUDE.md",
  ".claude/commands",
  ".claude/settings.json",
  ".workbench",
] as const;

/** Files that indicate a project already has code */
const PROJECT_INDICATORS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Makefile",
  "setup.py",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "src",
  "lib",
  "app",
] as const;

export interface ScanResult {
  /** Whether the directory exists and has files */
  exists: boolean;
  /** Whether there's an existing project (has code/config files) */
  hasProject: boolean;
  /** Whether .workbench/ already exists (previously registered) */
  hasWorkbench: boolean;
  /** Whether a CLAUDE.md exists */
  hasClaudeMd: boolean;
  /** List of workbench touchpoint files that already exist */
  conflicts: string[];
  /** Detected project indicators (e.g., "package.json", "src") */
  indicators: string[];
}

/**
 * Scan a directory and report what exists.
 * Pure function — reads the filesystem but changes nothing.
 */
export async function scanProjectDirectory(dir: string): Promise<ScanResult> {
  const result: ScanResult = {
    exists: false,
    hasProject: false,
    hasWorkbench: false,
    hasClaudeMd: false,
    conflicts: [],
    indicators: [],
  };

  try {
    await access(dir);
    result.exists = true;
  } catch {
    return result;
  }

  // Check for existing project indicators
  for (const indicator of PROJECT_INDICATORS) {
    try {
      await access(join(dir, indicator));
      result.indicators.push(indicator);
    } catch {
      // not found, skip
    }
  }
  result.hasProject = result.indicators.length > 0;

  // Check for workbench touchpoints
  for (const touchpoint of WORKBENCH_TOUCHPOINTS) {
    try {
      await access(join(dir, touchpoint));
      result.conflicts.push(touchpoint);
      if (touchpoint === ".workbench") result.hasWorkbench = true;
      if (touchpoint === "CLAUDE.md") result.hasClaudeMd = true;
    } catch {
      // not found, no conflict
    }
  }

  return result;
}

/**
 * Read an existing CLAUDE.md and check if it already has
 * the workbench integration section.
 */
export async function readExistingClaudeMd(
  dir: string
): Promise<{ content: string; hasWorkbenchSection: boolean } | null> {
  try {
    const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
    const hasWorkbenchSection = content.includes("Added by AI Dev Workbench");
    return { content, hasWorkbenchSection };
  } catch {
    return null;
  }
}

/**
 * Determine the scaffold mode based on scan results.
 */
export function determineMode(scan: ScanResult): "scaffold" | "import" | "reconnect" {
  if (scan.hasWorkbench) return "reconnect";  // Already registered, just reconnect
  if (scan.hasProject) return "import";        // Existing project, be careful
  return "scaffold";                           // Empty directory, full scaffold
}
