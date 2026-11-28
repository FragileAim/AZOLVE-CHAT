# AZOLVE CHAT — v1.1.8

## Translation engine
- [x] Romanised Indic detector (hi/gu/ta/te/bn/mr), returns `und` not a false `en`
- [x] Detector result passed to providers as a source hint
- [x] Code-mixed text not short-circuited when already in the target language
- [x] Removed the offline phrasebook, forced `source_lang=EN`, echoed-input and MyMemory prose errors
- [x] `backfillLanguages()` + `POST /api/admin/repair-languages` + boot backfill
- [x] 17/17 translation cases verified via DeepL

## Live captions
- [x] Whisper no longer pinned to the profile language
- [x] APK runs the server caption engine first
- [x] Echo guard drops peer lines off the speaker
- [x] Honest `translated` / `translation unavailable` badges

## Firebase — web push
- [x] `services/fcm.js` — FCM HTTP v1 over a hand-signed RS256 JWT, no Admin SDK
- [x] Real service account mints an OAuth token (HTTP 200 verified)
- [x] Real `messages:send` call authenticated; dead tokens purged on UNREGISTERED
- [x] `device_tokens` table, `/push/firebase-config`, `/push/fcm/register|unregister|status`
- [x] Client `web/src/lib/fcm.js`, wired into `App.jsx` on sign-in
- [x] FCM merged into the existing `sw.js` so Accept/Decline survive
- [x] No duplicate notifications: VAPID skipped when an FCM web token delivered

## Firebase — native APK push
- [x] `firebase-messaging` BOM 33.5.1 + google-services plugin
- [x] `app/google-services.json` for `io.azolve.chat`
- [x] `AzolveMessagingService`: `azolve_calls` high-importance channel, vibration, bypassDnd, full-screen intent
- [x] `PushBridge` @JavascriptInterface (getToken/requestToken/subscribe/notify/available)
- [x] MainActivity initialises Firebase, registers the bridge, asks POST_NOTIFICATIONS on 13+
- [x] Calls sent data-only so they ring over the lock screen
- [x] Manifest permissions + service + default channel/icon

## Google login
- [x] `GET /api/auth/providers` → `google: true`, mode `redirect`
- [x] `POST /api/auth/oauth/google` (ID token) + `/start` + `/callback`
- [x] Session returned in the URL fragment, absorbed by `main.jsx`
- [x] Live 302 to accounts.google.com with the correct redirect_uri
- [ ] **Blocked: the Client Secret supplied is the Client ID. Google returns `invalid_client`.**

## Release
- [x] v1.1.8, versionCode 19, UA suffix
- [x] Web deployed to Render, `/api/health` = 1.1.8
- [x] APK v1.1.8 (3.2 MB) with native FCM
- [x] 32/32 UX checks, 8/8 onboarding steps
- [x] Removed the blocking sandbox script from index.html

## Needs the user
- [ ] Real Google OAuth **Client Secret** (`GOCSPX-…`), not the Client ID

## v1.1.9 — Google OAuth secret (done)
- [x] Read uploaded client_secret JSON, confirm `GOCSPX-` prefix is real
- [x] Push GOOGLE_CLIENT_SECRET to Render
- [x] Prove credentials with oauth2.googleapis.com/token (invalid_grant, not invalid_client)
- [x] Restore the full Render env set after the PUT /env-vars replace wiped it
- [x] Drop DATA_DIR — no disk exists on this free-plan service
- [x] Redeploy and verify health / providers / firebase-config / oauth start
- [x] Verify DeepL key still valid (usage 52,328 / 1,000,000)

