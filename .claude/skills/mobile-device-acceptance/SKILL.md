---
name: mobile-device-acceptance
description: Use when a FactoryLM mobile change must be proven on a real Pixel or the Android emulator — device acceptance, release-artifact certification, Sensor/Notebook journeys, or any claim that needs a screenshot from the phone rather than a unit test. Also use when adb/uiautomator/CDP driving misbehaves (black screencap, dropped keystrokes, connectOverCDP error, path mangling, taps landing on the wrong app).
---

# Mobile device acceptance (Pixel + emulator)

## Overview
Evidence from the phone beats assertion. The screen is the truth (a11y tree ≠ pixels); the
build under test must be proven by bytes, not by "I installed it"; and Mike's phone is a
shared, real device — touch it with etiquette or not at all.

## When to use
- Proving a mobile PR / release APK on `emulator-5554` or the Pixel (`adb devices -l`).
- Certifying an artifact: version, signature, DEBUGGABLE flag, installed-bytes hash.
- Any journey that unit tests can't cover: native picker/camera, BACK ladder, force-stop
  persistence, streaming, evidence cards.
- NOT for web-only checks (use `qa`) or for anything you can pin with `vitest`.

## Quick reference
| Need | Do |
|---|---|
| Pick device + lock rotation + stay awake | `python tools/mobile-e2e/device.py preflight` (records version/cert/battery/focus; `restore` at the end) |
| Screenshot | `device.py shot NAME` → `$EVIDENCE_DIR/NAME.png`. Emulator black? use `cdp.mjs screenshot()` (debug builds) |
| Find / tap by text | `device.py find "Sensor"` → `device.py tap-text "Sensor"` (refuses when our app is not foreground) |
| Type into a WebView input | `device.py type "…"` — `input text` drops characters in React inputs; char-by-char ~90 ms |
| DOM-level evidence (debug builds only) | `device.py cdp` then `import {CDP} from tools/mobile-e2e/cdp.mjs` — `evaluate`, `key`, `touch`, `growth`, `screenshot` |
| Release build (no CDP) | uiautomator only; pull `pm path` base.apk and `sha256sum` it against the built artifact |
| Native picker from automation | push the fixture to `/sdcard/Pictures/` + `MEDIA_SCANNER_SCAN_FILE` broadcast; the picker then lists it. Debug builds may instead feed the component's hidden `<input type=file>` via CDP (say which path you used) |
| Debug APK pointed at staging | local-only edits to `src/api/client.ts` API_BASE, `capacitor.config.ts` cleartext, `AndroidManifest` `usesCleartextTraffic` — never commit |
| Build | `bun install --frozen-lockfile && bun run build && bunx cap sync android` (restore `capacitor.*.gradle` churn), `local.properties` sdk.dir with forward slashes, `JAVA_HOME=…/Android Studio/jbr`, `./gradlew assembleDebug` / release via `doppler run -p factorylm -c prd -- env ANDROID_KEYSTORE_FILE=C:/…/factorylm-upload.jks ./gradlew assembleRelease` |

## Phone etiquette (real device) — the run aborts, never the rule
1. `adb devices` quiet ≠ free: check `mCurrentFocus` before EVERY tap batch; a call or another
   app in front → wait, never tap through. `tap()` already refuses.
2. Save `accelerometer_rotation`, lock to portrait for the run, restore after (`preflight`/`restore`).
3. Real tenant = real data: at most one clearly named test notebook per run; never delete; never
   touch work orders; bound REPLAY asks to the dogfood machine notebook only.
4. Never install over an acceptance build with a different cert; same cert → `install -r` keeps
   the login. Uninstall only when the cert differs and say so.
5. When the human needs the phone: stop the agent, `restore`, `HOME`. Report what was mid-flight.

## Evidence rules
- Screenshot after every step and READ it; a dump showing a node does not mean it is tappable
  (a fullscreen viewer eats taps; screencap can return a stale composite — take a later frame).
- Artifact proof = `pm path` → pull → `sha256sum` equals the built APK; `dumpsys package` shows
  version/versionCode/cert prefix and no `DEBUGGABLE`; bundle grep for the API host.
- Label every screenshot with the build SHA it came from; delete captures from a superseded
  build rather than leaving them mislabelled.
- Copy screenshots to `docs/promo-screenshots/` as `YYYY-MM-DD_<feature>-<step>_android.png`
  (Screenshot Rule) — commit via a docs-only PR, never `git add` from the acceptance run.
- Report a table `step | pass/fail/limited/SKIP | evidence path | notes`; classify every
  defect as product vs device/harness; camera on the emulator is always SKIP, never PASS.
- Known platform limit to state, not hide: Android's CapacitorHttp fetch patch delivers one
  buffered SSE response and ignores AbortSignal (#3453) — streaming shows one jump, Stop is
  client-side only.

## Common mistakes
- Forgetting `MSYS_NO_PATHCONV=1` → Git Bash rewrites `/data/local/tmp` into a Windows path.
- `connectOverCDP` on Android WebView fails — use `cdp.mjs` (raw page target).
- Assuming the session persisted after `adb install -r` with a different cert (it doesn't).
- Claiming a fault-window REPLAY on a tenant that has no machine memory — use the staging
  fixture (`tools/qa/sensor_replay_fixture.py`, docs/discovery §7) or say not exercisable.
- Leaving rotation locked / stay-awake on / the debug build installed on the release phone.
