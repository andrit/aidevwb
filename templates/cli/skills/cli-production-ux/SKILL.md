---
name: cli-production-ux
description: Polish a CLI for production distribution — user-facing error messages (never stack traces), exit code conventions, --version and --help completeness, shell completion, first-run experience, and credential storage
domain: cli
type: cli
triggers:
  - "cli production"
  - "cli error messages"
  - "exit codes"
  - "shell completion"
  - "cli credentials"
  - "first run experience"
  - "cli help"
  - "cli ux"
  - "publish cli"
  - "cli distribution"
---

# CLI Production UX

## When to use

Before publishing a CLI to npm or distributing it to users who are not developers on the project. Development CLIs show stack traces, have incomplete `--help`, and store credentials in plaintext. A production CLI catches all errors and formats them for non-developers, follows Unix exit code conventions, generates shell completions, and stores credentials securely in the OS keychain. Activate when running `npm publish` or when the first non-developer user will install the tool.

## Prerequisites

- CLI implemented with `add-subcommand` skill complete
- Config file approach chosen (`add-config-file` skill complete)
- npm account for publishing (if distributing publicly)

## Step 1 — User-Facing Error Messages

Never let a stack trace reach the user. Catch all errors at the top level and format them as actionable messages.

```typescript
// src/main.ts — top-level error boundary
import { Command } from "commander";
import { CLIError, formatError } from "./lib/errors.js";

const program = new Command();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const message = formatError(err);
    process.stderr.write(`${message}\n`);
    process.exit(exitCodeFor(err));
  }
}

main();
```

```typescript
// src/lib/errors.ts
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export class AuthError extends CLIError {
  constructor(message: string) {
    super(message, 1, "Run `mycli auth login` to authenticate.");
  }
}

export class NetworkError extends CLIError {
  constructor(url: string, cause?: Error) {
    super(
      `Could not connect to ${url}.`,
      1,
      "Check your network connection and try again."
    );
  }
}

export function formatError(err: unknown): string {
  if (err instanceof CLIError) {
    let msg = `Error: ${err.message}`;
    if (err.hint) msg += `\nHint: ${err.hint}`;
    return msg;
  }

  if (err instanceof Error) {
    // Unexpected error — show message but not stack trace in production
    if (process.env.DEBUG) {
      return `Unexpected error: ${err.message}\n${err.stack}`;
    }
    return `Unexpected error: ${err.message}\nRun with DEBUG=1 for more details.`;
  }

  return `Unexpected error: ${String(err)}`;
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof CLIError) return err.exitCode;
  return 1;
}
```

**Error message principles:**
- Start with what went wrong: `"Could not find config file"`, not `"ENOENT: no such file..."`
- Include a hint when the fix is obvious: `"Run mycli init to create one."`
- Never expose file paths the user didn't provide: `"Config file not found"`, not `"Config file at /Users/alice/.config/mycli/config.json not found"`

## Step 2 — Exit Code Conventions

Other tools and CI pipelines depend on exit codes. Follow Unix conventions exactly.

```typescript
// src/lib/exit-codes.ts
export const EXIT = {
  SUCCESS:         0,  // completed normally
  GENERAL_ERROR:   1,  // any error not covered below
  MISUSE:          2,  // incorrect usage (bad flags, wrong arg count)
  CANNOT_EXECUTE:  126, // permission denied
  NOT_FOUND:       127, // command not found (for subcommand dispatch)
} as const;
```

```typescript
// Usage — set exit codes explicitly on error classes
export class UsageError extends CLIError {
  constructor(message: string) {
    super(message, EXIT.MISUSE);
  }
}

// In a command handler:
program
  .command("deploy <environment>")
  .action(async (environment) => {
    const valid = ["staging", "production"];
    if (!valid.includes(environment)) {
      throw new UsageError(
        `Unknown environment: "${environment}". Valid options: ${valid.join(", ")}`
      );
    }
    // ...
  });
```

