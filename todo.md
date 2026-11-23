# AZOLVE CHAT — v1.1.6 (Phase 1: translation accuracy + Firebase)

## Translation engine (Phase 1)
- [x] Rewrite language detector: Romanised Hindi/Gujarati/Tamil/Telugu/Bengali/Marathi markers, return `und` instead of lying with `en`
- [x] Stop forcing `source_lang=EN` into DeepL so it auto-detects Hinglish (`detected_source_language: OM`)
- [x] Delete the offline 4-phrase phrasebook that masked failures as translations
- [x] Reject echoed input and same-language "translations" as `translated: false`
- [x] Reject MyMemory prose errors instead of showing them as translations
- [x] `backfillLanguages()` + `POST /api/admin/repair-languages` to repair stored `original_lang`
- [x] Deferred backfill on server boot
- [x] Verify 10/10 translation cases via DeepL

## Live captions
- [x] Whisper: stop pinning `language` to the profile language
- [x] Speech engines use the detector, fall back to hint only on `und`
- [x] APK: run the server caption engine first (WebView has no usable recogniser)
- [x] Echo guard: drop peer lines captured off the speaker
- [x] Honest caption badge: `translated` only when it really translated, `translation unavailable` otherwise
- [x] "Translation unavailable" badge in chat bubbles

## Firebase
- [x] `device_tokens` table + `oauth_sub` migration
- [x] `services/fcm.js` — FCM HTTP v1 via signed RS256 JWT, no Admin SDK
- [x] `push.js` fans out to FCM + web push
- [x] Routes: `GET /push/firebase-config`, `POST /push/fcm/register`, `POST /push/fcm/unregister`, `GET /push/fcm/status`
- [x] Client `web/src/lib/fcm.js` (native Capacitor plugin + web SDK, honest reasons)
- [x] Wire `registerPush()` into `App.jsx` on sign-in

## Google login
- [x] `GET /api/auth/providers`
- [x] `POST /api/auth/oauth/google` (ID-token flow)
- [x] `GET /api/auth/oauth/google/start` + `/callback` (redirect flow, session in URL fragment)
- [x] `absorbOAuthFragment()` in `main.jsx`
- [x] `Auth.jsx` uses redirect flow with honest not-configured messaging

## Release
- [x] Bump to 1.1.6 (package.json, versionCode 17, UA suffix)
- [ ] Build `web/dist`
- [ ] Local smoke tests: providers, firebase-config, fcm/status, repair-languages, translation suite
- [ ] Regression: audit-ux + onboarding steps
- [ ] Commit + push + deploy to Render, verify `/api/health`
- [ ] Deliver Firebase setup steps to the user
