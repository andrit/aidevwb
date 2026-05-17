#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Restore the workbench database from a backup dump.         ║
# ║  Run this after spinning up on a new machine.               ║
# ║                                                              ║
# ║  Usage: make restore                                        ║
# ║         make restore BACKUP=backups/workbench-20260513.sql.gz║
# ║         bash infra/scripts/restore.sh [backup_file]         ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"

# Determine which backup to restore
BACKUP_FILE="${1:-$BACKUP_DIR/latest.sql.gz}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  echo ""
  if [ -d "$BACKUP_DIR" ]; then
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  (none)"
  else
    echo "No backups directory found. Run 'make backup' on your source machine first."
  fi
  exit 1
fi

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q '^supabase-db$'; then
  echo "Error: supabase-db container is not running."
  echo "Start the workbench first: docker compose up -d"
  exit 1
fi

BACKUP_NAME=$(basename "$BACKUP_FILE")
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo "▸ Restoring from: $BACKUP_NAME ($SIZE)"
echo ""
echo "  ⚠  This will DROP and recreate all workbench tables."
echo "     Supabase system tables (auth, storage) are untouched."
echo ""
read -p "  Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "▸ Restoring..."

# Decompress and pipe into psql inside the container
gunzip -c "$BACKUP_FILE" | docker exec -i supabase-db psql -U postgres -d postgres --quiet 2>&1 \
  | grep -v "^SET$" \
  | grep -v "^$" \
  | head -20

echo "✓ Restore complete."
echo ""

# Quick verification
DOC_COUNT=$(docker exec supabase-db psql -U postgres -d postgres -t -c \
  "SELECT count(*) FROM documents;" 2>/dev/null | xargs)
CHUNK_COUNT=$(docker exec supabase-db psql -U postgres -d postgres -t -c \
  "SELECT count(*) FROM document_chunks;" 2>/dev/null | xargs)

echo "  Documents: ${DOC_COUNT:-0}"
echo "  Chunks:    ${CHUNK_COUNT:-0}"
echo ""
echo "  Verify with: make status"
