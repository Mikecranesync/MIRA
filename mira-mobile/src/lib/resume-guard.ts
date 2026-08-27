/**
 * Blank-white-screen recovery, JS half (#3392).
 *
 * On a Pixel 9a the app came back from the background to a permanently white
 * screen twice, from two different causes: Android reclaimed the sandboxed
 * WebView renderer, and a plain return from the system photo picker with no
 * renderer kill at all. In both the Activity was alive and top-resumed while
 * the WebView painted nothing, and the only way out was force-stop.
 *
 * The native half (MainActivity.java) handles the renderer-gone callback and
 * probes the page from outside. This half runs INSIDE the page: when the app
 * becomes active again it looks at what is actually in the document — is the
 * React root populated, does the body have a size — and reloads if not. It
 * also kicks the compositor so a surface that merely stopped painting gets a
 * fresh frame. It never fires on the first activation, so a slow boot cannot
 * turn into a reload loop.
 */
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export type Probe = "ok" | "empty" | "no-root" | "zero";

/** What the document says about whether the UI is actually there. */
export function probeRendered(d: Document = document): Probe {
  const root = d.getElementById("root");
  if (!root) return "no-root";
  if (root.childElementCount === 0) return "empty";
  const b = d.body.getBoundingClientRect();
  if (b.width === 0 || b.height === 0) return "zero";
  return "ok";
}

export function shouldReloadAfterResume(a: { wasBackgrounded: boolean; probe: Probe }): boolean {
  return a.wasBackgrounded && a.probe !== "ok";
}

/** Force the WebView compositor to produce a new frame. Harmless when healthy. */
function kickPaint() {
  const s = document.body.style;
  s.willChange = "transform";
  requestAnimationFrame(() => {
    s.willChange = "";
  });
}

export function installResumeGuard(): void {
  if (!Capacitor.isNativePlatform()) return;
  let wasBackgrounded = false;
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) {
      wasBackgrounded = true;
      return;
    }
    kickPaint();
    // Two frames so React has had a chance to commit after resume.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const probe = probeRendered();
        if (shouldReloadAfterResume({ wasBackgrounded, probe })) {
          console.warn(`[resume-guard] UI not rendered after resume (${probe}); reloading`);
          window.location.reload();
        }
      }),
    );
  });
}
