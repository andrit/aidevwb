/**
 * Test runner — execute a project's test suite and return results.
 *
 * Auto-detects the test command from common project files,
 * or uses an explicit command. Results are structured for
 * Claude to understand (passed/failed/error/timeout + output).
 */
import { exec } from "child_process";
import { access } from "fs/promises";
import { join } from "path";
import type { TestResult } from "../schemas/index.js";

const AUTO_DETECT_ORDER: Array<{ file: string; command: string }> = [
  { file: "package.json", command: "npm test" },
  { file: "Makefile", command: "make test" },
  { file: "pytest.ini", command: "pytest" },
  { file: "pyproject.toml", command: "pytest" },
  { file: "setup.py", command: "python -m pytest" },
  { file: "Cargo.toml", command: "cargo test" },
  { file: "go.mod", command: "go test ./..." },
];

/**
 * Detect the test command for a project directory.
 * Checks for common config files in priority order.
 */
export async function detectTestCommand(
  projectDir: string
): Promise<string | null> {
  for (const { file, command } of AUTO_DETECT_ORDER) {
    try {
      await access(join(projectDir, file));
      return command;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Run a test command in the given directory.
 * Returns structured results with stdout, stderr, exit code, and duration.
 */
export async function runTests(
  projectDir: string,
  command: string,
  timeoutSec: number = 120
): Promise<TestResult> {
  const start = Date.now();

  return new Promise<TestResult>((resolve) => {
    const child = exec(command, {
      cwd: projectDir,
      timeout: timeoutSec * 1000,
      maxBuffer: 1024 * 1024, // 1MB output cap
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data;
    });
    child.stderr?.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      resolve({
        status: code === 0 ? "passed" : "failed",
        command,
        exit_code: code,
        stdout: truncate(stdout, 8000),
        stderr: truncate(stderr, 4000),
        duration_ms: durationMs,
      });
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - start;
      const isTimeout = err.message.includes("TIMEOUT") || err.message.includes("killed");
      resolve({
        status: isTimeout ? "timeout" : "error",
        command,
        exit_code: null,
        stdout: truncate(stdout, 8000),
        stderr: truncate(err.message, 4000),
        duration_ms: durationMs,
      });
    });
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor(maxLen / 2) - 20;
  return (
    str.slice(0, half) +
    `\n\n... [truncated ${str.length - maxLen} chars] ...\n\n` +
    str.slice(-half)
  );
}
