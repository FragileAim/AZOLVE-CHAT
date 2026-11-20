# Deploying AZOLVE CHAT on Render

This answers two things: **how to get a Render API key**, and **which options to
select** when you create the service. There are two different things people mean
by "Render API", so both are covered.

---

## 1. The Render API key (for automation)

An API key lets a script or the Render CLI create services, set env vars and
trigger deploys without clicking. It is **not** required to deploy — the
dashboard does everything the key does. You only need it if you want me (or CI)
to drive Render for you.

**How to get one:**

1. Sign in at <https://dashboard.render.com>.
2. Click your **avatar / workspace name** in the top-right corner.
3. Choose **Account Settings**.
4. In the left sidebar choose **API Keys**.
5. Click **Create API Key**.
6. Give it a name — `azolve-deploy` is fine.
7. Choose an expiry. **No expiration** is convenient; 90 days is safer. You can
   revoke it at any time from the same screen.
8. Click **Create API Key** and **copy the value immediately**. Render shows it
   once and never again. It looks like `rnd_XXXXXXXXXXXXXXXXXXXXXXXXXXXX`.

Store it as `RENDER_API_KEY` — never commit it, never put it in the browser
bundle.

**What the key can do:** everything your user account can do, scoped to the
workspaces you belong to. Treat it like a password.

**Quick check that it works:**

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/owners | jq '.[].owner.name'
```

If you see your workspace name, the key is good.

> There is also a separate **"Render API"** product in some Metered/AI contexts.
> If someone told you "give me the Render API", they almost certainly mean this
> personal API key from Account Settings → API Keys.

---

## 2. Which deployment type to select

### 2.0 The short answer

From the **New +** menu you pasted, click exactly one thing:

> ## ➜ **Web Services → New Web Service**

Then on the create screen set **Language / Runtime = `Docker`** (the repo already
contains a `Dockerfile`), **Region = `Singapore`**, **Instance = `Starter`**, and
add a **Disk** of **1 GB mounted at `/var/data`**.

Everything else in that menu is the wrong product for this app:

| Menu option | Pick it? | Why |
|---|---|---|
| **Static Sites** | ❌ No | Serves only HTML/CSS/JS from a CDN. AZOLVE CHAT needs a running Node process: Express API, Socket.IO for realtime chat + WebRTC signalling, and a SQLite file. A static site has no server, no WebSockets, no database. Login, translation, calls and moments would all be dead. |
| **Web Services** | ✅ **YES** | "Dynamic web app, full-stack apps, API servers, mobile backends." That is literally this project: one Node process that serves the built React app *and* the `/api` + Socket.IO backend. |
| **Private Services** | ❌ No | Same as a Web Service but with **no public URL** — reachable only from your other Render services. Your browser and the Android APK must reach it from the internet, so a private service would be unreachable. |
| **Background Workers** | ❌ No | Long-lived process that consumes a job queue and has no HTTP port. We have no queue. |
| **Cron Jobs** | ❌ No | Runs a script on a schedule and exits. Nothing here is scheduled. |
| **Postgres** | ❌ No | The app stores data in SQLite (`node:sqlite`). Adding Postgres means rewriting the whole data layer. Only needed later if you scale to multiple instances. |
| **Key Value** | ❌ No | Redis-compatible cache. The app has no Redis dependency. |
| **Workflow** | ❌ No | Fan-out task runner. Irrelevant. |
| **Sandbox Group** (Beta) | ❌ No | Ephemeral isolated compute for agent sandboxes. Irrelevant. |

You do **not** need Postgres or Key Value to start. One Web Service + one 1 GB
disk is the whole deployment.

> If **Blueprint** appears in your New + menu (it shows up once a GitHub account
> is connected), that is the one-click alternative — see §2.1.

### 2.1 The blueprint path

AZOLVE CHAT ships with a `render.yaml` blueprint. That file already declares the
web service, the Node runtime, the build and start commands, the health check,
the persistent disk and every environment variable. So the correct choice is:

### ✅ **New → Blueprint** (recommended)

1. Push the repo to GitHub (see §4).
2. Render dashboard → **New +** → **Blueprint**.
3. **Connect** your GitHub account if prompted, then pick the repository.
4. Render reads `render.yaml` and shows a preview: one web service named
   `azolve-chat`, one disk, and the env vars it needs.
5. Fill in the `sync: false` values (those are secrets Render will not invent):
   `GEMINI_API_KEY`, `DEEPL_API_KEY`, `TURN_APP`, `TURN_API_KEY`,
   `TURN_API_SECRET`, `RESEND_API_KEY` (or `SMTP_*`).
6. Click **Apply**.

Render then builds and deploys. First build takes 3–6 minutes.

### ⚠️ New → Web Service (manual, only if you skip the blueprint)

If you would rather click through every field, choose these exact values:

| Field | Value |
| --- | --- |
| **Source** | your GitHub repo |
| **Name** | `azolve-chat` |
| **Region** | **Singapore** (closest to India; also Frankfurt / Oregon) |
| **Branch** | `main` |
| **Root directory** | *(leave blank — the repo root)* |
| **Language / Runtime** | **Node** |
| **Node version** | set env `NODE_VERSION=22.23.4` (see note) |
| **Build command** | `npm install && npm run build` |
| **Start command** | `npm start` |
| **Instance type** | **Starter** (see the warning below) |
| **Health check path** | `/api/health` |
| **Auto-deploy** | **Yes** (redeploys on every push to `main`) |

Then add a **Disk**:

| Disk field | Value |
| --- | --- |
| Name | `azolve-data` |
| Mount path | `/var/data` |
| Size | `1 GB` |

And set `DATA_DIR=/var/data` so SQLite and uploads land on the disk.

**Note on the runtime choice.** AZOLVE CHAT uses Node's built-in `node:sqlite`,
which needs **Node 22.5 or newer**. Render's default Node image is 22.x, so the
**Node** runtime works — but pin it with `NODE_VERSION=22.23.4` so a future
default bump can never break the database driver. If you would rather have a
fully pinned image, set **Language = Docker** instead; the repo's `Dockerfile`
already does `FROM node:22-bookworm-slim`, `npm ci`, `npm run build` and
`CMD node server/index.js`, so no build/start commands are needed in that mode.
Docker builds take ~2 minutes longer.

### Do **not** select

- **Static Site** — this app has a Node server, WebSockets and SQLite. A static
  site cannot run any of it.
- **Private Service** — the browser and the Android APK have to reach it, so it
  must be public.
- **Postgres / Key Value** — not used by this build (SQLite is embedded).

---

## 3. The free-plan trap (read this before you pick Free)

Render's **Free** instance type:

- spins down after 15 minutes idle, so the first request afterwards takes ~50 s
- has **no persistent disk** — `DATA_DIR` is wiped on every deploy and every
  restart, which means **every user, message and moment disappears**
- has 512 MB RAM, which is tight once Socket.IO and SQLite are both warm

For a team test where you can re-register, Free is workable if you accept that
the database resets. For anything real, choose **Starter ($7/month)** plus a
**1 GB disk ($0.25/GB/month)** — about **$7.25/month** total, and the data
survives.

If you stay on Free, at minimum set:

```env
DATA_DIR=/tmp/azolve
```

so it is obvious the data is temporary, and do not tell testers their accounts
are permanent.

---

## 4. Connecting GitHub

1. Create the repo (private is fine): `azolve-chat`.
2. From your machine, inside the project folder:

```bash
git init
git add .
git commit -m "AZOLVE CHAT v1.0.0"
git branch -M main
git remote add origin https://github.com/<your-org>/azolve-chat.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules`, `data/`, `dist/` and the
Android build outputs, so no secret is committed.

