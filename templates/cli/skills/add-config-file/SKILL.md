---
name: add-config-file
description: Add a configuration file to a CLI tool — implement the discovery hierarchy (flags > env > project config > user config > defaults), validate with Zod or Pydantic, merge layers, and test each override level
domain: cli
type: cli
triggers:
  - "add config file"
  - "configuration file"
  - "config hierarchy"
  - "user config"
  - ".rc file"
  - "project config"
  - "settings file"
  - "config validation"
  - "merge config"
  - "override config"
---

# Add a Config File

## When to use

When a CLI tool needs persistent settings that users shouldn't have to pass on every invocation. Activate when the user says "add a config file", "users should be able to set defaults", "I want a `.mytoolrc`", or "the tool needs project-level settings."

See `seed-docs/cli-patterns.md` — Configuration Hierarchy section.

## Prerequisites

- CLI project with at least one command (see `add-subcommand` skill)
- Zod installed (Node.js) or Pydantic installed (Python)
- Decision made: what format? JSON (easiest), YAML (readable), TOML (idiomatic for Python tools)

## The Configuration Hierarchy

Every config system must implement this priority order. High priority wins. Low priority is the fallback:

```
Priority 1 (highest): --flag on the command line
Priority 2:           Environment variable (MY_TOOL_SETTING)
Priority 3:           Project config (.mytoolrc or mytool.config.json in cwd and parents)
Priority 4:           User config (~/.config/mytool/config.json)
Priority 5 (lowest):  Hardcoded defaults in code
```

**Never reverse this order.** An env var should always beat a config file, and a CLI flag should always beat an env var. Users who set a flag explicitly expect it to win.

## Steps (Node.js / TypeScript)

### 1. Define the config schema

```typescript
// src/lib/config.ts
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// The complete config shape — every field has a default
export const ConfigSchema = z.object({
  apiUrl:      z.string().url().default("https://api.example.com"),
  outputDir:   z.string().default("dist"),
  logLevel:    z.enum(["debug", "info", "warn", "error"]).default("info"),
  timeout:     z.coerce.number().int().positive().default(30),
  token:       z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

### 2. Implement the loader

```typescript
// src/lib/config.ts (continued)

const CONFIG_FILENAMES = [".mytoolrc", ".mytoolrc.json", "mytool.config.json"];
const USER_CONFIG_DIR  = path.join(os.homedir(), ".config", "mytool");
const USER_CONFIG_FILE = path.join(USER_CONFIG_DIR, "config.json");

function readJsonFile(filepath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
}

function findProjectConfig(startDir: string): Record<string, unknown> {
  let dir = startDir;
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return readJsonFile(candidate);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return {};
}

function readEnvVars(): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  // Map MY_TOOL_API_URL → apiUrl, MY_TOOL_LOG_LEVEL → logLevel, etc.
  if (process.env.MY_TOOL_API_URL)   env.apiUrl   = process.env.MY_TOOL_API_URL;
  if (process.env.MY_TOOL_OUTPUT_DIR) env.outputDir = process.env.MY_TOOL_OUTPUT_DIR;
  if (process.env.MY_TOOL_LOG_LEVEL) env.logLevel  = process.env.MY_TOOL_LOG_LEVEL;
  if (process.env.MY_TOOL_TIMEOUT)   env.timeout   = process.env.MY_TOOL_TIMEOUT;
  if (process.env.MY_TOOL_TOKEN)     env.token     = process.env.MY_TOOL_TOKEN;
  return env;
}

export interface LoadConfigOptions {
  cwd?: string;
  overrides?: Partial<Record<keyof Config, unknown>>; // from CLI flags
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const cwd = options.cwd ?? process.cwd();

  // Layer 4 (lowest): user config
  const userConfig  = readJsonFile(USER_CONFIG_FILE);
  // Layer 3: project config (walks up from cwd)
  const projectConfig = findProjectConfig(cwd);
  // Layer 2: environment variables
  const envConfig   = readEnvVars();
  // Layer 1 (highest): CLI flags (passed explicitly)
  const flagOverrides = options.overrides ?? {};

  // Merge: later entries win
  const merged = {
    ...userConfig,
    ...projectConfig,
    ...envConfig,
    ...flagOverrides,
  };

  // Validate the merged result — throws ZodError with clear messages if invalid
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}
```

### 3. Integrate into commands

```typescript
// src/commands/build.ts
import { Command } from "commander";
import { loadConfig } from "../lib/config.js";
import { build } from "../lib/builder.js";

