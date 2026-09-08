# FactoryLM Android — OTA web-bundle updates

**Doctrine:** ADR-0034 § *Amendment: signed OTA web bundles* (2026-08-24). Read that first.

Two delivery paths, and the split is not negotiable:

| Change | Path | Why |
|---|---|---|
| HTML / CSS / JS only | **OTA** — publish a signed bundle | ~90% of changes; reaches phones on next app open |
| Native plugin, Capacitor upgrade, `MainActivity`, Gradle, manifest, permissions, SDK, **the OTA public key** | **APK** via Firebase / Play | OTA cannot carry native code |

`scripts/ota-guard.mjs` enforces the split mechanically and fails closed.

---

## Signing material and installed-app identity

| Key / identity | Purpose | Controlled location |
|---|---|---|
| Android upload keystore | signs the APK/AAB uploaded by FactoryLM | Doppler `factorylm/prd` (`ANDROID_KEYSTORE_BASE64` + passwords) |
| Google Play app-signing certificate | identifies the APK actually installed by Play | Public SHA-256 in the repository Actions variable `FACTORYLM_PLAY_SIGNING_CERT_SHA256` |
| OTA signing key (RSA-4096) | signs the **web bundle** and channel pointer | Doppler `factorylm/ota_signing` (`OTA_SIGNING_PRIVATE_KEY`), readable only through the `ota-signing` environment secret `OTA_SIGNING_DOPPLER_TOKEN` |

The two private signing keys are separate so compromising one does not grant the
other. The OTA **public**
key is compiled into the shell (`capacitor.config.ts` → `plugins.LiveUpdate.publicKey`)
and is not secret — that is what lets a phone reject a bundle signed by anyone else.

The upload certificate and Play app-signing certificate are not interchangeable.
Production-promotion evidence must come from an APK installed by Google Play and
must match the Play app-signing certificate, not merely FactoryLM's upload key.

> **Changing the OTA public key is a NATIVE change.** It ships in an APK. A shell can
> only verify bundles signed by the key it was built with.

---

## One-time release prerequisites

Routine OTA runs do not provision the release host or GitHub environments. Before
the first governed run, a maintainer must complete the host bootstrap in
`docs/runbooks/ota-updates-host-cutover.md` and create these GitHub environments:

| Environment | Secret / variable | Required boundary |
|---|---|---|
| `ota-signing` | environment secret `OTA_SIGNING_DOPPLER_TOKEN` | Service token may read only Doppler `factorylm/ota_signing`; that config contains `OTA_SIGNING_PRIVATE_KEY` |
| `ota-canary` | environment secret `OTA_CANARY_SSH_KEY`; environment variable `OTA_CANARY_SSH_USER` | Restricted non-root identity that can stage immutable releases and update only the canary pointer |
| `ota-production` | environment secret `OTA_PRODUCTION_SSH_KEY`; environment variable `OTA_PRODUCTION_SSH_USER` | Restricted non-root identity that can update only the production pointer; at least one required reviewer; self-review prevented; administrator bypass disabled; deployments limited to protected branches |

At the last verified snapshot on 2026-09-07, these three OTA environments and
their scoped credentials had not been provisioned. The existing environment
named `production` had no protection rules and allowed administrator bypass; it
is used by a separate native-release lane and is not a substitute for
`ota-production`. Recheck live repository settings before every release and
treat any missing boundary as a hard stop.

Also create the repository Actions variable
`FACTORYLM_PLAY_SIGNING_CERT_SHA256` from the Google Play Console app-signing
certificate. It must be the lowercase 64-hex SHA-256 digest. Do not substitute
the upload-certificate digest. Provision the two restricted SSH identities and
their server-side permissions outside the routine workflow; never give either
identity root access or the other channel's pointer authority.

The existing broad `DOPPLER_TOKEN` used by the separate native/Firebase release
path is not an OTA credential and must not be added to any OTA environment.
Rotate any broad token that crossed the historical OTA runner before enabling
the replacement workflow, while preserving the separately reviewed native lane.

## Publish (operator) — via `ota-release.yml` (2026-09-07)

Do not run the signing or deployment scripts from a development session:
`tools/hooks/prod-guard.sh` hard-denies scp/rsync to prod, and the release host is
the prod nginx box. After the source head has passed its required governance and
has merged to `main`, dispatch **Actions → OTA release** from `main`. The
workflow has only `publish`, `stage-canary`, and `promote` modes. It uses
separate secret-free build/prepare, signing-only, canary-publication, and
production-publication runners:

