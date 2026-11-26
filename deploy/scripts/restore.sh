#!/usr/bin/env bash
# =============================================================================
#  AZOLVE CHAT - restore
#
#  Usage:  ./scripts/restore.sh ./backups/20261120T020000Z
#
#  Stops the application, replaces the data volume contents, restores the
#  snapshot store, and starts the application again. This is destructive: the
#  current volume is moved aside rather than deleted, so it can be recovered.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC/azolve-data.tar.gz" ]; then
  echo "usage: $0 <backup-directory>" >&2
  echo "       (must contain azolve-data.tar.gz)" >&2
  exit 1
fi

echo "[restore] verifying checksums"
( cd "$SRC" && sha256sum -c <(grep -E '^[0-9a-f]{64}  ' MANIFEST.txt) ) || {
  echo "[restore] checksum mismatch - refusing to continue" >&2
  exit 1
}

echo "[restore] stopping the application"
docker compose stop app

echo "[restore] moving the current volume aside"
docker run --rm \
  -v azolve-chat_azolve-data:/data \
  -v "$(cd "$SRC" && pwd)":/backup \
  alpine:3.20 \
  sh -c 'mkdir -p /data/.previous && mv /data/azolve.db /data/azolve.db-wal /data/azolve.db-shm /data/uploads /data/.previous/ 2>/dev/null || true'

echo "[restore] unpacking $SRC/azolve-data.tar.gz"
docker run --rm \
  -v azolve-chat_azolve-data:/data \
  -v "$(cd "$SRC" && pwd)":/backup \
  alpine:3.20 \
  tar xzf /backup/azolve-data.tar.gz -C /data

if [ -f "$SRC/snapshots.sql" ]; then
  echo "[restore] restoring the snapshot store"
  docker compose exec -T db \
    psql -U "${POSTGRES_USER:-azolve}" -d "${POSTGRES_DB:-azolve}" < "$SRC/snapshots.sql" || \
    echo "[restore] warning: snapshot restore reported errors (the live database is what matters)"
fi

echo "[restore] starting the application"
docker compose start app

echo "[restore] waiting for health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:${HTTP_PORT:-80}/healthz >/dev/null 2>&1; then
    echo "[restore] healthy"
    exit 0
  fi
  sleep 2
done

echo "[restore] did not become healthy - check: docker compose logs app" >&2
exit 1