export function buildCommand(): Command {
  return new Command("build")
    .description("Compile and bundle the project")
    .argument("<entry>", "Entry point file")
    // These flags override config — undefined means "not set, use config"
    .option("-o, --out-dir <dir>", "Output directory (overrides config)")
    .option("--timeout <seconds>", "Timeout in seconds (overrides config)")
    .action(async (entry: string, flags) => {
      const config = loadConfig({
        overrides: {
          // Only pass flag if explicitly provided (not undefined)
          ...(flags.outDir   !== undefined && { outputDir: flags.outDir }),
          ...(flags.timeout  !== undefined && { timeout: Number(flags.timeout) }),
        },
      });

      const result = await build({
        entry,
        outDir: config.outputDir,
        minify: false,
        timeout: config.timeout,
      });

      if (!result.success) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }
    });
}
```

### 4. Add an `init` command that writes the config file

```typescript
// src/commands/config-init.ts
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = {
  apiUrl:    "https://api.example.com",
  outputDir: "dist",
  logLevel:  "info",
  timeout:   30,
};

export function configInitCommand(): Command {
  return new Command("config")
    .description("Manage tool configuration")
    .addCommand(
      new Command("init")
        .description("Write a default config file in the current directory")
        .option("--global", "Write to user config (~/.config/mytool/config.json)")
        .action((options) => {
          const target = options.global
            ? path.join(os.homedir(), ".config", "mytool", "config.json")
            : ".mytoolrc.json";

          if (fs.existsSync(target)) {
            process.stderr.write(`Config already exists at ${target}\n`);
            process.exit(1);
          }

          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
          process.stdout.write(`Created ${target}\n`);
        })
    )
    .addCommand(
      new Command("show")
        .description("Show resolved config (merged from all sources)")
        .action(() => {
          const config = loadConfig();
          process.stdout.write(JSON.stringify(config, null, 2) + "\n");
        })
    );
}
```

## Steps (Python / Click + Pydantic)

### 1. Define the config schema

```python
# src/lib/config.py
import json
import os
from pathlib import Path
from pydantic import BaseModel, HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseModel):
    api_url:    str   = "https://api.example.com"
    output_dir: str   = "dist"
    log_level:  str   = "info"
    timeout:    int   = 30
    token:      str | None = None

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v):
        allowed = {"debug", "info", "warn", "error"}
        if v not in allowed:
            raise ValueError(f"log_level must be one of {allowed}")
        return v

    @field_validator("timeout")
    @classmethod
    def validate_timeout(cls, v):
        if v <= 0:
            raise ValueError("timeout must be positive")
        return v
```

### 2. Implement the loader

```python
CONFIG_FILENAMES = [".mytoolrc", ".mytoolrc.json", "mytool.config.json"]
USER_CONFIG_PATH = Path.home() / ".config" / "mytool" / "config.json"


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _find_project_config(start: Path) -> dict:
    """Walk up from start dir looking for a config file."""
    current = start.resolve()
    while True:
        for name in CONFIG_FILENAMES:
            candidate = current / name
            if candidate.exists():
                return _read_json(candidate)
        parent = current.parent
        if parent == current:
            break
        current = parent
    return {}


def _read_env_vars() -> dict:
    mapping = {
        "MY_TOOL_API_URL":    "api_url",
        "MY_TOOL_OUTPUT_DIR": "output_dir",
        "MY_TOOL_LOG_LEVEL":  "log_level",
        "MY_TOOL_TIMEOUT":    "timeout",
        "MY_TOOL_TOKEN":      "token",
    }
    return {
        field: os.environ[env_var]
        for env_var, field in mapping.items()
        if env_var in os.environ
    }


def load_config(cwd: Path | None = None, overrides: dict | None = None) -> Config:
    """Load and merge config from all sources. CLI overrides win."""
    cwd = cwd or Path.cwd()

    user_config    = _read_json(USER_CONFIG_PATH)
    project_config = _find_project_config(cwd)
    env_config     = _read_env_vars()
    cli_overrides  = {k: v for k, v in (overrides or {}).items() if v is not None}

    merged = {**user_config, **project_config, **env_config, **cli_overrides}

    try:
        return Config(**merged)
    except Exception as e:
        raise SystemExit(f"Invalid configuration: {e}") from e
```

### 3. Integrate with Click (pass via context)

```python
# src/cli.py
import click
from pathlib import Path
from .lib.config import load_config, Config

