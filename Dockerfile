# AZOLVE CHAT — single-image deployment (API + built web app)
# node:sqlite is built in from Node 22, so no native build tools are needed.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/var/data

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Build the React app into web/dist
COPY . .
RUN npm run build

# The database and uploads live on a mounted volume in production.
RUN mkdir -p /var/data/uploads

EXPOSE 3000

# Simple liveness probe against the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
