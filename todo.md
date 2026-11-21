# AZOLVE CHAT — Request Z: bright default, adaptive UI, fix the UI

## 1. Diagnose honestly
- [x] Rebuild the UI audit so it cannot lie (theme was leaking between runs; hash-only navigation never reloaded React)
- [x] Screenshot + measure all surfaces at phone / small phone / tablet / desktop in both themes
- [x] Separate real defects from false positives (gradient buttons, clipped decorative glows, scroll rails)

## 2. Bright by default
- [x] App.jsx default theme 'light'
- [x] index.html data-theme="light" + theme-color #F6F6FA
- [x] Pre-paint inline script so a saved dark choice never flashes light (and vice versa)

## 3. Adaptive layout
- [x] Fix desktop dead gap: `.app > *` was forcing the fixed rail back into flow (92px double offset)
- [x] Use 100dvh for app + chat so mobile browser chrome cannot clip the chat
- [x] Confirm rail on desktop, floating bottom nav on phone/tablet, single-column chat on phones

## 4. Fix the UI that looked unfinished
- [x] Style `.link-btn` (was a browser-default button, used across auth/home/moments/social)
- [x] Style `.quick-grid button` (AI actions were unstyled)
- [x] Fix chats tab active state (`.active` vs the `on` class the JSX sets)
- [x] Style `.lang-pill`, `.people-row`, `.contact-card`, `.mv-nav`, `.cm-form`, `.cm-upload`, `.cm-cap`, `.ai-compose-panel`, `.acp-*`, `.pill-count`, `.word-cloud`, `.word-chip`
- [x] Raise tap targets: chips 36px, `.btn.tiny` 36px, filters 34px, min button 44px

## 5. Verify + ship
- [x] Audit clean: 0 issues across 72 app surfaces + 6 auth surfaces, both themes
- [x] Seed a real account with a contact + conversation so the audit sees populated screens
- [ ] Build, commit, deploy to Render, verify production
- [ ] Rebuild APK + iOS zip
