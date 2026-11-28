package io.azolve.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;

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
 * The server sends high priority with channel_id "azolve_calls" for calls, so a
 * call push and a chat push look and behave differently, as they should.
 */
public class AzolveMessagingService extends FirebaseMessagingService {

    public static final String CHANNEL_CALLS = "azolve_calls";
    public static final String CHANNEL_MESSAGES = "azolve_messages";

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

        NotificationChannel calls = new NotificationChannel(
                CHANNEL_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Rings when someone calls you on AZOLVE CHAT");
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 800, 400, 800});
        calls.setBypassDnd(true);
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        calls.setLightColor(Color.parseColor("#2B50FF"));
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

        show(this, title, body == null ? "" : body,
                isCall ? CHANNEL_CALLS : CHANNEL_MESSAGES,
                data.get("callId"), isCall,
                data.get("fromId"), data.get("type"), data.get("fromName"),
                data.get("declineToken"));
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

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (callId != null) open.putExtra("callId", callId);
        if (isCall) {
            open.putExtra("openCall", true);
            if (fromId != null) open.putExtra("fromId", fromId);
            if (callType != null) open.putExtra("type", callType);
            if (fromName != null) open.putExtra("fromName", fromName);
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && fullScreen != null) {
                b.setFullScreenIntent(fullScreen, true);
            }
        } else {
            b.setCategory(Notification.CATEGORY_MESSAGE);
        }

        /* A call notification gets a stable id derived from the callId so that
           IncomingCallActivity can dismiss it the moment the user accepts or
           declines on the native ring screen. Anything else keeps a unique id
           so two messages never overwrite each other. */
        int id = (isCall && callId != null) ? callId.hashCode() : (int) System.currentTimeMillis();
        nm.notify(id, b.build());
    }

    /** Notification id for a call, shared with IncomingCallActivity. */
    public static int callNotificationId(String callId) {
        return callId == null ? 0 : callId.hashCode();
    }
}
