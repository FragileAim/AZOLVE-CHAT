package io.azolve.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives Firebase Cloud Messaging pushes for AZOLVE CHAT.
 *
 * Two shapes arrive here:
 *   1. A "notification" payload, which Android draws itself when the app is in
 *      the background. Nothing to do.
 *   2. A "data" payload, which always arrives here even when the app is dead.
 *      That is the one that matters for calls, because a ringing phone needs a
 *      full-screen intent and a loud channel, not a quiet tray entry.
 *
 * The server sends calls data-only and high priority on purpose: a
 * system-drawn notification cannot carry a full-screen intent, so the phone
 * would buzz in the tray instead of ringing over the lock screen.
 */
public class AzolveMessagingService extends FirebaseMessagingService {

    /**
     * v2 on purpose.
     *
     * A notification channel is immutable once created: sound, importance and
     * vibration can never be changed by an app afterwards, only by the user.
     * v1 was created without a ringtone, so every call arrived with the short
     * default notification blip instead of a ring. A new id is the only way to
     * ship a channel that actually rings.
     */
    public static final String CHANNEL_CALLS = "azolve_calls_v2";
    public static final String CHANNEL_MESSAGES = "azolve_messages";
    /** The old, sound-less call channel. Deleted on upgrade. */
    private static final String CHANNEL_CALLS_LEGACY = "azolve_calls";

    public static final String ACTION_DECLINE = "io.azolve.chat.DECLINE_CALL";
    public static final String ACTION_ACCEPT = "io.azolve.chat.ACCEPT_CALL";

