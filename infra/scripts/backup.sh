#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Backup the workbench database to a portable SQL dump.      ║
# ║  The dump file lives in the repo so it travels with you.    ║
# ║                                                              ║
# ║  Usage: make backup                                         ║
# ║         bash infra/scripts/backup.sh                        ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/workbench-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q '^supabase-db$'; then
  echo "Error: supabase-db container is not running."
  echo "Start the workbench first: docker compose up -d"
  exit 1
fi

echo "▸ Backing up database..."

# pg_dump inside the container, gzip, write to host
docker exec supabase-db pg_dump \
  -U postgres \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  -T '_realtime*' \
  -T 'auth.*' \
  -T 'storage.*' \
  -T 'supabase_*' \
  postgres \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✓ Backup complete: backups/workbench-${TIMESTAMP}.sql.gz (${SIZE})"

# Keep a latest symlink for easy restore
ln -sf "workbench-${TIMESTAMP}.sql.gz" "$BACKUP_DIR/latest.sql.gz"
echo "  Symlink: backups/latest.sql.gz → workbench-${TIMESTAMP}.sql.gz"
echo ""
echo "  This file contains: documents, chunks, embeddings, and all RAG data."
echo "  It travels with your repo. Restore on a new machine with:"
echo "    make restore"
