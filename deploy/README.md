# AZOLVE CHAT — Sovereign On-Premises Deployment

This directory is a complete, self-contained deployment of AZOLVE CHAT for a
Government of Dubai tenant. It runs entirely on infrastructure you control.
Nothing in the message path leaves the host unless you deliberately enable an
external service.

It is written to be handed to an infrastructure team that has never seen this
application before, and to be defensible in a security review.

---

## 1. What gets deployed

| Service | Image | Purpose |
|---|---|---|
| `edge` | `nginx:1.27-alpine` | TLS termination, HTTP→HTTPS redirect, WebSocket upgrade, request rate limiting, security headers |
| `app` | built from `./Dockerfile` | The Node application: REST API, Socket.IO realtime, and the compiled web client |
| `db` | `postgres:16-alpine` | Durable store for **encrypted database snapshots** |
| `turn` | `coturn/coturn:4.6.3-alpine` | WebRTC relay — required for voice/video calls on du and Etisalat mobile networks |
| `ai` | `ollama/ollama` | Optional. Local LLM for AZOLVE AI. Profile `offline-ai` |
| `translate` | `libretranslate/libretranslate` | Optional. Local translation engine. Profile `offline-ai` |

### An important architectural note, stated plainly

The live database is **SQLite**, inside the `azolve-data` volume. PostgreSQL is
**not** the live database. It holds a compressed, AES-256-GCM-encrypted snapshot
of the SQLite file, written every `SNAPSHOT_EVERY` seconds.

This is deliberate and it is how the application actually works. Presenting
PostgreSQL as the primary store would be a fiction that fails the first time
someone opens `psql` expecting to find tables of users and messages. What the
PostgreSQL instance buys you is genuine: if the volume is lost or corrupted, the
application restores itself from the encrypted snapshot on boot, and the worst
case is a few seconds of lost messages rather than a lost tenant.

If your security review requires a relational primary database, that is a
different piece of work and should be scoped separately. It is not a
configuration change.

---

## 2. Prerequisites

On the target host:

- Docker Engine 24 or newer, with the Compose v2 plugin (`docker compose version`)
- 4 vCPU, 8 GB RAM, 100 GB SSD as a sensible starting point for a few thousand users
- A DNS record for the service hostname pointing at this host
- Outbound access on port 587 (or 25) to the government SMTP relay
- Inbound access on the ports listed in §7

`openssl` is required on the host for secret and certificate generation. It is
present on every standard Linux distribution.

You do **not** need Node.js, npm, or any build tooling on the host. The
application is compiled inside the Docker build.

---

## 3. First deployment

### 3.1 Generate secrets

```bash
cd deploy
./init.sh
```

This copies `.env.example` to `.env` and fills in four secrets with fresh
random values:

- `JWT_SECRET` — signs access tokens
- `SNAPSHOT_KEY` — encrypts the database snapshots
- `POSTGRES_PASSWORD` — the snapshot store
- `TURN_STATIC_AUTH_SECRET` — mints short-lived WebRTC relay credentials

It also derives `SNAPSHOT_PG_URL` from the generated password, and sets the file
mode to `600`.

`init.sh` **refuses to overwrite an existing `.env`**. This is intentional.
Regenerating `JWT_SECRET` signs every user out; regenerating `SNAPSHOT_KEY`
makes every existing backup permanently unreadable. If you genuinely need new
secrets, delete `.env` deliberately and understand the consequences first.

### 3.2 Fill in the site-specific values

Open `.env` and set at minimum:

```ini
PUBLIC_BASE_URL=https://chat.yourdomain.gov.ae
ADMIN_EMAILS=first.admin@yourdomain.gov.ae
SMTP_HOST=mail.yourdomain.gov.ae
SMTP_USER=<relay account>
SMTP_PASS=<relay password>
EMAIL_FROM=no-reply@chat.yourdomain.gov.ae
TURN_REALM=yourdomain.gov.ae
TURN_URL=turn:chat.yourdomain.gov.ae:3478?transport=udp,turn:chat.yourdomain.gov.ae:3478?transport=tcp
```

`PUBLIC_BASE_URL` must match the certificate exactly. It is used in OTP emails,
OAuth redirects, and the Android App Link.