    /** How long the page gets to ring itself before the OS takes over. */
    private static final long FOREGROUND_GRACE_MS = 1500;

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels(this);
    }

    /** Android 8+ refuses to post to a channel that was never created. */
    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        try { nm.deleteNotificationChannel(CHANNEL_CALLS_LEGACY); } catch (Throwable ignored) { }

        NotificationChannel calls = new NotificationChannel(
                CHANNEL_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Rings when someone calls you on AZOLVE CHAT");
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 900, 500, 900, 500, 900});
        calls.setBypassDnd(true);
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        calls.setShowBadge(true);
        calls.setLightColor(Color.parseColor("#2B50FF"));
        calls.enableLights(true);

        /* The actual ringtone. A call that arrives with the default "ping" is a
           call nobody notices, which is the complaint this fixes. */
        Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (ring == null) ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (ring != null) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            calls.setSound(ring, attrs);
        }
        nm.createNotificationChannel(calls);

        NotificationChannel msgs = new NotificationChannel(
                CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_DEFAULT);
        msgs.setDescription("New messages and mentions");
        msgs.enableVibration(true);
        nm.createNotificationChannel(msgs);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        /* The WebView may not be alive yet, so hand the token to the bridge and
           let it deliver whenever the page next asks. */
        PushBridge.setToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> data = msg.getData();
        String kind = data.get("kind");
        boolean isCall = "call".equals(kind) || "incoming_call".equals(kind);

        String title = data.get("title");
        String body = data.get("body");
        if (title == null && msg.getNotification() != null) title = msg.getNotification().getTitle();
        if (body == null && msg.getNotification() != null) body = msg.getNotification().getBody();
        if (title == null) title = "AZOLVE CHAT";

        final String fTitle = title;
        final String fBody = body == null ? "" : body;
        final String callId = data.get("callId");
        final String fromId = data.get("fromId");
        final String type = data.get("type");
        final String fromName = data.get("fromName");
        final String declineToken = data.get("declineToken");

        if (!isCall) {
            show(this, fTitle, fBody, CHANNEL_MESSAGES, callId, false,
                    fromId, type, fromName, declineToken);
            return;
        }

        /* The app is open and the page is running, so let the page ring. That is
           the same stage the socket would have opened, and it avoids a native
           ring screen on top of a call the user is already looking at. If the
           page does not claim the call within the grace period (frozen JS, a
           crashed bundle, a signed-out session) the OS takes over. A call must
           never be lost because the WebView was asleep. */
        MainActivity act = MainActivity.current;
        if (act != null && MainActivity.isForeground) {
            final boolean[] claimed = {false};
            act.evalJsWithResult(nativeCallJs(callId, fromId, fromName, type, declineToken),
                    value -> claimed[0] = "true".equals(value));
            handler.postDelayed(() -> {
                if (claimed[0]) return;
                show(AzolveMessagingService.this, fTitle, fBody, CHANNEL_CALLS, callId, true,
                        fromId, type, fromName, declineToken);
            }, FOREGROUND_GRACE_MS);
            return;
        }

        show(this, fTitle, fBody, CHANNEL_CALLS, callId, true,
                fromId, type, fromName, declineToken);
    }

    /** The snippet the page evaluates to claim a call pushed while it is open. */
    private static String nativeCallJs(String callId, String fromId, String fromName,
                                       String type, String declineToken) {
        StringBuilder sb = new StringBuilder("(function(){try{");
        sb.append("var h=window.__azolveNativeCall;");
        sb.append("if(typeof h!=='function')return false;");
        sb.append("h({callId:").append(quote(callId))
                .append(",fromId:").append(quote(fromId))
                .append(",fromName:").append(quote(fromName))
                .append(",type:").append(quote(type))
                .append(",declineToken:").append(quote(declineToken))
                .append("});return true;}catch(e){return false;}})()");
        return sb.toString();
    }

    private static String quote(String s) {
        return org.json.JSONObject.quote(s == null ? "" : s);
    }

    /** Draws the notification. Also used by MainActivity for a cold-start push. */
    static void show(Context ctx, String title, String body, String channel,
                     String callId, boolean isCall) {
        show(ctx, title, body, channel, callId, isCall, null, null, null, null);
    }

    /**
     * Draws the notification.
     *
     * The caller's id, the call type and the caller's name travel with the
     * PendingIntent because MainActivity needs them to build the `?answer=` URL.
     * Without them the app can open on a call notification but cannot join the
     * call — CallHost requires a peer id to mount the stage, so it silently did
     * nothing and the user saw a black screen.
     */
    static void show(Context ctx, String title, String body, String channel,
                     String callId, boolean isCall,
                     String fromId, String callType, String fromName,
                     String declineToken) {
        ensureChannels(ctx);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;

        /* Tapping the body joins the call. */
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (callId != null) open.putExtra("callId", callId);
        if (isCall) {
            open.putExtra("openCall", true);
            if (fromId != null) open.putExtra("fromId", fromId);
            if (callType != null) open.putExtra("type", callType);
            if (fromName != null) open.putExtra("fromName", fromName);
        }
        PendingIntent pi = PendingIntent.getActivity(ctx, (int) System.currentTimeMillis(), open, flags);

        /* The full-screen intent must NOT be the WebView. See
           IncomingCallActivity: a full-screen intent aimed at MainActivity is
           drawn behind the keyguard and has to cold-boot the bundle, which is
           exactly the blank screen people were seeing when a call arrived. */
        PendingIntent fullScreen = null;
        if (isCall && callId != null) {
            Intent ring = new Intent(ctx, IncomingCallActivity.class);
            ring.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ring.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
            if (fromId != null) ring.putExtra(IncomingCallActivity.EXTRA_FROM_ID, fromId);
            if (callType != null) ring.putExtra(IncomingCallActivity.EXTRA_TYPE, callType);
            if (fromName != null) ring.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
            if (declineToken != null) ring.putExtra(IncomingCallActivity.EXTRA_DECLINE_TOKEN, declineToken);
            fullScreen = PendingIntent.getActivity(ctx, (int) (System.currentTimeMillis() + 1), ring, flags);
        }

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, channel)
                : new Notification.Builder(ctx);

        b.setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.sym_action_call)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setVisibility(Notification.VISIBILITY_PUBLIC);

        if (isCall) {
            b.setCategory(Notification.CATEGORY_CALL);
            b.setOngoing(true);
            b.setPriority(Notification.PRIORITY_MAX);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                /* Pre-O there is no channel, so the ring has to be set here. */
                Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (ring != null) b.setSound(ring);
                b.setVibrate(new long[]{0, 900, 500, 900, 500, 900});
                b.setDefaults(Notification.DEFAULT_LIGHTS);
            }
            /* Not gated on Q any more: full-screen intents have existed since
               API 1, and gating them meant Android 8 and 9 phones only ever got
               a tray entry. */
            if (fullScreen != null) b.setFullScreenIntent(fullScreen, true);

            /* Accept and Decline straight from the shade, so a call can be
               handled without opening the app. The push payload already carries
               a short-lived decline token for exactly this. */
            if (callId != null) {
                Intent accept = new Intent(ctx, MainActivity.class);
                accept.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                accept.putExtra("openCall", true);
                accept.putExtra("callId", callId);
                if (fromId != null) accept.putExtra("fromId", fromId);
                if (callType != null) accept.putExtra("type", callType);
                if (fromName != null) accept.putExtra("fromName", fromName);
                PendingIntent acceptPi = PendingIntent.getActivity(
                        ctx, callId.hashCode(), accept, flags);
                b.addAction(new Notification.Action.Builder(
                        android.R.drawable.sym_action_call, "Accept", acceptPi).build());

                if (declineToken != null && declineToken.length() > 0) {
                    Intent decline = new Intent(ctx, CallActionReceiver.class);
                    decline.setAction(ACTION_DECLINE);
                    decline.putExtra("callId", callId);
                    decline.putExtra("declineToken", declineToken);
                    PendingIntent declinePi = PendingIntent.getBroadcast(
                            ctx, callId.hashCode() + 7, decline, flags);
                    b.addAction(new Notification.Action.Builder(
                            android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi).build());
                }
            }
        } else {
            b.setCategory(Notification.CATEGORY_MESSAGE);
        }

        /* A call notification gets a stable id derived from the callId so that
           IncomingCallActivity can dismiss it the moment the user accepts or
           declines on the native ring screen. Anything else keeps a unique id
           so two messages never overwrite each other. */
        int id = (isCall && callId != null) ? callId.hashCode() : (int) System.currentTimeMillis();
        try {
            nm.notify(id, b.build());
        } catch (Throwable t) {
            android.util.Log.w("AzolvePush", "could not post notification: " + t.getMessage());
        }
    }

    /** Notification id for a call, shared with IncomingCallActivity. */
    public static int callNotificationId(String callId) {
        return callId == null ? 0 : callId.hashCode();
    }
}
