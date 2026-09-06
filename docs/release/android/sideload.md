# Direct install (sideload) — the no-Play distribution path

**Page:** https://updates.factorylm.com/download (302 → `/app/`)
**Files served:** `/app/index.html`, `/app/latest.json`, `/app/latest.apk`, `/app/factorylm-<versionName>-vc<versionCode>.apk`

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
scheme), then copies the versioned APK first and the three pointers second, verifies the
sha256 on the host, and probes the public URLs. `latest.json`:

```json
{"versionName":"1.1.0","versionCode":10,"file":"factorylm-1.1.0-vc10.apk",
 "sha256":"…","sizeBytes":…,"builtAt":"…Z","commit":"…"}
```

The page reads it to label the button; if the fetch fails the button still points at
`latest.apk`.

## Rules

- **Never reuse a versionCode.** Android treats a same-or-lower versionCode as "not an
  update" and refuses to install over the existing app. Bump it in
  `mira-mobile/android/app/build.gradle` for every APK you publish here, same as Play.
- **Same signing key as Play** (`docs/release/android/signing.md`). Installing a Play build
  over a sideloaded one, or vice versa, only works because the certificate is identical.
- Versioned APKs are immutable; `latest.*` are pointers (`Cache-Control: no-cache`).
- The nginx block is applied by `ota-release.yml mode=provision` (idempotent, repo file
  is authoritative). Change the conf → re-run provision.

## Related

- `docs/release/android/ota.md` — updating an installed app
- `docs/release/android/play-compliance.md` — the Play track (account verification, policy)
- `deployment/ota-download/index.html` — the page (bundles its FactoryLM tokens per `.claude/rules/ui-style.md`)
