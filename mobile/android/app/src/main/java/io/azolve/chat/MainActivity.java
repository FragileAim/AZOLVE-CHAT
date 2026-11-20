package io.azolve.chat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import android.app.Activity;

import java.util.ArrayList;
import java.util.List;

/**
 * AZOLVE CHAT — native Android shell.
 *
 * The whole product is the React bundle in assets/www. This Activity exists to give that
 * bundle the things a browser tab cannot: camera + microphone permissions, media autoplay,
 * a file chooser for attachments, hardware back-button navigation and a real launcher icon.
 */
public class MainActivity extends Activity {

    /** Bundled, fully offline build (VITE_DEMO=1) used when no live server is configured. */
    private static final String LOCAL_URL = "file:///android_asset/www/index.html";
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
        s.setUserAgentString(s.getUserAgentString() + " AzolveChatApp/1.0.0");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        web.setBackgroundColor(0xFF07070C);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
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
