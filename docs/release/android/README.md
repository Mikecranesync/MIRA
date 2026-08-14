# FactoryLM Android — release runbook

Client: `mira-mobile/` (Capacitor 8, static packaged bundle — ADR-0034 trust boundary:
no remote UI, no `server.url`; the app talks to `https://app.factorylm.com` only).

## Identity (permanent once the Play listing exists — do not change)

| Field | Value |
|---|---|
| Application ID | `com.factorylm.mira` |
| Display name | FactoryLM |
| minSdk / compileSdk / targetSdk | 24 / 36 / 36 |
| versionName / versionCode | `mira-mobile/android/app/build.gradle` (see policy below) |

**Version policy:** `versionCode` bumps by exactly **+1 on every Play upload** (Play
rejects any reuse — including rejected/discarded uploads). `versionName` is the
human-readable release line (`1.0.0`, `1.1.0`, …) and follows the mobile feature line,
independent of the monorepo tag.

## Release build (from the release machine)

```bash
cd C:/flm-mob                     # junction → mira-mobile (gradle path-length workaround)
npx vite build                    # web bundle → dist/
npx cap sync android              # copy bundle + plugin config into android/
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab  (signed iff keystore.properties present)
```

Signing: `docs/release/android/signing.md`. Play listing + compliance:
`play-listing.md`, `play-compliance.md` in this directory. Store graphics are generated
by `mira-mobile/tools/gen-android-assets.mjs` (brand mark → launcher icons, splash,
Play icon 512, feature graphic) — regenerate, never hand-edit the PNGs.

## Pre-upload checklist

- [ ] `versionCode` bumped (+1 vs last Play upload)
- [ ] `npx vite build` ran against the intended commit (dist/ is not stale)
- [ ] `jarsigner -verify` passes on the AAB; cert SHA-256 matches signing.md
- [ ] No `localhost`/dev endpoints in `dist/` (`grep -r localhost dist/assets`)
- [ ] Physical-device smoke test on the exact commit (Phase-1 matrix in the release PR)
