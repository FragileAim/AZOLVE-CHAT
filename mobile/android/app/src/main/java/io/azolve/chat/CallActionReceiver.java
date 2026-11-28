package io.azolve.chat;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles the Decline button on a call notification.
 *
 * The notification is posted by AzolveMessagingService, which may run with the
 * app closed and nobody signed in on this device. A BroadcastReceiver is the
 * only component that can be started from a notification action without
 * bringing up an Activity, so declining a call never flashes the app open.
 *
 * The server call is authenticated by the short-lived per-call token in the
 * push payload, not by a session. Best effort: if it fails, the caller's own
 * ring timeout still ends the call.
 */
public class CallActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        if (!AzolveMessagingService.ACTION_DECLINE.equals(intent.getAction())) return;

        final String callId = intent.getStringExtra("callId");
        final String token = intent.getStringExtra("declineToken");

        /* Drop the ringing entry immediately; the network call can take a
           moment and the user has already made their choice. */
        if (callId != null) {
            try {
                NotificationManager nm =
                        (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(AzolveMessagingService.callNotificationId(callId));
            } catch (Throwable ignored) { }
        }

        if (token == null || token.isEmpty()) return;

        final Context app = ctx.getApplicationContext();
        new Thread(() -> postDecline(app, token)).start();
    }

    private static void postDecline(Context ctx, String token) {
        String base = BuildConfig.APP_URL;
        if (base == null || base.isEmpty()) return;
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        HttpURLConnection c = null;
        try {
            URL url = new URL(base + "/api/push/decline");
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            String body = "{\"token\":\"" + token.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.close();
            c.getResponseCode();
        } catch (Throwable ignored) {
            /* The caller's ring timeout is the backstop. */
        } finally {
            if (c != null) try { c.disconnect(); } catch (Throwable ignored) { }
        }
    }
}
