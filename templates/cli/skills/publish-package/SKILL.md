---
name: publish-package
description: Publish a CLI tool to npm (Node.js) or PyPI (Python) — version bump, changelog, pre-publish checks, publish command, and verify the published package installs and works
domain: cli
type: cli
triggers:
  - "publish package"
  - "publish to npm"
  - "publish to PyPI"
  - "release"
  - "version bump"
  - "ship the CLI"
  - "distribute"
  - "npm publish"
  - "pip install"
  - "release automation"
---

# Publish a Package

## When to use

When a CLI tool is ready to share — either internally via a private registry or publicly via npm/PyPI. Activate when the user says "publish to npm", "release a new version", "how do I ship this", or "version bump."

## Prerequisites

- CLI tool working with tests passing
- npm account (for npm) or PyPI account (for PyPI)
- `git` clean working tree (no uncommitted changes)
- `CHANGELOG.md` started (even if it just has one entry)

## Semantic Versioning (semver)

Every version bump is one of three types:

```
MAJOR (1.0.0 → 2.0.0): breaking change — users must update their code
MINOR (1.0.0 → 1.1.0): new feature, backwards-compatible
PATCH (1.0.0 → 1.0.1): bug fix, backwards-compatible

Rules:
- Never skip a level without reason
- A breaking change MUST be a MAJOR bump
- A new flag or command is MINOR
- A documentation fix is PATCH
- Pre-release: 1.0.0-beta.1, 1.0.0-rc.1
```

**Before 1.0.0**: `0.x.y` means anything can break. Once you publish 1.0.0, you're making a stability commitment.

## Node.js / npm

### 1. Configure package.json for publishing

```json
{
  "name": "@myorg/mytool",
  "version": "1.0.0",
  "description": "My development tool",
  "bin": {
    "mytool": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist/**/*",
    "README.md",
    "CHANGELOG.md"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build":         "tsc",
    "test":          "vitest run",
    "prepublishOnly": "npm run build && npm test",
    "version":       "npm run build && git add -A dist"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Key fields:
- `bin` — maps command name to the entry point. This is what creates the `mytool` command after `npm install -g`
- `files` — only these files are included in the published package. Keep it small; don't ship `src/`, `tests/`, or dev configs
- `prepublishOnly` — runs automatically before every `npm publish`. It builds and tests — publish only succeeds if both pass
- `engines.node` — documents the minimum Node.js version you've tested against

### 2. Add the shebang and make the entry point executable

```typescript
// src/cli.ts — first line must be the shebang
#!/usr/bin/env node

import { program } from "commander";
// ... rest of CLI setup
```

Make the compiled file executable (add to build script or `prepublishOnly`):

```bash
chmod +x dist/cli.js
```

Or add to `package.json`:

```json
"scripts": {
  "build": "tsc && chmod +x dist/cli.js"
}
```

### 3. Pre-publish checklist (run manually before every release)

```bash
# 1. Tests pass
npm test

# 2. Build is current
npm run build

# 3. Check what will be published (dry run)
npm publish --dry-run
# Review: only dist/ and docs should appear

# 4. Check the binary works from the built output
node dist/cli.js --help
node dist/cli.js --version

# 5. Verify no secrets in the package
npm publish --dry-run 2>&1 | grep -i "token\|secret\|password\|key"
# Should return nothing

# 6. Check package size
npm publish --dry-run 2>&1 | grep "package size"
# Rule of thumb: > 1MB is usually shipping too much
```

### 4. Version bump and publish

```bash
# Bump version (updates package.json, creates git tag, runs build+test via prepublishOnly)
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# Publish to npm
npm publish

# Push the version commit and tag
git push && git push --tags
```

`npm version` does three things atomically: updates `package.json`, commits the change, and creates a git tag. The `prepublishOnly` hook runs during `npm publish` to ensure tests pass before the package hits the registry.

### 5. Verify the published package

```bash
# Install in a clean temp directory
cd /tmp && mkdir verify-publish && cd verify-publish
npm install @myorg/mytool@1.0.1

# Test the installed binary
npx mytool --version
npx mytool --help
npx mytool <a real command>
```

Always verify in a clean environment — your dev environment may have the package symlinked and mask install problems.

## Python / PyPI

### 1. Configure pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mytool"
version = "1.0.0"
description = "My development tool"
readme = "README.md"
requires-python = ">=3.11"
license = { text = "MIT" }
authors = [{ name = "Your Name", email = "you@example.com" }]
dependencies = [
  "click>=8.0",
  "pydantic>=2.0",
]

[project.scripts]
mytool = "mytool.cli:cli"   # creates the `mytool` command

[project.urls]
Homepage = "https://github.com/yourorg/mytool"
Changelog = "https://github.com/yourorg/mytool/blob/main/CHANGELOG.md"

[tool.hatch.build.targets.wheel]
packages = ["src/mytool"]   # only ship the package, not tests/docs
```