## v1.1.9 — recovery after the env-var wipe (done)
- [x] Recover the Brevo API key from conversation history, verify live via /v3/account
- [x] Restore EMAIL_PROVIDER=brevo, BREVO_API_KEY, BREVO_FROM, EMAIL_FROM/REPLY_TO
- [x] Set OTP_DEV_ECHO=0 — real codes are emailed, not printed
- [x] Prove delivery: Brevo logged "Your AZOLVE CHAT verification code" from production
- [x] Root-cause "is not defined": Auth.jsx read `me.language`, context exposes `lang`
- [x] Root-cause dead Google button: it had no onClick; replaced with a real <a href>
- [x] Root-cause invisible Google button on short phones: `.oauth-row { display:none }`
- [x] Verified in headless Chromium at 390x844, 375x667, 1440x900 — renders, clicks, reaches Google
- [x] Use per-variable PUT /env-vars/{key} from now on, never the bulk replace

## v1.1.9 — Brevo sender on the azolve.io domain (done)
- [x] Query Brevo /v3/senders/domains — azolve.io authenticated:true verified:true
- [x] Direct API send from no-reply@azolve.io — HTTP 201, messageId returned
- [x] Update BREVO_FROM, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_FROM_NAME one key at a time
- [x] Confirm 37 env vars intact after the edits (no repeat of the bulk-PUT wipe)
- [x] Redeploy dep-dc210gl6e07s73eku740 — live
- [x] App OTP send confirmed in Brevo log: from no-reply@azolve.io
- [x] Declare BREVO_FROM in render.yaml, commit dac7bca

## v1.1.9 — APK rebuild + Google sign-in inside the app (done)
- [x] Bump versionCode 20 / versionName 1.1.9
- [x] server: oauth start accepts mobile=1 in signed state; callback returns azolve://oauth
- [x] android: azolve://oauth intent filter, Google hosts open in real browser, deep link replayed as #/auth?token=
- [x] web: googleStart() adds mobile=1 only when window.AzolvePush exists
- [x] build-android.sh locates gradle instead of failing
- [x] APK built, signed with same debug cert as v1.1.8 (upgrades in place)
- [x] Verified: mobile callback -> azolve://oauth?error=, web callback -> #/auth?error=
- [x] Deployed dep-dc212rk3eqjs7388bv1g live; site + APK share bundle index-C-xuItZp.js
- [x] Deliverable outputs/AZOLVE-CHAT-v1.1.9.apk (sha256 9b839f66…)

## v1.1.10 — onboarding asks once; database survives restarts (done)
- [x] Root cause 1: needsOnboarding inferred from "no country or no bio" -> users.onboarded_at stamp + backfill
- [x] Root cause 2: no durable storage (backend null) -> every restart wiped accounts
- [x] SNAPSHOT_PG_URL pointed at the account's Postgres (internal URL; external was dropped)
- [x] SNAPSHOT_RESET=1 used once to discard an undecryptable old snapshot, then removed
- [x] Proven: signup -> onboarding (blank bio) -> needsOnboarding false
- [x] Proven: full redeploy -> restored:true, same token valid, needsOnboarding false
- [x] Test account deleted (404, token 401)
- [x] OTP_DEV_ECHO back to 0

## v1.1.10 — APK rebuild after onboarding fix
- [x] Bump versionCode 21 / versionName 1.1.10
- [x] Rebuild web bundle (index-1MXspT-Q.js) and APK in live mode
- [x] Verify versionCode/versionName via aapt2
- [x] Verify signing cert unchanged (upgrades in place)
- [x] Verify `onboarded:!0` present in the bundled JS
- [x] Verify azolve://oauth intent filter + Google host handoff in dex
- [x] Confirm live site serves the same bundle hash
- [x] Push release commit and confirm /api/health = 1.1.10
- [x] Confirm /api/health/persist backend=postgres, restored=true

