# AZOLVE CHAT — Deployment Guide

## 1. Requirements

- Node.js **22+** (uses the built-in `node:sqlite` module)
- 1 vCPU / 512 MB RAM minimum for demo scale
- A writable data directory (SQLite database + uploads)
- A reverse proxy (nginx / Caddy / a cloud load balancer) for TLS
- Optional: TURN server for WebRTC behind symmetric NAT

## 2. Environment variables

Copy `.env.example` → `.env`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `JWT_SECRET` | **yes in production** | dev fallback | Signs access tokens |
| `DATA_DIR` | no | `./data` | SQLite file + uploads |
| `OTP_DEMO_MODE` | no | `true` | When `false`, OTPs are not returned by the API (requires an SMS/email integration) |
| `TRANSLATION_PROVIDER` | no | `deepl,google,libre,openai,mymemory,offline` | Ordered provider chain |
| `DEEPL_API_KEY` | no | — | DeepL translation |
| `GOOGLE_TRANSLATE_API_KEY` | no | — | Google Cloud Translation |
| `LIBRE_TRANSLATE_URL` / `LIBRE_TRANSLATE_KEY` | no | — | Self-hosted LibreTranslate |
| `MYMEMORY_EMAIL` | no | — | Raises MyMemory quota |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | no | — / `gpt-4o-mini` | LLM + Whisper transcription |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / `OLLAMA_URL` | no | — | Alternative LLM providers |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | — | Google sign-in |
| `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` | no | — | Apple sign-in |

Never commit `.env`. Rotate `JWT_SECRET` to invalidate every existing session.

## 3. Build and run

```bash
npm ci
npm run build          # outputs web/dist
npm start              # serves API + static frontend on $PORT
```

The server serves `web/dist` and falls back to `index.html` for client routes (excluding `/api`, `/uploads`, `/socket.io`).

### Process management

```bash
# systemd example
[Unit]
Description=AZOLVE CHAT
After=network.target

[Service]
WorkingDirectory=/srv/azolve
EnvironmentFile=/srv/azolve/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
User=azolve

[Install]
WantedBy=multi-user.target
```

Or with PM2: `pm2 start server/index.js --name azolve-chat`.

## 4. Reverse proxy + TLS

```nginx
server {
  listen 443 ssl http2;
  server_name chat.example.com;

  ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

  client_max_body_size 50m;   # media uploads

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # WebSocket upgrade for Socket.IO
  location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
  }
}
```

WebRTC requires HTTPS in production (browsers block `getUserMedia` on plain HTTP origins other than localhost).

## 5. WebRTC in production

The client uses Google's public STUN server. For reliable connectivity add a TURN service:

```js
// web/src/pages/Calls.jsx
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:turn.example.com:3478', username: '...', credentials: '...' },
  ],
};
```

For group calls beyond ~4 participants, replace peer-to-peer mesh with an SFU (LiveKit or mediasoup) and keep the existing Socket.IO signalling contract.

## 6. Scaling path

| Concern | Now | Production |
|---|---|---|
| Database | SQLite WAL, single node | PostgreSQL — port `server/db.js` helpers (`all/get/run/tx`) and DDL |
| Sessions / presence / rate limits | In-process | Redis (shared presence, rate limits, socket adapter) |
| Realtime | Single Socket.IO node | `@socket.io/redis-adapter` + sticky sessions |
| Uploads | Local disk | S3 / GCS / R2; swap the Multer storage engine |
| Media delivery | Express static | CDN in front of object storage |
| Translation | MyMemory + cache | DeepL/Google with the existing cache table |
| AI | local-heuristic | Hosted LLM via env keys |
| Jobs (scheduled messages, moment expiry) | In-process interval | Durable queue (BullMQ) |

The code is already structured for this: routes never touch the DB driver directly, providers are adapters, and all secrets come from env.

## 7. Backups

- Stop writes briefly, or use `sqlite3 data/azolve.db ".backup 'backup.db'"` for a consistent snapshot.
- Back up `data/uploads/` alongside the database.
- In WAL mode also copy `-wal` and `-shm` if you copy files directly.

## 8. Health checks

- `GET /api/health` → `{ ok: true }`
- Admin → Overview → System shows uptime, memory, Node version, DB engine, realtime status.

## 9. First-run checklist

1. Set a strong `JWT_SECRET`.
2. Set `OTP_DEMO_MODE=false` once an SMS/email provider is wired.
3. Configure at least one translation provider and one LLM provider.
4. Put the app behind HTTPS.
5. Add a TURN server for calls.
6. Move uploads to object storage before scaling past one node.
7. Run `npm run seed` only on demo environments — never on production with real users.
