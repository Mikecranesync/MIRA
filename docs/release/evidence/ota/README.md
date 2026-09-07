# OTA physical-handset promotion evidence

This directory holds reviewable proof that one exact signed canary worked on a
physical Android phone installed by Google Play. The proof is an input to
production authorization; it does not authorize itself. The intended protected
`ota-production` environment must require a human reviewer, disable self-review
and administrator bypass, and accept deployments only from protected branches.
As of 2026-09-07 the repository API returned 404 for that environment, so
production promotion remains an operational HOLD until a maintainer provisions
and independently verifies those settings.

Do not create a `PASS` receipt from a browser preview, emulator, Firebase build,
directly installed APK, CI result, or signature check alone. The terminal
condition is a Play-installed physical handset completing:

1. **Check now** on the canary channel.
2. **Update ready** for the exact expected bundle.
3. **Restart** without automatic rollback.
4. **About & updates** showing that exact active `bundleId` and `canary` channel.

## File layout

For artifact SHA-256 `<artifact-sha256>`:

```text
docs/release/evidence/ota/
├── <artifact-sha256>.json
└── files/
    ├── <capture>-adb.txt
    ├── <capture>-about.png
    └── <capture>-update-ready.png  # optional
```

The receipt filename is the complete lowercase 64-hex artifact SHA-256. Evidence
paths inside the receipt are repository-relative and must remain under
`docs/release/evidence/ota/files/`. Files must be regular files, never symlinks.
Use unique paths, hash their exact committed bytes, and keep the set between two
and twenty files.

Do not commit credentials, cookies, access tokens, phone numbers, account email,
or a device serial. A device model is required; a unique device identifier is not.

## Receipt schema version 1

The validator accepts exactly these top-level fields; extra fields fail closed.

| Field | Required value |
|---|---|
| `schemaVersion` | Integer `1` |
| `result` | String `PASS` |
| `artifactSha256` | Exact lowercase 64-hex hash of the canary ZIP and receipt filename |
| `bundleId` | Exact bundle ID shown by the app after restart |
| `nativeFingerprint` | Exact lowercase 16-hex fingerprint in the signed canary |
| `releaseSha` | Exact lowercase 40-hex source commit authenticated by release provenance |
| `canaryManifestSha256` | SHA-256 of the exact signed canary pointer tested on the phone |
| `pointerChangedAt` | Exact canonical UTC-millisecond timestamp from that canary pointer |
| `testedAt` | Canonical UTC-millisecond timestamp at or after `pointerChangedAt` |
| `packageName` | `com.factorylm.mira` |
| `installerPackage` | `com.android.vending` |
| `playSigningCertSha256` | Exact lowercase 64-hex Play app-signing certificate digest; must match repository variable `FACTORYLM_PLAY_SIGNING_CERT_SHA256` |
| `deviceModel` | Nonempty physical-handset model, at most 100 characters and one line |
| `updateReady` | Boolean `true` |
| `restartCompleted` | Boolean `true` |
| `aboutBundleIdVerified` | Boolean `true` |
| `aboutChannel` | String `canary` |
| `evidenceFiles` | Array of two to twenty exact evidence-file records described below |

Canonical timestamps use `YYYY-MM-DDTHH:MM:SS.sssZ`, for example
`2026-09-07T14:03:05.123Z`. A test captured before the current canary pointer is
invalid even if an older bundle with the same label once worked.

Each `evidenceFiles` record has exactly three fields:

| Field | Required value |
|---|---|
| `kind` | `adb_transcript`, `about_screenshot`, or optional `update_ready_screenshot` |
| `path` | Repository-relative path below `docs/release/evidence/ota/files/` |
| `sha256` | Lowercase 64-hex SHA-256 of the committed file bytes |

At least one `adb_transcript` and one `about_screenshot` are mandatory. The
transcript should establish the physical model, package, installer package, and
the observed update/restart sequence without retaining a device serial. The
About screenshot must visibly establish the post-restart bundle ID and canary
channel. An Update-ready screenshot is useful but optional because the receipt
also binds the before/after sequence to the transcript.

## Capture and validate

1. Start from a canary published by the governed workflow on `main`. Record its
   immutable target, complete artifact SHA-256, bundle ID, native fingerprint,
   release SHA, exact canary-manifest SHA-256, and `pointerChangedAt`.
2. On the Play-installed phone, confirm the installer without recording its
   serial, for example:

   ```bash
   adb shell getprop ro.product.model
   adb shell pm list packages -i com.factorylm.mira
   ```

3. Capture the complete Check-now, Update-ready, Restart, and About result. Store
   a redacted text transcript and About screenshot under `files/`.
4. Hash every evidence file with `sha256sum` or `shasum -a 256`, then create the
   receipt named for the artifact SHA-256.
5. Validate from the repository root using the exact values from the signed
   canary:

   ```bash
   python3 tools/ota_handset_evidence.py \
     --evidence-json docs/release/evidence/ota/<artifact-sha256>.json \
     --evidence-root . \
     --artifact-sha256 <artifact-sha256> \
     --bundle-id <bundle-id> \
     --native-fingerprint <native-fingerprint> \
     --release-sha <release-sha> \
     --canary-manifest-sha256 <canary-manifest-sha256> \
     --pointer-changed-at <pointer-changed-at> \
     --play-signing-cert-sha256 <play-signing-cert-sha256>
   ```

6. Commit the receipt and its referenced files, merge them to `main`, and record
   that full evidence commit SHA. Dispatch `ota-release.yml` from a `main` commit
   that descends from it:

   ```bash
   gh workflow run ota-release.yml --ref main \
     -f mode=promote \
     -f promote_to=<version>/<16-hex>.zip \
     -f evidence_commit_sha=<full-evidence-commit-sha>
   ```

The workflow revalidates the receipt with the validator from the release head,
requires the evidence commit to be an ancestor of that head, verifies the
protected environment settings, and reconfirms the same canary before and under
the production publication lock.

## Quarantined 1.1.8 canary

Canary `1.1.8` from Actions run `34131104475` predates this authenticated
provenance and receipt contract. It is not governance-cleared and cannot become
eligible through a retroactive receipt. Publish and test a new governed canary
from the merged release head instead.
