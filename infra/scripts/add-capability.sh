#!/usr/bin/env bash
# add-capability.sh — merge a capability contract onto an existing project.
#
# Reads templates/<capability>/capability.json (preferred) or falls back to
# project.json. Updates mcp_tools, skills, seed_docs, capabilities[],
# provides[], and consumes[] using union semantics — never removes anything.
#
# Usage:  bash infra/scripts/add-capability.sh <project-name> <capability-type>
# Example: make add-capability NAME=myapp CAPABILITY=rag

set -euo pipefail

NAME="${1:?Usage: add-capability.sh <project-name> <capability-type>}"
CAPABILITY="${2:?Usage: add-capability.sh <project-name> <capability-type>}"
API_PORT="${API_PORT:-3100}"
TEMPLATES_DIR="$(cd "$(dirname "$0")/../../templates" && pwd)"

# ── Locate capability definition ────────────────────────────────────────────
CAP_FILE="$TEMPLATES_DIR/$CAPABILITY/capability.json"
FALLBACK="$TEMPLATES_DIR/$CAPABILITY/project.json"

if [ ! -d "$TEMPLATES_DIR/$CAPABILITY" ]; then
  echo "✗ Unknown capability: '$CAPABILITY'"
  echo "  Available: $(ls "$TEMPLATES_DIR" | grep -v '^_' | tr '\n' ' ')"
  exit 1
fi

if [ -f "$CAP_FILE" ]; then
  SOURCE="$CAP_FILE"
  SOURCE_TYPE="capability.json"
elif [ -f "$FALLBACK" ]; then
  SOURCE="$FALLBACK"
  SOURCE_TYPE="project.json (no capability.json found)"
else
  echo "✗ No capability.json or project.json found in templates/$CAPABILITY/"
  exit 1
fi

# ── Fetch current project config ─────────────────────────────────────────────
echo "▸ Fetching project '$NAME'..."
CURRENT=$(curl -sf "http://localhost:$API_PORT/projects/$NAME") || {
  echo "✗ Project '$NAME' not found. Run 'make list-projects' to see available projects."
  exit 1
}

# ── Merge and PATCH ───────────────────────────────────────────────────────────
echo "▸ Merging capability '$CAPABILITY' (from $SOURCE_TYPE)..."

python3 - "$CURRENT" "$SOURCE" "$NAME" "$CAPABILITY" "$API_PORT" <<'PYEOF'
import sys, json
from urllib.request import urlopen, Request
from urllib.error import HTTPError

current_json, source_path, name, capability, port = \
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

current = json.loads(current_json)
with open(source_path) as f:
    cap = json.load(f)

existing_config = current.get("config") or {}


def union_merge(base: list, overlay: list) -> list:
    """Append items from overlay that aren't already in base (by value)."""
    seen = {json.dumps(i, sort_keys=True) for i in base}
    result = list(base)
    for item in overlay:
        key = json.dumps(item, sort_keys=True)
        if key not in seen:
            result.append(item)
            seen.add(key)
    return result


def deep_merge(base: dict, overlay: dict) -> dict:
    """
    Merge overlay into base.
      - Arrays: union semantics (append new, deduplicate)
      - Dicts:  recurse
      - Scalars: keep base value (overlay never overwrites existing scalars)
    """
    result = dict(base)
    for key, val in overlay.items():
        # capability.json-only fields that drive the merge
        if key in ("name", "description") and key in result:
            continue  # never overwrite the project's name/description
        if key not in result:
            result[key] = val
        elif isinstance(result[key], list) and isinstance(val, list):
            result[key] = union_merge(result[key], val)
        elif isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = deep_merge(result[key], val)
        # else: keep existing scalar
    return result


# Track what changed for the summary
before_tools  = set(existing_config.get("mcp_tools", []))
before_skills = set(existing_config.get("skills", []))
before_caps   = set(existing_config.get("capabilities", []))
before_prov   = set(existing_config.get("provides", []))
before_cons   = set(existing_config.get("consumes", []))

merged = deep_merge(existing_config, cap)

# Always track capability membership
caps = merged.get("capabilities", [])
if capability not in caps:
    caps.append(capability)
merged["capabilities"] = caps

# Compute deltas for output
added_tools  = sorted(set(merged.get("mcp_tools", [])) - before_tools)
added_skills = sorted(set(merged.get("skills", [])) - before_skills)
added_caps   = sorted(set(merged.get("capabilities", [])) - before_caps)
added_prov   = sorted(set(merged.get("provides", [])) - before_prov)
added_cons   = sorted(set(merged.get("consumes", [])) - before_cons)

# Idempotency check — nothing would change
if not added_tools and not added_skills and not added_caps \
        and not added_prov and not added_cons:
    print(f"✓ '{capability}' is already applied to '{name}' — nothing to change.")
    sys.exit(0)

# PATCH
body = json.dumps({"config": merged}).encode()
req = Request(
    f"http://localhost:{port}/projects/{name}/config",
    data=body,
    method="PATCH",
    headers={"Content-Type": "application/json"},
)
try:
    with urlopen(req) as resp:
        resp.read()
except HTTPError as e:
    print(f"✗ PATCH failed: {e.code} {e.read().decode()}")
    sys.exit(1)

# Summary
print(f"✓ Capability '{capability}' added to '{name}'")
print(f"  Capabilities: {', '.join(merged.get('capabilities', []))}")
if added_tools:
    print(f"  + MCP tools:  {', '.join(added_tools)}")
if added_skills:
    print(f"  + Skills:     {', '.join(added_skills)}")
if added_prov:
    print(f"  + Provides:   {', '.join(added_prov)}")
if added_cons:
    print(f"  + Consumes:   {', '.join(added_cons)}")
PYEOF