Leave `SEED_DEMO` unset or `0`. Leave `OTP_DEV_ECHO` blank. Both are testing
switches; `SEED_DEMO=1` would place sample users in a government database, and
`OTP_DEV_ECHO=1` would return one-time codes in API responses.

### 3.3 Install the TLS certificate

Preferred path — a certificate from the authority's own CA:

```bash
./scripts/issue-cert.sh csr
```

Send `certs/chat.csr` to the certificate team. When the signed certificate and
its issuing chain come back, concatenate them (leaf certificate first, then the
chain) into `certs/fullchain.pem`, copy `certs/chat.key` to `certs/privkey.pem`,
then verify:

```bash
./scripts/issue-cert.sh check
```

`check` confirms the key and certificate belong together, that the certificate
has not expired, and that it actually lists your hostname in
`subjectAltName`. That last check matters: a certificate that does not cover the
hostname produces a blank screen in the mobile app with no useful error.

If you already have certificate files from elsewhere, drop them into `certs/` as
`fullchain.pem` and `privkey.pem` and run `check`.

For an acceptance demonstration before the CA has issued anything:

```bash
./scripts/issue-cert.sh self
```

This creates a self-signed certificate valid for 825 days. Browsers and the
mobile app will show a trust warning. It is for proving the stack works, not for
serving users.

### 3.4 Start the stack

```bash
docker compose up -d --build
```

The first build takes several minutes: it installs dependencies and compiles the
web client inside the image. Subsequent builds reuse the layer cache.

Watch it come up:

```bash
docker compose ps
docker compose logs -f app
```

`app` will not report healthy until the database is reachable and the HTTP
listener answers `/api/health`. `edge` waits for `app` to be healthy before
starting, so the proxy never serves a half-initialised backend.

### 3.5 Verify

```bash
curl -sk https://localhost/healthz                 # -> ok
curl -sk https://localhost/api/health              # -> {"ok":true,...}
curl -sk https://localhost/api/health/persist      # snapshot backend status
```

Then open `PUBLIC_BASE_URL` in a browser. Register the first account using the
address in `ADMIN_EMAILS`. With `FIRST_USER_IS_ADMIN=1` that account becomes the
administrator.

---

## 4. Fully air-gapped mode (offline AI)

By default the application expects a translation provider and an AI provider. If
message content must never leave the jurisdiction — which is the normal
requirement for a government tenant — enable the bundled offline services:

```bash
docker compose --profile offline-ai up -d
```

This starts Ollama and LibreTranslate on the `internal` network. They have **no
route to the internet**: the `internal` bridge is declared `internal: true`, so
containers on it cannot reach anything outside the host.

Then set in `.env`:

```ini
TRANSLATION_PROVIDER=libre
LIBRE_TRANSLATE_URL=http://translate:5000
OLLAMA_URL=http://ai:11434
OLLAMA_MODEL=llama3.1
```

and restart the app:

```bash
docker compose up -d app
```

### Downloading the models before you disconnect

This step matters and is easy to get wrong. The `ai` and `translate` containers
run on the `internal` network, which has **no route to the internet**. That is
the whole point of it — but it also means `docker compose exec ai ollama pull
llama3.1` will fail, because the pull itself needs egress. The container is
correctly sealed; the command is simply the wrong tool.

Use the bootstrap script instead. It starts throwaway containers on the normal
bridge network (which does have egress), mounts the **same named volumes** the
real services use, downloads the models, and exits:

```bash
docker compose --profile offline-ai up -d     # creates the volumes
./scripts/fetch-models.sh                     # downloads into them
```

It reads `OLLAMA_MODEL` from `.env` so the two cannot drift apart. You can also
pass a specific model, or fetch only one of the two:

```bash
./scripts/fetch-models.sh llama3.1:8b
./scripts/fetch-models.sh --ai-only
./scripts/fetch-models.sh --translate-only
```

Once the models are cached in the volumes, the host can be disconnected from the
internet entirely and the application continues to translate and answer AI
queries locally. The services themselves never had egress at any point.

Expect the first translation request for a language pair to be slow while
LibreTranslate loads its model into memory; subsequent requests are fast.

If you would rather not download twice, back up the two model volumes after
fetching — `fetch-models.sh` prints the exact `tar` command at the end.

If you leave `TRANSLATION_PROVIDER` pointing at a hosted provider, translated
message text leaves the country. That is a decision for the data owner, not a
technical default.

