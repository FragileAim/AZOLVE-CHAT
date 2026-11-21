# AZOLVE CHAT — v1.1.2 (buttons + captions)

## Request AJ — every button, every API, correct captions
- [x] Reproduce the "buttons do not navigate" report with a real CDP sweep at 390×844
- [x] Cause 1: the `Mobile view` device-preview pill (`position:fixed; z-index:70; bottom:18px; right:18px`) sat on top of the bottom nav, so Profile and nearby taps hit the pill
- [x] Cause 2: `device === 'mobile'` wrapped the whole app in an iframe, so taps changed the iframe hash and never the page
- [x] Gate the preview behind `?preview=1` only; production renders the app directly
- [x] Navigation truth test: bottom nav, all-screens sheet and 10 deep links — 21/21 behave correctly
- [x] People category chips now refetch the directory by keyword (were highlight-only)
- [x] Explore: For you / Following / Reels are three distinct lists (were one list)
- [x] Profile: Share profile can no longer fail silently
- [x] Hear: reports "voices still loading" instead of doing nothing
- [x] Static API audit: all 84 UI calls resolve to real server routes (119 routes)
- [x] Fix `/api/social/moments` — handler was not `async` after the translation patch, which crashed the server on boot
- [x] Moments captions translate per viewer + real "See original" toggle
- [x] AI captions grounded in the user's own sentence, in their language (was unrelated English templates)
- [x] AI provider timeout 30s → 8s, model chain capped at 3 (was ~60s per caption)
- [x] Click sweep: 35 dead buttons → 10; every remaining one is an active tab, an empty-input Send, or a headless-only mic/speech limit
- [x] `audit-ux.mjs` 32/32 computed-style checks pass
- [x] `shot-ux.mjs` 14 screens, no horizontal overflow, 0 console errors
- [x] Version 1.1.2 / versionCode 13 / iOS build 13
- [x] APK rebuilt and verified (`io.azolve.chat` 1.1.2)
- [x] Committed `11b06a2`, pushed, Render `dep-dc0v3bos00ms73fvfavg` live, bundle hash matches local

## Open
- none
