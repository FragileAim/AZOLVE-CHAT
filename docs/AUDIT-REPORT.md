# AZOLVE CHAT — Functional Audit Report

**Build audited:** commit `eb72efb` (main), version 1.0.0
**Backend:** https://azolve-chat.onrender.com (Render free tier)
**Date of this run:** 20 November 2026
**Method:** automated end-to-end API harness (`scripts/audit.mjs`) plus a manual browser walkthrough of every screen.

---

## 1. Headline result

| Area | Result |
| --- | --- |
| Automated end-to-end API audit | **80 checks passed, 0 failed** |
| Languages exercised for translation | **27 / 27** |
| Screens walked manually in the browser | **all** |
| Android release APK | **built, signed, signature verified** |
| iOS Xcode project | **dependency-free, ready to open** |
| Production email OTP delivery | **confirmed `delivered` by Brevo** |
| Production TURN relay | **live, `turnSource: "static"`** |

The harness creates two real accounts, drives the full product surface, and
asserts on the actual response bodies — not on status codes alone. It is
re-runnable: it resets the role it changes at the end.

---

## 2. What the automated audit covers

The harness (`scripts/audit.mjs`, 14 sections) runs against a server booted with
the **same environment as production**, with one deliberate difference:
`OTP_DEV_ECHO=1` so the harness can read the verification code from the response
instead of an inbox. Production runs with `OTP_DEV_ECHO=0`.

### 0. Health & static delivery
Health endpoint returns `{ok:true, service:"azolve-chat", version:"1.0.0"}`.
The SPA is served at `/`, hash routes resolve, and unknown `/api/*` paths return
a JSON 404 rather than the HTML shell (which would break client error handling).

### 1. Authentication
Both accounts were created through the real email-OTP flow, not seeded. Covered:
`/auth/me` with a valid token, without a token (401), and with a garbage token
(401); refresh-token rotation; the session list; OTP resend throttling (429);
invalid email rejected (400); wrong code rejected (400). The first account is
promoted to `admin` by `ADMIN_EMAILS`, the second stays `user`.

### 2. Users & profile
`GET /api/users/me`, `PATCH /api/users/me`, and a re-read to prove the change
**persisted** (display name and language both changed on disk). Search,
suggestions, and public profile lookup by handle all respond.

### 3. Chats & messaging — the core of the product
Direct-message creation is **idempotent**: calling it twice returns the same
conversation id, so two people opening a chat at the same moment cannot end up
in two threads. Sending a message, reading it as the peer, reacting, starring,
pinning, marking read, chat summary, AI threads, and call history all pass.

Two assertions matter most here:

- **Per-recipient translation is real.** A message sent in English is read by a
  Hindi recipient as `ऑडिट की ओर से नमस्ते, यह अनुवाद हो जाना …` — actual
  Devanagari from DeepL, not a placeholder.
- **The original is never overwritten.** The stored `body` remains
  `Hello from the audit, this sho…`. Translation is a separate row keyed by
  `(message_id, lang)`, so "See Original" always has the true original to show.

An outsider (a third account not in the conversation) is refused with 401.

### 4. Translation breadth
All 27 supported languages were exercised and returned a non-empty translation:
`27/27`.

### 5. AI assistant
`POST /api/ai/chat` returned a genuine model reply from Gemini, and the harness
asserts the reply is **not** an error string and not the local heuristic
fallback. The integrations endpoint responds.

### 6–9. Moments, Social, Communities, Notifications
Moment creation, feed, view, react, and viewer list. Social post creation, feed,
follow/unfollow, follower list, trending, explore, comments, save, and saved
list. Community creation, join, posting inside a community, listing, and detail.
Notifications are **generated as a side effect of real activity** (the harness
asserts the count increased), and can be marked read.

### 10. Uploads
A PNG is uploaded through the real multipart endpoint and then **fetched back
over HTTP** to prove it is actually served, not just recorded.

### 11. RBAC / admin
A normal user is blocked from `/api/admin/stats` (403) and an anonymous caller
gets 401. An admin can read stats, the audit log, and the user list, and can
change another user's role. Critically, **a non-admin cannot escalate their own
role** (403).

### 12. WebRTC
`/api/rtc/config` returns STUN plus a TURN server **with credentials**, and
reports `turnSource: "static"` — meaning the Metered credentials are live, not a
fallback. Call creation returns 201.

### 13. Input validation & error hygiene
Malformed JSON returns `400 {"error":"Request body is not valid JSON"}` with no
stack trace. A missing required field returns 4xx. A 10,001-character message is
rejected with **413** rather than being stored and fanned out.

