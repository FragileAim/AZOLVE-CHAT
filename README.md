# AZOLVE CHAT

**A premium, AI-powered global social communication platform by AZOLVE INFOTECH.**

Every language. One conversation. AZOLVE CHAT translates each message **for each recipient**, privately and automatically, while the sender's original text is preserved forever in the database.

---

## 1. What this is

AZOLVE CHAT is a complete, running application — not a mockup. It ships with:

| Area | What is implemented |
|---|---|
| Authentication | Email/phone signup, OTP verification, login, rotating refresh tokens, session list + revoke, logout, forgot/reset password, optional 2FA (TOTP secret), OAuth hooks for Google/Apple |
| Onboarding | Username, display name, avatar, bio, DOB, country, **display language** (becomes default translation target), privacy preferences, contact discovery |
| Messaging | 1:1 and group chats, realtime delivery (Socket.IO), read receipts, presence, typing indicators, reply, forward, edit, delete, pin, star, reactions, emoji, media (image/video/document/voice), location, contact cards, search, archive, mute, lock, disappearing messages, scheduled + silent messages, AI summaries, AI replies, voice transcription, spam flags |
| Translation | **Per-recipient** translation with provider chain, auto language detection, cached per `(message, language)`, "See original" toggle, RTL (Arabic/Hebrew/Urdu), per-group per-member rendering, per-chat language override |
| AZOLVE MOMENTS | Photo/video/text moments, backgrounds, captions, audience control, hide-from, reactions, replies (creates a DM), viewer list, 24h expiry, highlights, AI Moment Creator |
| AZOLVE SOCIAL | Public/private profiles, follow graph, feed, explore, trending hashtags, posts with carousels, likes, comments, saves, share links, hashtags, mentions, location tags, AI captions/hashtags, caption translation, multilingual discovery |
| AZOLVE AI | Chat assistant with persistent threads, 8 task tools (summarise, rewrite, translate, caption, hashtags, explain, ideas, replies), voice input (Web Speech) and speech output, pluggable model providers with an honest `engine` label |
| Calls | Real WebRTC 1:1 audio/video, mute, camera toggle, camera switch, screen share, PiP, live translated captions, call history with direction/status/duration |
| Communities | Public/private communities, categories, linked group chat, discussions, polls with live results, events, member roles (admin/moderator/member), join/leave, discovery |
| Profile & settings | Profile editing, cover/avatar upload, privacy controls, theme (light/dark), language & translation settings, security, notifications, data export (JSON), account deletion |
| Admin | RBAC console: platform stats, registration/message/language charts, user verification/suspension/roles, report queue, audit log, system health |
| Notifications | In-app notification centre with unread badges, mark-all-read, clear |

Everything above is wired to the real API and the real database. There are no dead buttons.

---

## 2. Tech stack

- **Frontend:** React 19 + Vite 8 (rolldown), hash routing, Context state, CSS custom properties for theming. No UI framework — a bespoke design system (`styles.css` + `styles-v2.css`).
- **Backend:** Node.js 22, Express 5, Socket.IO 4, JWT (`jsonwebtoken`), `bcryptjs`, `multer` uploads.
- **Database:** SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) in WAL mode. 28 tables. No native compilation, no external database service required. The data layer is isolated in `server/db.js` so it can be swapped for PostgreSQL.
- **Realtime:** Socket.IO for messages, presence, typing, receipts, notifications and WebRTC signalling.
- **Media:** Multer disk storage served from `/uploads` (swap for S3/GCS by replacing `upload` config).
- **AI / translation:** provider-agnostic adapters (see §5).

---

## 3. Quick start

```bash
# 1. install
npm install

# 2. configure (optional — the app runs with sane defaults)
cp .env.example .env
#    edit JWT_SECRET at minimum

# 3. seed demo data (7 accounts, chats, posts, moments, communities)
npm run seed

# 4. build the frontend
npm run build

# 5. run
npm start
# → http://localhost:3000
```

Development with hot reload:

```bash
npm run dev            # API on :3000
cd web && npm run dev  # Vite dev server on :5173 with proxy to :3000
```

### First sign-in (phone OTP)

There is no demo account. The database starts empty and the **first phone
number to sign up becomes the admin**, so you can reach the admin dashboard
immediately.

1. Open the app → **Continue with phone number**
2. Enter your number with country code, e.g. `+91 98765 43210`
3. With the default `SMS_PROVIDER=console` the six-digit code is printed to the
   server log (and shown in the UI when `OTP_DEV_ECHO=1`)
4. Enter it — you are signed in

To send real text messages, set `SMS_PROVIDER` to `textbelt`, `fast2sms`,
`msg91`, `2factor`, `vonage` or `twilio` and add that provider's key. See
[docs/DEPLOY.md](docs/DEPLOY.md) §5 for the free options and their limits.

### Optional sample workspace

For a throwaway demo box only:

```bash
SEED_DEMO=1 npm start
```

That seeds six sample people, a group, posts and communities. It is off by
default and every seeded row is clearly sample data — never presented as real
user activity.


---

## 4. How per-recipient translation works

This is the core differentiator and it is implemented exactly as specified.

