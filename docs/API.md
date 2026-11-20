# AZOLVE CHAT — API Reference

Base URL: `http://localhost:3000/api`
All responses are JSON. Authenticated routes require:

```
Authorization: Bearer <accessToken>
```

Errors use standard HTTP codes with `{ "error": "message" }`.

---

## Authentication

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/signup` | — | `{ email?, phone?, password, displayName }` | `{ token, refreshToken, user, otpRequired }` |
| POST | `/auth/otp/request` | — | `{ identifier }` | `{ sent: true, demoCode? }` (demo code only when `OTP_DEMO_MODE=true`) |
| POST | `/auth/otp/verify` | — | `{ identifier, code }` | `{ verified: true, token, refreshToken, user }` |
| POST | `/auth/login` | — | `{ identifier, password, code? }` | `{ token, refreshToken, sessionId, user }`; `{ twoFactorRequired: true }` if 2FA enabled and no code |
| POST | `/auth/refresh` | — | `{ refreshToken }` | `{ token, refreshToken }` (rotates) |
| POST | `/auth/logout` | ✔ | — | `{ ok: true }` |
| POST | `/auth/logout-all` | ✔ | — | `{ ok: true }` |
| GET | `/auth/me` | ✔ | — | `{ user }` |
| POST | `/auth/forgot` | — | `{ identifier }` | `{ sent: true, demoCode? }` |
| POST | `/auth/reset` | — | `{ identifier, code, password }` | `{ ok: true }` |
| GET | `/auth/sessions` | ✔ | — | `{ sessions: [{ id, device, ip, created_at, last_seen, current }] }` |
| DELETE | `/auth/sessions/:id` | ✔ | — | `{ ok: true }` |
| POST | `/auth/2fa/enable` | ✔ | `{ enable, code? }` | `{ twoFactor, secret? }` |
| POST | `/auth/oauth/:provider` | — | `{ code, redirectUri }` | `501` with setup instructions when not configured |

`user` shape: `{ id, username, displayName, email, phone, avatar, cover, bio, dob, country, language, mood, moodText, role, verified, isPrivate, temporaryIdentity, privacy, prefs, createdAt }`.

---

## Users & social graph

| Method | Path | Auth | Notes |
|---|---|---|---|
| PATCH | `/users/me` | ✔ | Partial update. Accepts `displayName, bio, avatar, cover, dob, country, language, mood, moodText, username, isPrivate, temporaryIdentity, privacy{}, prefs{}` |
| GET | `/users/search?q=` | ✔ | `{ users: [...] }` |
| GET | `/users/suggestions` | ✔ | `{ users: [...] }` |
| GET | `/users/:username` | optional | `{ user, counts{posts,followers,following}, isFollowing, followsYou, blocked, canView, posts, moments, mutual }` |
| POST | `/users/:id/follow` | ✔ | `{ following: boolean }` |
| GET | `/users/:id/followers` | ✔ | `{ users }` |
| GET | `/users/:id/following` | ✔ | `{ users }` |
| POST | `/users/:id/block` | ✔ | `{ blocked: boolean }` |
| POST | `/users/:id/report` | ✔ | `{ reason, details? }` → `{ ok: true }` |
| GET | `/users/me/export` | ✔ | JSON download of the account |
| DELETE | `/users/me` | ✔ | Soft delete: status `deleted`, PII cleared, username anonymised |

---

## Chats & messages

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/chats` | ✔ | `{ conversations: [...] }`, each with per-viewer translated `lastMessage` |
| POST | `/chats/dm` | ✔ | `{ userId }` → `{ conversation }` (reuses existing DM) |
| POST | `/chats/group` | ✔ | `{ title, memberIds[], avatar? }` → `{ conversation }` |
| GET | `/chats/search?q=` | ✔ | Searches conversations and messages |
| GET | `/chats/:id` | ✔ | `{ conversation, participants }` |
| GET | `/chats/:id/messages?before=&limit=` | ✔ | `{ messages: [...] }` paginated, newest last |
| POST | `/chats/:id/messages` | ✔ | `{ body?, type?, mediaUrl?, mediaMeta?, replyTo?, location?, contact?, silent?, scheduledFor?, clientId? }` |
| PATCH | `/chats/:id/messages/:mid` | ✔ | `{ body }` — re-detects language, invalidates translations |
| DELETE | `/chats/:id/messages/:mid` | ✔ | Soft delete (`deleted=1`) |
| POST | `/chats/:id/messages/:mid/react` | ✔ | `{ emoji }` → `{ reactions }` |
| POST | `/chats/:id/read` | ✔ | `{ messageId? }` → marks read, emits receipts |
| PATCH | `/chats/:id` | ✔ | `{ title, avatar, mute, archive, pinned, locked, languageOverride, wallpaper, disappearSeconds }` |
| POST | `/chats/:id/members` | ✔ | `{ userIds[] }` |
| DELETE | `/chats/:id/members/:uid` | ✔ | Remove member |
| POST | `/chats/:id/messages/:mid/star` | ✔ | Toggle star |
| POST | `/chats/:id/messages/:mid/pin` | ✔ | Toggle pin |
| GET | `/chats/:id/starred` | ✔ | `{ messages }` |
| GET | `/chats/:id/summary` | ✔ | AI summary of the thread → `{ text, engine }` |
| POST | `/chats/:id/translate` | ✔ | `{ messageId, lang }` → on-demand translation |