1. `mode=publish`, `channel=canary`, `version=<x.y.z>`, `apk_base_sha=<commit the installed
   APK was built from>` — runs the OTA guard against that base (fail-closed), builds without
   secrets, signs on a fresh `ota-signing` runner after dropping Doppler access,
   then publishes from an `ota-canary` runner. The immutable ZIP and its signed
   provenance are installed before the manifest pointer changes.
2. Verify that exact canary artifact on an explicitly enrolled, Play-installed
   physical phone and commit the governed receipt described below.
3. `mode=promote`, `promote_to=<version>/<hash>.zip`,
   `evidence_commit_sha=<full SHA>` — repoints `production` only when
   the target exactly matches the currently signed canary pointer. Direct production
   publish is rejected.
4. For rollback, first use `mode=stage-canary` with the historical
   `<version>/<hash>.zip`, verify it on the canary phone, then promote that same pointer.

Phones on that channel pick it up on the next app open, verify it, stage it, and
show **Update ready** with a Restart action. Nothing reloads under a technician.

The native and OTA build jobs derive the packaged replay floor from GitHub's
server-issued `run_started_at` for the exact run ID and attempt, after matching
that record to the exact source SHA. The tuple `(source SHA, run ID, attempt,
run_started_at, pinned toolchain)` is the build provenance; Git commit dates are
not trusted as release time. The same epoch is carried through the immutable
handoff and signed `releasedAt`, and a channel pointer may not predate it. A
local, preview, or test build receives the noncanonical value `unset` and
therefore cannot consume OTA updates.

Within one governed attempt, packaging sorts all files, rejects links,
normalizes modes and timestamps, and uses the Linux release runner's store-only
ZIP path. Identical built bytes therefore produce an identical artifact digest.
A new workflow attempt deliberately has a new replay floor and is distinct
release provenance, even when it builds the same source SHA.

### Quarantined canary 1.1.8

Canary `1.1.8` is published but **not governance-cleared**. Actions run
`34131104475` published only the canary pointer from source
`5cd26f33a441229abe774b3265570dbdba5a9128`: bundle
`1.1.8-a36c63bf`, artifact SHA-256
`a36c63bfe43b788512dc9895f18e2a435f1739ac377d2027d4626a5863c9bff6`,
native fingerprint `dafaba3f19d380c4`. The source was a draft head without a
fresh exact-head Codex PASS, and the historical workflow used mutable Actions
and did not publish the authenticated immutable-provenance sidecar and signed
pointer envelope required by the current contract.

Treat `1.1.8` as diagnostic-only. Do not promote it, do not stage it as a
rollback candidate, do not rerun its historical workflow, and do not use it as
phone-readiness evidence. The hardened native-fingerprint protocol is itself a
native compatibility input, so a new Play-signed APK built from the governed
head must be installed before a new canary can satisfy the handset gate.

## Rollback (operator)

Rollback repoints the manifest at an artifact that **already exists**. It never
rebuilds, and it never modifies the old bundle. Production rollback still follows
the canary-first workflow: stage the historical artifact on canary, verify it on a
phone, then promote that exact signed canary pointer.

If the artifact on disk no longer hashes to its own filename, rollback **refuses**
and exits non-zero rather than signing a mutated bundle.

## Promotion canary → production

Promotion is deliberately a separate human workflow dispatch, not a flag on
publish. Supply `mode=promote` and the exact `<version>/<hash>.zip` observed on
the verified canary handset, plus `evidence_commit_sha`, the lowercase full SHA
of a commit containing that exact handset receipt. The evidence commit must be
an ancestor of the `main` commit from which the promotion workflow is dispatched.

The workflow verifies that `<version>/<hash>.zip` is the exact artifact named by
the valid signed canary pointer before it can sign the production pointer. It
binds the receipt to the artifact SHA-256, bundle ID, native fingerprint,
release SHA, byte-for-byte canary-manifest SHA-256, and pointer timestamp. It
then re-fetches the canary pointer before publication and checks it again under
the production host lock. Any drift stops the run. Use `stage-canary` first when
the candidate is an older rollback artifact.

The receipt lives at
`docs/release/evidence/ota/<artifact-sha256>.json`; its transcript and screenshots
live under `docs/release/evidence/ota/files/`. See that directory's `README.md`
for the exact schema. Receipt and evidence files are ordinary review inputs,
not self-authorization: the protected `ota-production` environment still
requires a human reviewer and does not permit administrator bypass.

