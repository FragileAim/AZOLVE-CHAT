# Deploying AZOLVE CHAT on GitHub + Render

This guide takes the repository from your machine to a live, shareable URL your
team can log into with a real phone number.

---

## 1. What you need

- A GitHub account (free)
- A Render account (free tier is enough to start)
- Node 22+ if you want to run it locally first
- Optional: an SMS gateway account (see §5)

The app is a single Node process that serves both the API and the built React
bundle. The database is SQLite, stored as one file on a disk.

---

## 2. Push to GitHub

From the project root (`azolve/`):

```bash
git init
git add .
git commit -m "AZOLVE CHAT — phone OTP sign-up, Render deployment"
git branch -M main
git remote add origin https://github.com/<your-org>/azolve-chat.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `data/` and `.env`, so no
secrets or local databases are uploaded. Verify with:

```bash
git status --short          # should be empty
git ls-files | grep -c node_modules   # should print 0
```

---

## 3. Deploy on Render (Blueprint — recommended)

1. In Render: **New + → Blueprint**.
2. Connect the GitHub repo you just pushed. Render reads `render.yaml`.
3. Click **Apply**. The first build takes ~3–5 minutes (installs deps, builds
   the React app, starts the server).
4. When it goes live you get `https://azolve-chat.onrender.com`.

`render.yaml` already sets:

| Setting | Value | Why |
|---|---|---|
| `DATA_DIR` | `/var/data` | SQLite file + uploads live on the disk |
| `JWT_SECRET` | auto-generated | sessions are signed with a real secret |
| `SMS_PROVIDER` | `console` | works with zero signup; codes go to the log |
| `OTP_DEV_ECHO` | `1` | **team testing**: the code appears in the UI |
| `FIRST_USER_IS_ADMIN` | `1` | first sign-up becomes the admin |
| `SEED_DEMO` | `0` | no sample accounts |
| disk | 1 GB at `/var/data` | survives redeploys |

### Manual setup instead of Blueprint

If you prefer clicking through the dashboard:

1. **New + → Web Service** → connect the repo.
2. Runtime: **Docker**. Dockerfile path: `./Dockerfile`.
3. Add the environment variables from `.env.example` (at minimum
   `JWT_SECRET`, `DATA_DIR=/var/data`, `SMS_PROVIDER`, `OTP_DEV_ECHO`).
4. **Disks → Add Disk**: name `azolve-data`, mount path `/var/data`, 1 GB.
5. Health check path: `/api/health`.

---

## 4. First login

1. Open the URL. Tap **Continue with phone number**.
2. Enter your number with country code, e.g. `+91 98765 43210`.
3. **With `OTP_DEV_ECHO=1`** the six-digit code is shown on the OTP screen
   (labelled "Test mode"). Enter it and you are in.
4. **With `OTP_DEV_ECHO=0`** read the code from the Render log:
   **Dashboard → your service → Logs**, look for:

   ```
     ┌─────────────────────────────────────────────┐
     │  AZOLVE OTP                                  │
     │  to: +919876543210                           │
     │  code: 481920                                │
     └─────────────────────────────────────────────┘
   ```

5. The first account created becomes **admin**, so it can open the admin
   dashboard. Everyone after that is a normal user.

> **Turn `OTP_DEV_ECHO` off before real users arrive.** While it is on, the
> API returns the code to the browser, which defeats the point of an OTP.

---

## 5. Free options for sending OTP by SMS

The server ships with a pluggable SMS layer (`server/services/sms.js`). Pick one
by setting `SMS_PROVIDER`. You can switch at any time — no code changes.

| `SMS_PROVIDER` | Cost | Setup | Notes |
|---|---|---|---|
| `console` | **Free forever** | none | Code printed to the server log. Perfect for a team test. |
| `textbelt` | **Free: 1 SMS/day** | none (key optional) | Global, no account needed for the free tier. |
| `fast2sms` | Free trial credits | sign up, get API key | India. Production needs DLT template registration. |
| `msg91` | Free trial credits | sign up, flow + template ID | India. Production needs DLT. |
| `2factor` | Free trial credits | sign up, API key | India. Production needs DLT. |
| `vonage` | Trial credit | sign up | Trial only sends to verified numbers. |
| `twilio` | Trial credit (~$15) | sign up | Trial only sends to verified numbers. |

