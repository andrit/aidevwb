#!/usr/bin/env bash
# Register/re-register the workbench MCP bridge with Claude Code.
# Run this if you deleted the claude-auth volume or need to reset MCP config.
#
# Usage: bash infra/scripts/register-mcp.sh

set -euo pipefail

echo "Checking Claude Code container..."
if ! docker ps --format '{{.Names}}' | grep -q '^claude-code$'; then
  echo "Error: claude-code container is not running."
  echo "Start the workbench first: docker compose up -d"
  exit 1
fi

echo "Registering workbench MCP bridge..."
docker exec claude-code claude mcp add workbench \
  -s user \
  -- node /opt/mcp-bridge/index.js

echo ""
echo "Verifying registration..."
docker exec claude-code claude mcp list

echo ""
echo "✓ MCP bridge registered. Start a Claude Code session: make claude"
