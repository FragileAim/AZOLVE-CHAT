package io.azolve.chat;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * The bridge the web layer talks to for push.
 *
 * The Capacitor PushNotifications plugin is not usable here because MainActivity
 * is a plain android.app.Activity, not a Capacitor BridgeActivity, and pulling in
 * the whole Capacitor bridge just for push would add megabytes to a 750 KB APK.
 * So the page calls window.AzolvePush instead, which is a handful of methods.
 *
 * Everything returns a string and never throws across the bridge: an exception
 * thrown in a @JavascriptInterface method kills the WebView silently, which is
 * exactly the kind of failure that is impossible to diagnose in the field.
 */
public class PushBridge {

    private static final String TAG = "AzolvePush";
    private static final String PREFS = "azolve_push";
    private static final String KEY_TOKEN = "fcm_token";

    /* The token can arrive before the page exists. Keep it here so a late
       getToken() call still gets the right answer. */
    private static volatile String cachedToken = null;

    private final Activity activity;

    PushBridge(Activity activity) {
        this.activity = activity;
    }

    static void setToken(String token) {
        cachedToken = token;
        try {
            Context ctx = FirebaseApp.getInstance().getApplicationContext();
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putString(KEY_TOKEN, token).apply();
        } catch (Throwable t) {
            Log.w(TAG, "could not persist token: " + t.getMessage());
        }
    }

    /** Last known token, or an empty string. Never blocks. */
    @JavascriptInterface
    public String getToken() {
        if (cachedToken != null && !cachedToken.isEmpty()) return cachedToken;
        try {
            SharedPreferences sp = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String t = sp.getString(KEY_TOKEN, "");
            return t == null ? "" : t;
        } catch (Throwable e) {
            return "";
        }
    }

    /**
     * Asks Firebase for the token. A synchronous JS call cannot wait on a
     * network round trip, so this returns immediately and the page polls
     * getToken(). Returns "ok" when a token is already known, "pending" when a
     * fetch was started, "error:..." when Firebase refused.
     */
    @JavascriptInterface
    public String requestToken() {
        String existing = getToken();
        if (!existing.isEmpty()) return "ok";
        try {
            FirebaseMessaging.getInstance().getToken()
                    .addOnSuccessListener(t -> setToken(t))
                    .addOnFailureListener(e -> Log.w(TAG, "token fetch failed: " + e.getMessage()));
            return "pending";
        } catch (Throwable e) {
            Log.w(TAG, "requestToken: " + e.getMessage());
            return "error:" + e.getMessage();
        }
    }

    /** Subscribes to a topic so a broadcast can reach every install. */
    @JavascriptInterface
    public String subscribe(String topic) {
        try {
            FirebaseMessaging.getInstance().subscribeToTopic(topic);
            return "ok";
        } catch (Throwable e) {
            return "error:" + e.getMessage();
        }
    }

    /** Lets the page show a notification for a push it received in the foreground. */
    @JavascriptInterface
    public String notify(String title, String body, boolean isCall) {
        try {
            activity.runOnUiThread(() -> AzolveMessagingService.show(
                    activity, title, body,
                    isCall ? AzolveMessagingService.CHANNEL_CALLS : AzolveMessagingService.CHANNEL_MESSAGES,
                    null, isCall));
            return "ok";
        } catch (Throwable e) {
            return "error:" + e.getMessage();
        }
    }

    /** True when Firebase actually initialised, so the page can report honestly. */
    @JavascriptInterface
    public boolean available() {
        try {
            return !FirebaseApp.getApps(activity).isEmpty();
        } catch (Throwable e) {
            return false;
        }
    }
}
