# AZOLVE CHAT — v1.1.6 (Phase 1: translation accuracy + Firebase)

## Translation engine (Phase 1)
- [x] Rewrite language detector: Romanised Hindi/Gujarati/Tamil/Telugu/Bengali/Marathi markers, return `und` instead of lying with `en`
- [x] Stop forcing `source_lang=EN` into DeepL so it auto-detects Hinglish
- [x] Pass our detector result to providers as a source hint (fixes romanised Gujarati read as Swedish)
- [x] Do not short-circuit code-mixed text that is already in the target language
- [x] Delete the offline 4-phrase phrasebook that masked failures as translations
- [x] Reject echoed input, same-language output, and MyMemory prose errors
- [x] `backfillLanguages()` + `POST /api/admin/repair-languages` + boot backfill
- [x] Verify 17/17 translation cases via DeepL

## Live captions
- [x] Whisper: stop pinning `language` to the profile language
- [x] Speech engines use the detector, fall back to hint only on `und`
- [x] APK: run the server caption engine first
- [x] Echo guard: drop peer lines captured off the speaker
- [x] Honest caption badge: `translated` only when it really translated
- [x] "Translation unavailable" badge in chat bubbles

## Firebase
- [x] `device_tokens` table + `oauth_sub` migration
- [x] `services/fcm.js` — FCM HTTP v1 via signed RS256 JWT, no Admin SDK
- [x] `push.js` fans out to FCM + web push
- [x] Routes: `/push/firebase-config`, `/push/fcm/register`, `/unregister`, `/status`
- [x] Client `web/src/lib/fcm.js` (native Capacitor plugin + web SDK, honest reasons)
- [x] Wire `registerPush()` into `App.jsx` on sign-in
- [x] Prove JWT signing against Google's OAuth endpoint

## Google login
- [x] `GET /api/auth/providers`
- [x] `POST /api/auth/oauth/google` (ID-token flow)
- [x] `GET /api/auth/oauth/google/start` + `/callback` (session in URL fragment)
- [x] `absorbOAuthFragment()` in `main.jsx`; `Auth.jsx` redirect flow

## Release
- [x] Bump to 1.1.6 (package.json, versionCode 17, UA suffix)
- [x] Build `web/dist`
- [x] Local smoke tests: providers, firebase-config, fcm/status, repair-languages, translation suite
- [x] Regression: 32/32 UX checks, 8/8 onboarding steps
- [x] Remove blocking sandbox script from index.html
- [x] Build live APK v1.1.6 (758 KB, live URL baked, versionCode 17)
- [x] Commit + push + deploy to Render, verify `/api/health` = 1.1.6
- [x] Deliver Firebase setup steps to the user

## Blocked on the user
- [ ] `google-services.json` from Firebase Console (needed to add the Capacitor push plugin and rebuild the APK)
- [ ] Firebase + Google OAuth env vars on Render
