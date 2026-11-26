# syntax=docker/dockerfile:1.7
# =============================================================================
#  AZOLVE CHAT — hardened image for on-premises / sovereign deployment
#  (Government of Dubai, ministry or authority data centre)
#
#  Two stages:
#    build    installs dependencies and compiles the React bundle
#    runtime  contains only what is needed to serve traffic
#
#  Deliberate choices for a government deployment:
#    * runs as the unprivileged `node` user (uid 1000), never root
#    * no build toolchain, no npm cache and no source maps in the final image
#    * dumb-init as PID 1 so SIGTERM from `docker stop` is forwarded to Node
#      and in-flight WebSocket connections close cleanly instead of being killed
#    * every secret arrives at run time from the environment — nothing is baked
#      into a layer, so the image can be handed over as a signed artefact
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — build the web client
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies first: this layer is cached and only invalidated when the
# lockfile changes, which keeps rebuilds during acceptance testing fast.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# `npm run build` is `cd web && vite build`, so the whole tree is needed.
COPY . .

# Vite writes to web/dist. Fail the build loudly if it produced nothing —
# a silent empty bundle is far harder to diagnose inside a running container.
RUN npm run build \
 && test -f web/dist/index.html \
 && echo "[build] web/dist/index.html present"

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# dumb-init: correct signal handling. ca-certificates: outbound TLS to the
# government SMTP relay and any approved AI endpoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Runtime dependencies only. Note: this project keeps its build tools in
# "dependencies" rather than "devDependencies", so --omit=dev does not shrink
# the tree much; correctness is preferred over a few megabytes here.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Compiled client + server source only. No tests, no scripts, no mobile/, no
# .git — the smaller the surface, the smaller the audit.
COPY --from=build /app/web/dist ./web/dist
COPY server ./server

# /data holds azolve.db (SQLite) and uploads/. It is a mounted volume in every
# supported deployment; creating it here just makes the image runnable alone.
RUN mkdir -p /data/uploads \
 && chown -R node:node /data /app

USER node

EXPOSE 3000

# Liveness: the same endpoint an external load balancer should poll.
# Uses Node's built-in fetch so curl is not required in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/index.js"]
