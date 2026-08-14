# FactoryLM Android — release signing workflow

**Model: Google Play App Signing.** Google holds the *app signing key*; we hold only an
*upload key*. A lost/compromised upload key is recoverable through Play Console support
(key reset), so the upload keystore deliberately lives on the release machine — never in git.

## What exists where

| Artifact | Location | In git? |
|---|---|---|
| Upload keystore | `C:\Users\hharp\.factorylm-signing\factorylm-upload.jks` (release machine) | **NO** |
| Keystore credentials | `mira-mobile/android/keystore.properties` | **NO** (gitignored) |
| Signing wiring | `mira-mobile/android/app/build.gradle` (`signingConfigs.release` reads `keystore.properties`) | yes |
| Ignore rules | `mira-mobile/android/.gitignore` (`*.jks`, `*.keystore`, `keystore.properties`) | yes |

Upload key: alias `factorylm-upload`, RSA 2048, validity 25 years, created 2026-08-14.
Upload certificate SHA-256:
`EB:8F:D0:81:30:18:E0:13:BE:10:99:07:2A:9D:E2:5F:FD:7F:3A:2B:F1:89:3F:FF:71:6A:9F:DC:EB:77:78:C4`

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
