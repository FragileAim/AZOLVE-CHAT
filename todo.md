# AZOLVE CHAT — v1.1.5 (privacy step cannot scroll)

## Reproduced
- [x] Drove a fresh account through onboarding at 390x844 to the Privacy step
- [x] `.onb` computed `overflow-y: visible`, `scrollHeight == clientHeight` (961/961) — nothing to scroll
- [x] "Enter AZOLVE CHAT" at y=847 in an 844px viewport: 3px below the fold, unreachable
- [x] 360x640: step overflowed by 332px with no way to reach it
- [x] Cause: `html, body, #root` are `100dvh` + `overflow:hidden !important`; `.onb` had no scroll container of its own

## Fix
- [x] `.onb` is its own scroll container: 100dvh, `overflow-y:auto`, top-aligned (a centred flex box taller than its viewport loses its top)
- [x] Safe-area padding + iOS momentum scrolling + `overscroll-behavior: contain`
- [x] Children `flex: 0 0 auto` so the form scrolls instead of squeezing
- [x] Step buttons sticky to the bottom of the scrollport on a solid backdrop; static on desktop
- [x] `.onb-card` margin reset (styles.css `margin:auto` fought the scroll position)

## Verify
- [x] `onb-scroll.mjs`: overflowY auto, max scroll 85, button visible at y=774
- [x] `onb-steps.mjs`: 8/8 PASS across 390x844 and 360x640, all four steps, 0 fields hidden behind the bar
- [x] `onb-complete.mjs`: pressing "Enter AZOLVE CHAT" saves and lands in the app, 5 nav buttons
- [x] `audit-ux.mjs` 32/32 PASS
- [x] `shot-ux.mjs` 14 screens, no horizontal overflow, `errors []`
- [x] Live CSS MD5 matches local build and contains the rule
- [x] APK v1.1.5 / versionCode 16 contains the rule
- [x] Deploy 98a61f7 live, /api/health → 1.1.5

Open: none