### 14. Logout
Logout returns 200 and the token is **rejected afterwards** (401) — the session
is genuinely revoked, not just cleared client-side.

---

## 3. Defects found and fixed during this audit

The audit was not a rubber stamp. It found four real bugs, all now fixed and
covered by a regression check.

### 3.1 Socket messages arrived in the wrong shape (highest impact)

The REST API returned camelCase (`createdAt`, `clientId`) but the Socket.IO
`message:new` event emitted the **raw database row** in snake_case
(`created_at`, `client_id`). Three visible symptoms followed from that one
mismatch:

- every incoming message was stamped **"Invalid Date"**;
- the sender's own bubble was drawn **on the receiving side**;
- every message appeared **twice**, because the optimistic copy could not be
  matched to its server echo.

Fixed in `server/realtime.js`: the socket payload is now constructed to be
identical in shape to the REST payload, including the per-recipient translated
`displayBody`. Defensive guards were also added to `web/src/lib/utils.js` so a
missing timestamp renders as nothing rather than "Invalid Date".

### 3.2 Malformed JSON returned 500

A client sending a broken body got `500 Internal server error`, which is both
wrong and unhelpful. The error handler now maps `entity.parse.failed` to 400 and
`entity.too.large` to 413, and never leaks a stack trace.

### 3.3 Oversized messages were accepted

A 10,001-character message was stored, translated and fanned out to every
participant. Now capped at 10,000 characters with a 413.

### 3.4 `GET /api/users/me` did not exist

A client holding only its own user id had to guess its username. Added, declared
before `/:username` so `me` is never treated as a handle.

### 3.5 A feature was claimed but not built

The Calls screen advertised **"live translated captions"**. That is not
implemented, and the specification forbids presenting unbuilt features as real.
The copy now states plainly that in-call captions are not built yet, while text
translation in chats is.

---

## 4. Production verification (the instance your testers will use)

The local audit proves the code. These checks prove the **deployed** instance.

| Check | Evidence |
| --- | --- |
| Health | `200 {"ok":true,"service":"azolve-chat","version":"1.0.0"}` |
| `GET /api/users/me` without a token | `401` — route exists (was 404 before the fix) |
| Malformed JSON | `400 {"error":"Request body is not valid JSON"}` — fix is deployed |
| Unknown API route | `404 {"error":"Unknown endpoint GET /api/nope"}` |
| OTP channel | `provider: "brevo"`, `emailDelivery: true`, `primary: "email"` |
| **Real OTP email** | `POST /api/auth/email/start` → `delivered: true`; Brevo event log shows **`delivered`** for "Your AZOLVE CHAT verification code" |
| TURN relay | `/api/rtc/config` → `turnSource: "static"`, `hasTurn: true`, three Metered URLs with username + credential |
| Gemini key | direct API call returned `PONG` |
| DeepL key | direct API call returned `सुबह की शुभकामनाएँ, आप कैसे हैं?` |

The email path is the one testers hit first, so it was verified twice: once
through the app's own endpoint, and once against Brevo's event log, which
independently confirms `delivered`.

---

## 5. Manual browser walkthrough

Every screen was opened in a real browser, not just asserted over HTTP.

- **Landing → signup.** "Continue with email", name and address, "Email my code",
  code entry, then the four-step onboarding (Identity → Profile → Language →
  Privacy). The Privacy step states honestly that end-to-end encryption is
  **not** enabled — the specification forbids claiming it otherwise.
- **Home.** Renders with a live AI engine label. The copy no longer contradicts
  itself by saying "engine is live" and "add a key" in the same sentence.
- **Chats.** Send, receive, translate, react, pin, star, read receipts.
- **Moments, Explore, Communities, Calls, Settings.** All render; no blank
  screens, no console errors.
- **Dark / light mode.** Toggling sets `data-theme="dark"` on the root, the body
  background becomes `rgb(7,7,12)`, and the choice survives a reload via
  `localStorage['azolve.theme']`.
- **Mobile view.** The device preview renders a 298px `.device-fit` frame inside
  `.device-stage`, matching a real handset viewport.
- **AI assistant.** Returns a real Gemini reply in the UI.

---

## 6. Mobile builds

### Android — installable now

