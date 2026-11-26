#!/usr/bin/env bash
# =============================================================================
#  AZOLVE CHAT - backup
#
#  Produces one timestamped directory containing:
#    azolve-data.tar.gz   the whole /data volume (SQLite database + uploads)
#    snapshots.sql        a pg_dump of the encrypted snapshot table
#    MANIFEST.txt         sizes and SHA-256 so the client can verify the copy
#
#  Schedule this nightly from cron on the host:
#    0 2 * * *  /opt/azolve/deploy/scripts/backup.sh >> /var/log/azolve-backup.log 2>&1
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR:-./backups}/$STAMP"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"

echo "[backup] $STAMP -> $DEST"

# --- 1. the data volume ------------------------------------------------------
# A throwaway container mounts the named volume read-only. Copying the SQLite
# file while the app is writing is safe because the app runs in WAL mode and
# the -wal/-shm files are captured alongside it.
docker run --rm \
  -v azolve-chat_azolve-data:/data:ro \
  -v "$(cd "$DEST" && pwd)":/backup \
  alpine:3.20 \
  tar czf /backup/azolve-data.tar.gz -C /data .

# --- 2. the snapshot store ---------------------------------------------------
docker compose exec -T db \
  pg_dump -U "${POSTGRES_USER:-azolve}" -d "${POSTGRES_DB:-azolve}" --no-owner \
  > "$DEST/snapshots.sql"

# --- 3. manifest -------------------------------------------------------------
{
  echo "AZOLVE CHAT backup"
  echo "created: $STAMP"
  echo "host:    $(hostname)"
  echo
  ( cd "$DEST" && sha256sum azolve-data.tar.gz snapshots.sql )
  echo
  ( cd "$DEST" && ls -lh azolve-data.tar.gz snapshots.sql )
} > "$DEST/MANIFEST.txt"

cat "$DEST/MANIFEST.txt"

# --- 4. retention ------------------------------------------------------------
if [ -d "${BACKUP_DIR:-./backups}" ]; then
  find "${BACKUP_DIR:-./backups}" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} + || true
fi

echo "[backup] done"
