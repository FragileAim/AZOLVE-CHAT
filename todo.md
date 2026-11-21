# AZOLVE CHAT — Request AC: match the supplied design set, structurally

## 1. Diagnose the real gap
- [x] Pixel-histogram all 10 designs — palette was already byte-exact (#F7F5F0, #0C0F1B, #344FF5, #E3E4F1, #FDF6EC, #0E121F)
- [x] OCR every screen to extract exact geometry (headings, tabs, rows, bubbles)
- [x] Conclude the mismatch was structure/layout, not colour

## 2. Rebuild the structure
- [x] Thin 34px top bar "Azolve Chat — <Screen>" on every screen
- [x] Chat list: 40px "Chats", compose + search actions, centred Personal/Groups/Work pills, design spacing
- [x] Conversation: TODAY divider above the lavender auto-translate banner
- [x] Feed: "Updates" header, underline tabs, story rings, likes above caption
- [x] Profile: cover, 30px name, Public badge, stats, underline tabs
- [x] AI: centred header, private subtitle
- [x] Translation settings: centred title + back, PREVIEW card, four design toggles, language pickers
- [x] Welcome: phone-only hero (wordmark, preview chat, language chips, "Say it your way. They read it theirs.", Get started)
- [x] Discover: title, category chips, Trending now hashtags, popular creators

## 3. Verify
- [x] Production build succeeds
- [x] 80-combination UI sweep: 0 console exceptions, no page overflow
- [x] Screenshots regenerated and compared against the design set

## 4. Ship
- [x] Commit and push to main (aacb2ad) — Render auto-deploy verified (new CSS + classes live)
- [x] Rebuild Android APK v1.0.6 (versionCode 7)
- [x] Rebuild iOS Xcode project v1.0.6 (CURRENT_PROJECT_VERSION 7)
