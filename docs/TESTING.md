# AZOLVE CHAT — Testing Report

Environment: Node v22.23.4, Chromium (headless), Linux x64, SQLite WAL, `local-heuristic` AI engine, `mymemory` translation provider (no API keys configured).

Method: every journey below was driven through the real browser against the running server, plus direct API calls to verify response shapes. No journey was marked passing without observing rendered output or a verified JSON payload.

---

## 1. Test matrix

| # | Journey | Steps | Result |
|---|---|---|---|
| 1 | Server boot | start server, `GET /`, `GET /api/health` | ✅ `root=200`, `{ok:true, service:"azolve-chat"}` |
| 2 | Auth screen render | open `/` logged out | ✅ Hero, brand, language chips, Google/Apple hooks visible |
| 3 | Login | email + password → dashboard | ✅ Session issued, Home rendered |
| 4 | Home dashboard | inspect cards | ✅ 6 conversations, 4 moment circles, trending hashtags, AI engine chip, translated previews |
| 5 | Conversation list | open Chats | ✅ All conversations with last message + unread counts |
| 6 | Open group chat | open "Global Founders 🌍" | ✅ 10 messages, 6 members, per-message language tags |
| 7 | Per-recipient translation | read messages from HI/DE/AR/ES/JA senders | ✅ All rendered in English with `Translated from <lang>` |
| 8 | "See original" | toggle on Spanish message | ✅ Original Spanish shown; label flips to "Hide original" |
| 9 | Send message | type Hindi text, Enter | ✅ Optimistic append, persisted, correct timestamp |
| 10 | Language detection | Japanese message | ✅ Detected `ja` after fix (see §3) |
| 11 | Moments feed | open Moments | ✅ 4 live circles, highlights section, AI Moment Creator entry |
| 12 | Moment viewer | open a moment | ✅ Full-screen viewer, author, age, audience, reaction bar |
| 13 | Explore feed | open Explore | ✅ 6 posts with media, likes, comments, hashtags, language tags |
| 14 | Post translation | translate Portuguese caption | ✅ Rendered in EN with "Translated to EN · See original" |
| 15 | Like a post | click heart | ✅ Count incremented 12 → 13, persisted |
| 16 | AI assistant | ask a summarisation prompt | ✅ Structured bullet summary, engine label shown |
| 17 | AI providers panel | inspect chips | ✅ Only configured providers highlighted; honest copy |
| 18 | Calls page | open Calls | ✅ Hero, call type picker, history with direction/status/duration |
| 19 | Start call | pick contact → audio | ✅ Overlay "Ringing…", call row created as `Ringing` |
| 20 | End call | hang up | ✅ Overlay closes, row updated to `Missed`, duration recorded |
| 21 | Communities list | open Communities | ✅ 4 communities, categories, member counts, privacy badges |
| 22 | Community detail | open Cinema & Motion | ✅ Hero, tabs, poll, discussion post, members, "Group chat" link |
| 23 | Poll vote | vote "Scaling realtime chat" | ✅ 0% → 100%, "1 vote", persisted |
| 24 | Profile | open own profile | ✅ Cover, avatar, bio, stats, tabs, edit/settings actions |
| 25 | Settings — appearance | open Appearance | ✅ Light/Dark cards, theme applies instantly and persists |
| 26 | Settings — language | open Language & translation | ✅ 27 languages, auto-translate switch, provider chips, honesty box |
| 27 | Settings — security | open Security | ✅ E2EE disclosure, session list with revoke, logout |
| 28 | Admin login | login as `azolve` | ✅ Admin item appears in navigation |
| 29 | Admin overview | open Admin | ✅ 7 users, 14 messages, charts, language bars, system panel |
| 30 | Admin users | open Users tab | ✅ Verify/Suspend actions per user |
| 31 | Admin reports | open Reports tab | ✅ Open spam report with Resolve action |
| 32 | SPA routing | direct hash navigation | ✅ `#/profile/alexr`, `#/chats`, `#/calls` all resolve |
| 33 | API auth guard | call `/api/admin/stats` as normal user | ✅ `403` |
| 34 | Data export | Settings → Data & account | ✅ JSON blob download endpoint responds |
| 35 | Realtime transport | Socket.IO connect on login | ✅ Presence + delivery channel established |

