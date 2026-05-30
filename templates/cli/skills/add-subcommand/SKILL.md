---
name: add-subcommand
description: Add a new subcommand to a CLI tool — define the command, flags, and arguments; implement the handler as a testable pure function; write auto-generated help text; and test via process spawn
domain: cli
type: cli
triggers:
  - "add a subcommand"
  - "add a command"
  - "new CLI command"
  - "add a flag"
  - "add an argument"
  - "new option"
  - "extend the CLI"
  - "add init command"
  - "add deploy command"
---

# Add a Subcommand

## When to use

When adding a new verb to an existing CLI tool — `mytool build`, `mytool deploy`, `mytool init` — or starting a CLI tool from scratch. Activate when the user says "add a command for X", "the CLI needs a new flag", or "add a subcommand."

See `seed-docs/cli-patterns.md` for the architectural overview.

## Prerequisites

- CLI project exists with a chosen parsing library:
  - **Node.js**: Commander.js (`npm install commander`)
  - **Python**: Click (`pip install click`) or Typer (`pip install typer`)
- Project structure: `src/cli.ts` (or `cli.py`) for the entry point, `src/commands/` for handlers, `src/lib/` for pure functions

## The Core Rule

**Separate parsing from logic.** The command handler only parses arguments and calls a pure function. The pure function lives in `src/lib/` and never touches `process.argv`, `sys.argv`, or any CLI framework type. This makes logic independently testable without spawning a process.

```
src/commands/build.ts    ← parses options, calls lib/builder.ts
src/lib/builder.ts       ← pure function, no CLI deps, unit tested
tests/cli/build.test.ts  ← spawn process, assert stdout/exit code
tests/lib/builder.test.ts ← unit test, no process spawn
```

## Steps (Node.js / TypeScript)

### 1. Create the pure logic function

Write the core logic first, in `src/lib/`:

```typescript
// src/lib/builder.ts
export interface BuildOptions {
  entry: string;
  outDir: string;
  minify: boolean;
}

export interface BuildResult {
  success: boolean;
  outputFiles: string[];
  durationMs: number;
  error?: string;
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const start = Date.now();
  // ... actual build logic here ...
  return {
    success: true,
    outputFiles: [`${options.outDir}/index.js`],
    durationMs: Date.now() - start,
  };
}
```

### 2. Create the command handler

```typescript
// src/commands/build.ts
import { Command } from "commander";
import { build } from "../lib/builder.js";

export function buildCommand(): Command {
  return new Command("build")
    .description("Compile and bundle the project")
    .argument("<entry>", "Entry point file")
    .option("-o, --out-dir <dir>", "Output directory", "dist")
    .option("--minify", "Minify the output", false)
    .option("--verbose", "Show detailed output", false)
    .action(async (entry: string, options) => {
      const verbose = options.verbose as boolean;

      if (verbose) {
        process.stderr.write(`Building from ${entry}...\n`);
      }

      const result = await build({
        entry,
        outDir: options.outDir as string,
        minify: options.minify as boolean,
      });

      if (!result.success) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      // Output to stdout — parseable by pipes
      if (verbose) {
        process.stdout.write(`Built ${result.outputFiles.length} files in ${result.durationMs}ms\n`);
        result.outputFiles.forEach((f) => process.stdout.write(`  ${f}\n`));
      } else {
        process.stdout.write(`${result.outputFiles.join("\n")}\n`);
      }
    });
}
```

### 3. Register the command in the main entry point

```typescript
// src/cli.ts
import { program } from "commander";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";

program
  .name("mytool")
  .description("My development tool")
  .version("1.0.0");

program.addCommand(buildCommand());
program.addCommand(deployCommand());

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
```

### 4. Test the pure function (unit test)

```typescript
// tests/lib/builder.test.ts
import { describe, it, expect } from "vitest";
import { build } from "../../src/lib/builder.js";

describe("build()", () => {
  it("returns output file paths on success", async () => {
    const result = await build({ entry: "src/index.ts", outDir: "dist", minify: false });
    expect(result.success).toBe(true);
    expect(result.outputFiles).toContain("dist/index.js");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("returns error on missing entry file", async () => {
    const result = await build({ entry: "nonexistent.ts", outDir: "dist", minify: false });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

### 5. Test the CLI (integration test, spawn the process)

```typescript
// tests/cli/build.test.ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CLI = path.resolve("dist/cli.js");  // built output

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