Message shape:

```json
{
  "id": "m_...",
  "conversationId": "c_...",
  "senderId": "u_...",
  "body": "original text",
  "displayBody": "translated or original text",
  "displayLang": "en",
  "originalBody": "original text",
  "originalLang": "hi",
  "translated": true,
  "translationProvider": "mymemory",
  "type": "text|image|video|file|voice|location|contact|system",
  "mediaUrl": null,
  "mediaMeta": {},
  "replyTo": { "id": "...", "body": "...", "senderName": "..." },
  "reactions": [{ "emoji": "❤️", "userId": "u_..." }],
  "reads": ["u_..."],
  "starred": false,
  "pinned": false,
  "scheduledFor": null,
  "silent": false,
  "location": null,
  "contact": null,
  "createdAt": 1795094261644,
  "editedAt": null,
  "deleted": false,
  "clientId": "tmp_..."
}
```

---

## Social (AZOLVE SOCIAL)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/social/feed?before=` | ✔ | Following + own posts, paginated |
| GET | `/social/explore?q=&before=` | ✔ | Public discovery, search by caption/hashtag |
| GET | `/social/trending` | ✔ | `{ hashtags: [{ tag, count, lang }] }` |
| POST | `/social/posts` | ✔ | `{ caption, media[], privacy, location?, type? }` |
| DELETE | `/social/posts/:id` | ✔ | Author only |
| POST | `/social/posts/:id/like` | ✔ | `{ liked, likes }` |
| POST | `/social/posts/:id/save` | ✔ | `{ saved }` |
| GET | `/social/saved` | ✔ | `{ posts }` |
| GET | `/social/posts/:id/comments` | ✔ | `{ comments }` with per-viewer translation |
| POST | `/social/posts/:id/comments` | ✔ | `{ body }` |
| GET | `/social/moments` | ✔ | `{ groups: [{ user, moments[] }] }`, audience + block filtered |
| POST | `/social/moments` | ✔ | `{ type, mediaUrl?, text?, bg?, caption?, audience, hideFrom[], location?, link? }` |
| POST | `/social/moments/:id/view` | ✔ | Records viewer |
| POST | `/social/moments/:id/react` | ✔ | `{ emoji }` |
| POST | `/social/moments/:id/reply` | ✔ | `{ body }` → creates/reuses DM |
| GET | `/social/moments/:id/viewers` | ✔ | Owner only |
| POST | `/social/moments/:id/highlight` | ✔ | `{ title }` |
| GET | `/social/highlights/:userId` | ✔ | `{ highlights }` |
| DELETE | `/social/moments/:id` | ✔ | Owner only |

---