---

## 5. What is genuinely sovereign, and what is not

Being precise about this is more useful than a blanket claim.

**Fully inside your perimeter:**

- User accounts, profiles, contacts, conversations, messages, media uploads
- The SQLite database and its encrypted snapshots
- Authentication, sessions, OTP issuance and verification
- Translation and AI, when `--profile offline-ai` is used
- Voice and video call signalling and media relay (coturn)
- The web client and the mobile app shell
- Audit trail and the admin dashboard

**External, and must be approved or disabled:**

- **Push notifications (Firebase Cloud Messaging).** Google operates FCM
  outside the UAE. If `FIREBASE_*` is left blank, push is disabled and the
  application falls back to in-app notifications. For most government tenants
  this is the correct choice unless FCM has been explicitly approved.
- **Google and Apple sign-in.** Both are third-party identity providers. If
  `GOOGLE_CLIENT_ID` and `APPLE_*` are left blank, the SSO buttons are hidden
  entirely and users authenticate with email or phone OTP only. This is the
  usual configuration for a government tenant.
- **Hosted translation or AI providers.** Avoided entirely by using
  `--profile offline-ai`.
- **Public STUN servers.** `STUN_URLS` defaults to a Google STUN server. It is
  only used for NAT discovery and carries no message content, but for a strict
  deployment point it at an internal STUN service or remove it and rely on
  coturn alone.

---

## 6. Operations

### Backups

```bash
./scripts/backup.sh
```

Creates `backups/<timestamp>/` containing:

- `azolve-data.tar.gz` — the full data volume (database plus uploaded media)
- `snapshots.sql` — a `pg_dump` of the encrypted snapshot store
- `MANIFEST.txt` — SHA-256 checksums and file sizes

Retention is controlled by `KEEP_DAYS` (default 14):

```bash
KEEP_DAYS=30 ./scripts/backup.sh
```

A nightly cron entry is the normal arrangement:

```cron
15 2 * * * cd /opt/azolve/deploy && ./scripts/backup.sh >> /var/log/azolve-backup.log 2>&1
```

Copy the `backups/` directory off the host. A backup that lives only on the
machine it protects is not a backup.

### Restore

```bash
./scripts/restore.sh backups/20261126-021500
```

The script verifies every checksum against the manifest and refuses to proceed
on a mismatch — a corrupted backup restored silently is worse than a failed
restore. It then stops the app, moves the current volume contents into
`/data/.previous/` so the previous state remains recoverable, unpacks the
backup, restores the snapshot store, restarts, and polls `/healthz` until the
service answers.

### Upgrading

```bash
git pull
docker compose build app
docker compose up -d app
```

The data volume is untouched by a rebuild. Because the snapshot loop runs
continuously, an upgrade that goes wrong can be rolled back by restoring the
most recent backup.

To pin a version explicitly, set `APP_VERSION` in `.env`; it becomes the image
tag.

### Logs

```bash
docker compose logs -f app          # application
docker compose logs -f edge         # access log, TLS errors
docker compose logs -f turn         # relay allocation failures
```

Log rotation is configured on every service: 20 MB per file, 5 files retained.

---

## 7. Firewall and port table

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 80 | TCP | anywhere | HTTP→HTTPS redirect only; also serves `/healthz` for load balancer probes |
| 443 | TCP | anywhere | The application (HTTPS and WebSocket) |
| 3478 | UDP and TCP | anywhere | coturn STUN/TURN |
| 49160–49200 | UDP | anywhere | coturn media relay range |

Ports 3000 (app), 5432 (PostgreSQL), 11434 (Ollama) and 5000 (LibreTranslate)
are **never** published to the host. They are reachable only from other
containers on the Compose networks.

If the host sits behind 1:1 NAT, set `TURN_EXTERNAL_IP` to the public address so
coturn advertises the correct relay candidate. Without it, calls connect but
carry no audio.

---

## 8. Security posture

What the package does by default:

- The application runs as the unprivileged `node` user, never as root
- `cap_drop: ALL` on the application container — it needs no Linux capabilities
- `no-new-privileges:true` on every service
- PostgreSQL, Ollama and LibreTranslate sit on an `internal` network with no
  internet route