## v1.1.11 — Google sign-in return trip in the APK
- [x] Root cause 1: Chrome refuses a 302 to azolve:// (unknown-scheme dead end)
- [x] Root cause 2: hash-only loadUrl never re-ran absorbOAuthFragment()
- [x] Server returns over https to /oauth/app with the session in the fragment
- [x] Served /.well-known/assetlinks.json with the debug cert fingerprint
- [x] Added autoVerify App Link filter for https://azolve-chat.onrender.com/oauth/app
- [x] Shell forces a real document load (?r= cache-buster) before replaying the token
- [x] Intercept /api/auth/oauth/google/start directly, not only Google's hosts
- [x] Surface OAuth errors instead of silently returning to the login form
- [x] Verified live: callback 302 → https://…/oauth/app#error=access_denied
- [x] Verified APK: versionCode 22, assetlinks cert matches signing cert, bundle hash matches live

## v1.1.11 — iOS Xcode project (was missing / stale at 1.1.0)
- [x] Rebuilt the web bundle and refreshed App/App/public
- [x] Google sign-in: ASWebAuthenticationSession + azolve URL scheme in Info.plist
- [x] Intercept /api/auth/oauth/google/start in WKWebView before Google loads
- [x] Force a real document load (?r=) before replaying the session
- [x] Surface sign-in errors instead of silently returning to the login form
- [x] Server picks the return route per platform: https App Link (Android), azolve:// (iOS)
- [x] Verified live: ios state → azolve://oauth?error=…, android state → https://…/oauth/app#error=…
- [x] Version 1.1.11 / build 22 in project.pbxproj
- [x] Packaged outputs/AZOLVE-CHAT-iOS-1.1.11.zip (46 files) and validated Info.plist

## v1.1.12 — bottom-centre "+" button stuck (fixed)
- [x] Root-caused: FAB only called setMoreOpen(true); no toggle
- [x] Root-caused: .more-sheet outranked by `.app > :not(.rail){position:relative}` so backdrop never covered page
- [x] Added web/src/lib/back.js + installBackBridge so hardware back closes overlays
- [x] FAB toggles; X, grab handle, backdrop, Escape, navigate, back all dismiss
- [x] Playwright: 6 consecutive taps toggle correctly, 0 page errors
- [x] Bump 1.1.12 / versionCode 23; APK built, cert unchanged
- [x] Commit a049b71 pushed; Render redeploy triggered
- [x] iOS zip refreshed to 1.1.12
- [x] Verify live site serves 1.1.12 with fix (bundle index-CyYoTGNS.js, css index-DJqy9w6O.css)

## v1.1.13 — "correct OTP" rejected with circular-JSON error (fixed)
- [x] Root-caused: onClick={verifyEmail}/{verifyPhone}/{doVerify} passed the DOM click event as `code`
- [x] `code || form.code` forwarded the event to the API layer, which JSON.stringify'd it
- [x] Added pickCode(): only a non-empty string is an explicit code
- [x] Call sites use arrows: onClick={() => verifyEmail()}
- [x] Audited every other onClick={fn} in the app — all zero-arg, no other instances
- [x] Playwright end-to-end: email OTP 689274 verified -> onboarding, 0 page errors
- [x] Bump 1.1.13 / versionCode 24; APK built, cert unchanged
- [x] Commit 8da264b pushed; live verified 1.1.13 with fix in index-BzrsZDFr.js
- [x] iOS zip refreshed to 1.1.13

## v1.1.14 — UI overlap, invisible buttons, group photo
- [x] Fix `.up-main` having no CSS (28px text/pill overlap in New conversation)
- [x] Make `Modal` scrollable (`.modal-body`) + reserve bottom-nav clearance
- [x] Make Chat settings reachable (avatar/title button in chat header)
- [x] Add group photo upload to Create group and Chat settings
- [x] Accept `avatar` on POST /api/chats/group
- [x] Fix composer placeholder wrapping out of the pill at 320px
- [x] Verify 320/360/390/430 widths: no overflow, all buttons in view
- [x] Bump to 1.1.14 / versionCode 25, rebuild web + APK + iOS zip
- [x] Push, confirm Render live on 1.1.14 with new bundle

