# Request AH — Adopt the UI/UX team's UXPilot design, ship as a real app

## Design system
- [x] Extract the UXPilot export (12 screens) and read tokens + Tailwind config
- [x] Author `web/src/styles-ux.css` loaded last (Manrope, #2b50ff, #f7f5f0, #0d1220, amber, 30px titles, floating pill nav)
- [x] Kill web-app chrome: hide `.topbar`, zero `.page-wrap`, no scrollbars, no text-select, no tap-highlight, 100dvh
- [x] Restyle cards, buttons, chips, inputs, auth, chat list, conversation, call, profile, settings
- [x] Rebuild the shell: 5-slot floating nav (Chats · Discover · + · Updates · Profile) + "All screens" bottom sheet
- [x] Keep every feature reachable (Home, Moments, AI, Calls, Communities, Settings, Admin, theme toggle)

## Fixes found by the harness
- [x] Conversation pane measured 475px in a 390px viewport (grid `1fr` min-content bug) → `minmax(0,1fr)` + min-width:0
- [x] Re-run harness: conversation `hOverflow:false`, `offenders:[]`
- [x] Discover anonymous 79px decorative offender (hOverflow already false — cosmetic)

## Verify
- [x] Harness across welcome, chats, conversation, profile, discover, feed, settings, ai, sheet
- [x] Floating nav at y:746 h:68 w:338 bg rgb(13,18,32), 5 buttons on every screen
- [x] Titles resolve (Chats, Discover, Updates, Settings, Azolve AI)
- [x] 0 console errors

## Ship v1.1.0
- [x] Bump versionCode 11 / versionName 1.1.0, iOS CURRENT_PROJECT_VERSION 11 / MARKETING_VERSION 1.1.0
- [x] Build `dist` + `dist-demo`, copy into Android assets + iOS public
- [x] Build APK (live backend https://azolve-chat.onrender.com)
- [x] Commit + push main, Render redeploy, verify /api/health 200 + new bundle hash
- [x] Deliver APK + screenshots
