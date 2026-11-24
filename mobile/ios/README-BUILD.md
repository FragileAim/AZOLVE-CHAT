# AZOLVE CHAT — iOS build instructions

This is a **complete, dependency-free Xcode project**. There is no CocoaPods, no
`pod install`, and no `npm install`. Open it and press Run.

## Requirements

- A Mac with **Xcode 14 or newer** (free from the Mac App Store)
- macOS 12 or newer
- An Apple ID (a free Apple ID is enough to run the app on your own iPhone)

## Steps

1. Unzip this folder somewhere permanent, e.g. `~/Developer/AZOLVE-CHAT-iOS`.
2. Double-click **`App.xcodeproj`**. (Do not look for an `.xcworkspace` — there
   isn't one, and you don't need one.)
3. In the left sidebar select the blue **App** project icon, then the **App**
   target, then the **Signing & Capabilities** tab.
4. Tick **Automatically manage signing** and choose your **Team** from the
   dropdown. If your Apple ID is not listed, click *Add an Account…* and sign in.
5. If Xcode complains that the bundle identifier is taken, change
   `io.azolve.chat` to something unique, e.g. `io.yourname.azolvechat`.
6. Plug in your iPhone with a cable, unlock it, and tap **Trust** on the phone.
7. Pick your iPhone in the device dropdown at the top of the Xcode window
   (next to the Run ▶ button), then press **Run (⌘R)**.

The first launch on a physical iPhone will fail with *"Untrusted Developer"*.
That is normal for a free Apple ID. Fix it on the phone:

> **Settings → General → VPN & Device Management → Developer App → your Apple ID → Trust**

Then tap the AZOLVE CHAT icon again.

## What you get

The app opens the live production backend at
`https://azolve-chat.onrender.com`, so it always runs the newest build — you do
not need to rebuild the app when the web app changes.

The native layer adds the things a browser tab cannot:

- camera and microphone permission prompts for voice and video calls
- inline media playback (video calls start without an extra tap)
- a native file picker for photo and document attachments
- external links open in Safari instead of being trapped inside the app
- a **"Try again"** screen if the server is asleep

## Important: the free-tier server sleeps

The backend runs on a Render **free** instance. It sleeps after roughly 15
minutes with no traffic, and the next request takes **30–60 seconds** to wake it.
If the app shows *"Could not reach AZOLVE CHAT"*, that is almost always the
server waking up, not a bug. Wait a moment and tap **Try again**.

If you want the app to feel instant for your testers, upgrade the Render service
to the Starter plan and add a 1 GB persistent disk — that removes both the sleep
and the database reset that happens on every redeploy.

## Changing the server address

Open `App/AppDelegate.swift` and edit line 26:

```swift
let AZOLVE_URL = URL(string: "https://azolve-chat.onrender.com")!
```

## Building a distributable .ipa (TestFlight)

Running on your own device needs only the steps above. To send the app to other
people you need a paid **Apple Developer Program** membership (USD 99/year):

1. Signing & Capabilities → set your paid Team.
2. Select **Any iOS Device (arm64)** as the destination.
3. **Product → Archive**.
4. In the Organizer press **Distribute App → App Store Connect → Upload**.
5. Create the app in App Store Connect and add testers under **TestFlight**.

There is no way to produce a signed `.ipa` without an Apple ID and Apple's
toolchain — that is an Apple restriction, not a limitation of this project.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Could not reach AZOLVE CHAT" | Render free tier asleep | Wait 60s, tap Try again |
| "Untrusted Developer" | Free Apple ID | Trust the developer in Settings |
| "No signing certificate" | No Team selected | Pick a Team in Signing & Capabilities |
| Blank white screen | Server unreachable | Check the URL in `AppDelegate.swift` |

---

## Google sign-in (added in v1.1.11)

Google refuses to draw its consent screen inside an embedded WebView and answers
with `disallowed_useragent`. This build therefore runs the whole sign-in flow in
`ASWebAuthenticationSession`, which is a real browser context, and receives the
session back through the `azolve://oauth` URL scheme.

Two pieces make that work, and both are already set up in this project:

- `Info.plist` registers the `azolve` URL scheme under `CFBundleURLTypes`.
- `AppDelegate.swift` catches `/api/auth/oauth/google/start`, opens the session,
  and replays the returned token into the WebView with a forced document load.

You do not need to configure anything for this. It does mean Google sign-in only
works in the **native build** (Option B below). If you install the app from
Safari via *Add to Home Screen* (Option A), Google sign-in opens a separate
Safari window and cannot hand the session back — use email or phone OTP there,
or build the native app.

## Version

This archive is **v1.1.11** (build 22), matching the Android APK and the live
server at `https://azolve-chat.onrender.com`.
