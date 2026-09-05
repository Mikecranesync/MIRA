# ChatGPT-class UI spike probes

Reproducible measurement harnesses for the §8.3 compatibility spike
(PRD `docs/prd/2026-08-30-chatgpt-class-ui-prd.md`, plan
`docs/plans/2026-08-30-chatgpt-class-ui-spike-plan.md`, results
`docs/plans/2026-08-30-chatgpt-class-ui-spike-results.md`).

**These are spike scaffolding — delete them with the spike.** They exist so the
streaming/Stop measurements cited in ADR-0038 can be re-run rather than trusted.

## Prerequisites

1. Hub dev server on `:3000` — `cd mira-hub && npm run dev`
   (the spike page is `/hub/labs/chat-spike/`, dev-only: it `notFound()`s in
   production and the middleware matcher excludes it).
2. For the device probes: an Android emulator or a device running a **debug**
   Capacitor shell whose WebView is pointed at that page.

## Web probes

```bash
cd tools/chat-ui-spike
node web-proof.mjs        # criteria 3/5 in headless Chromium + screenshots
```

## Device probes (emulator or debug device)

The device runs a throwaway **side-by-side** debug shell so the real
`com.factorylm.mira` install is never touched. All four edits below are
LOCAL-ONLY — `git checkout -- mira-mobile/` when finished, and never commit
them (ADR-0034 forbids `server.url`; the app id / label are cosmetic):

| File | Local-only edit |
|---|---|
| `mira-mobile/capacitor.config.ts` | `server.url = "http://localhost:3000/hub/labs/chat-spike/"`, `server.cleartext = true` |
| `mira-mobile/android/app/build.gradle` | `applicationId "com.factorylm.mira.spike"` |
| `mira-mobile/android/app/src/main/res/values/strings.xml` | `app_name` → `MIRA Spike` |
| `mira-mobile/android/local.properties` | `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` (forward slashes; gitignored) |

```bash
cd mira-mobile && npx vite build && ./node_modules/.bin/cap.exe sync android
cd android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:3000 tcp:3000            # WebView reaches the host dev server
adb shell monkey -p com.factorylm.mira.spike -c android.intent.category.LAUNCHER 1
# CDP (debug builds only — Playwright's connectOverCDP does NOT work on Android WebView)
adb shell cat /proc/net/unix | grep webview_devtools     # note the pid
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>

cd ../../tools/chat-ui-spike
node device-proof.mjs     # the criteria matrix (C1/C3/C4/C5 + cross-origin control)
node stop-invariant.mjs   # STRM-2 invariant, sweeping WHEN Stop lands
node capture.mjs          # evidence screenshots → docs/promo-screenshots/
```

Teardown: `adb uninstall com.factorylm.mira.spike`, `adb reverse --remove tcp:3000`,
`git checkout -- mira-mobile/`.

## What each probe establishes

- **`device-proof.mjs`** — hydration, incremental streaming, unknown-frame
  tolerance, Stop, and the **cross-origin control**: the page fetches
  `localhost` vs `127.0.0.1`, changing *only* the origin, which isolates the
  CapacitorHttp fetch patch as the cause of buffering (#3453).
- **`stop-invariant.mjs`** — sweeps the moment Stop lands across the stream and
  asserts the STRM-2 invariant (a stopped turn keeps its partial text and shows
  **no** citations/basis). It also classifies the *tail race*: once the client
  has the `status` frame the turn is legitimately answered even though the
  server logs the connection as cancelled.
- **`web-proof.mjs`** — the same criteria in a desktop browser, as the baseline
  the device numbers are compared against.

## Gotcha the harnesses encode

The spike page has **more than one `<textarea>`**; always select the composer by
its placeholder. React controlled checkboxes need the click **verified** (and
conditional subtrees need a render pass before their testids exist) — blind
`click()` + immediate assert is flaky. Both are handled in the helpers.
