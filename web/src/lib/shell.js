/* ============================================================================
   SHELL DETECTION
   ----------------------------------------------------------------------------
   "Am I inside the AZOLVE Android/iOS app, or in a real browser?"

   This matters because the two environments have genuinely different
   capabilities, and guessing wrong is what makes features look broken:

   - Android WebView has no working Web Speech recognition engine. The
     constructor is either missing entirely or present-but-silent, so choosing
     it means captions never start.
   - Android WebView has no speechSynthesis voices on most devices, so
     "tap to hear" fails unless we hand the text to the native TTS engine.
   - getUserMedia inside the shell needs the runtime permissions the native
     layer asks for, which behave differently from a browser prompt.

   The native layer injects `window.AzolvePush` (a @JavascriptInterface) and
   appends `AzolveChatApp/<version>` to the user agent, so either signal is
   enough. Nothing here throws if window is absent (SSR / prerender).
   ========================================================================== */

export const isNativeShell = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.AzolvePush) return true;
    if (window.AzolveTts) return true;
    if (window.Capacitor?.isNativePlatform?.()) return true;
    const ua = navigator?.userAgent || '';
    if (/AzolveChatApp\//.test(ua)) return true;
    /* iOS WKWebView reports the app name but not Safari. */
    if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return true;
    return false;
  } catch {
    return false;
  }
};

export const shellPlatform = () => {
  if (typeof window === 'undefined') return 'web';
  if (window.AzolvePush || window.AzolveTts) {
    try { return window.AzolvePush?.platform?.() || 'native'; } catch { return 'native'; }
  }
  return 'web';
};