## v1.1.15 — Sovereign on-premises Docker package (Government of Dubai)
- [x] Inspect real runtime requirements (node:sqlite, web/dist, DATA_DIR, Socket.IO, /api/health, TURN strategies, translation providers)
- [x] Two-stage Dockerfile: non-root `node`, dumb-init, HEALTHCHECK via node fetch, no secrets in layers
- [x] docker-compose.yml: edge (nginx) + app + db (snapshot store) + turn (coturn) + optional offline-ai profile
- [x] nginx/azolve.conf: TLS 1.2/1.3, WebSocket upgrade map, rate limits, HSTS/CSP/nosniff — validated with `nginx -t`
- [x] .env.example: government profile, SMTP relay, libre translation, Firebase/Google/Apple blank
- [x] init.sh: generates JWT_SECRET, SNAPSHOT_KEY, POSTGRES_PASSWORD, TURN_STATIC_AUTH_SECRET; never overwrites
- [x] scripts/issue-cert.sh: self / csr / check modes — all three exercised, incl. key-cert mismatch detection
- [x] scripts/fetch-models.sh: downloads Ollama + LibreTranslate models with egress into the sealed services' volumes
- [x] scripts/backup.sh + scripts/restore.sh: checksummed backup, verified restore with recoverable previous state
- [x] README.md: runbook, port table, air-gapped mode, sovereignty honesty section, troubleshooting
- [x] Harden .dockerignore: `deploy/.env` and `deploy/certs` were reachable by `COPY . .` (patterns are root-anchored)
- [x] Validate compose YAML parse + network/volume/depends_on referential integrity (pyyaml)
- [x] Confirm every `${VAR}` in compose exists in .env.example (13/13)
- [x] Confirm server imports never escape server/ so `COPY server` is complete
- [x] Confirm `pg` is a runtime dependency for the snapshot backend

## v1.1.16 — Android app: 10 reported issues
- [x] (10) Blank screen when receiving a call — three causes: intent extras never read, no caller identity in the intent, and `sendToUser()` passing `payload.data` (empty for calls) to FCM. Added `callUrlFromIntent()`/`handleCallIntent()`, flattened the FCM payload, resumed the paused WebView before loading.
- [x] (1) Push notifications not arriving outside the app — `deliverMessage()` only emitted over the socket; added per-recipient push with mute/archive/silent/deleted/sender guards, plus the missing Firebase env vars in render.yaml.
- [x] (5) Bottom navbar overflow + active-class mismatch — `flex: 1 1 0`, no fixed padding, ellipsised labels, 46px centre button, 10px insets; `.on` and `.active` both styled. Verified at 320/360/390px: no child exceeds the pill.
- [x] (3) Auto rotation — `screenOrientation` `fullSensor` → `portrait`
- [x] (2) Loading screen — four stacked splash layers unified on one design (wordmark, teal CHAT, tagline, thin indeterminate line); dwell 1250 → 900ms
- [x] (6) Render.com "server waking" page — all free-tier/waking copy removed from the native error box, the React reconnect card and the wake banner; auto-retry 8×7s native / 7s React
- [x] (4) Offline loading — service worker caches shell + assets with a branded offline page; `api.js` caches GETs and serves them on failure. Also fixed the real blocker: the wake-up retry loop waited ~42s on a network-level failure, so offline boot hung on the splash. Network failures now fail fast (2 retries) and fall through to cache.
- [x] (7) Call flow — 550ms minimum dwell in `connecting`, persistent phase pill (ringing/connecting/in call · mm:ss/ended) with per-phase colours
- [x] (8) Communities "For you" — added a real `?feed=for-you` ranked endpoint, a segmented tab control, and an inline honest error card with retry (was a raw toast)
- [x] (9) Edit profile UI — rebuilt as a full-screen `ux-*` editor: cover + camera affordance, centred avatar with edit badge, grouped field cards, live bio counter, `ux-switch` for private profile, sticky Save footer; nav hidden while editing
- [x] Bump 1.1.16 / versionCode 26, rebuild web + APK + iOS zip
- [x] Playwright verify all fixes, commit and push