---

## 2. API verification (curl)

Verified response shapes for: `/api/health`, `/api/auth/login`, `/api/auth/me`, `/api/auth/sessions`, `/api/users/alexr`, `/api/users/priya`, `/api/chats`, `/api/chats/:id/messages`, `/api/social/feed`, `/api/social/explore`, `/api/social/trending`, `/api/communities`, `/api/communities/:id`, `/api/ai/status`, `/api/ai/threads`, `/api/ai/threads/:id`, `/api/ai/chat`, `/api/ai/task`, `/api/ai/calls`, `/api/admin/stats`, `/api/admin/users`, `/api/admin/reports`.

All returned the documented shapes. Non-admin access to `/api/admin/*` correctly returned `403`.

---

## 3. Defects found and fixed during testing

| Defect | Cause | Fix |
|---|---|---|
| `Cannot GET /` on the production build | Express 5 / path-to-regexp v8 rejects `app.get('*')` | Replaced with a middleware SPA fallback that skips `/api`, `/uploads`, `/socket.io` and non-GET requests |
| Frontend build failed | `socket.io-client` imported but not installed | Added dependency; build succeeds (64 modules) |
| Japanese message labelled "Translated from Chinese" | Stale `original_lang` rows seeded before the kana-before-CJK detection fix | Re-ran detection over existing rows (3 corrected); detection order verified (`ja` before `zh`) |
| AI summarise echoed the prompt with a leading colon | Prompt-stripping regex left punctuation behind | Rewrote the summarise branch: strips the instruction, emits bullet key points + one-line summary |
| AI provider panel implied every provider was available | Chips listed all names under "available now" | Label now reads "highlighted means configured & active"; only active chips are highlighted |
| Profile post grid showed `0 0` likes/comments | `/users/:username` did not include counts | Added `likes` and `comments` aggregates to the profile posts payload |
| `npm run build` failed from repo root | Vite root was `web/` but the script ran at root | Script is now `cd web && vite build` |
| Browser `fill` on React-controlled inputs silently failed in one flow | Value set without native events | Used selector-scoped `fill` + explicit submit button click |

---

## 4. Known limitations

1. **No E2EE.** Per-recipient translation requires server-side text. Disclosed in Settings → Security and in the README. Not advertised anywhere as encrypted end-to-end.
2. **OTP is demo-mode.** Codes are returned by the API and labelled "Demo delivery — no SMS/email provider configured" until a provider is configured.
3. **`local-heuristic` AI.** Deterministic and honest; quality is below a hosted LLM. The UI always names the engine.
4. **MyMemory translation** is keyless and rate-limited by the public service. Production should use DeepL or Google.
5. **WebRTC group calls** work peer-to-peer for small rooms; larger rooms need an SFU and a TURN server for NAT traversal.
6. **Uploads are on local disk.** Fine for a single node; object storage is required for horizontal scaling.
7. **SQLite** is excellent for a single node and demo scale; PostgreSQL is the production target (the data layer is isolated for this reason).
8. **No automated test suite yet.** This report documents manual, browser-driven verification. Adding Vitest/Playwright is the recommended next step.

---

## 5. Performance observations

- Production bundle: 445 KB JS (128 KB gzip), 77 KB CSS (15 KB gzip), 64 modules.
- First authenticated paint after login: sub-second on localhost.
- Message pagination is cursor-based (`before`), so long threads do not load in full.
- Media is lazy-loaded in feeds and grids (`loading="lazy"`).
- Translation results are cached in the database, so repeated reads of the same message/language cost nothing.
- Socket reconnection is handled by `socket.io-client` defaults; the UI re-fetches state on reconnect.

---

## 6. How to reproduce

```bash
npm install
npm run build
npm start
# open http://localhost:3000
# sign up with your phone number — the code appears in the terminal
# the first account created is the admin
```

Suggested manual pass: sign up with a phone number → onboarding → Home → Chats
→ send a message → toggle "See original" → tap a translation to hear it →
Moments → Explore → AI assistant → Calls → Communities → vote in a poll →
Profile → Settings (theme, language, voice, security) → log out → sign in again
with a phone code → Admin dashboard (first account only).
