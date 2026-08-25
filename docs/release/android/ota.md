# FactoryLM Android — OTA web-bundle updates

**Doctrine:** ADR-0034 § *Amendment: signed OTA web bundles* (2026-08-24). Read that first.

Two delivery paths, and the split is not negotiable:

| Change | Path | Why |
|---|---|---|
| HTML / CSS / JS only | **OTA** — publish a signed bundle | ~90% of changes; reaches phones on next app open |
| Native plugin, Capacitor upgrade, `MainActivity`, Gradle, manifest, permissions, SDK, **the OTA public key** | **APK** via Firebase / Play | OTA cannot carry native code |

`scripts/ota-guard.mjs` enforces the split mechanically and fails closed.

---

## Keys — two of them, deliberately separate

| Key | Purpose | Private half lives |
|---|---|---|
| Android upload keystore | signs the **APK** | Doppler `factorylm/prd` (`ANDROID_KEYSTORE_BASE64` + passwords) |
| OTA signing key (RSA-4096) | signs the **web bundle** | Doppler `factorylm/prd` (`OTA_SIGNING_PRIVATE_KEY`) |

They are separate so compromising one does not grant the other. The OTA **public**
key is compiled into the shell (`capacitor.config.ts` → `plugins.LiveUpdate.publicKey`)
and is not secret — that is what lets a phone reject a bundle signed by anyone else.

> **Changing the OTA public key is a NATIVE change.** It ships in an APK. A shell can
> only verify bundles signed by the key it was built with.

---

## Publish (operator)

```bash
cd mira-mobile

# 1. Build + sign + stage an immutable artifact. Private key comes from Doppler;
#    it is never typed on a command line.
doppler run --project factorylm --config prd -- \
  node scripts/ota-publish.mjs --channel canary --version 1.0.2

# 2. Review the plan (dry run by default).
node scripts/ota-deploy.mjs --channel canary

# 3. Upload: artifacts first, manifest last.
node scripts/ota-deploy.mjs --channel canary --confirm
```

Phones on that channel pick it up on the next app open, verify it, stage it, and
show **Update ready** with a Restart action. Nothing reloads under a technician.

## Rollback (operator)

Rollback repoints the manifest at an artifact that **already exists**. It never
rebuilds, and it never modifies the old bundle.

```bash
node scripts/ota-rollback.mjs --channel production --list

doppler run --project factorylm --config prd -- \
  node scripts/ota-rollback.mjs --channel production --to 1.0.1/fe548c1f078ad4ff.zip

node scripts/ota-deploy.mjs --channel production --confirm
```

If the artifact on disk no longer hashes to its own filename, rollback **refuses**
and exits non-zero rather than signing a mutated bundle.

## Promotion canary → production

Deliberately a separate human action, not a flag on publish:

```bash
doppler run --project factorylm --config prd -- \
  node scripts/ota-rollback.mjs --channel production --to <version>/<hash>.zip
node scripts/ota-deploy.mjs --channel production --confirm
```

(The same "repoint the pointer" mechanism — promotion and rollback are the same
operation in opposite directions, which is why there is only one implementation.)

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

Static files only — no `proxy_pass`, no application. The Hub can be down and the
update channel keeps working.

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

Also needed once for CI: `DOPPLER_TOKEN_PRD` as a GitHub Actions secret (a Doppler
service token scoped to `factorylm/prd`).

Then: **Actions → Mobile release — build + distribute → Run workflow**, with
`distribute: yes`.

---

## What the technician sees

**Settings → More → About & updates**: app version/build, package, platform,
native fingerprint, active OTA bundle, channel, last check + result, **Check now**,
and **Recover to packaged version**.

The fingerprint is shown on purpose: when an update "is not arriving", a
fingerprint mismatch is usually the reason, and it turns a mystery into a
one-glance answer.