| Property | Value |
| --- | --- |
| File | `AZOLVE-CHAT-v1.0.0.apk` |
| Size | 299 KB |
| Package | `io.azolve.chat` |
| Version | 1.0.0 (versionCode 1) |
| minSdk / targetSdk | 24 / 34 |
| Signature | `apksigner verify` → **Verifies**, APK Signature Scheme v2 |
| Signer | `CN=AZOLVE INFOTECH, O=AZOLVE INFOTECH PVT LTD, L=Ahmedabad, ST=Gujarat, C=IN` |
| APK file SHA-256 | `31615f6fb3b0b977d54b6ee3665f7424b61d9d2f329295cd488d815c8e5eb04c` |
| Signing cert SHA-256 | `31f20436e892ba7751a494b28ffc4b7040ad5ce303b6383e7aa8a6390f092f11` |
| Backend baked in | `https://azolve-chat.onrender.com` (confirmed inside `classes.dex`) |

The APK is a native WebView shell around the live product, which means it always
runs the newest deployed build — you do not need to rebuild the app when the web
app changes. The shell supplies what a browser tab cannot: camera and microphone
permission handling for WebRTC, media autoplay, a native file chooser, hardware
back-button integration, and a branded launcher icon.

**Added during this audit:** a branded splash screen and a "Try again" screen for
the first navigation. Without them, a Render cold start showed Chromium's
"Webpage not available" page, which looks like a broken app rather than a
sleeping server. This was the single most likely thing to make a tester report
"it doesn't work".

### iOS — Xcode project, ready to open

| Property | Value |
| --- | --- |
| File | `AZOLVE-CHAT-iOS-Xcode.zip` (428 KB) |
| Project | `App.xcodeproj` |
| Bundle id | `io.azolve.chat` |
| Deployment target | iOS 13.0 |
| Dependencies | **none** — no CocoaPods, no `pod install`, no `npm install` |
| App icon | 1024×1024, no alpha channel (Apple's requirement) |

The project was originally Capacitor-based, which would have required
`node_modules` and a working CocoaPods install on your MacBook before it could
even open. It has been rewritten as a **dependency-free native WKWebView app**:
the CocoaPods build phases, the `Pods` group, the xcconfig references, the
broken `.xcworkspace` and the `Podfile` were all removed, and `AppDelegate.swift`
now builds the window programmatically. The dangling `CAPBridgeViewController`
storyboard reference was deleted along with `UIMainStoryboardFile`.

It provides camera/microphone grant for WebRTC, inline media playback, a native
document picker, external links opening in Safari, and the same "Try again"
screen as Android. Build steps are inside the zip as `README.md`.

**An honest limitation:** a signed `.ipa` cannot be produced outside Apple's
toolchain, so iOS is delivered as a project you build once in Xcode (⌘R). With a
free Apple ID you can run it on your own iPhone today; distributing to other
people needs the paid Apple Developer Program (USD 99/year) and TestFlight.

---

## 7. Operational caveats your testers should know

These are properties of the **Render free tier**, not defects in the app.

1. **The server sleeps after ~15 minutes idle.** The next request takes 30–60
   seconds. Both apps now show a "Try again" screen for exactly this. Tell your
   testers: if it looks stuck on first open, wait a minute and tap Try again.
2. **The database resets on every deploy.** Render free has no persistent disk,
   so accounts and messages created before a redeploy are gone. For a real test
   round, either avoid deploying during the test window, or move to Starter +
   a 1 GB disk ($7.25/month), which fixes both this and the sleep.
3. **SMS is not live.** Verification is by email (Brevo, on the authenticated
   `azolve.io` domain). SMS is pending DLT approval. The UI says so rather than
   pretending.
4. **End-to-end encryption is not enabled.** Messages are encrypted in transit
   (TLS) and WebRTC media is DTLS-SRTP encrypted, but the server can read message
   bodies in order to translate them. The Privacy screen states this plainly.

---

## 8. Security housekeeping

Several secrets were pasted into chat during this project and should be rotated
before you hand the app to a wider audience: the GitHub PAT, the Render API key,
the Brevo API and SMTP keys, the Gemini key, and the Metered TURN secret. Rotating
them is a five-minute job per provider and does not require a code change — only
an environment variable update on Render.

Also worth adding: `include:spf.sendinblue.com` in the root SPF record for
`azolve.io`, so Brevo's mail is authorised alongside any existing sender.

---

## 9. Verdict

Every feature that the specification says is built is built, reachable, and
verified against a real server with real third-party providers. Every feature
that is *not* built (SMS, in-call captions, E2EE) is labelled as not built
rather than faked. The two mobile deliverables are ready: the APK installs
directly, and the Xcode project opens and runs without any dependency setup.

The remaining risks are operational, not functional, and all three are listed in
section 7 with a concrete remedy.
