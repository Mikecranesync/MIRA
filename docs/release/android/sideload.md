# Direct install (sideload) — the no-Play distribution path

**Page:** https://updates.factorylm.com/download (302 → `/app/`)
**Files served:** `/app/index.html`, `/app/latest.json`, `/app/latest.apk`, and
content-addressed `/app/factorylm-<versionName>-vc<versionCode>-<apk-sha256>.apk`

Google Play is one door, not the only one. A technician opens the page on the phone,
taps Download, allows installs from Chrome once, and installs. No Google account, no
review queue, no tester quota. Plant phones are frequently locked out of the Play Store
anyway, so this is the path most pilots actually use.

## Why it lives on updates.factorylm.com

Same reason the OTA manifest does (`deployment/nginx-updates-factorylm.conf` header):
static files off disk, no proxy, no shared failure domain with the Hub. The two are
complementary — **OTA updates an installed app's web bundle; this page is how the app
gets installed.** A native change (new Capacitor plugin, versionCode bump) means a new
APK here; everything else ships through `ota-release.yml`.

## Publish

```
gh workflow run mobile-release-distribute.yml \
  -f release_notes="<what changed>" -f distribute=no -f publish_download=yes
```

The job builds and signature-verifies the APK exactly as for Play (`CN=FactoryLM`, v2
scheme), then installs the digest-named APK with collision refusal. Under a host lock it
atomically replaces `index.html` and `latest.apk`, then moves `latest.json` last so the
metadata pointer never names an artifact that is not already available. It verifies the
exact bytes on the host and downloads both public APK URLs for SHA-256 verification.
`latest.json`:

```json
{"versionName":"1.1.0","versionCode":10,"file":"factorylm-1.1.0-vc10-<64-hex-sha256>.apk",
 "sha256":"…","sizeBytes":…,"builtAt":"…Z","commit":"…"}
```

The page reads it to label the button; if the fetch fails the button still points at
`latest.apk`.

## Rules

- **Never reuse a versionCode.** Android treats a same-or-lower versionCode as "not an
  update" and refuses to install over the existing app. Bump it in
  `mira-mobile/android/app/build.gradle` for every APK you publish here, same as Play.
- **Do not assume the direct APK has the Play app-signing certificate.** FactoryLM signs
  direct APKs with its upload key; Google Play App Signing can re-sign Play installs with
  a distinct app-signing key. Verify the certificates before switching install paths. If
  they differ, Android requires uninstalling the existing app, which clears local state.
  A direct or Firebase install never satisfies the OTA production handset receipt, which
  requires installer package `com.android.vending` and the configured Play certificate.
- Digest-named APKs are immutable and refuse different bytes at an existing path;
  `latest.*` are atomically replaced pointers (`Cache-Control: no-cache`).
- The nginx block is applied through the separately reviewed host-bootstrap runbook;
  `ota-release.yml` deliberately has no provision mode. The repository nginx file remains
  authoritative, but a config change needs its own reviewed operator deployment.

## Related

- `docs/release/android/ota.md` — updating an installed app
- `docs/release/android/play-compliance.md` — the Play track (account verification, policy)
- `deployment/ota-download/index.html` — the page (bundles its FactoryLM tokens per `.claude/rules/ui-style.md`)
