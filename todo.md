# AZOLVE CHAT — v1.1.4 (APK stuck on "AZOLVE CHAT" splash)

## Reproduced
- [x] APK loads `file:///android_asset/www/index.html`; Vite emits ES modules
- [x] WebView blocks the module + stylesheet over file://: "Cross origin requests are only supported for protocol schemes: http, https…"
- [x] `onPageFinished` still fires, so the native splash is dismissed and the user is left with the unstyled "AZOLVE CHAT" markup forever
- [x] Proved the bundle itself is fine: same files over http render the full app, 0 errors

## Fix
- [x] Serve the bundle from a virtual `https://appassets.androidplatform.net` origin via `shouldInterceptRequest`
- [x] Correct MIME types (text/javascript for modules), CORS header, SPA fallback to index.html
- [x] Render watchdog: 15s after load, if `#root` is empty, show the error screen + Try again instead of a silent blank
- [x] Clearer error copy (covers waking server and failed start)
- [x] Ship APK pointed at the live backend (real accounts, no sample data)
- [x] Drop Capacitor's duplicate `assets/public` copy — APK 1.4 MB → 790 KB
- [x] v1.1.4 / versionCode 15

## Verify
- [x] badging: io.azolve.chat, versionCode 15, versionName 1.1.4, minSdk 24, targetSdk 34
- [x] dex contains appassets host, live URL, text/javascript, watchdog
- [x] launcher activity = io.azolve.chat.MainActivity
- [x] live site re-checked at 390x844: login advances, create account → 200 → code screen

Open: none
