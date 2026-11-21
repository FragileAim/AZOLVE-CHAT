# Request AI — Rebuild the real DOM to match the UI/UX team's export (v1.1.1)

The v1.1.0 attempt layered a CSS override sheet over the old markup. The user rejected it:
"the ui/ux which i gave is different and which you gave is totally different". Fix = rewrite the
JSX structure itself to mirror `/tmp/ux/src/pages/*.tsx`, with `.ux-*` classes carrying the
export's exact measurements.

## Foundation
- [x] Re-extract the UXPilot export to `/tmp/ux`
- [x] Read Welcome, ChatList, ConversationTranslation, BottomNav, Profile, Discover, OtpVerification, index.css
- [x] Rewrite `styles-ux.css` as a real design system (tokens, .ux-screen/.ux-scroll/.ux-h1/.ux-round/.ux-search/.ux-filters/.ux-row/.ux-av/.ux-bubble/.ux-orig/.ux-composer/.ux-welcome/.ux-otp/.ux-pf/.mobile-nav)
- [x] Rebuild ChatList JSX (bell+pen header, persistent search, filter pills, PINNED/ALL MESSAGES)
- [x] Rebuild conversation header (back, 40px avatar, name/online, HI→EN chip, 2 round buttons)
- [x] Rebuild composer (plus + pill + mic/send)
- [x] Rename MessageBubble classes + amber ORIGINAL block
- [x] OtpInput → .ux-otp-boxes/.ux-otp-box
- [x] Welcome screen JSX → .ux-welcome

## Remaining screens (JSX, not CSS)
- [x] Auth: sign-in / create-account panel + OTP step (back, 30px title, boxes, meta, verify, custom keypad)
- [x] Profile → Profile.tsx (190px cover, glass buttons, 92px avatar, stats card, action row, tabs, grid)
- [x] People/Discover → Discover.tsx (search + filter icon, category pills, trending chips, creators row)
- [x] Explore/Updates → SocialFeed.tsx
- [x] AI → AiAssistantDark.tsx
- [x] Settings → TranslationSettings.tsx
- [x] Calls → VideoCall.tsx
- [x] Communities → GroupChatDark.tsx
- [x] Moments → StoryViewer.tsx
- [x] Home → Reels.tsx / feed shell

## Verify by self-testing (user demanded it)
- [x] Re-check chat pane overflow against new `.ux-cv-head` (hOverflow:false on all 14 screens)
- [x] Build `dist`, run `node scripts/shot-ux.mjs` (0 console errors)
- [x] `see_image` every screenshot vs the corresponding .tsx; fix mismatches
- [x] Objective computed-style audit `scripts/audit-ux.mjs` → 32/32 PASS
- [x] Fix story-ring inline-span bug (rings were 900px wide on Moments)
- [x] 0 console errors, nav present on all screens

## Ship v1.1.1
- [ ] Bump versionCode 12 / 1.1.1 + iOS 12 / 1.1.1
- [ ] Build dist + dist-demo, copy to Android assets + iOS public
- [ ] Build APK against https://azolve-chat.onrender.com
- [ ] Commit + push main, verify Render redeploy
- [ ] Deliver APK + before/after screenshots