## v1.1.17 — Incoming call blank screen, real root cause
- [x] Reproduced with two live sessions (Ada → Grace) in Chromium: the web call stage renders on both sides, so the bug is Android-shell-only, not the call logic
- [x] Root cause 1 — keyguard: `setFullScreenIntent()` pointed at `MainActivity`, which never opted into `showWhenLocked`/`turnScreenOn`. Android 8+ launches the activity from a full-screen intent while locked, but draws it *behind* the keyguard → black screen
- [x] Root cause 2 — cold boot: the full-screen target was a WebView that must boot the React bundle and reach the server before `CallStage` can paint. Seconds of nothing, and nothing at all if the request fails
- [x] New native `IncomingCallActivity` — pure framework Views, no WebView, no network, paints on the first frame; gradient initials disc, caller name, call type, Decline / Accept
- [x] `setShowWhenLocked(true)` + `setTurnScreenOn(true)` (API 27+) with `FLAG_SHOW_WHEN_LOCKED`/`FLAG_TURN_SCREEN_ON` fallback for older releases; `FLAG_KEEP_SCREEN_ON`
- [x] Manifest: `showWhenLocked`, `turnScreenOn`, `singleInstance`, `noHistory`, `taskAffinity=""`, `excludeFromRecents`, dedicated `AzolveTheme.Call` (no window preview flash)
- [x] `AzolveMessagingService` now builds a separate full-screen PendingIntent to `IncomingCallActivity` (callId/fromId/type/fromName/declineToken) while `setContentIntent` still points at `MainActivity` for the tray tap
- [x] Decline works without opening the app — posts the short-lived per-call token to `/api/push/decline`
- [x] `onNewIntent` re-reads extras and rebuilds, so a second caller replaces the ring screen instead of showing the previous caller
- [x] 45s auto-dismiss matches `CALL_RING_TIMEOUT_MS`
- [x] `MainActivity` also opts into the keyguard as a second line of defence (warm-start path)
- [x] Verified merged manifest with `aapt2 dump xmltree`: `showWhenLocked=true`, `turnScreenOn=true`, activity present; class present in `classes3.dex`
- [x] Re-ran the two-user Playwright call test: caller stage renders, callee shows "Incoming video call"
- [x] Bump 1.1.17 / versionCode 27, rebuild web + APK + iOS zip

## v1.1.18 — "blank when picked" + "no speech engine"
- [x] Reproduced the real bug: tapping **Accept** threw `ReferenceError: isNativeShell is not defined` inside `startLiveCaption()`, the error escaped the effect and unmounted the whole call stage → blank screen. Confirmed with a two-user Playwright test (PAGEERROR captured at the exact moment of accept).
- [x] `isNativeShell` was called in `livecaption.js` but never defined or imported anywhere. Added `web/src/lib/shell.js` with real detection (AzolvePush/AzolveTts bridge, Capacitor, `AzolveChatApp/` UA, iOS WKWebView) and imported it.
- [x] Captions are now non-fatal: `startLiveCaption()` is wrapped in try/catch inside `CallStage`, so a caption failure reports `liveStatus: error` instead of taking the call down.
- [x] Verified both call types end-to-end after the fix: video → callee `In call · 0:01 → 0:07`, remote audio+video streams attached, captions live; voice → same with audio only. Caller and callee both stay mounted.
- [x] "This browser has no speech engine. Try Chrome, Edge, Safari or Firefox." — Android WebView exposes `speechSynthesis` but has no voices bound, so tap-to-hear was dead in the app. Added a native `TtsBridge` (`window.AzolveTts`) on Android's TextToSpeech engine, registered in `MainActivity`, with `isReady/status/error/hasLanguage/speak/stop/platform` and an utterance-complete callback.
- [x] `speech.js` now routes to the native engine first, waits for it to warm up (`whenNativeReady`), and falls back to `speechSynthesis` in a real browser. Split the web path into `speakWeb()` so both engines are explicit.
- [x] `Hear.jsx` no longer blocks on the Web Speech voice list when the native engine is present, and polls for the engine becoming ready.
- [x] Reworded the failure copy: it now says the *device* has no speech engine and tells Android users to enable "Speech Services by Google", instead of blaming the browser inside an app.
- [x] Verified the routing in isolation: native bridge → 1 native call, `ok:true`; browser → 1 web utterance, `ok:true`; no engine → clean `novoice` with no throw.
- [x] Bump 1.1.18 / versionCode 28, rebuild web + APK + iOS zip

