#!/usr/bin/env bash
# =============================================================================
#  AZOLVE CHAT - pre-download the offline AI models
#
#  Why this exists:
#    The `ai` (Ollama) and `translate` (LibreTranslate) containers run on the
#    `internal` network, which is declared `internal: true` in
#    docker-compose.yml. That means they have NO route to the internet - which
#    is exactly what you want for a sovereign deployment, but it also means
#    `docker compose exec ai ollama pull ...` cannot work, because the pull
#    itself needs to reach the internet.
#
#  This script solves that cleanly. It starts throwaway containers on the
#  default bridge network (which does have egress), mounts the SAME named
#  volumes the real services use, downloads the models, and exits. The models
#  are then already present when the air-gapped services start, and the
#  services themselves never needed internet access.
#
#  Run this once, on a host that still has internet access, BEFORE the host is
#  disconnected for good. Re-run it any time you want to add a model.
#
#  Usage:
#    ./scripts/fetch-models.sh              # default model from .env
#    ./scripts/fetch-models.sh llama3.1:8b  # a specific model
#    ./scripts/fetch-models.sh --translate-only
#    ./scripts/fetch-models.sh --ai-only
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_PROJECT_NAME:-azolve-chat}"

# Named volumes are prefixed with the compose project name, which comes from
# the `name:` key in docker-compose.yml.
VOL_MODELS="${PROJECT}_azolve-models"
VOL_LT="${PROJECT}_azolve-lt"

DO_AI=1
DO_LT=1
MODEL=""

for arg in "$@"; do
  case "$arg" in
    --ai-only)        DO_LT=0 ;;
    --translate-only) DO_AI=0 ;;
    -h|--help)        sed -n '2,30p' "$0"; exit 0 ;;
    -*)               echo "Unknown option: $arg" >&2; exit 2 ;;
    *)                MODEL="$arg" ;;
  esac
done

# Fall back to the model configured in .env so the two never drift apart.
if [ -z "$MODEL" ] && [ -f .env ]; then
  MODEL="$(grep -E '^OLLAMA_MODEL=' .env | head -1 | cut -d= -f2- || true)"
fi
MODEL="${MODEL:-llama3.1}"

need_volume() {
  if ! docker volume inspect "$1" >/dev/null 2>&1; then
    echo "  Volume $1 does not exist yet."
    echo "  Start the stack once so Compose creates it:"
    echo "    docker compose --profile offline-ai up -d"
    exit 1
  fi
}

if [ "$DO_AI" = 1 ]; then
  need_volume "$VOL_MODELS"
  echo "  Pulling Ollama model: $MODEL"
  echo "  (this can take several minutes and a few GB of disk)"
  # `ollama serve` must be running for `ollama pull` to work, so the pull runs
  # in a shell that starts the server, waits for it, pulls, then exits.
  docker run --rm \
    --network bridge \
    -v "$VOL_MODELS:/root/.ollama" \
    --entrypoint /bin/sh \
    ollama/ollama:latest -c '
      set -e
      ollama serve >/tmp/serve.log 2>&1 &
      pid=$!
      # Wait for the API to answer before asking it to pull anything.
      i=0
      until ollama list >/dev/null 2>&1; do
        i=$((i+1))
        [ "$i" -gt 60 ] && { echo "ollama did not start"; cat /tmp/serve.log; exit 1; }
        sleep 2
      done
      ollama pull "$1"
      echo "--- models now present ---"
      ollama list
      kill $pid 2>/dev/null || true
    ' sh "$MODEL"
fi

if [ "$DO_LT" = 1 ]; then
  need_volume "$VOL_LT"
  echo "  Downloading LibreTranslate language models"
  # LibreTranslate fetches its models on first start. Running it once on the
  # bridge network with the real volume mounted populates the cache, so the
  # air-gapped instance starts instantly and needs no egress.
  docker run --rm \
    --network bridge \
    -v "$VOL_LT:/home/libretranslate/.local" \
    -e LT_LOAD_ONLY="${LT_LOAD_ONLY:-en,ar,hi,ur,fr,tl,ml}" \
    -e LT_UPDATE_MODELS=true \
    -e LT_DISABLE_WEB_UI=true \
    libretranslate/libretranslate:latest \
    --load-only "${LT_LOAD_ONLY:-en,ar,hi,ur,fr,tl,ml}" --update-models &
  LT_PID=$!
  # The container serves forever once models are loaded, so wait for the model
  # files to appear and then stop it. Polling the volume is more reliable than
  # guessing a timeout.
  echo "  waiting for models to land in $VOL_LT ..."
  for _ in $(seq 1 90); do
    sleep 4
    if docker run --rm -v "$VOL_LT:/v:ro" alpine:3 sh -c \
         'find /v -name "*.argosmodel" -o -name "*.db" 2>/dev/null | head -1 | grep -q .' 2>/dev/null; then
      echo "  models present."
      break
    fi
  done
  kill "$LT_PID" 2>/dev/null || true
  wait "$LT_PID" 2>/dev/null || true
  docker stop "$(docker ps -q --filter ancestor=libretranslate/libretranslate:latest)" >/dev/null 2>&1 || true
fi

cat <<EOF

  Done. The models are cached in the named volumes:
    $VOL_MODELS
    $VOL_LT

  You can now start the air-gapped services. They need no internet:
    docker compose --profile offline-ai up -d

  Back up these volumes if you would rather not download again:
    docker run --rm -v $VOL_MODELS:/m:ro -v "\$PWD":/out alpine:3 \\
      tar czf /out/ollama-models.tar.gz -C /m .

EOF