- coturn is configured with `--denied-peer-ip` for all RFC1918 ranges, loopback
  and link-local, so a malicious client cannot use the relay to reach the
  authority's internal network
- `server_tokens off` — nginx does not advertise its version
- HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and a CSP baseline on every response
- TLS 1.2 and 1.3 only, with a modern cipher list and OCSP stapling
- Authentication endpoints are rate limited to 10 requests per minute per IP
  with a burst of 20; the general API to 30 per second with a burst of 60
- Database snapshots are encrypted with AES-256-GCM and gzip-compressed before
  they leave the process
- No secret is ever baked into an image layer — everything arrives at runtime
  through `env_file`

What you should consider adding for a formal review:

- Uncomment `read_only: true` and the `tmpfs` block on the `app` service once a
  clean boot is confirmed. This makes the container filesystem immutable.
- Place the host behind the authority's WAF or reverse proxy if one exists.
- Ship container logs to the central SIEM rather than relying on local rotation.
- Replace the self-signed certificate with an authority-issued one before any
  user touches the system.

### Credential-gated features

Two capabilities need credentials that only the authority can supply, and both
fail visibly rather than silently:

- **Email OTP** requires a working SMTP relay. If `SMTP_*` is unset, the
  application reports that mail delivery is not configured instead of pretending
  to send a code.
- **WebRTC calls** require coturn to be reachable on the ports above. If it is
  not, the application falls back to STUN-only and calls fail between symmetric
  NATs — which, on du and Etisalat, is most of them. The health endpoint reports
  which TURN strategy is active.

---

## 9. Troubleshooting

**`edge` restarts in a loop, logs mention `cannot load certificate`**
`certs/fullchain.pem` or `certs/privkey.pem` is missing or unreadable. Run
`./scripts/issue-cert.sh check`.

**`app` is unhealthy but logs look normal**
Check `docker compose logs db`. The app waits for PostgreSQL before it reports
healthy, even though PostgreSQL is not the live store.

**The web page loads but stays blank**
Almost always a hostname mismatch. The certificate must list the exact hostname
in `PUBLIC_BASE_URL` in `subjectAltName`. Run `./scripts/issue-cert.sh check`
and read the warning.

**Users cannot log in and no email arrives**
`SMTP_HOST`, `SMTP_USER` or `SMTP_PASS` is wrong, or the relay refuses the
sender address in `EMAIL_FROM`. Check `docker compose logs app` for the SMTP
response code.

**Calls connect but there is no audio or video**
coturn is not reachable. Confirm 3478 and 49160–49200 are open in both
directions, and set `TURN_EXTERNAL_IP` if the host is behind NAT.

**`POSTGRES_PASSWORD` error on `docker compose up`**
`.env` was not created. Run `./init.sh`.

**Translations return the original text unchanged**
`TRANSLATION_PROVIDER=libre` is set but the `translate` service is not running.
Start it with `docker compose --profile offline-ai up -d`.

**`ollama pull` fails with a connection or timeout error**
Expected. The `ai` container has no internet route by design. Use
`./scripts/fetch-models.sh`, which downloads through a temporary container that
does have egress and writes into the same volume.

**AI replies are slow or the model is missing after a restart**
The model was pulled into a container's own filesystem instead of the
`azolve-models` volume. Confirm with `docker volume inspect azolve-chat_azolve-models`
and re-run `./scripts/fetch-models.sh`.

---

## 10. File map

```
deploy/
├── Dockerfile              two-stage build; non-root runtime; healthcheck
├── docker-compose.yml      the full stack
├── .env.example            every setting, documented, with a government profile
├── init.sh                 generates .env with fresh secrets; never overwrites
├── nginx/azolve.conf       TLS, WebSocket upgrade, rate limits, security headers
├── certs/                  fullchain.pem + privkey.pem (never committed)
└── scripts/
    ├── issue-cert.sh       self-signed, CSR for the authority CA, or verify
    ├── fetch-models.sh     downloads Ollama + LibreTranslate models with egress,
    │                       into the volumes the sealed services then read
    ├── backup.sh           volume + snapshot dump + checksums + retention
    └── restore.sh          verified restore with a recoverable previous state
```

The build context is the parent directory (`..`), so the Dockerfile compiles the
real application source rather than a copy. `deploy/` itself contains no
application code.