@click.group()
@click.option("--out-dir", default=None, help="Output directory (overrides config)")
@click.option("--timeout", default=None, type=int, help="Timeout (overrides config)")
@click.pass_context
def cli(ctx, out_dir, timeout):
    """My development tool."""
    ctx.ensure_object(dict)
    ctx.obj["config"] = load_config(overrides={
        "output_dir": out_dir,
        "timeout": timeout,
    })

# In command handlers:
@cli.command()
@click.argument("entry")
@click.pass_context
def build(ctx, entry):
    """Compile and bundle the project from ENTRY."""
    config: Config = ctx.obj["config"]
    # use config.output_dir, config.timeout, etc.
```

## Testing the Config Hierarchy

Each layer must be tested independently. Don't just test the happy path:

```typescript
// tests/lib/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("loadConfig()", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));

  afterEach(() => {
    // Clean up env vars set during tests
    delete process.env.MY_TOOL_LOG_LEVEL;
    delete process.env.MY_TOOL_OUTPUT_DIR;
  });

  it("returns defaults when no config exists", () => {
    const config = loadConfig({ cwd: tmpDir });
    expect(config.logLevel).toBe("info");
    expect(config.timeout).toBe(30);
  });

  it("project config overrides defaults", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mytoolrc.json"),
      JSON.stringify({ logLevel: "debug" })
    );
    const config = loadConfig({ cwd: tmpDir });
    expect(config.logLevel).toBe("debug");
  });

  it("env var overrides project config", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mytoolrc.json"),
      JSON.stringify({ logLevel: "debug" })
    );
    process.env.MY_TOOL_LOG_LEVEL = "warn";
    const config = loadConfig({ cwd: tmpDir });
    expect(config.logLevel).toBe("warn");
  });

  it("CLI override wins over env var", () => {
    process.env.MY_TOOL_LOG_LEVEL = "warn";
    const config = loadConfig({ cwd: tmpDir, overrides: { logLevel: "error" } });
    expect(config.logLevel).toBe("error");
  });

  it("throws clearly on invalid config value", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mytoolrc.json"),
      JSON.stringify({ logLevel: "verbose" })  // not a valid level
    );
    expect(() => loadConfig({ cwd: tmpDir })).toThrow(/logLevel/);
  });

  it("walks up directories to find project config", () => {
    const subDir = path.join(tmpDir, "a", "b", "c");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".mytoolrc.json"),  // config at the root
      JSON.stringify({ outputDir: "build" })
    );
    const config = loadConfig({ cwd: subDir });  // started from subdir
    expect(config.outputDir).toBe("build");
  });
});
```

## Checklist

- [ ] Config schema defined with Zod (TS) or Pydantic (Python) — every field has a default
- [ ] Loader implements all 5 levels: defaults, user config, project config, env vars, CLI flags
- [ ] Project config discovery walks up the directory tree (not just `cwd`)
- [ ] Env var names documented with the `MY_TOOL_` prefix convention
- [ ] Invalid config values produce a clear error message (not a cryptic stack trace)
- [ ] `config show` subcommand (or `--show-config` flag) lets users see the resolved config
- [ ] `config init` subcommand writes a default config file
- [ ] Test: defaults return when no config exists
- [ ] Test: project config overrides defaults
- [ ] Test: env var overrides project config
- [ ] Test: CLI override wins over env var
- [ ] Test: invalid value produces a clear error

## Files involved

| File | Action |
|------|--------|
| `src/lib/config.ts` | Create: schema, loader, env var mapping, directory walk |
| `src/commands/config-init.ts` | Create: `config init` and `config show` subcommands |
| `src/cli.ts` | Update: register config commands; pass loaded config to handlers |
| `tests/lib/config.test.ts` | Create: hierarchy tests per level |

## Common mistakes

**Config loaded once at import time** — if `loadConfig()` is called at module load rather than inside the command action, tests that set env vars after import are invisible. Load config inside the command action where the test can control the environment.

**Not walking up the directory tree** — a project config at the repo root should work from any subdirectory, just like `.gitignore`. If you only check `process.cwd()`, the config won't be found from subdirectories.

**CLI flag of `undefined` overrides config** — if the user doesn't pass `--out-dir`, Commander gives you `undefined`. Merging `{ outputDir: undefined }` will overwrite the config file's value with `undefined`. Filter out undefined overrides before merging.

**Secrets in config files** — tokens, API keys, and passwords should come from environment variables or a secrets manager, not from a config file that gets committed to git. Add the config filename to `.gitignore` and document that `token` should be set via `MY_TOOL_TOKEN` env var.
