package io.azolve.chat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The screen that answers "someone is calling me" without a WebView.
 *
 * Why this exists
 * ---------------
 * Incoming calls used to raise a full-screen intent that pointed straight at
 * MainActivity. That had two problems, and together they are the "screen goes
 * blank when I receive a call" report:
 *
 *  1. MainActivity never opted into showing over the keyguard. Android 8+ will
 *     launch an activity from a full-screen intent while the phone is locked,
 *     but unless the window sets showWhenLocked/turnScreenOn the activity is
 *     drawn behind the keyguard, so the user sees a blank (black) screen.
 *
 *  2. Even when it did draw, MainActivity is a WebView that has to cold-boot
 *     the React bundle and then reach the server before CallStage can render.
 *     On a cold start over a mobile network that is several seconds of nothing,
 *     which reads as a hang, and if the request fails there is no call UI at
 *     all.
 *
 * This activity is pure framework Views: it paints on the first frame, needs no
 * network, and works with the screen off and the phone locked. Accept hands off
 * to MainActivity through the same `openCall` extras it already understands, so
 * there is still exactly one code path that joins a call. Decline posts to the
 * server's short-lived decline token and never opens the app.
 */
public class IncomingCallActivity extends Activity {

    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_FROM_ID = "fromId";
    public static final String EXTRA_FROM_NAME = "fromName";
    public static final String EXTRA_TYPE = "type";
    public static final String EXTRA_DECLINE_TOKEN = "declineToken";

    private static final long RING_TIMEOUT_MS = 45000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = new Runnable() {
        @Override public void run() { finish(); }
    };

    private String callId;
    private String fromId;
    private String fromName;
    private String type;
    private String declineToken;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* The two lines that stop the blank window. API 27+ has the setters;
           older releases need the window flags. */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (!applyIntent(getIntent())) { finish(); return; }
    }

    /**
     * Read the call out of an intent and (re)draw the screen. Returns false when
     * the intent carries no call, in which case there is nothing to show.
     *
     * `launchMode=singleInstance` means a second caller rings into this same
     * instance through onNewIntent, so the extras have to be re-read and the
     * views rebuilt — otherwise the screen keeps showing the previous caller's
     * name while the phone rings for someone else.
     */
    private boolean applyIntent(Intent intent) {
        callId = intent.getStringExtra(EXTRA_CALL_ID);
        fromId = intent.getStringExtra(EXTRA_FROM_ID);
        fromName = intent.getStringExtra(EXTRA_FROM_NAME);
        type = intent.getStringExtra(EXTRA_TYPE);
        declineToken = intent.getStringExtra(EXTRA_DECLINE_TOKEN);

        if (callId == null || callId.length() == 0) return false;
        if (fromName == null || fromName.length() == 0) fromName = "Someone";
        if (type == null || type.length() == 0) type = "audio";

        setContentView(build());

        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_TIMEOUT_MS);
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!applyIntent(intent)) finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(timeout);
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ UI */

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private View build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0D18"));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), dp(56), dp(28), dp(48));
        FrameLayout.LayoutParams colLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(col, colLp);

        TextView eyebrow = new TextView(this);
        eyebrow.setText(type.equals("video") ? "INCOMING VIDEO CALL" : "INCOMING VOICE CALL");
        eyebrow.setTextColor(Color.parseColor("#7E8AA8"));
        eyebrow.setTextSize(11f);
        eyebrow.setLetterSpacing(0.16f);
        eyebrow.setTypeface(Typeface.DEFAULT_BOLD);
        eyebrow.setGravity(Gravity.CENTER);
        col.addView(eyebrow);

        /* Initials disc. A real avatar would mean a network fetch, and this
           screen must not depend on the network. */
        TextView avatar = new TextView(this);
        avatar.setText(initials(fromName));
        avatar.setTextColor(Color.WHITE);
        avatar.setTextSize(38f);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable disc = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.parseColor("#5B4FF0"), Color.parseColor("#18C8B4")});
        disc.setShape(GradientDrawable.OVAL);
        avatar.setBackground(disc);
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(dp(116), dp(116));
        avLp.topMargin = dp(40);
        col.addView(avatar, avLp);

        TextView name = new TextView(this);
        name.setText(fromName);
        name.setTextColor(Color.WHITE);
        name.setTextSize(28f);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setGravity(Gravity.CENTER);
        name.setMaxLines(2);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nameLp.topMargin = dp(24);
        col.addView(name, nameLp);

        TextView sub = new TextView(this);
        sub.setText(type.equals("video") ? "wants to video call you" : "is calling you");
        sub.setTextColor(Color.parseColor("#9AA3BA"));
        sub.setTextSize(15f);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(8);
        col.addView(sub, subLp);

        View spacer = new View(this);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(0, 0, 1f);
        col.addView(spacer, spLp);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);

        row.addView(actionButton("Decline", "#FF3B4E", new View.OnClickListener() {
            @Override public void onClick(View v) { decline(); }
        }));
        View gapView = new View(this);
        row.addView(gapView, new LinearLayout.LayoutParams(dp(24), dp(1)));
        row.addView(actionButton(type.equals("video") ? "Accept video" : "Accept", "#1FBF75",
                new View.OnClickListener() {
                    @Override public void onClick(View v) { accept(); }
                }));

        col.addView(row);

        TextView hint = new TextView(this);
        hint.setText("Tap Accept to join \u2014 your camera and mic stay off until you do.");
        hint.setTextColor(Color.parseColor("#6C7794"));
        hint.setTextSize(11.5f);
        hint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintLp.topMargin = dp(22);
        col.addView(hint, hintLp);

        return root;
    }

    private View actionButton(String label, String color, View.OnClickListener onClick) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(15f);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        GradientDrawable pill = new GradientDrawable();
        pill.setShape(GradientDrawable.RECTANGLE);
        pill.setCornerRadius(dp(30));
        pill.setColor(Color.parseColor(color));
        b.setBackground(pill);
        b.setClickable(true);
        b.setFocusable(true);
        b.setOnClickListener(onClick);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(148), dp(60)));
        return b;
    }

    private static String initials(String name) {
        String[] parts = name.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length && sb.length() < 2; i++) {
            if (parts[i].length() > 0) sb.append(Character.toUpperCase(parts[i].charAt(0)));
        }
        return sb.length() == 0 ? "?" : sb.toString();
    }

    /* ------------------------------------------------------------- actions */

    private void accept() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("openCall", true);
        open.putExtra("callId", callId);
        if (fromId != null) open.putExtra("fromId", fromId);
        if (fromName != null) open.putExtra("fromName", fromName);
        if (type != null) open.putExtra("type", type);
        startActivity(open);
        finish();
    }

    private void decline() {
        final String token = declineToken;
        if (token != null && token.length() > 0) {
            new Thread(new Runnable() {
                @Override public void run() { postDecline(token); }
            }).start();
        }
        finish();
    }

    /**
     * Tell the server the call was declined so the caller stops ringing.
     *
     * Uses the short-lived per-call token from the push payload rather than a
     * session, because this screen can run with the app closed and the user not
     * signed in on this device. Best effort: if it fails the caller's own ring
     * timeout still ends the call.
     */
    private void postDecline(String token) {
        String base = BuildConfig.APP_URL;
        if (base == null || base.length() == 0) return;
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
        } catch (Exception ignored) {
            /* the ring timeout on the caller side is the backstop */
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