**If you want me to push it for you**, I need two things, not one:

1. the **repository URL** (owner/name), and
2. a token with **Contents: Read and write** on that specific repo.

A fine-grained PAT (`github_pat_…`) is scoped to selected repositories. Without
the repo name I cannot tell which one it is allowed to touch. Classic tokens
(`ghp_…`) need the `repo` scope.

---

## 5. Environment variables to paste

Minimum for a working deployment:

```env
NODE_ENV=production
DATA_DIR=/var/data
NODE_VERSION=22.23.4
JWT_SECRET=<Render generates this for you>

# AI + translation
GEMINI_API_KEY=AQ.Ab8RN6...
GEMINI_MODEL=gemini-3.6-flash
DEEPL_API_KEY=704ae940-...:fx

# Email OTP (primary verification channel)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=no-reply@azolve.io

# TURN relay for calls on mobile networks
TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443
TURN_APP=<your metered sub-domain>
TURN_API_KEY=sk_id_...
TURN_API_SECRET=sk_secret_...

# Turn this OFF once real users arrive
OTP_DEV_ECHO=0
```

The full list with explanations is in `.env.example`.

---

## 6. After the first deploy

1. Open `https://azolve-chat.onrender.com/api/health` — you should get
   `{"ok":true,...}`.
2. Open `https://azolve-chat.onrender.com/api/auth/otp/status` — check that
   `emailDelivery` is `true` and `primary` is `"email"`.
3. Register the first account. On an empty database the first user becomes
   **admin** (`FIRST_USER_IS_ADMIN=1`), which unlocks the admin dashboard.
4. Open `/api/rtc/config` — `hasTurn` must be `true` before you trust calls on
   cellular.
5. Set `OTP_DEV_ECHO=0` and redeploy.

---

## 7. Custom domain

Render → your service → **Settings → Custom Domains → Add Custom Domain**.
Add the CNAME Render shows at your DNS provider. TLS is issued automatically
once DNS resolves. Nothing in the app needs to change — it uses relative URLs
throughout.

---

## 8. If the deploy fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails at `npm run build` | `web/` folder missing from the repo | Commit the whole tree, not just `server/` |
| `Cannot find module 'node:sqlite'` | Render picked Node 18 or 20 | Set `NODE_VERSION=22` (already in `render.yaml`) |
| App boots then 502s | Start command wrong | Must be `npm start`, not `node index.js` |
| Data vanishes after each deploy | No disk, or `DATA_DIR` not `/var/data` | Add the disk and the env var |
| `SQLITE_CANTOPEN` | Disk not mounted yet | Redeploy once; Render mounts disks before start on retry |
| WebSocket disconnects | Proxy buffering | Render supports WS natively; make sure the client uses `wss://` (it derives it from the page URL) |
