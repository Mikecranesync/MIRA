package com.factorylm.mira;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.PixelCopy;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * Blank-screen recovery, native half (#3392).
 *
 * Two proven paths leave a live, top-resumed Activity showing nothing:
 *
 * 1. Android killed the sandboxed renderer while we were backgrounded. Android's
 *    contract is that returning false from onRenderProcessGone kills the whole app;
 *    returning true means WE rebuild the WebView. We recreate the Activity.
 * 2. A return from the system photo picker with the renderer ALIVE and the DOM
 *    INTACT — measured on the Pixel 9a 2026-08-26: the resume DOM probe answered
 *    "ok" while the screen stayed blank, and a HOME + relaunch repainted it. That is
 *    a compositor/surface stall, invisible to any DOM check. So after a genuine
 *    pause/resume we ALSO sample the WebView's pixels (PixelCopy); if they are
 *    uniform we re-attach the surface (visibility toggle — the same thing the
 *    HOME/relaunch did), re-sample, and only then fall back to reload()/recreate().
 *
 * Guards: the cold-start onResume never probes (the page is still booting), and a
 * probe only runs once the page has loaded at least once.
 *
 * The JS half (src/lib/resume-guard.ts) runs the DOM check from inside the page.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MiraWebViewRecovery";
    private static final long PROBE_DELAY_MS = 1200;
    private static final long PROBE_TIMEOUT_MS = 2500;
    private static final long PAINT_RECHECK_MS = 700;
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
    private Runnable pendingTimeout;

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
        if (pendingTimeout != null) {
            handler.removeCallbacks(pendingTimeout);
            pendingTimeout = null;
        }
    }

    // ── 1. DOM probe (renderer alive? page populated?) ─────────────────────────

    private void probeRendered() {
        pendingProbe = null;
        final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        // !pageLoaded here means a reload is already in flight (e.g. the JS half fired).
        if (wv == null || recovering || !pageLoaded) return;
        wv.invalidate();

        final boolean[] answered = { false };
        final Runnable timeout = () -> {
            pendingTimeout = null;
            if (!answered[0]) {
                answered[0] = true;
                recover(wv, "probe timed out (renderer not answering)");
            }
        };
        pendingTimeout = timeout;
        handler.postDelayed(timeout, PROBE_TIMEOUT_MS);
        try {
            wv.evaluateJavascript(
                PROBE_JS,
                value -> {
                    if (answered[0]) return;
                    answered[0] = true;
                    handler.removeCallbacks(timeout);
                    pendingTimeout = null;
                    if (!"\"ok\"".equals(value)) {
                        recover(wv, "probe returned " + value);
                    } else {
                        Log.d(TAG, "resume probe ok (DOM); checking paint");
                        probePaint(wv, 0);
                    }
                }
            );
        } catch (RuntimeException e) {
            answered[0] = true;
            handler.removeCallbacks(timeout);
            pendingTimeout = null;
            recover(wv, "probe threw " + e);
        }
    }

    // ── 2. Paint probe (is anything actually on screen?) ────────────────────────

    /**
     * Sample the WebView's window region into a tiny bitmap. Uniform = blank.
     * attempt 0: blank → re-attach the surface and re-check; attempt 1: still blank →
     * reload the page (recover()).
     */
    private void probePaint(final WebView wv, final int attempt) {
        if (recovering || wv.getWidth() < 8 || wv.getHeight() < 8 || getWindow() == null) return;
        final int[] loc = new int[2];
        wv.getLocationInWindow(loc);
        final Rect src = new Rect(loc[0], loc[1], loc[0] + wv.getWidth(), loc[1] + wv.getHeight());
        // A small bitmap is enough: PixelCopy scales the region into it.
        final Bitmap bmp = Bitmap.createBitmap(16, 9, Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(
                getWindow(),
                src,
                bmp,
                result -> {
                    if (result != PixelCopy.SUCCESS) {
                        Log.d(TAG, "paint probe unavailable (" + result + "); skipping");
                        bmp.recycle();
                        return;
                    }
                    boolean uniform = isUniform(bmp);
                    bmp.recycle();
                    if (!uniform) {
                        Log.d(TAG, "resume probe ok (paint)");
                        return;
                    }
                    if (attempt == 0) {
                        Log.w(TAG, "DOM ok but nothing painted after resume; re-attaching WebView surface");
                        kickSurface(wv);
                        handler.postDelayed(() -> probePaint(wv, 1), PAINT_RECHECK_MS);
                    } else {
                        recover(wv, "still blank after surface re-attach");
                    }
                },
                handler
            );
        } catch (IllegalArgumentException e) {
            // Window not yet drawn / detached — nothing to probe.
            Log.d(TAG, "paint probe skipped: " + e);
            bmp.recycle();
        }
    }

    private static boolean isUniform(Bitmap bmp) {
        int first = bmp.getPixel(0, 0);
        for (int y = 0; y < bmp.getHeight(); y++) {
            for (int x = 0; x < bmp.getWidth(); x++) {
                if (colorDistance(first, bmp.getPixel(x, y)) > 12) return false;
            }
        }
        return true;
    }

    private static int colorDistance(int a, int b) {
        int dr = Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff));
        int dg = Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff));
        int db = Math.abs((a & 0xff) - (b & 0xff));
        return Math.max(dr, Math.max(dg, db));
    }

    /** Detach/re-attach the WebView's drawing surface — what a HOME/relaunch does. */
    private void kickSurface(final WebView wv) {
        wv.setVisibility(View.INVISIBLE);
        handler.post(() -> {
            wv.setVisibility(View.VISIBLE);
            wv.requestLayout();
            wv.invalidate();
        });
    }

    // ── 3. Recovery ─────────────────────────────────────────────────────────────

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