Verify exit codes in your smoke test:
```bash
mycli --bad-flag 2>/dev/null; echo "exit: $?"  # should be 2
mycli deploy bad-env 2>/dev/null; echo "exit: $?"  # should be 2
mycli auth login --token invalid 2>/dev/null; echo "exit: $?"  # should be 1
```

## Step 3 — `--version` and `--help` Completeness

```typescript
// src/main.ts
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

// Read version from package.json — single source of truth
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
);

const program = new Command()
  .name("mycli")
  .description("One-line description of what this tool does.")
  .version(pkg.version, "-v, --version", "Print version and exit")
  .helpOption("-h, --help", "Show this help message");
```

**`--help` completeness checklist:**
- Every flag has a description (no empty `.option("-x")` calls)
- Required args are shown in `<angle-brackets>`, optional in `[square-brackets]`
- Default values shown: `.option("--port <n>", "Port to listen on", "3000")`
- At least one usage example in the root help text

```typescript
program
  .addHelpText("afterAll", `
Examples:
  $ mycli init                     # Initialize a new project
  $ mycli deploy staging           # Deploy to staging environment
  $ mycli --version                # Print version

Documentation: https://docs.myapp.com/cli
`)
```

## Step 4 — Shell Completion

Completion turns a CLI from "I need to check the docs" into "I can just tab." Generate it from the same command definitions.

```typescript
// package.json scripts
{
  "scripts": {
    "completion:bash": "node dist/main.js completion bash",
    "completion:zsh":  "node dist/main.js completion zsh",
    "completion:fish": "node dist/main.js completion fish"
  }
}
```

Using `commander` with `@commander-js/extra-typings` or a completion library:

```typescript
// src/commands/completion.ts
import { Command } from "commander";

export function addCompletionCommand(program: Command): void {
  program
    .command("completion <shell>")
    .description("Generate shell completion script")
    .addHelpText("after", `
Shells supported: bash, zsh, fish

Install completions:
  # bash (~/.bashrc):
  source <(mycli completion bash)

  # zsh (~/.zshrc):
  source <(mycli completion zsh)

  # fish (~/.config/fish/completions/mycli.fish):
  mycli completion fish > ~/.config/fish/completions/mycli.fish
`)
    .action((shell) => {
      const completions = generateCompletion(program, shell);
      if (!completions) {
        throw new UsageError(`Unknown shell: "${shell}". Supported: bash, zsh, fish`);
      }
      process.stdout.write(completions);
    });
}
```

Document completion installation in your README and in the `--help` output for the root command.

## Step 5 — First-Run Experience

A user who just installed the CLI and runs it cold should not see `Error: ANTHROPIC_API_KEY is not set`.

```typescript
// src/lib/first-run.ts
import { existsSync } from "fs";
import { getConfigPath } from "./config.js";

export async function checkFirstRun(): Promise<void> {
  if (!existsSync(getConfigPath())) {
    console.log(`Welcome to mycli!

It looks like this is your first time running mycli.
Let's get you set up.

Run: mycli init

This will guide you through the initial configuration.
`);
    process.exit(0);
  }
}
```

```typescript
// src/commands/init.ts — guided setup
export async function runInit(): Promise<void> {
  console.log("Setting up mycli...\n");

  // Check prerequisites
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`You'll need an Anthropic API key.
Get one at: https://console.anthropic.com

Once you have it, run:
  export ANTHROPIC_API_KEY=sk-ant-...
  mycli init
`);
    process.exit(1);
  }

  // Run interactive setup
  const answers = await promptSetup();
  await writeConfig(answers);

  console.log(`\n✓ Config written to ${getConfigPath()}`);
  console.log(`✓ Run "mycli --help" to get started.\n`);
}
```

## Step 6 — Credential Storage

Config files with embedded API keys get accidentally committed to git. Use the OS keychain for secrets.