1. A sender posts a message. `body` is stored **once**, unchanged, together with `original_body` and `original_lang` (auto-detected via Unicode script ranges + stopword scoring).
2. For each participant, the server resolves their display language (`users.language`, or a per-chat `languageOverride`).
3. If the reader's language differs from `original_lang`, `translateManyForViewer()` translates the text and caches the result in the `translations` table keyed by `(message_id, lang)`.
4. Realtime delivery emits `message:new` **per recipient**, each with `displayBody`, `displayLang`, `translated`, `translationProvider` and the untouched `originalBody`.
5. The UI renders `displayBody` and, when `translated` is true, shows `Translated from <language> · See original`. Toggling swaps to the stored original — it never writes back.
6. The original row is never updated by translation. Editing a message re-detects language and invalidates cached translations.

RTL languages (`ar`, `he`, `ur`, `fa`) get `dir="rtl"` on the bubble automatically.

Group chats work per participant: five members with five languages get five cached translations of the same message.

---

## 5. Provider configuration

All providers are optional and configured through environment variables. No keys are hardcoded anywhere.

**Translation chain** (`TRANSLATION_PROVIDER`, default `deepl,google,libre,openai,mymemory,offline`):

| Provider | Env | Notes |
|---|---|---|
| DeepL | `DEEPL_API_KEY` | highest quality for European languages |
| Google Cloud Translation | `GOOGLE_TRANSLATE_API_KEY` | broad language coverage |
| LibreTranslate | `LIBRE_TRANSLATE_URL`, `LIBRE_TRANSLATE_KEY` | self-hostable |
| OpenAI | `OPENAI_API_KEY` | LLM-based translation |
| MyMemory | `MYMEMORY_EMAIL` (optional) | **keyless, enabled by default, verified working** |
| Offline phrasebook | — | deterministic fallback for demo phrases |

The app degrades gracefully: if a provider fails or is not configured, the next one is tried. `GET /api/ai/status` reports which providers are actually available, and the UI shows this honestly.

**LLM chain** (first configured wins): OpenAI → Anthropic → Gemini → Groq → Ollama → `local-heuristic`.

`local-heuristic` is a real deterministic engine (extractive summarisation, tone rewriting, caption/hashtag generation, reply drafting). Every response includes `engine`, so the UI always states which engine answered. It never pretends to be a frontier model.

---

## 6. Security and honesty

- Passwords hashed with bcrypt. JWTs signed with `JWT_SECRET`, short-lived access tokens, rotating refresh tokens stored per session.
- Sessions are listed and individually revocable. `logout-all` invalidates every session.
- Rate limiting: 600 requests/minute per IP (in-memory).
- Input validation on every route; parameterised SQL everywhere (no string interpolation into queries).
- Blocking is enforced at message, feed, moment and profile level.
- Audit log records admin actions.
- **End-to-end encryption is NOT enabled in this build.** Per-recipient AI translation requires the server to read message text. This is disclosed in Settings → Security and in the docs. TLS in transit + storage at rest are the current guarantees. A future E2EE mode would translate on-device and be labelled as such. The product never claims E2EE while it is not active.
- No message text is sent to a third-party AI provider unless that provider is explicitly configured by the operator via env vars, and the active provider is shown in the UI.

---

## 7. Project structure

```
azolve/
├── server/
│   ├── index.js            # Express app, static hosting, SPA fallback, Socket.IO bootstrap
│   ├── db.js               # schema + all/get/run/tx helpers (node:sqlite, WAL)
│   ├── auth.js             # tokens, sessions, requireAuth/requireAdmin, blocking
│   ├── realtime.js         # presence, delivery, per-recipient translation, WebRTC signalling
│   ├── seed.js             # demo data
│   ├── util.js             # ids, language names, RTL, publicUser
│   ├── routes/
│   │   ├── auth.js         # signup, OTP, login, refresh, sessions, 2FA, OAuth hooks
│   │   ├── users.js        # profile, follow, block, report, export, delete
│   │   ├── chats.js        # conversations, messages, reactions, receipts, translation
│   │   ├── social.js       # feed, posts, comments, moments, highlights
│   │   ├── communities.js  # communities, posts, polls, roles
│   │   ├── ai.js           # assistant, tasks, uploads, notifications, call log
│   │   └── admin.js        # stats, users, reports, audit
│   └── services/
│       ├── translate.js    # detection + provider chain + cache
│       └── ai.js           # LLM chain + local heuristic engine
├── web/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx, App.jsx
│       ├── styles.css, styles-v2.css
│       ├── components/     # AppShell, UI kit
│       ├── lib/            # api, socket, i18n, utils
│       └── pages/          # Auth, Onboarding, Home, Chats, Moments, Explore,
│                           # AI, Calls, Communities, Profile, Settings, Admin
├── docs/                   # API, database, features, testing, deployment
├── data/                   # SQLite database + uploads (gitignored)
└── .env.example
```

---

## 8. Scripts

| Command | Description |
|---|---|
| `npm start` | Run the production server (serves the built frontend) |
| `npm run dev` | API with `node --watch` |
| `npm run build` | Build the React frontend into `web/dist` |
| `npm run seed` | Populate demo data (idempotent guard: run on a fresh DB) |

---

## 9. Documentation

- [`docs/API.md`](docs/API.md) — every endpoint, request/response shapes, auth
- [`docs/DATABASE.md`](docs/DATABASE.md) — full schema, relationships, indexes
- [`docs/FEATURES.md`](docs/FEATURES.md) — completed features and credential-gated items
- [`docs/TESTING.md`](docs/TESTING.md) — test journeys, results, known limitations
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment and scaling
- [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md) — external services and how to enable them

---

© AZOLVE INFOTECH. Built as a production-shaped reference implementation.