## Communities

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/communities?q=&category=&privacy=` | ✔ | `{ communities }` |
| POST | `/communities` | ✔ | `{ name, description, category, privacy, cover?, avatar? }` — creates linked group chat |
| GET | `/communities/:id` | ✔ | `{ community, posts, locked, members }` |
| POST | `/communities/:id/join` | ✔ | `{ joined }` |
| POST | `/communities/:id/posts` | ✔ | `{ body?, type: 'text'|'poll'|'event', poll?, event?, media? }` |
| POST | `/communities/:id/posts/:pid/vote` | ✔ | `{ option }` → updated poll results |
| PATCH | `/communities/:id/members/:uid` | ✔ | `{ role: 'admin'|'moderator'|'member' }` |
| DELETE | `/communities/:id` | ✔ | Owner/admin |

Community post shape includes `displayBody`, `translated`, `originalLang`, `poll { question, options, results, myVote, total }`, `event { title, startsAt, location }`, `author`.

---

## AZOLVE AI

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/ai/status` | ✔ | `{ engine, translationProviders: [{ name, available }] }` |
| GET | `/ai/threads` | ✔ | `{ threads: [{ thread_id, started, last }] }` |
| GET | `/ai/threads/:threadId` | ✔ | `{ messages: [{ id, role, content, created_at }] }` |
| POST | `/ai/chat` | ✔ | `{ message, threadId?, lang? }` → `{ threadId, reply, engine }` |
| POST | `/ai/task` | ✔ | `{ kind, text, lang?, targetLang?, tone? }` → `{ text, engine }` |
| POST | `/ai/upload` | ✔ | multipart `file` → `{ url, kind, name, size }` |
| GET | `/ai/notifications` | ✔ | `{ notifications, unread }` |
| POST | `/ai/notifications/read` | ✔ | `{ ids? }` or all |
| DELETE | `/ai/notifications` | ✔ | Clear all |
| GET | `/ai/calls` | ✔ | `{ calls: [{ id, peer, type, direction, status, duration, created_at }] }` |
| POST | `/ai/calls` | ✔ | `{ callId }` — log an outgoing call |
| PATCH | `/ai/calls/:id` | ✔ | `{ status, duration }` |

`kind` values for `/ai/task`: `summarize`, `rewrite`, `caption`, `hashtags`, `explain`, `translate`, `improve`, `ideas`, `replies`.
`tone` values: `professional`, `friendly`, `shorter`, `formal`, `casual`, `empathetic`, `confident`.

---

## Admin (RBAC: `admin` or `moderator`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | `{ users, active24, active30, messages, msgs24, posts, moments, communities, calls, openReports, suspended, translations, aiMsgs, registrations[], messageVolume[], languages[], engine, translationUsage[], system{} }` |
| GET | `/admin/users` | `{ users }` with status/email/phone |
| POST | `/admin/users/:id/verify` | Toggle verification |
| POST | `/admin/users/:id/status` | `{ status: 'active'|'suspended' }` |
| POST | `/admin/users/:id/role` | `{ role: 'user'|'moderator'|'admin' }` |
| GET | `/admin/reports` | `{ reports }` with reporter |
| POST | `/admin/reports/:id` | `{ status: 'resolved'|'dismissed' }` |
| GET | `/admin/posts` | Moderation list |
| GET | `/admin/communities` | Moderation list |
| GET | `/admin/audit` | `{ entries }` |

---

## Realtime events (Socket.IO)

Connect with `auth: { token }` on the default namespace.

**Client → server**

| Event | Payload |
|---|---|
| `typing` | `{ conversationId, typing }` |
| `read` | `{ conversationId, messageId }` |
| `call:invite` | `{ to, callId, type: 'audio'|'video', conversationId }` |
| `call:accept` | `{ callId, to }` |
| `call:decline` | `{ callId, to }` |
| `call:end` | `{ callId, to }` |
| `call:signal` | `{ callId, to, signal }` (SDP / ICE) |
| `call:caption` | `{ callId, to, text, lang }` |

**Server → client**

| Event | Payload |
|---|---|
| `message:new` | message object (already translated for this viewer) |
| `message:updated` / `message:deleted` | `{ conversationId, message }` / `{ conversationId, messageId }` |
| `message:reaction` | `{ conversationId, messageId, reactions }` |
| `read` | `{ conversationId, userId, messageId }` |
| `typing` | `{ conversationId, userId, typing }` |
| `presence` | `{ userId, online, lastSeen }` |
| `conversation:created` / `conversation:updated` | conversation object |
| `notification:new` | notification object |
| `moment:new` | moment object |
| `call:incoming` | `{ callId, from, type, conversationId }` |
| `call:accepted` / `call:declined` / `call:ended` | `{ callId }` |
| `call:signal` | `{ callId, from, signal }` |
| `call:caption` | `{ callId, text, lang }` |

---

## Health

`GET /api/health` → `{ ok: true, service: "azolve-chat", version, time }`
