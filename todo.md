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