## v1.1.19 — Calls never arrived at all (closed, background, or open)
- [x] Traced the full delivery chain instead of guessing at the layer that looked suspicious (the previous three fixes were each real but each hit the wrong layer).
- [x] **Root cause 1, the whole bug:** `server/realtime.js` `call:start` did `if (isOnline(to)) { emit; return; }`. A backgrounded Android app keeps its Socket.IO connection open — the OS only freezes the WebView's JavaScript — so the callee looked online, the invite was emitted into a page that was not executing, and `sendToUser()` was **never called**. No push → no notification → no ring screen. Replaced with emit-AND-push: the socket is no longer treated as proof that a human can see the ring.
- [x] **Root cause 2:** the `azolve_calls` notification channel was created with no ringtone, so calls arrived with a single default blip. Android channels are immutable after creation, so added `azolve_calls_v2` with a real `TYPE_RINGTONE` sound and deleted the legacy channel in `ensureChannels()`.
- [x] **Root cause 3:** `setFullScreenIntent()` was gated on `Build.VERSION_CODES.Q`, so Android 8 and 9 phones only ever got a tray entry. Full-screen intents have existed since API 1; gate removed.
- [x] **Root cause 4:** the native ring screen had no audio of its own. `IncomingCallActivity` now owns a looping `MediaPlayer` ringtone and a waveform vibration, stopped on accept, decline, timeout and destroy, with `setVolumeControlStream(STREAM_RING)`.
- [x] **Root cause 5:** no way to see which link in the chain was broken. Added `PushBridge.status()` (token, firebase, notifications, full-screen, battery optimisation, sdk), four system-dialog launchers, and a server-free local test notification.
- [x] Foreground claim handshake: when a call push lands while `MainActivity.isForeground`, the service evaluates `window.__azolveNativeCall(...)` in the WebView and waits 1500 ms; if the page claims it, no second ring screen is drawn, and if the page is frozen/crashed/signed-out the OS takes over. A call can never be lost because the WebView was asleep.
- [x] `CallHost.jsx` registers `window.__azolveNativeCall`, tolerates a null socket, and de-duplicates a call that legitimately arrives twice (socket + push).
- [x] Notification Accept and Decline actions; `CallActionReceiver` declines without opening the app.
- [x] `direct_boot_ok: true` on call pushes so a call survives a reboot before first unlock; 45 s TTL.
- [x] Push re-registration on every foreground resume, and the native token poll extended to ~20 s so a cold start over mobile data no longer outlives the loop.
- [x] Settings → Notifications: five green/red status rows, each broken row carrying the exact Android dialog, plus "Test here" (local) and "Send test" (server → Firebase → phone).
- [x] Ops log `[push] call <id> -> user <id>: N device(s)` on every call push, so this can never again be diagnosed blind.
- [x] Verified the fix functionally: with the callee **online**, a call now logs `[push] call call_zaXwExKwejlC -> user u_YLqgqwJldQfy: 0 device(s)` — the push path runs even when the socket ring succeeded, which was impossible before.
- [x] Re-ran the two-user Playwright accept test for both types: video → `In call · 0:07` with remote audio+video; voice → `In call · 0:08` with remote audio. No regression to the online path.
- [x] Bump 1.1.19 / versionCode 29, rebuild web + APK + iOS zip.
