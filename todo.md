# AZOLVE CHAT — Request AD: welcome page must not require scrolling

## A. Reproduce & measure
- [x] Measure welcome hero and post-"Get started" form geometry via CDP at 360×640, 375×667, 390×844, 414×896
- [x] Identify the submit button's real label ("Email me a code" / "Create account & email my code")

## B. Fix the transition
- [x] Add `started` state so the hero is replaced by the form (not appended below it)
- [x] Hide `.auth-mobile-hero` entirely once started
- [x] Make `.auth-panel.started` a full-height flex column with a borderless transparent card
- [x] Add a back chevron that restores the hero
- [x] Tighten vertical rhythm (tabs, h2, sub, fields, buttons)
- [x] Short-screen rules (≤740px height) drop legal footnote / OAuth row
- [x] Trim hero spacing on short screens so "Get started" sits above the fold

## C. Verify
- [x] All 8 size × mode combinations: `scrollH === viewport`, primary CTA visible, hero hidden
- [x] Hero at all 4 sizes: `scrollH === viewport`, CTA visible
- [x] Back button restores hero
- [x] Full UI sweep: 0 console exceptions, no page-level overflow

## D. Build hardening
- [x] Discover CSS minifier emitted `width<=899px` range syntax (breaks iOS < 16.4 / old Android WebView)
- [x] Pin `cssTarget` to chrome87/safari13/firefox78/edge88 → classic `max-width` queries
- [x] Confirm 0 range-syntax queries in the built CSS

## E. Ship
- [x] Bump to v1.0.7 (versionCode 8, CURRENT_PROJECT_VERSION 8, MARKETING_VERSION 1.0.7)
- [x] Rebuild APK with corrected CSS, verify bundled asset hash + media queries
- [x] Rebuild iOS project zip
- [x] Commit + push `main`, confirm Render auto-deploy
- [x] Verify live CSS hash, absence of range syntax, `/api/health` 200
