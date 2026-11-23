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