describe("mytool build", () => {
  it("exits 0 on valid input", () => {
    const { exitCode } = run(["build", "src/index.ts"]);
    expect(exitCode).toBe(0);
  });

  it("exits non-zero on missing entry", () => {
    const { exitCode, stderr } = run(["build", "nonexistent.ts"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/error/i);
  });

  it("shows help with --help", () => {
    const { stdout, exitCode } = run(["build", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("entry");
    expect(stdout).toContain("--out-dir");
  });

  it("writes output to stdout (pipeable)", () => {
    const { stdout } = run(["build", "src/index.ts"]);
    // stdout should be the output file path(s), not decorative text
    expect(stdout.trim()).toMatch(/dist\//);
  });
});
```

## Steps (Python / Click)

### 1. Create the pure logic function

```python
# src/lib/builder.py
import time
from dataclasses import dataclass

@dataclass
class BuildResult:
    success: bool
    output_files: list[str]
    duration_ms: int
    error: str | None = None

def build(entry: str, out_dir: str, minify: bool) -> BuildResult:
    start = time.time()
    # ... actual build logic ...
    return BuildResult(
        success=True,
        output_files=[f"{out_dir}/output.js"],
        duration_ms=int((time.time() - start) * 1000),
    )
```

### 2. Create the Click command

```python
# src/commands/build.py
import sys
import click
from ..lib.builder import build

@click.command("build")
@click.argument("entry")
@click.option("--out-dir", "-o", default="dist", show_default=True,
              help="Output directory")
@click.option("--minify/--no-minify", default=False,
              help="Minify the output")
@click.option("--verbose", "-v", is_flag=True,
              help="Show detailed output")
def build_command(entry: str, out_dir: str, minify: bool, verbose: bool):
    """Compile and bundle the project from ENTRY."""
    if verbose:
        click.echo(f"Building from {entry}...", err=True)

    result = build(entry=entry, out_dir=out_dir, minify=minify)

    if not result.success:
        click.echo(f"Error: {result.error}", err=True)
        sys.exit(1)

    if verbose:
        click.echo(f"Built {len(result.output_files)} files in {result.duration_ms}ms",
                   err=True)
        for f in result.output_files:
            click.echo(f"  {f}", err=True)
    else:
        # Clean stdout for piping
        for f in result.output_files:
            click.echo(f)
```

### 3. Register in the main CLI group

```python
# src/cli.py
import click
from .commands.build import build_command
from .commands.deploy import deploy_command

@click.group()
@click.version_option()
def cli():
    """My development tool."""
    pass

cli.add_command(build_command)
cli.add_command(deploy_command)

if __name__ == "__main__":
    cli()
```

## Help Text Rules

Good help text is the difference between a CLI your team adopts and one they avoid:

```
Rules:
1. Command description: one sentence, active verb ("Compile and bundle the project")
2. Arguments: describe what the value IS, not what to do with it ("Entry point file", not "Provide the entry point")
3. Options: include the default value if non-obvious (default="dist" → show_default=True)
4. Examples in the description for non-obvious commands:

  @click.command()
  ...
  def deploy(env, dry_run):
      """Deploy to the specified environment.

      \b
      Examples:
        mytool deploy staging
        mytool deploy production --dry-run
      """
```

## Output Conventions

| Channel | What goes there |
|---------|----------------|
| stdout | Machine-readable output (file paths, JSON, transformed data) |
| stderr | Human-readable progress, warnings, errors |
| exit 0 | Success |
| exit 1 | General error |
| exit 2 | Usage error (wrong flags, missing args) |

This lets `mytool build | xargs mytool deploy` work correctly — pipe chains only consume stdout.

## Checklist

- [ ] Core logic in `src/lib/` as a pure function — no CLI framework imports
- [ ] Command handler in `src/commands/` — only parses args, calls lib function
- [ ] Command registered in `src/cli.ts` (or `cli.py`)
- [ ] `--help` shows argument names, option descriptions, and defaults
- [ ] Progress and errors go to stderr; machine-readable output goes to stdout
- [ ] Unit test for the lib function (no process spawn)
- [ ] CLI integration test: exit 0 on valid input, non-zero on invalid, stdout is pipeable

## Files involved

| File | Action |
|------|--------|
| `src/lib/<command>.ts` | Create: pure function with no CLI dependencies |
| `src/commands/<command>.ts` | Create: Commander/Click command definition |
| `src/cli.ts` | Update: register the new command |
| `tests/lib/<command>.test.ts` | Create: unit tests for pure function |
| `tests/cli/<command>.test.ts` | Create: integration test via process spawn |

## Common mistakes

**Business logic in the command handler** — if the handler is more than ~20 lines, logic has leaked out of `src/lib/`. A command handler should be: parse → validate → call lib → format output → exit. Nothing else.

**Writing progress to stdout** — `console.log("Building...")` or `print("Building...")` to stdout breaks piping. Progress messages belong on stderr. In Node: `process.stderr.write()`; in Click: `click.echo(..., err=True)`.

**Not testing exit codes** — `expect(result.exitCode).toBe(0)` is the most important assertion in a CLI test. An unhandled exception or a wrong return code breaks scripts that depend on the CLI. Always assert exit code explicitly.

**No `--help` test** — help text breaks silently when you add a required argument to an existing command. Add a test that runs `--help` and checks for key flag names.