```typescript
// src/lib/credentials.ts
// Uses 'keytar' — stores in macOS Keychain, Windows Credential Store, Linux libsecret
import keytar from "keytar";

const SERVICE = "mycli";

export async function saveToken(account: string, token: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, token);
}

export async function loadToken(account: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, account);
}

export async function deleteToken(account: string): Promise<void> {
  await keytar.deletePassword(SERVICE, account);
}
```

```typescript
// src/commands/auth.ts
program
  .command("auth")
  .addCommand(
    new Command("login")
      .description("Authenticate with the API")
      .option("--token <token>", "API token (reads from MYCLI_TOKEN env var if omitted)")
      .action(async (opts) => {
        const token = opts.token ?? process.env.MYCLI_TOKEN;
        if (!token) throw new UsageError("Provide --token or set MYCLI_TOKEN");

        await verifyToken(token);  // throws AuthError if invalid
        await saveToken("default", token);
        console.log("✓ Authenticated. Token stored securely in OS keychain.");
      })
  )
  .addCommand(
    new Command("logout")
      .description("Remove stored credentials")
      .action(async () => {
        await deleteToken("default");
        console.log("✓ Credentials removed.");
      })
  );
```

**Fallback for headless/CI environments** (where the keychain may not be available):

```typescript
export async function loadToken(account: string): Promise<string | null> {
  // Env var takes precedence — works in CI without keychain
  if (process.env.MYCLI_TOKEN) return process.env.MYCLI_TOKEN;

  try {
    return await keytar.getPassword(SERVICE, account);
  } catch {
    // Keychain unavailable (headless server) — fall back to config file
    return loadTokenFromConfigFile();
  }
}
```

## Checklist

- [ ] Top-level `try/catch` in `main()` — no stack traces reach users
- [ ] `CLIError` / `AuthError` / `NetworkError` classes with exit codes and hints
- [ ] `DEBUG=1` enables stack traces for developers without affecting default output
- [ ] Exit codes: 0 success, 1 error, 2 misuse — verified in smoke test
- [ ] `--version` reads from `package.json` (not hardcoded)
- [ ] Every `option()` and `argument()` has a description
- [ ] At least one usage example in root `--help`
- [ ] Shell completion command added (`bash`, `zsh`, `fish`)
- [ ] First-run check: friendly message + `mycli init` when config missing
- [ ] `keytar` used for token storage (not plaintext config file)
- [ ] CI/headless fallback: `MYCLI_TOKEN` env var bypasses keychain

## Files involved

| File | Action |
|------|--------|
| `src/main.ts` | Update: top-level error boundary, `--version` from package.json |
| `src/lib/errors.ts` | Create: `CLIError`, `AuthError`, `NetworkError`, `UsageError`, `formatError` |
| `src/lib/exit-codes.ts` | Create: `EXIT` constants |
| `src/lib/credentials.ts` | Create: `keytar` wrapper — `saveToken`, `loadToken`, `deleteToken` |
| `src/lib/first-run.ts` | Create: `checkFirstRun` |
| `src/commands/auth.ts` | Create/update: `auth login` / `auth logout` |
| `src/commands/completion.ts` | Create: `completion <shell>` command |
| `package.json` | Update: add `keytar` dependency; add completion scripts |

## Common mistakes

**Throwing raw errors with `throw new Error(...)`** — these bypass the exit code system and show stack traces in production. Always throw typed `CLIError` subclasses so the top-level handler can format them correctly.

**Hardcoding the version string** — `program.version("1.0.0")` diverges from `package.json` the moment someone bumps the package without updating the command. Read `package.json` at startup.

**`keytar` without a CI fallback** — CI servers don't have a desktop keychain. If `keytar.getPassword` throws with no fallback, every CI run fails with a cryptic native module error. Always check `process.env.MYCLI_TOKEN` first.

**Completion script that re-runs the CLI on every tab press** — some completion approaches shell out to the CLI to generate suggestions dynamically. This means pressing Tab calls your API. Generate static completions at install time, not at tab-press time.
