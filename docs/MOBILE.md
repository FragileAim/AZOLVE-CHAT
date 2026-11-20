# AZOLVE CHAT — Mobile apps

Two native shells wrap the exact same React bundle that runs on the web. Nothing is
re-implemented: the app you test in the browser is the app inside the APK / iOS build.

```
mobile/
├── android/            native Android project (Gradle, WebView shell)
├── ios/                native iOS project (Xcode + Capacitor, generated on Linux)
├── capacitor.config.json
└── package.json
```

---

## 1. Android — installable APK (built and ready)

**File:** `dist/AZOLVE-CHAT-android.apk` (≈380 KB)

| | |
|---|---|
| Package | `io.azolve.chat` |
| Version | 1.0.0 (versionCode 1) |
| Min Android | 7.0 (API 24) |
| Target | Android 14 (API 34) |
| Signing | debug key — installable by sideload, **not** Play-Store ready |

### Install on a phone

1. Copy `AZOLVE-CHAT-android.apk` to the device (USB, Google Drive, WhatsApp to yourself).
2. Tap it. Android will warn about "unknown sources" — allow your file manager / browser
   to install unknown apps.
3. Open **AZOLVE CHAT**.

### What the shell adds over a browser tab

- Camera and microphone permission prompts wired to `getUserMedia`, so **voice notes and
  video calls work** inside the app.
- `setMediaPlaybackRequiresUserGesture(false)` — received voice notes and call audio play
  without a second tap.
- A real file chooser for attachments (`onShowFileChooser`), including multi-select.
- Hardware back button: first asks the web app to close a sheet/modal (`window.__azolveBack`),
  then falls back to WebView history, then backgrounds the app.
- `adjustResize` so the composer stays above the keyboard.
- Dark status/navigation bars matching `#07070C`, splash screen with the AZOLVE mark.

### Two build modes

The APK currently ships the **offline build**: the whole UI is bundled inside the APK and
API calls are served by the in-app mock layer. That is why it opens instantly with no
server and no login — it is a design/UX preview, not a live account.

To point the app at your real backend instead:

```bash
cd mobile/android
./gradlew assembleDebug -PappUrl=https://your-service.onrender.com
```

That compiles the URL into `BuildConfig.APP_URL`; `MainActivity` loads it instead of the
bundled assets. Rebuild the web bundle first with the real API base:

```bash
cd web && VITE_API_BASE=https://your-service.onrender.com npx vite build
rm -rf ../mobile/android/app/src/main/assets/www
cp -r dist/. ../mobile/android/app/src/main/assets/www/
```

### Rebuilding from source

```bash
# prerequisites: JDK 17, Android SDK (platform 34, build-tools 34.0.0), Node 20+
export ANDROID_HOME=$HOME/Android/Sdk
bash scripts/build-android.sh                 # offline build
APP_URL=https://your-app.onrender.com bash scripts/build-android.sh   # live build
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### Signed release APK

The release key lives at `mobile/android/keystore/azolve-release-2026.jks`, and its
password is written down in `mobile/android/keystore/CREDENTIALS.txt` — back both
files up. Android identifies an app by its signing key, so losing them means you
can never update an already-installed app.

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
cd mobile/android
gradle assembleRelease -PappUrl=https://azolve-chat.onrender.com \
  -Pandroid.injected.signing.store.file=$PWD/keystore/azolve-release-2026.jks \
  -Pandroid.injected.signing.store.password='AzolveChat2026!' \
  -Pandroid.injected.signing.key.alias=azolve \
  -Pandroid.injected.signing.key.password='AzolveChat2026!'
# → app/build/outputs/apk/release/app-release.apk
```

> **v1.0.0 → v1.0.1:** v1.0.0 was signed with an older key whose password was
> never recorded. Anyone who installed v1.0.0 must uninstall it once before
> installing v1.0.1. Every update after v1.0.1 installs over the top normally.

For the Play Console, `gradle bundleRelease` produces `app-release.aab` instead.

---

## 2. iOS — Xcode project, built on a Mac

**An `.ipa` cannot be produced on this Linux sandbox.** Apple's toolchain (`xcodebuild`,
the iOS SDK, code signing) only exists on macOS, and every installable iOS build must be
signed with an Apple Developer certificate. That is an Apple restriction, not a missing
feature here.

What is delivered instead — a **real, complete Xcode project** generated with Capacitor 6,
already containing the web bundle, the app icon, the splash screen and every permission
string:

```
mobile/ios/App/App.xcodeproj        ← open this in Xcode
mobile/ios/App/App/Info.plist       ← NSCameraUsageDescription, NSMicrophoneUsageDescription, …
mobile/ios/App/App/AppDelegate.swift
mobile/ios/App/Podfile
```

### Build it on a Mac (15 minutes, free)

```bash
# 1. On the Mac: Xcode 15+ from the App Store, then
sudo xcode-select --install
brew install node cocoapods

# 2. Copy the project over, then
cd azolve/mobile
npm install                 # installs @capacitor/ios, needed by the Podfile
cd ios/App && pod install   # creates App.xcworkspace

# 3. Open the workspace (not the .xcodeproj)
open App.xcworkspace
```

In Xcode:

1. Select the **App** target → *Signing & Capabilities* → tick **Automatically manage
   signing** → choose your Apple ID team. (A free Apple ID works for 7-day builds on your
   own device.)
2. Plug in the iPhone, select it as the run destination, press **⌘R**.
3. The app installs and launches. Trust the developer certificate under
   *Settings → General → VPN & Device Management* on the phone the first time.

For TestFlight: *Product → Archive → Distribute App → App Store Connect*, then add the
build to a TestFlight group. Requires a paid Apple Developer Program membership ($99/yr).

### Pointing iOS at your backend

Same as Android: rebuild `web` with `VITE_API_BASE` and run `npx cap copy ios`, or edit
`mobile/capacitor.config.json` and add:

```json
"server": { "url": "https://your-service.onrender.com", "cleartext": false }
```

---

## 3. Works today, no store, no Mac — PWA

The web build is already a valid Progressive Web App. On any phone:

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** open the site → ⋮ → **Install app** / **Add to Home screen**.

It launches full-screen with the AZOLVE icon, keeps its own storage, and supports
camera/microphone after the browser permission prompt. This is the fastest way to let your
team try the real, server-connected product on iOS before an Apple account is set up.

---

## 4. What is identical across all three

| Feature | Web | Android APK | iOS |
|---|---|---|---|
| Per-recipient AI translation (27 languages) | ✅ | ✅ | ✅ |
| Voice notes, media, location | ✅ | ✅ (native mic) | ✅ (native mic) |
| Voice / video calls (WebRTC) | ✅ | ✅ | ✅ |
| Tap-to-hear messages | ✅ | ✅ | ✅ |
| Moments, Social, Communities, AI | ✅ | ✅ | ✅ |
| Push notifications | — | backgrounded WebSocket | backgrounded WebSocket |

Push notifications (FCM/APNs) are **not** wired yet — while the app is open or recently
backgrounded, messages arrive over the live socket; a fully closed app will not wake up.
That needs Firebase (Android) and an APNs key (iOS) plus a small server-side sender. Say
the word and it can be added.
