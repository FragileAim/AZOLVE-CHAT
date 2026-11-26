#!/usr/bin/env bash
# =============================================================================
#  AZOLVE CHAT - one-time environment bootstrap
#
#  Creates .env from .env.example and fills every secret with a fresh random
#  value. Run this once per deployment; running it again never overwrites an
#  existing .env, because regenerating JWT_SECRET would sign every user out and
#  regenerating SNAPSHOT_KEY would make existing backups unreadable.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "  .env already exists - leaving it untouched."
  echo "  Delete it deliberately if you really want new secrets."
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "  openssl is required to generate secrets." >&2
  exit 1
fi

rand_hex() { openssl rand -hex "${1:-32}"; }

cp .env.example .env

# Portable in-place edit (GNU and BSD sed disagree about -i).
set_key() {
  local key="$1" value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" k "=" { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env > "$tmp"
  mv "$tmp" .env
}

JWT_SECRET="$(rand_hex 48)"
SNAPSHOT_KEY="$(rand_hex 32)"
PG_PASS="$(rand_hex 24)"
TURN_SECRET="$(rand_hex 32)"

set_key JWT_SECRET          "$JWT_SECRET"
set_key SNAPSHOT_KEY        "$SNAPSHOT_KEY"
set_key POSTGRES_PASSWORD   "$PG_PASS"
set_key TURN_STATIC_AUTH_SECRET "$TURN_SECRET"
set_key SNAPSHOT_PG_URL     "postgres://azolve:${PG_PASS}@db:5432/azolve"

chmod 600 .env

cat <<EOF

  .env created with fresh secrets (mode 600).

  Generated:
    JWT_SECRET                (signs access tokens)
    SNAPSHOT_KEY              (encrypts database snapshots)
    POSTGRES_PASSWORD         (snapshot store)
    TURN_STATIC_AUTH_SECRET   (WebRTC relay credentials)

  Still to fill in by hand:
    PUBLIC_BASE_URL           the https:// address users will open
    ADMIN_EMAILS              the first administrator's email
    SMTP_*                    the government mail relay
    TURN_EXTERNAL_IP          only if the host sits behind 1:1 NAT

  Then:
    ./scripts/issue-cert.sh   # or drop your own certs into ./certs
    docker compose up -d --build

  If you will run with --profile offline-ai (recommended for a sovereign
  deployment), also download the models while this host still has internet:
    docker compose --profile offline-ai up -d
    ./scripts/fetch-models.sh

EOF
