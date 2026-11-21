#!/usr/bin/env bash
# Build the AZOLVE CHAT Android APK from scratch on Linux or macOS.
# Requires: JDK 17, Android SDK (platform 34 + build-tools 34.0.0), Node 20+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
APP_URL="${APP_URL:-}"

echo "==> 1/4  Building the web bundle (offline/demo build)"
cd "$ROOT/web"
VITE_DEMO=1 npx vite build --outDir dist-demo --base ./

echo "==> 2/4  Copying bundle into the Android assets"
rm -rf "$ROOT/mobile/android/app/src/main/assets/www"
mkdir -p "$ROOT/mobile/android/app/src/main/assets/www"
cp -r "$ROOT/web/dist-demo/." "$ROOT/mobile/android/app/src/main/assets/www/"
# Capacitor's own copy of the web bundle is dead weight: the launcher is
# io.azolve.chat.MainActivity, which reads assets/www. Leaving it in shipped two
# copies of the app and made the APK 1.2 MB larger than it needed to be.
rm -rf "$ROOT/mobile/android/app/src/main/assets/public"

echo "==> 3/4  Gradle"
cd "$ROOT/mobile/android"
echo "sdk.dir=$SDK" > local.properties
if [ ! -x ./gradlew ]; then
  echo "    no wrapper found — using system gradle"
  GRADLE_BIN="${GRADLE_BIN:-gradle}"
else
  GRADLE_BIN="./gradlew"
fi

if [ -n "$APP_URL" ]; then
  echo "    live mode: $APP_URL"
  "$GRADLE_BIN" assembleDebug -PappUrl="$APP_URL"
else
  echo "    offline mode (bundled demo bundle)"
  "$GRADLE_BIN" assembleDebug
fi

echo "==> 4/4  Done"
ls -lh "$ROOT/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
