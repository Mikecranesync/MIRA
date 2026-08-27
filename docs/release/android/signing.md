# FactoryLM Android — release signing workflow

> **KEY ROTATED 2026-08-24.** The 2026-08-14 upload key was superseded: its password was never
> recorded anywhere (confirmed with Mike), so it could not sign. Nothing had ever been signed with
> it — the only installed build was debug-signed — so rotation cost nothing. Doing it now was
> deliberate: after technicians are onboarded, rotating means a forced uninstall for every one of
> them. The old file is retained, not deleted, at
> `factorylm-upload.jks.superseded-2026-08-24`.
>
> **The password now exists in exactly one place: Doppler `factorylm/prd`.** It was generated
> locally, piped straight to keytool and Doppler, and never printed, echoed, or written to disk.

**Model: Google Play App Signing.** Google holds the *app signing key*; we hold only an
*upload key*. A lost/compromised upload key is recoverable through Play Console support
(key reset), so the upload keystore deliberately lives on the release machine — never in git.

## What exists where

| Artifact | Location | In git? |
|---|---|---|
| Upload keystore | `C:\Users\hharp\.factorylm-signing\factorylm-upload.jks` (release machine) | **NO** |
| Keystore credentials | **Doppler `factorylm/prd`** — `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` | **NO** |
| Keystore backup | **Doppler `factorylm/prd`** — `ANDROID_KEYSTORE_BASE64` (so this laptop is not a single point of failure) | **NO** |
| Keystore credentials (legacy path, still supported) | `mira-mobile/android/keystore.properties` | **NO** (gitignored) |
| Signing wiring | `mira-mobile/android/app/build.gradle` (`signingConfigs.release` reads `keystore.properties`) | yes |
| Ignore rules | `mira-mobile/android/.gitignore` (`*.jks`, `*.keystore`, `keystore.properties`) | yes |

Upload key: alias `factorylm-upload`, **RSA 4096**, validity 25 years, created **2026-08-24**.
Upload certificate SHA-256 (verified with `apksigner verify --print-certs` against a real
`assembleRelease` output, not from keytool alone):
`23:95:B9:60:50:C5:10:A5:C7:87:46:5B:83:25:6F:38:1B:1F:F5:E4:83:3D:2F:A8:8D:B7:35:79:29:3F:92:A9`

## keystore.properties format (recreate by hand if lost)

```properties
storeFile=C:/Users/hharp/.factorylm-signing/factorylm-upload.jks
storePassword=<password>
keyAlias=factorylm-upload
keyPassword=<password>
```

**Owner action required:** copy the password out of `keystore.properties` into the team
password manager (or Doppler `factorylm/prd` as `ANDROID_UPLOAD_KEYSTORE_PASSWORD`).
The file on disk is the only copy today.

## Building a signed release

```bash
cd mira-mobile/android
doppler run --project factorylm --config prd -- env   ANDROID_KEYSTORE_FILE="C:\Users\hharp\.factorylm-signing\factorylm-upload.jks"   ./gradlew assembleRelease
```

`ANDROID_KEYSTORE_FILE` is a **path**; the key material itself never becomes an env var. In CI,
base64-decode `ANDROID_KEYSTORE_BASE64` to a temp file first and point this at it. Verify:

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

## Behavior without secrets

If `keystore.properties` is absent (CI, fresh clones), `bundleRelease` produces an
**unsigned** bundle and does not fail — signing is strictly additive. CI never needs the key.

## Regenerating the upload key (only if lost)

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore C:\Users\hharp\.factorylm-signing\factorylm-upload.jks `
  -alias factorylm-upload -keyalg RSA -keysize 2048 -validity 9125 `
  -dname "CN=FactoryLM, O=FactoryLM, C=US"
```

If the Play listing already exists, a NEW upload key must be registered via
Play Console → Setup → App integrity → “Request upload key reset”.
