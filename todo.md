# AZOLVE CHAT — Request AB: match the supplied design set

## 1. Extract the design specification
- [x] Read all 10 screenshots and OCR every screen
- [x] Extract the exact palette (cream #F7F5F0, white, ink #0E121F, Azolve Blue #344FF5, lavender #E3E4F1, cream bubble #FDF6EC, gold #F4BC54)
- [x] Extract the night palette (#0C0F1B page, #181E34 surface, #24293E elevated)
- [x] Lock the type scale (Display 34/800, Title 26/800, Heading 20/700, Body 15/500, Caption 13)

## 2. Build the v4 design layer
- [x] Write `web/src/styles-v4.css` with the exact tokens, radii, shadows and type scale
- [x] Load it last in `main.jsx` so it wins the cascade
- [x] Restyle shell, rail, mobile nav, cards, buttons, inputs
- [x] Restyle chat list, conversation, bubbles, translation banner, original block, composer
- [x] Restyle Explore (Updates title, For you/Following/Reels, stories row, post cards)
- [x] Restyle Profile (verified name, handle, bio, Public badge, stats, highlights)
- [x] Restyle AI (Azolve AI, private subtitle, cards, action chips)
- [x] Restyle Translation settings (preview card + 4 toggles + language pickers)
- [x] Restyle Welcome/auth to the design hero (preview chat card, language chips, headline)

## 3. Add the missing structure from the designs
- [x] Chats: Personal / Groups / Work pill tabs
- [x] Conversation: auto-translation banner with Settings link
- [x] Group messages: "from <language>" tag
- [x] Explore: Updates header, three feed tabs, stories rail
- [x] Settings: translation preview + the four design toggles

## 4. Verify
- [x] Production build succeeds
- [x] 80-combination UI sweep: no horizontal overflow, 0 console exceptions
- [x] Token probe confirms cream/night backgrounds, 800-weight headings, ink active pills
- [x] Conversation renders white incoming bubbles in light and #24293E in dark

## 5. Ship
- [x] Commit and push to main (Render auto-deploy)
- [x] Rebuild Android APK + iOS project as v1.0.5
