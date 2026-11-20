# AZOLVE CHAT on iPhone — two ways

There are two ways to get AZOLVE CHAT onto an iPhone. Pick the one that suits you.

| | **Option A — install from Safari** | **Option B — build the Xcode project** |
| --- | --- | --- |
| Time | 20 seconds | ~5 minutes |
| Needs a Mac | No | Yes |
| Needs Xcode | No | Yes |
| Runs full-screen with its own icon | **Yes** | **Yes** |
| Works on any iPhone, including your testers' | **Yes** | Only devices you build for |
| Camera / mic for calls | **Yes** | Yes |
| Can be published to the App Store | No | Yes |

**For your 4–5 testers, use Option A.** It is a real installed app — its own
icon on the home screen, no Safari address bar, no browser chrome — and it works
on every iPhone today with nothing to install on a Mac.

**Option B is for when you want a native binary**, an App Store listing, or
TestFlight distribution.

---

## Option A — Install from Safari (recommended for testing)

The web app is now a proper installable app: it ships a web manifest, Apple touch
icons at every size iOS asks for, and nine launch images so it does not flash
white when it opens.

### Steps on the iPhone

1. Open **Safari** on the iPhone. This must be Safari — Chrome and Firefox on iOS
   cannot add apps to the home screen.
2. Go to **https://azolve-chat.onrender.com**
3. Wait for the app to load. If it shows *"Could not reach AZOLVE CHAT"*, the
   server is waking up — wait a minute and reload.
4. Tap the **Share** button (the square with an arrow pointing up) in the toolbar.
5. Scroll down and tap **Add to Home Screen**.
6. The name will already read **AZOLVE**. Tap **Add**.

You now have an **AZOLVE** icon on the home screen with the brand mark.

### What you get

- Opens **full screen** — no address bar, no Safari toolbar
- Dark status bar matching the app
- Branded launch image instead of a white flash
- Camera and microphone work, so voice and video calls work
- Your session is remembered, so you stay signed in
- It always runs the newest deployed build — no updating required

### Sending it to your testers

Just send them the link and these six steps. Nothing to install, no Apple ID, no
signing, no expiry. This is why it is the right choice for a test round.

---

## Option B — Build the native Xcode project

The zip `AZOLVE-CHAT-iOS-Xcode.zip` contains a complete Xcode project with **no
dependencies at all** — no CocoaPods, no `pod install`, no `npm install`.

### Requirements

- A Mac with **Xcode 14 or newer** (free from the Mac App Store)
- macOS 12 or newer
- An Apple ID — a **free** one is enough to run on your own iPhone

### Steps

1. Unzip `AZOLVE-CHAT-iOS-Xcode.zip` somewhere permanent, e.g.
   `~/Developer/AZOLVE-CHAT-iOS`.
2. Double-click **`App.xcodeproj`**.
   There is no `.xcworkspace` and you do not need one.
3. In the left sidebar click the blue **App** project icon, select the **App**
   target, then open the **Signing & Capabilities** tab.
4. Tick **Automatically manage signing** and choose your **Team**.
   If your Apple ID is not listed, click *Add an Account…* and sign in.
5. If Xcode says the bundle identifier is taken, change `io.azolve.chat` to
   something unique, e.g. `io.yourname.azolvechat`.
6. Connect the iPhone with a cable, unlock it, and tap **Trust** on the phone.
7. Choose your iPhone in the device dropdown at the top of the Xcode window,
   then press **Run (⌘R)**.

### First launch: "Untrusted Developer"

With a free Apple ID the first launch fails with *Untrusted Developer*. That is
normal. Fix it on the phone:

> **Settings → General → VPN & Device Management → Developer App → your Apple ID → Trust**

Then tap the AZOLVE icon again.

### Why there is no ready-made .ipa

A signed `.ipa` can only be produced by Apple's own toolchain, using an Apple ID
and a signing certificate. It cannot be generated on a Linux server, and it
cannot be generated without your Apple ID. This is an Apple restriction, not a
limitation of this project.

So iOS is delivered as a project you build once in Xcode. That is also the only
path to an App Store or TestFlight release.

### Distributing to other people (TestFlight)

Running on your own device needs only the steps above. To send the app to other
people you need a paid **Apple Developer Program** membership (USD 99/year):

1. Signing & Capabilities → set your paid Team.
2. Select **Any iOS Device (arm64)** as the destination.
3. **Product → Archive**.
4. In the Organizer press **Distribute App → App Store Connect → Upload**.
5. Create the app in App Store Connect and add testers under **TestFlight**.

---

## What the native layer adds over Option A

Both options run the same product. Option B adds a few things a web app cannot
do on iOS:

- camera and microphone permission prompts handled natively for WebRTC
- inline media playback, so a video call starts without an extra tap
- a native document picker for photo and document attachments
- external links open in Safari instead of being trapped in the app
- a "Try again" screen when the server is asleep

---

## The free-tier caveat

The backend runs on a Render **free** instance. It sleeps after roughly 15
minutes without traffic, and the next request takes **30–60 seconds** to wake it.

If the app shows *"Could not reach AZOLVE CHAT"*, that is almost always the
server waking up, not a bug. Wait a moment and tap **Try again**.

Render free also has **no persistent disk**, so the database resets on every
deploy. During a test round, avoid deploying. Upgrading to Starter with a 1 GB
disk ($7.25/month) removes both the sleep and the reset.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No "Add to Home Screen" in the share sheet | Not using Safari | Open the link in Safari, not Chrome |
| Icon is a screenshot of the page | Cached the old page | Reload, then add again |
| "Could not reach AZOLVE CHAT" | Render free tier asleep | Wait 60s, tap Try again |
| "Untrusted Developer" (Option B) | Free Apple ID | Unlock, trust the developer in Settings |
| "No signing certificate" (Option B) | No Team selected | Pick a Team in Signing & Capabilities |
| Blank white screen (Option B) | Server unreachable | Check the URL in `AppDelegate.swift` |
