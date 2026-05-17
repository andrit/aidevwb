# CLI Tool — Reference Guide

## Design Principles

### Composability
CLI tools should do one thing well and work with pipes. Accept stdin, emit to stdout, errors to stderr. Exit code 0 for success, non-zero for failure.

### User Feedback
Show progress for long operations. Use `--verbose` or `-v` for detailed output, quiet by default. Color output for terminals, plain for pipes (detect with `process.stdout.isTTY`).

### Argument Parsing
Use a library (commander, yargs, clap, cobra) rather than manual parsing. Support `--long-flags` and `-s` short flags. Required arguments are positional, optional ones are flags.

## Common Patterns

### Subcommands
```
mytool init        — set up a new project
mytool build       — compile/bundle
mytool test        — run tests
mytool deploy      — ship to production
```

### Configuration Hierarchy
1. Command-line flags (highest priority)
2. Environment variables
3. Project config file (.mytoolrc, mytool.config.js)
4. User config (~/.config/mytool/config.json)
5. Defaults (lowest priority)

### Testing CLIs
Test the core logic as pure functions (no CLI framework). Test the CLI integration by spawning the process and asserting on stdout/stderr/exit code. Use fixtures for file-based tests.

## Directory Structure
```
src/
├── cli.ts          — argument parsing, command routing
├── commands/       — one file per subcommand
├── lib/            — core logic (pure, testable)
└── __tests__/
    ├── lib/        — unit tests for core logic
    └── cli/        — integration tests (spawn process)
```
