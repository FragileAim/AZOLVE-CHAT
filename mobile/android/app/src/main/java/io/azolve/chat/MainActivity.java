package io.azolve.chat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import android.app.Activity;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * AZOLVE CHAT — native Android shell.
 *
 * The whole product is the React bundle in assets/www. This Activity exists to give that
 * bundle the things a browser tab cannot: camera + microphone permissions, media autoplay,
 * a file chooser for attachments, hardware back-button navigation and a real launcher icon.
 */
public class MainActivity extends Activity {

    /**
     * Bundled, fully offline build (VITE_DEMO=1) used when no live server is configured.
     *
     * It is served from a virtual https origin rather than file://. Vite emits ES
     * modules, and a WebView refuses to load a module (or its stylesheet) from a
     * file:// page — "blocked by CORS policy: Cross origin requests are only
     * supported for protocol schemes: http, https…". That left the app showing
     * only the static "AZOLVE CHAT" splash forever: the page finished loading, so
     * the native splash was dismissed, but the bundle never executed.
     */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_URL = "https://" + ASSET_HOST + "/index.html";
    /** Everything the bundled build needs lives under assets/www. */
    private static final String ASSET_ROOT = "www";
    /** How long to wait for the React root to fill before admitting failure. */
    private static final long RENDER_WATCHDOG_MS = 15000;
    /**
     * Live server URL injected at build time:
     *   ./gradlew assembleDebug -PappUrl=https://your-app.onrender.com
     * Empty means "run the bundled offline build".
     */
    private static final String LIVE_URL = BuildConfig.APP_URL;
    private static final int REQ_PERMS = 4101;
    private static final int REQ_FILE = 4102;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;
    private View splash;
    private View errorBox;
    private boolean firstLoadDone;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF07070C);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);

        /* Firebase has to be up before the page loads so a token exists by the
           time the app asks for one. A failure here is not fatal: the app works
           without push, it just will not ring when closed. */
        try {
            com.google.firebase.FirebaseApp.initializeApp(this);
            AzolveMessagingService.ensureChannels(this);
        } catch (Throwable t) {
            android.util.Log.w("AzolvePush", "Firebase init failed: " + t.getMessage());
        }

        /* Push bridge. The page calls window.AzolvePush.getToken() etc. */
        web.addJavascriptInterface(new PushBridge(this), "AzolvePush");

        /* Android 13+ requires the runtime notification permission before any
           notification can be posted. Asking on first launch is the only time
           the prompt makes sense. */
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7001);
        }
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AzolveChatApp/1.1.8");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        web.setBackgroundColor(0xFF07070C);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        /* The backend is a Render free instance that sleeps after ~15 minutes idle.
           A cold start takes 30-60 seconds. Without this overlay the WebView shows
           Chromium's "Webpage not available" page, which looks like a broken app
           rather than a server waking up. */
        splash = buildSplash();
        errorBox = buildErrorBox();
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(errorBox, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        errorBox.setVisibility(View.GONE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                firstLoadDone = true;
                if (splash != null) splash.setVisibility(View.GONE);
                watchForBlankApp();
            }

            /**
             * Serves the bundled build over https so the module graph is same-origin.
             * Returning null lets the request go to the network untouched, which is
             * what the live-server mode needs.
             */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null || !ASSET_HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                return assetResponse(path);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                // Only a failed top-level navigation is worth interrupting the user for.
                if (request != null && !request.isForMainFrame()) return;
                if (firstLoadDone) return;
                if (splash != null) splash.setVisibility(View.GONE);
                if (errorBox != null) errorBox.setVisibility(View.VISIBLE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                String path = uri.getPath() == null ? "" : uri.getPath();

                /* Google refuses to draw its consent screen inside an embedded
                   WebView and answers with "disallowed_useragent". Hand the
                   sign-in start off to the real browser before it ever loads
                   here. Intercepting the start URL as well as Google's own
                   hosts matters: not every WebView build reports a server
                   redirect through this callback, and if the redirect is
                   missed the consent page opens inside the shell and fails. */
                boolean googleAuthStart = path.startsWith("/api/auth/oauth/google/start");
                boolean googleHost = host.endsWith("accounts.google.com") || host.endsWith("accounts.youtube.com");
                if (request.isForMainFrame() && (googleAuthStart || googleHost)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) { }
                    return true;
                }
                // Keep the app inside the WebView; hand external links to the system browser.
                if (scheme.equals("http") || scheme.equals("https") || scheme.equals("file")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    List<String> needed = new ArrayList<>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needed.add(Manifest.permission.RECORD_AUDIO);
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needed.add(Manifest.permission.CAMERA);
                    }
                    if (needed.isEmpty()) { request.grant(request.getResources()); return; }
                    List<String> missing = new ArrayList<>();
                    for (String p : needed) {
                        if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
                    }
                    if (missing.isEmpty()) {
                        request.grant(request.getResources());
                    } else {
                        pendingWebPermission = request;
                        requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(Intent.createChooser(intent, "Select file"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("AzolveWeb", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        // Ask up-front so the first call does not stall on a permission dialog.
        List<String> ask = new ArrayList<>();
        for (String p : new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) ask.add(p);
        }
        if (!ask.isEmpty()) {
            requestPermissions(ask.toArray(new String[0]), REQ_PERMS);
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(LIVE_URL != null && LIVE_URL.length() > 0 ? LIVE_URL : LOCAL_URL);
        }

        /* The app may have been launched *by* the Google return trip, in which
           case the session is already sitting in the intent. */
        handleOAuthIntent(getIntent());
    }

    /**
     * Replay an azolve://oauth?token=… deep link into the WebView.
     *
     * The browser that finished the Google exchange is a different process with
     * its own storage, so the session cannot simply appear in the app. Rewriting
     * the link into the normal `#/auth?token=…` fragment lets the SPA's existing
     * absorbOAuthFragment() store it — one code path for web and app, no second
     * implementation to drift out of sync.
     */
    private void handleOAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        String scheme = data.getScheme() == null ? "" : data.getScheme().toLowerCase();
        String host = data.getHost() == null ? "" : data.getHost().toLowerCase();
        String path = data.getPath() == null ? "" : data.getPath();

        /* Two ways in: the verified App Link (https://…/oauth/app#token=…) and
           the legacy custom scheme (azolve://oauth?token=…). */
        boolean custom = "azolve".equals(scheme) && "oauth".equals(host);
        boolean appLink = "https".equals(scheme) && path.startsWith("/oauth/app");
        if (!custom && !appLink) return;
        if (LIVE_URL == null || LIVE_URL.length() == 0) return;

        /* An App Link carries the session in the fragment, the custom scheme in
           the query. Accept either, whichever is present. */
        String q = appLink ? data.getFragment() : data.getQuery();
        if (q == null || q.length() == 0) q = data.getQuery();
        if (q == null || q.length() == 0) q = data.getFragment();
        if (q == null || q.length() == 0) return;
        if (q.startsWith("?")) q = q.substring(1);

        String base = LIVE_URL.endsWith("/") ? LIVE_URL.substring(0, LIVE_URL.length() - 1) : LIVE_URL;
        /* The unique query is load-bearing. Navigating to the same URL with only
           a different hash is a same-document change: the bundle never re-runs,
           absorbOAuthFragment() never reads the token, and the person is left
           staring at the login form. A fresh query forces a real page load. */
        String target = base + "/?r=" + System.currentTimeMillis() + "#/auth?" + q;
        web.loadUrl(target);
        /* Consume it so a rotation or a resume does not replay a stale token. */
        intent.setData(null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    /**
     * Read a file out of assets/www and answer with the right MIME type. A wrong
     * type here is fatal for module scripts — WebView refuses to execute a module
     * unless it is served as JavaScript.
     */
    private WebResourceResponse assetResponse(String path) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-cache");

        String rel = ASSET_ROOT + path;
        InputStream in = null;
        try {
            in = getAssets().open(rel);
        } catch (IOException missing) {
            /* Unknown path with no extension is an app route (hash routing means
               this is rare) — hand back index.html so the app can render it. */
            if (!path.contains(".")) {
                try {
                    in = getAssets().open(ASSET_ROOT + "/index.html");
                    return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers, in);
                } catch (IOException ignored) { /* fall through to 404 */ }
            }
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
        return new WebResourceResponse(mimeFor(path), "utf-8", 200, "OK", headers, in);
    }

    private String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest") || p.endsWith(".manifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    /**
     * A page that "finishes loading" but renders nothing used to look identical to
     * a slow start: splash gone, blank screen, no way forward. Check that the React
     * root actually has content, and if it does not, say so and offer a retry.
     */
    private void watchForBlankApp() {
        web.postDelayed(() -> {
            if (errorBox != null && errorBox.getVisibility() == View.VISIBLE) return;
            web.evaluateJavascript(
                    "(function(){var r=document.getElementById('root');return r?r.childElementCount:0;})()",
                    value -> {
                        int count = 0;
                        try { count = Integer.parseInt(value.replaceAll("[^0-9]", "")); } catch (Exception ignored) { }
                        if (count > 0) return;
                        if (splash != null) splash.setVisibility(View.GONE);
                        if (errorBox != null) errorBox.setVisibility(View.VISIBLE);
                    });
        }, RENDER_WATCHDOG_MS);
    }

    /** Branded first-paint screen: the mark, the wordmark and a spinner. */
    private View buildSplash() {
        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(0xFF07070C);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView word = new TextView(this);
        word.setText("AZOLVE");
        word.setTextColor(0xFFFFFFFF);
        word.setTextSize(30f);
        word.setTypeface(null, android.graphics.Typeface.BOLD);
        word.setLetterSpacing(0.22f);
        word.setGravity(Gravity.CENTER);

        TextView sub = new TextView(this);
        sub.setText("CHAT");
        sub.setTextColor(0xFF18E0C8);
        sub.setTextSize(12f);
        sub.setLetterSpacing(0.5f);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, 6, 0, 0);

        ProgressBar spin = new ProgressBar(this);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(28), dp(28));
        sp.topMargin = dp(28);

        col.addView(word);
        col.addView(sub);
        col.addView(spin, sp);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        box.addView(col, lp);
        return box;
    }

    /** Shown only when the very first navigation fails — almost always a sleeping server. */
    private View buildErrorBox() {
        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(0xFF07070C);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(32);
        col.setPadding(pad, 0, pad, 0);

        TextView msg = new TextView(this);
        msg.setText("AZOLVE CHAT could not start.\n\nThe server may be waking up — on the free tier that can take up to a minute. Check your connection and try again.");
        msg.setTextColor(0xFFE8E8F0);
        msg.setTextSize(15f);
        msg.setGravity(Gravity.CENTER);
        msg.setLineSpacing(dp(4), 1f);

        TextView retry = new TextView(this);
        retry.setText("Try again");
        retry.setTextColor(0xFFFFFFFF);
        retry.setTextSize(16f);
        retry.setTypeface(null, android.graphics.Typeface.BOLD);
        retry.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF6D5EF8);
        bg.setCornerRadius(dp(12));
        retry.setBackground(bg);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(dp(170), dp(46));
        rp.topMargin = dp(26);
        retry.setOnClickListener(v -> {
            errorBox.setVisibility(View.GONE);
            if (splash != null) splash.setVisibility(View.VISIBLE);
            firstLoadDone = false;
            web.loadUrl(LIVE_URL != null && LIVE_URL.length() > 0 ? LIVE_URL : LOCAL_URL);
        });

        col.addView(msg);
        col.addView(retry, rp);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        box.addView(col, lp);
        return box;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_PERMS) return;
        if (pendingWebPermission != null) {
            List<String> grant = new ArrayList<>();
            for (int i = 0; i < permissions.length; i++) {
                if (results[i] == PackageManager.PERMISSION_GRANTED) {
                    if (permissions[i].equals(Manifest.permission.RECORD_AUDIO)) grant.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                    if (permissions[i].equals(Manifest.permission.CAMERA)) grant.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                }
            }
            if (grant.isEmpty()) pendingWebPermission.deny();
            else pendingWebPermission.grant(grant.toArray(new String[0]));
            pendingWebPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (filePathCallback == null) return;
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(out);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        // Let the web app close a modal / leave a chat first.
        web.evaluateJavascript(
                "(function(){try{return window.__azolveBack ? window.__azolveBack() : 'no';}catch(e){return 'no';}})()",
                value -> {
                    boolean handled = value != null && value.contains("true");
                    if (handled) return;
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        web.pauseTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.resumeTimers();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}
