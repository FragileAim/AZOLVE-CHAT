package io.azolve.chat;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

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

    /* ------------------------------------------------------------------------
       Diagnostics
       ------------------------------------------------------------------------
       "I get no notification when someone calls" has four independent causes
       and they all look identical from the outside:

         1. no device token registered with the server
         2. the notification permission was never granted (Android 13+)
         3. the full-screen intent permission is denied (Android 14+)
         4. the phone's battery optimiser is killing the app in the background

       These methods expose each one so the Settings screen can show the real
       state and offer the exact system dialog that fixes it, instead of asking
       the user to guess.
       --------------------------------------------------------------------- */

    /** A JSON object describing what this device can actually do. */
    @JavascriptInterface
    public String status() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("token", getToken());
            o.put("firebase", available());
            o.put("notifications", notificationsEnabled());
            o.put("fullScreen", fullScreenAllowed());
            o.put("batteryOptimised", batteryOptimised());
            o.put("sdk", Build.VERSION.SDK_INT);
        } catch (Throwable e) {
            try { o.put("error", String.valueOf(e.getMessage())); } catch (Throwable ignored) { }
        }
        return o.toString();
    }

    private boolean notificationsEnabled() {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                if (activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        != PackageManager.PERMISSION_GRANTED) return false;
            }
            NotificationManager nm =
                    (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
            return nm == null || nm.areNotificationsEnabled();
        } catch (Throwable e) {
            return false;
        }
    }

    private boolean fullScreenAllowed() {
        try {
            NotificationManager nm =
                    (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            if (Build.VERSION.SDK_INT >= 34) return nm.canUseFullScreenIntent();
            /* Before 14 the permission is granted at install time. */
            return true;
        } catch (Throwable e) {
            return true;
        }
    }

    private boolean batteryOptimised() {
        try {
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return false;
            return !pm.isIgnoringBatteryOptimizations(activity.getPackageName());
        } catch (Throwable e) {
            return false;
        }
    }

    /** Opens this app's notification settings page. */
    @JavascriptInterface
    public String openNotificationSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return "ok";
        } catch (Throwable e) {
            return "error:" + e.getMessage();
        }
    }

    /** Android 14+: the "allow full-screen notifications" switch. */
    @JavascriptInterface
    public String openFullScreenSettings() {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                i.setData(Uri.parse("package:" + activity.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
                return "ok";
            }
            return openNotificationSettings();
        } catch (Throwable e) {
            return "error:" + e.getMessage();
        }
    }

    /** Asks the system to stop putting the app to sleep, which is what makes
        OEM battery savers drop FCM delivery on Xiaomi, Oppo, Vivo and Realme. */
    @JavascriptInterface
    public String requestBatteryExemption() {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + activity.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return "ok";
        } catch (Throwable e) {
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
                return "ok";
            } catch (Throwable e2) {
                return "error:" + e2.getMessage();
            }
        }
    }

    /**
     * Posts a local notification right now, with no server involved.
     *
     * This isolates the one thing a user cannot otherwise test: whether this
     * phone will draw a notification from this app at all. If the test arrives
     * and a real call does not, the problem is delivery (token / server), not
     * the phone.
     */
    @JavascriptInterface
    public String testNotification(boolean asCall) {
        try {
            activity.runOnUiThread(() -> AzolveMessagingService.show(
                    activity,
                    asCall ? "Test call" : "AZOLVE CHAT notifications work",
                    asCall ? "This is how an incoming call looks on this phone"
                           : "This is how a message notification looks on this phone",
                    asCall ? AzolveMessagingService.CHANNEL_CALLS : AzolveMessagingService.CHANNEL_MESSAGES,
                    null, asCall));
            return "ok";
        } catch (Throwable e) {
            return "error:" + e.getMessage();
        }
    }
}
