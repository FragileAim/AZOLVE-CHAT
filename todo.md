# AZOLVE CHAT — v1.1.3 (stuck-on-loading fix)

## Root cause
- [x] Reproduce on the live site: splash clears, login screen shows, but "Get started" / "I already have an account" do nothing
- [x] Identify cause: `.ux-welcome` is `height:100dvh` and no rule hid it, so the form rendered below the fold
- [x] Identify desktop cause: `.ux-welcome` claimed the 2nd grid column, pushing the form to row 2

## Fix
- [x] `.auth-wrap.started .ux-welcome { display:none }`
- [x] Hide `.ux-welcome` at `min-width:900px`
- [x] Phone: full-height form panel, card chrome stripped, back button to welcome
- [x] Verify at 390x844 and 1440x900 (`auth-advance.mjs`)
- [x] Regression: `audit-ux.mjs` 32/32 PASS
- [x] Regression: `shot-ux.mjs` 14 screens, 0 overflow, no errors

## Ship
- [x] Commit + push `2dd2a54`
- [x] Deploy to Render — live
- [x] Live check `live-auth.mjs`: both buttons now reveal the form
- [x] Live check `live-form.mjs`: create account → POST /api/auth/email/start 200 → 6-digit code screen
- [x] Confirm deployed bundle MD5 == local tested bundle
- [x] Build `AZOLVE-CHAT-v1.1.3.apk` (versionCode 14, versionName 1.1.3)
- [x] Fix `/api/health` hardcoded version 1.0.0 → real package version (`3647dae`)
- [x] Deploy health fix + verify version string (`/api/health` → 1.1.3, deploy live)
- [x] Final live re-check after deploy: both login buttons advance, no console errors, no network failures

Open: none
