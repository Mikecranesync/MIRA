package com.factorylm.mira;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * Blank-white-screen recovery, native half (#3392).
 *
 * Two proven paths leave a live, top-resumed Activity wrapping a WebView that paints
 * nothing: Android kills the sandboxed renderer while we are backgrounded, and a plain
 * return from the system photo picker with no renderer kill at all. A bare
 * BridgeActivity does nothing in either case, so the technician gets a white screen
 * whose only exit is force-stop.
 *
 * 1. Renderer gone: Android's contract is that returning false kills the whole app;
 *    returning true means WE must rebuild the WebView. We recreate the Activity, which
 *    rebuilds the Capacitor bridge and WebView from scratch (the dead view must not be
 *    touched). Session cookies live in the native store, the tab in Preferences.
 * 2. Resumed to nothing: after a real background/foreground round-trip we probe the page
 *    from outside — is the React root populated? If the probe reports empty, or the
 *    renderer never answers, we reload the (local-origin) page. Guarded so the very first
 *    onResume of a cold start, when the page is still booting, can never loop.
 *
 * The JS half (src/lib/resume-guard.ts) runs the same check from inside the page.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MiraWebViewRecovery";
    private static final long PROBE_DELAY_MS = 1200;
    private static final long PROBE_TIMEOUT_MS = 2500;
    private static final long RECOVER_COOLDOWN_MS = 6000;

    private static final String PROBE_JS =
        "(function(){var r=document.getElementById('root');if(!r)return 'no-root';" +
        "if(r.childElementCount===0)return 'empty';" +
        "var b=document.body.getBoundingClientRect();if(b.width===0||b.height===0)return 'zero';" +
        "return 'ok'})()";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pageLoaded = false;
    private boolean wasPaused = false;
    private boolean recovering = false;
    private Runnable pendingProbe;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() == null) return; // no-webview fallback layout
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageStarted(WebView webView) {
                        pageLoaded = false;
                    }

                    @Override
                    public void onPageLoaded(WebView webView) {
                        pageLoaded = true;
                        recovering = false;
                    }

                    @Override
                    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                        Log.w(TAG, "WebView renderer gone (didCrash=" + detail.didCrash() + "); recreating activity");
                        pageLoaded = false;
                        // Post so we never touch the dead WebView from inside its own callback.
                        handler.post(MainActivity.this::recreate);
                        return true;
                    }
                }
            );
    }

    @Override
    public void onPause() {
        super.onPause();
        wasPaused = true;
        cancelProbe();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Only after a genuine background round-trip, and only once the page has loaded
        // at least once — the cold-start onResume must never probe a still-booting page.
        if (!wasPaused || !pageLoaded || recovering) return;
        cancelProbe();
        pendingProbe = this::probeRendered;
        handler.postDelayed(pendingProbe, PROBE_DELAY_MS);
    }

    private void cancelProbe() {
        if (pendingProbe != null) {
            handler.removeCallbacks(pendingProbe);
            pendingProbe = null;
        }
    }

    private void probeRendered() {
        pendingProbe = null;
        final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv == null || recovering) return;
        // A surface that merely stopped painting gets a fresh frame.
        wv.invalidate();

        final boolean[] answered = { false };
        final Runnable timeout = () -> {
            if (!answered[0]) {
                answered[0] = true;
                recover(wv, "probe timed out (renderer not answering)");
            }
        };
        handler.postDelayed(timeout, PROBE_TIMEOUT_MS);
        try {
            wv.evaluateJavascript(
                PROBE_JS,
                value -> {
                    if (answered[0]) return;
                    answered[0] = true;
                    handler.removeCallbacks(timeout);
                    if (!"\"ok\"".equals(value)) {
                        recover(wv, "probe returned " + value);
                    } else {
                        Log.d(TAG, "resume probe ok");
                    }
                }
            );
        } catch (RuntimeException e) {
            answered[0] = true;
            handler.removeCallbacks(timeout);
            recover(wv, "probe threw " + e);
        }
    }

    private void recover(WebView wv, String why) {
        if (recovering) return;
        recovering = true;
        Log.w(TAG, "UI not rendered after resume: " + why + "; reloading page");
        try {
            wv.reload();
        } catch (RuntimeException e) {
            Log.w(TAG, "reload failed (" + e + "); recreating activity");
            recreate();
            return;
        }
        // If onPageLoaded never clears the flag (renderer truly dead), fall back to recreate.
        handler.postDelayed(
            () -> {
                if (recovering) {
                    Log.w(TAG, "reload did not complete; recreating activity");
                    recreate();
                }
            },
            RECOVER_COOLDOWN_MS
        );
    }
}
