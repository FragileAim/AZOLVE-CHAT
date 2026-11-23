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
