# Device acceptance — MIRA Intelligence Contract on the emulator

**Date:** 2026-09-22 · **Staging SHA:** `076ab7371` · **Flag:** `MIRA_PERSONA_CONTRACT=1` (stg only)
**Device:** `sdk_gphone64_arm64`, Android **15**, AVD `mira35`, `emulator-5554`
**App:** `com.factorylm.mira.staging` **1.2.0**, `stagingDebug`, built from this branch
**API base:** `https://app-staging.factorylm.com` (from `BuildConfig.API_BASE`, flavor `staging`)

Emulator, not a physical device — per `tools/mobile-e2e/README.md` the emulator is
the default gate, and the three things that genuinely need hardware (cellular,
real camera capture, Play-signed identity) are not what this change touches.

## What was exercised

The staging-flavor app was built, installed **alongside** production
(`applicationIdSuffix .staging`, so `com.factorylm.mira` was untouched), launched,
and driven through its **own WebView network stack** via CDP — the same driver
`tools/mobile-e2e/cdp.mjs` uses. The turn below is the exact request shape
`NotebookScreen.tsx` sends when a technician has no sources selected.

## Result — blank chat, no project, no machine, no sources

```
notebook  da27ad27-44b5-431f-9256-7bf426ad5e56   (created from the device)
HTTP      200
frames    trace → content → sources → evidence → usage → status
trace     e8a9033030324e78d8b13a004511c75b
basis     general_reasoning
answer    1649 chars
```

> "**With the VFD output isolated, locked out and the motor terminals verified at
> 0 V**, the most common cause of overheating at low speed is excessive slip
> causing high stator current. At low frequencies the motor sees less back-EMF, so
> for a given load the VFD must supply more torque by increasing current; if the
> mechanical load (belt tension, gear friction, bearing drag) is higher than the
> motor's low-speed torque capability, the motor runs in the high-torque,
> high-current region and heats quickly.
>
> What to check next:
> 1. With the drive in run mode at the low speed that's overheating, measure motor
>    line current (phase-to-phase) and compare it to the motor's rated full-load
>    current. If it's > 110 % of rated, the motor is being over-torqued. …"

This is the contract working on a device:

- **Acceptance A** — a blank chat with no Project, machine, notebook or source got
  a real, useful answer. No dead end, no "add a source to start".
- **Safety posture** — the energy-isolation clause is in the **first sentence**,
  in the same sentence as the instruction, exactly as `MIRA_CORE` requires. Before
  this work that rule was reachable from one of nine Hub surfaces.
- **Answer shape** — cause first, then ordered checks with a concrete threshold.
  No bullet quota, no forced diagnostic ladder.
- **Unsupported specifics** — no parameter number, terminal or fault meaning is
  asserted for a machine it has no evidence for.

## One rough edge found on the device path

A chat request with **no sources and no `mode`** returns `422 no_sources_selected`.
The shipped client always sends `mode:"general"` in that case
(`NotebookScreen.tsx:341`), so the product path is fine — but the server still
requires that hint to tolerate an empty source set. It is the one place where the
client's scope-derived inference is still load-bearing, and it is pre-existing
(line 1156), untouched by this PR. Worth closing when the client inference is
retired.

## Reproduce

```bash
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
emulator -avd mira35 -no-snapshot-load &
cd mira-mobile && npm run sync
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew assembleStagingDebug
adb install -r app/build/outputs/apk/staging/debug/app-staging-debug.apk
adb shell am start -n com.factorylm.mira.staging/com.factorylm.mira.MainActivity
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.factorylm.mira.staging)
```

Build needs **JDK 21** (`capacitor-camera` toolchain); JDK 17 fails.
Screenshot: `docs/promo-screenshots/2026-09-22_staging-flavor-app-emulator_android.png`.
