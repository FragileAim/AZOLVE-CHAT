package io.azolve.chat;

import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Locale;

/**
 * Native text-to-speech for the WebView.
 *
 * Why this exists
 * ---------------
 * "Tap to hear" used the Web Speech API (speechSynthesis). Android WebView
 * exposes the object but almost never has a voice list bound to it, because the
 * TTS engine is a separate app that the WebView does not enumerate. So every
 * tap ended in "This browser has no speech engine" — the feature was dead in
 * the app even though the phone can obviously speak.
 *
 * The phone's own TextToSpeech engine is right there, so we hand the text to it
 * instead. The web layer prefers this bridge when it is present and falls back
 * to speechSynthesis in a real browser.
 *
 * Everything is guarded: a TTS engine that fails to initialise reports
 * `ready:false` rather than throwing, because an exception inside a
 * @JavascriptInterface method kills the WebView silently.
 */
public class TtsBridge {

    private final Context ctx;
    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean failed = false;
    private volatile String pendingLang = null;
    private volatile String lastError = null;

    public TtsBridge(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        try {
            tts = new TextToSpeech(this.ctx, status -> {
                if (status == TextToSpeech.SUCCESS) {
                    ready = true;
                    try {
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) { /* no-op */ }
                            @Override public void onDone(String id) { notifyDone(id, true); }
                            @Override public void onError(String id) { notifyDone(id, false); }
                            @Override public void onError(String id, int code) { notifyDone(id, false); }
                        });
                    } catch (Throwable ignored) { /* listener is optional */ }
                    if (pendingLang != null) { applyLang(pendingLang); pendingLang = null; }
                } else {
                    failed = true;
                    lastError = "The phone's text-to-speech engine did not start.";
                }
            });
        } catch (Throwable e) {
            failed = true;
            lastError = String.valueOf(e.getMessage());
        }
    }

    /** Tell the page that an utterance finished so the UI can drop its spinner. */
    private void notifyDone(String id, boolean ok) {
        try {
            MainActivity act = MainActivity.current;
            if (act == null) return;
            act.runOnUiThread(() -> act.evalJs(
                    "window.__azolveTtsDone && window.__azolveTtsDone(" +
                            JSONObject.quote(id) + "," + ok + ")"));
        } catch (Throwable ignored) { /* page may be gone */ }
    }

    private boolean applyLang(String lang) {
        if (tts == null || !ready) { pendingLang = lang; return false; }
        try {
            Locale loc = toLocale(lang);
            int avail = tts.isLanguageAvailable(loc);
            if (avail == TextToSpeech.LANG_MISSING_DATA || avail == TextToSpeech.LANG_NOT_SUPPORTED) {
                /* Fall back to the device default rather than staying silent. */
                tts.setLanguage(Locale.getDefault());
                return false;
            }
            tts.setLanguage(loc);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    private static Locale toLocale(String lang) {
        String l = lang == null ? "en" : lang.trim();
        if (l.isEmpty()) l = "en";
        String[] parts = l.replace('_', '-').split("-");
        if (parts.length >= 2 && parts[1].length() == 2) {
            return new Locale(parts[0], parts[1].toUpperCase(Locale.ROOT));
        }
        return new Locale(parts[0]);
    }

    /* ------------------------------ JS surface ---------------------------- */

    @JavascriptInterface
    public boolean isReady() {
        return ready && !failed && tts != null;
    }

    @JavascriptInterface
    public String status() {
        if (failed) return "failed";
        if (ready) return "ready";
        return "starting";
    }

    @JavascriptInterface
    public String error() {
        return lastError == null ? "" : lastError;
    }

    /** True when the device actually has voice data for this language. */
    @JavascriptInterface
    public boolean hasLanguage(String lang) {
        if (tts == null || !ready) return false;
        try {
            int avail = tts.isLanguageAvailable(toLocale(lang));
            return avail >= TextToSpeech.LANG_AVAILABLE;
        } catch (Throwable e) {
            return false;
        }
    }

    /**
     * Speak text. Returns the utterance id, or "" when it could not start.
     * `rate`/`pitch` are the same 0.5–2.0 range the web API uses.
     */
    @JavascriptInterface
    public String speak(String text, String lang, float rate, float pitch, String id) {
        if (tts == null || !ready) {
            lastError = failed ? "No text-to-speech engine on this device." : "Text-to-speech is still starting.";
            return "";
        }
        String body = text == null ? "" : text.trim();
        if (body.isEmpty()) return "";
        String uid = (id == null || id.isEmpty()) ? "u" + System.currentTimeMillis() : id;
        try {
            applyLang(lang);
            float r = Math.max(0.5f, Math.min(2.0f, rate <= 0 ? 1f : rate));
            float p = Math.max(0.5f, Math.min(2.0f, pitch <= 0 ? 1f : pitch));
            tts.setSpeechRate(r);
            tts.setPitch(p);

            int rv;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Bundle params = new Bundle();
                rv = tts.speak(body, TextToSpeech.QUEUE_FLUSH, params, uid);
            } else {
                HashMap<String, String> params = new HashMap<>();
                params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, uid);
                rv = tts.speak(body, TextToSpeech.QUEUE_FLUSH, params);
            }
            if (rv != TextToSpeech.SUCCESS) {
                lastError = "The speech engine refused the request.";
                return "";
            }
            return uid;
        } catch (Throwable e) {
            lastError = String.valueOf(e.getMessage());
            return "";
        }
    }

    @JavascriptInterface
    public void stop() {
        try { if (tts != null) tts.stop(); } catch (Throwable ignored) { /* nothing to stop */ }
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    /** Called from MainActivity.onDestroy so the engine is not leaked. */
    public void shutdown() {
        try {
            if (tts != null) { tts.stop(); tts.shutdown(); }
        } catch (Throwable ignored) { /* already gone */ }
        tts = null;
        ready = false;
    }
}