### 2. Pre-publish checklist

```bash
# 1. Tests pass
python -m pytest

# 2. Build the distribution
pip install build
python -m build
# Creates dist/mytool-1.0.0.tar.gz and dist/mytool-1.0.0-py3-none-any.whl

# 3. Check what's in the wheel
pip install wheel
python -m zipfile -l dist/mytool-1.0.0-py3-none-any.whl
# Should contain only src/mytool/**

# 4. Check for secrets
grep -r "token\|password\|secret" dist/ --include="*.py"
# Should return nothing

# 5. Validate package metadata
pip install twine
twine check dist/*
# Should say "PASSED"
```

### 3. Version bump and publish

Update `pyproject.toml` manually (or use `bump2version`):

```bash
# Option A: manual
sed -i 's/version = "1.0.0"/version = "1.0.1"/' pyproject.toml
git add pyproject.toml
git commit -m "chore: bump version to 1.0.1"
git tag v1.0.1

# Option B: bump2version (automated)
pip install bump2version
bump2version patch   # patch/minor/major

# Publish to Test PyPI first (always)
twine upload --repository testpypi dist/*

# Test the TestPyPI installation
pip install --index-url https://test.pypi.org/simple/ mytool==1.0.1
mytool --help

# If it works, publish to real PyPI
twine upload dist/*
git push && git push --tags
```

Always publish to TestPyPI first. A malformed package or wrong metadata on the real PyPI is hard to undo (PyPI doesn't allow replacing or deleting a release).

### 4. Verify the published package

```bash
# In a fresh virtual environment
python -m venv /tmp/verify-env
source /tmp/verify-env/bin/activate
pip install mytool==1.0.1

mytool --version
mytool --help
mytool <a real command>
deactivate
```

## Changelog Convention

Update `CHANGELOG.md` before every release. Follow Keep a Changelog format:

```markdown
# Changelog

## [Unreleased]
- Nothing yet

## [1.0.1] - 2025-01-15
### Fixed
- Config file not found when running from subdirectory (#23)
- `--timeout` flag now correctly overrides config file value

## [1.0.0] - 2025-01-01
### Added
- `build` command with `--out-dir` and `--minify` flags
- `config init` and `config show` subcommands
- Configuration file discovery (.mytoolrc, .mytoolrc.json)

## Format rules:
# Unreleased: changes in progress
# Added: new features
# Changed: changes to existing features
# Deprecated: features being removed in a future version
# Removed: features removed this release
# Fixed: bug fixes
# Security: security fixes
```

## Automating with GitHub Actions

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - run: npm ci
      - run: npm test
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

This triggers on any `v*` tag push — so the workflow is: bump version locally, push the tag, CI publishes.

## Checklist

- [ ] `bin` field (npm) or `[project.scripts]` (PyPI) creates the correct command name
- [ ] `files` / `hatch build targets` excludes tests, dev configs, and source (ships only dist)
- [ ] `prepublishOnly` (npm) or equivalent ensures build + tests pass before publish
- [ ] Shebang `#!/usr/bin/env node` on entry point (Node.js)
- [ ] `CHANGELOG.md` updated with this release's changes
- [ ] Dry run reviewed — only expected files included, package size reasonable
- [ ] Published to TestPyPI first (Python only)
- [ ] Verified in a clean install environment (not dev symlink)
- [ ] Git tag pushed after publish
- [ ] Version in `package.json`/`pyproject.toml` matches git tag

## Files involved

| File | Action |
|------|--------|
| `package.json` | Update: `bin`, `files`, `engines`, `prepublishOnly`, `version` |
| `src/cli.ts` | Update: add `#!/usr/bin/env node` shebang |
| `pyproject.toml` | Create/update: `[project.scripts]`, `version`, `requires-python` |
| `CHANGELOG.md` | Update: add release entry before every publish |
| `.github/workflows/publish.yml` | Create (optional): tag-triggered CI publish |

## Common mistakes

**Publishing from a dirty git tree** — if you have uncommitted changes when you publish, the published package and the git tag don't match. Users can't reproduce the published version from the tag. Require a clean tree before any publish.

**Missing shebang on Node CLI** — without `#!/usr/bin/env node`, the installed binary runs as a shell script and fails with a parse error on macOS/Linux. The shebang is required.

**`files` too broad** — `"files": ["."]` ships your entire repo including `node_modules` (if present), test files, and dev configs. Always specify exactly what you want: `["dist/**/*", "README.md", "CHANGELOG.md"]`.

**Not testing the installed package** — your dev environment has the package symlinked via `npm link` or `pip install -e .`. A problem with the `bin` field or missing `dist/` file only shows up in a clean install. Always verify in a fresh environment.

**Forgetting to push the tag** — `npm version` creates a local git tag. `git push` doesn't push tags by default. Run `git push --tags` explicitly, or the GitHub Actions publish workflow won't trigger.