**Honest answer to "is there a free version of getting OTP on phone?":**
There is no provider that gives unlimited free SMS — SMS costs real money
somewhere. What you *can* get for free is:

- **`console`** — genuinely free and unlimited, but the code goes to the log,
  not to the phone. This is what your team should use while testing.
- **`textbelt`** — one real SMS per day, free, no signup.
- **Indian gateways (fast2sms / msg91 / 2factor)** — free trial credits on
  signup, enough for a few dozen test messages. For production volume in India
  you must register a DLT template with your operator, which is free but
  requires a business entity.

For a team of 5–10 people testing for a week, `fast2sms` trial credits are the
cheapest path to real texts. For a permanent product, budget roughly
₹0.15–₹0.25 per SMS in India, or ~$0.0075 per SMS on Twilio in the US.

### Configuring a provider

```bash
# Render → Environment
SMS_PROVIDER=fast2sms
FAST2SMS_API_KEY=your-key
OTP_DEV_ECHO=0
```

Then redeploy. The OTP screen will say "Code sent by SMS via fast2sms" when
delivery succeeds, and will show the provider error if it fails.

---

## 6. How the phone sign-up works

```
POST /api/auth/phone/start   { phone: "+919876543210", displayName? }
  → creates a pending user if the number is new
  → generates a 6-digit code (10 min TTL)
  → sends it via SMS_PROVIDER
  → returns { userId, isNew, delivered, provider, deliveryCode? }

POST /api/auth/phone/verify  { userId, code }
  → marks the phone verified, activates the account
  → returns { token, refreshToken, user, needsOnboarding }

POST /api/auth/phone/resend  { userId }
GET  /api/auth/otp/status
  → { provider, configured, echo, smsDelivery }
```

Guard rails that are already in place:

- one code per number per **30 seconds**
- maximum **6 codes per number per hour**
- **5 wrong guesses** kill the code
- codes expire after **10 minutes**
- codes are single-use
- suspended accounts are refused before a code is sent

---

## 7. Important operational notes

**Single instance only.** SQLite is a local file. If you scale the Render
service to two instances they will each have their own database and users will
"disappear" depending on which instance answers. Keep it at one instance. If you
later need horizontal scale, migrate to Postgres — the `db.js` helper layer is
the only file that would need to change.

**Free tier sleeps.** Render's free plan spins the service down after 15
minutes of inactivity; the next request takes ~30–50 seconds to wake. WebSocket
connections drop when it sleeps. The Starter plan ($7/mo) stays awake.

**WebSockets work on Render** out of the box — Socket.IO upgrades are proxied
correctly. No extra configuration is needed.

**Uploads** go to `$DATA_DIR/uploads`, which is on the mounted disk, so they
survive redeploys.

**Backups.** The whole database is one file: `/var/data/azolve.db`. Download it
from the Render shell (`cp /var/data/azolve.db /tmp/backup.db`) or add a cron
job that copies it off-box. WAL mode means you should copy the `-wal` file too,
or run `sqlite3 azolve.db "PRAGMA wal_checkpoint(TRUNCATE);"` first.

**Rotating `JWT_SECRET`** invalidates every session — everyone has to log in
again. That is the correct emergency response if a secret leaks.

---

## 8. Running locally

```bash
cp .env.example .env
# edit JWT_SECRET at minimum
npm install
npm run build          # builds web/dist
npm start              # http://localhost:3000
```

For hot reload during development, run the API and Vite separately:

```bash
npm run dev            # API on :3000
cd web && npx vite     # UI on :5173, proxies /api to :3000
```

Locally with `SMS_PROVIDER=console`, the code is printed to your terminal the
moment you tap **Send my code**.

---

## 9. Removing demo data

There is no demo account any more. `SEED_DEMO` defaults to `0`, so a fresh
deployment starts with an empty database and the first phone sign-up becomes
the admin.

If you ever want the old sample workspace back on a throwaway box:

```bash
SEED_DEMO=1 npm start
```

That path is clearly logged as sample data and is never enabled by default.