Only a physical, Play-installed handset clears this gate. Firebase distribution,
direct APK installation, an emulator, a browser preview, a successful build, or
a valid cryptographic signature can support diagnosis but cannot replace the
required **Check now → Update ready → Restart → About shows the exact
bundle ID on canary** proof.

---

## VPS hosting (one-time)

DNS: `updates.factorylm.com` → `165.245.138.91`

```bash
sudo mkdir -p /srv/factorylm/ota/releases
sudo cp deployment/nginx-updates-factorylm.conf \
  /etc/nginx/sites-available/updates.factorylm.com
sudo ln -sf /etc/nginx/sites-available/updates.factorylm.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d updates.factorylm.com
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://updates.factorylm.com/healthz     # -> ok
```

Static files only — no `proxy_pass`, no application.

## How a device actually gets the manifest

The device does **not** read `manifest.<channel>.json` from this host directly.
It asks the Hub through the app's authenticated request path:

```
GET https://app.factorylm.com/api/mobile/live-update/manifest/?channel=<c>&fingerprint=<fp>
```

(`mira-hub/src/app/api/mobile/live-update/manifest/route.ts`, added because the
client had called this since #3393 and the route did not exist — every "Check
now" returned `Update server error (404)`.)

The trailing slash is intentional. Native requests carry the persisted app
session cookie; browser requests use `credentials: include`. A bare unauthenticated
probe may redirect or return `401` and is not evidence that a signed-in phone can
discover an update.

That route reads the published `manifest.<channel>.json` from `OTA_ORIGIN`
(default `https://updates.factorylm.com`) and serves it only if it is usable:
right channel, fingerprint matching the asking shell, valid immutable-provenance
and channel-pointer signatures, matching artifact digest/path, and a
`downloadUrl` on the release host itself. Anything else is a `200` with no
`downloadUrl`, which the client reads as "no update" rather than an error.

The **artifact** is still fetched straight from this host by the device — the
Hub is never a proxy for the zip. It verifies the signed provenance and pointer;
the device separately verifies that the downloaded ZIP bytes match the signed
artifact, against the public key baked into the APK.

Consequence worth knowing: **the Hub must be up for a device to discover an
update.** It does not need to be up to serve one — an already-discovered
download comes from this host. (An earlier version of this runbook claimed the
Hub could be down entirely; that stopped being true once the client started
asking the Hub for the manifest.)

---

## Firebase App Distribution (native APK path)

Workflow: `.github/workflows/mobile-release-distribute.yml` (manual dispatch;
`distribute: no` builds and verifies without sending anything).

**Everything in the repo is done. What remains needs an interactive Google login,
so it has to be Mike.** Shortest path:

1. <https://console.firebase.google.com> → **Add project** → name `factorylm` →
   Google Analytics **off** → Create.
2. In the project → **Add app** → **Android**:
   - package name **exactly** `com.factorylm.mira`
   - SHA-1 is not required for App Distribution — skip it
   - skip the config-file download (the app is not a Firebase SDK consumer)
3. Copy the **App ID** (looks like `1:123456789012:android:abc123def456`).
4. **Project settings → Service accounts → Generate new private key** → downloads a JSON.
5. **App Distribution → Testers & Groups →** create a group named `technicians`,
   add your own email.
6. Hand the two values over (do not paste them in chat — set them directly):

```bash
doppler secrets set FIREBASE_ANDROID_APP_ID="1:...:android:..." \
  --project factorylm --config prd
doppler secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ~/Downloads/<that-file>.json)" \
  --project factorylm --config prd
```

Also needed once for this separate native/Firebase lane: `DOPPLER_TOKEN` as a
secret in the protected `production` environment (a Doppler service token scoped
to `factorylm/prd`). It is not used by `ota-release.yml`.

Then: **Actions → Mobile release — build + distribute → Run workflow**, with
`distribute: yes`.

The native workflow records the same exact-attempt replay-floor provenance in a
separate `native-release-provenance-<sha>-<run>-<attempt>` artifact alongside
the signed APK and AAB. Those artifact names include the run attempt so a rerun
cannot silently reuse or collide with an earlier build's outputs.

---

## What the technician sees

In the canonical FactoryLM mobile shell, **About & updates** shows app
version/build, package, platform, native fingerprint, active OTA bundle,
channel, last check + result, **Check now**, and **Recover to packaged version**.
The canonical adapter also owns explicit **Enroll in canary updates** and
**Return to production updates** controls. The classic rollback screen remains
feature-frozen and must not gain new product controls.

The fingerprint is shown on purpose: when an update "is not arriving", a
fingerprint mismatch is usually the reason, and it turns a mystery into a
one-glance answer.
