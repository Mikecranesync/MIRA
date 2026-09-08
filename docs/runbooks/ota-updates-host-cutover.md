# Runbook: `updates.factorylm.com` OTA release-host cutover

**Purpose:** initial or recovery provisioning of the static OTA release host so
Android phones can discover and download signed web bundles. This is a host
bootstrap runbook, not the routine publish or rollback procedure.

> **Routine releases never follow the old local `doppler run`, `ota-deploy.mjs`,
> root SSH, or manual `scp` path.** After bootstrap, use the main-only
> `.github/workflows/ota-release.yml` flow documented in
> `docs/release/android/ota.md`. That workflow deliberately has no provision mode.

**Owner split.** Steps marked **[MIKE]** need the DNS account, temporary
administrative host access, GitHub environment administration, or the phone in
hand. Steps marked **[AGENT]** are read-only repo/CI verification that can happen
afterwards without changing production.

**Sources of truth (read if anything here looks off):**
`docs/release/android/ota.md`, `docs/release/evidence/ota/README.md`,
`.github/workflows/ota-release.yml`, `deployment/nginx-updates-factorylm.conf`,
`docs/adr/0034-native-mobile-static-capacitor-client.md` § *signed OTA web bundles*,
`mira-mobile/scripts/ota-{guard,package,provenance,publish,deploy,rollback}.mjs`,
`mira-hub/src/app/api/mobile/live-update/manifest/route.ts`.

**Never in this file:** secret values, private keys, tokens, or production
credentials. Routine signing reads `OTA_SIGNING_PRIVATE_KEY` from the isolated
Doppler `factorylm/ota_signing` config through a scoped service token; routine
publication uses separate restricted canary and production SSH identities.

---

## 0. Preconditions (2 min)

- **[MIKE]** You have temporary administrative access to provision nginx, TLS,
  the release directories, and restricted release identities. Routine workflow
  credentials must never be root credentials.
- **[MIKE]** `deployment/nginx-updates-factorylm.conf` is on `main` (it is — it ships the
  `/healthz` probe, the `no-store` manifest location, and the immutable `/releases/` location).
- **[MIKE]** The exact reviewed nginx configuration is merged to `main`; record
  that commit in the bootstrap/change ticket.

---

## 1. DNS A record — **[MIKE]** (2 min + propagation)

Same DNS provider as the other `factorylm.com` records (the `stg` host was added the same way,
`docs/plans/2026-06-15-staging-usable-subdomain.md`).

| Field | Value |
|---|---|
| Type | `A` |
| Name / host | `updates` (FQDN `updates.factorylm.com`) |
| Value | `165.245.138.91` |
| TTL | `300` (5 min) while cutting over; raise to `3600` after §4 passes |
| Proxy / CDN | **OFF** (grey-cloud if Cloudflare). The manifest is `no-store` and certbot's HTTP-01 challenge must reach nginx directly. |

Verify propagation (run from your laptop; repeat until both agree):

```bash
dig +short updates.factorylm.com A
# expected:
# 165.245.138.91

dig +short @1.1.1.1 updates.factorylm.com A     # public resolver, bypasses local cache
# 165.245.138.91

nslookup updates.factorylm.com                  # Windows
# Name:    updates.factorylm.com
# Address: 165.245.138.91
```

Do not continue to §3 until `dig @1.1.1.1` returns the IP — certbot will fail otherwise.

---

## 2. nginx vhost install — **[MIKE]** (3 min)

Matches existing practice on this VPS: vhost in `sites-available`, symlink into `sites-enabled`,
`nginx -t`, reload (same shape as `.github/workflows/deploy-nginx-stg.yml`).

From your laptop, at the repo root on `main`:

```bash
scp deployment/nginx-updates-factorylm.conf \
  factorylm-prod:/etc/nginx/sites-available/updates.factorylm.com
```

Then on the VPS:

```bash
ssh factorylm-prod

# artifact store; bootstrap uses admin access, routine release jobs do not
mkdir -p /srv/factorylm/ota/releases
mkdir -p /srv/factorylm/ota/.incoming

# certbot HTTP-01 webroot referenced by the port-80 server block
mkdir -p /var/www/certbot

ln -sf /etc/nginx/sites-available/updates.factorylm.com \
       /etc/nginx/sites-enabled/updates.factorylm.com
ls -l /etc/nginx/sites-enabled/ | grep updates
# lrwxrwxrwx ... updates.factorylm.com -> /etc/nginx/sites-available/updates.factorylm.com
```

Before enabling routine publication, provision two separate non-root release
identities and test their least-privilege boundaries:

- The canary identity may create immutable files below `releases/`, use
  `.incoming/` and the shared `.ota-pointer.lock`, and atomically replace only
  `manifest.canary.json`.
- The production identity may read the exact canary pointer and immutable
  release files, use `.incoming/` and the shared `.ota-pointer.lock`, and
  atomically replace only `manifest.production.json`.
- Neither identity may obtain a shell outside this release role, write the
  other's pointer, modify nginx/TLS, or run as root.

The concrete account names are environment variables, not doctrine. Store them
as `OTA_CANARY_SSH_USER` in `ota-canary` and `OTA_PRODUCTION_SSH_USER` in
`ota-production`; store their distinct private keys only in the matching
environment secrets. Keep the committed SSH host key as the trust anchor.

**Do NOT run `nginx -t` yet** — the 443 block references
`/etc/letsencrypt/live/updates.factorylm.com/*.pem`, which does not exist until §3, and `nginx -t`
will fail on the missing cert. Certbot's `--nginx` installer needs the 80 block reachable, so:

```bash
# temporarily enable only the port-80 half so certbot can answer the challenge
sed -n '1,36p' /etc/nginx/sites-available/updates.factorylm.com > /etc/nginx/sites-available/updates.factorylm.com.http-only
ln -sf /etc/nginx/sites-available/updates.factorylm.com.http-only /etc/nginx/sites-enabled/updates.factorylm.com
nginx -t && systemctl reload nginx
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

(Lines 1–36 of the conf are the comment header plus the complete `listen 80` server block —
check with `tail -3 …http-only` that it ends at the closing `}` of that block.)

---

## 3. TLS certificate — **[MIKE]** (2 min)

Existing hosts on this VPS use Let's Encrypt via certbot's nginx plugin
(`app.factorylm.com` cert lines in `deployment/nginx-app-factorylm.conf:356-359`;
`stg` plan says `certbot --nginx -d stg.factorylm.com`). Use `certonly` so certbot does **not**
rewrite the repo-managed vhost:

```bash
certbot certonly --webroot -w /var/www/certbot -d updates.factorylm.com
# ...
# Successfully received certificate.
# Certificate is saved at: /etc/letsencrypt/live/updates.factorylm.com/fullchain.pem
# Key is saved at:         /etc/letsencrypt/live/updates.factorylm.com/privkey.pem
```

If webroot fails (challenge 404), fall back to `certbot certonly --nginx -d updates.factorylm.com`.

Now swap in the full vhost and reload:

```bash
ln -sf /etc/nginx/sites-available/updates.factorylm.com /etc/nginx/sites-enabled/updates.factorylm.com
rm -f /etc/nginx/sites-available/updates.factorylm.com.http-only
nginx -t && systemctl reload nginx
# nginx: ... syntax is ok
# nginx: ... test is successful
```

Renewal check (the timer already renews `app.factorylm.com`; confirm the new cert is in the set):

```bash
certbot certificates | grep -A3 updates.factorylm.com
#   Certificate Name: updates.factorylm.com
#     Domains: updates.factorylm.com
#     Expiry Date: <~90 days out> (VALID: 89 days)
certbot renew --dry-run 2>&1 | grep -E "updates.factorylm.com|Congratulations|failed"
# Congratulations, all simulated renewals succeeded: ... updates.factorylm.com/fullchain.pem (success)
systemctl list-timers | grep certbot     # timer present
```

---

## 4. Verification — **[MIKE]** on the VPS/laptop, **[AGENT]** may re-run the curls later

### 4a. Host liveness + headers

```bash
curl -sI https://updates.factorylm.com/healthz
# HTTP/2 200
# content-type: text/plain
# x-content-type-options: nosniff
# referrer-policy: no-referrer

curl -sS https://updates.factorylm.com/healthz
# ok

curl -sI http://updates.factorylm.com/healthz | head -3
# HTTP/1.1 301 Moved Permanently
# location: https://updates.factorylm.com/healthz

curl -sI https://updates.factorylm.com/               # root is deliberately 404
# HTTP/2 404
curl -sI https://updates.factorylm.com/manifest.canary.json
# HTTP/2 404 on a newly provisioned empty host; an existing host may already return a canary pointer
# After a governed publish: 200 + cache-control: no-store, no-cache, must-revalidate
```

Note: this vhost does **not** set `Strict-Transport-Security` (unlike `app.factorylm.com`).
That is by design in the conf as committed — do not expect an HSTS header. **[AGENT]** can
add it in a follow-up PR if wanted.

### 4b. Manifest round-trip through the Hub

The phone never reads `manifest.<channel>.json` directly; it asks
`GET https://app.factorylm.com/api/mobile/live-update/manifest/?channel=<c>&fingerprint=<fp>`.
That route is **session-gated** (`sessionOr401`), so an anonymous curl proves only that the route
exists:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://app.factorylm.com/api/mobile/live-update/manifest/?channel=canary&fingerprint=0000000000000000"
# 401
```

Contract to look for once authenticated (any non-2xx is a bug; ordinary outcomes are 200):

| Body | Meaning |
|---|---|
| `{"update":false,"reason":"upstream_unavailable"}` | DNS/TLS/nginx not reachable from the Hub → §1–§3 incomplete |
| `{"update":false,"reason":"no_manifest"}` | host is up, nothing published yet → §5 next |
| `{"update":false,"reason":"incompatible_native"}` | published, but the shell's fingerprint differs → re-publish from the shell's build |
| `{"bundleId":..., "downloadUrl":"https://updates.factorylm.com/releases/<v>/<hash>.zip", "checksum":..., "signature":..., ...}` | **success — `downloadUrl` populated** |

The Hub reads the release host from env var **`OTA_ORIGIN`** (name only; default
`https://updates.factorylm.com`, so no Doppler change is needed unless you want to override it).

**Verify from the phone (the real test):** open the signed-in app → **About & updates → Check
now**. The screen shows channel, native fingerprint, last check + result. Before §5 the result
reads as "no update"; after a governed publish it shows **Update ready** with a Restart action. If it shows
`Update server error (NNN)`, the Hub route returned non-2xx — capture NNN for §7.

---

## 5. Hand off to the governed release workflow

Host bootstrap stops here. Do not materialize the OTA signing key locally and do
not publish with root SSH, `ota-deploy.mjs --confirm`, or manual `scp`. Once the
release configuration and restricted identities are tested, follow
`docs/release/android/ota.md`:

1. Merge a governed source head to `main`.
2. Dispatch `.github/workflows/ota-release.yml` with `mode=publish`,
   `channel=canary`, a semantic `version`, and the exact full `apk_base_sha` of
   the Play APK installed on the test phone.
3. Confirm the workflow installs the immutable ZIP and signed provenance before
   atomically changing `manifest.canary.json`.
4. On a physical Play-installed phone enrolled in canary, complete **Check now →
   Update ready → Restart → About shows the exact bundle ID**. Automatic
   rollback means the canary failed; it is never a soft pass.
5. Commit the exact receipt and evidence under
   `docs/release/evidence/ota/` using that directory's `README.md`.
6. Dispatch `mode=promote` with the exact immutable target and full
   `evidence_commit_sha`. Production remains behind the protected
   `ota-production` human-review environment.

A rollback follows the same canary-first proof path. Dispatch
`mode=stage-canary` for an existing authenticated immutable target, test that
exact target on the Play handset, commit a new receipt, and only then dispatch
`mode=promote`. The current workflow has no direct production publish and no
rollback override.

### Quarantined canary 1.1.8

Actions run `34131104475` published canary `1.1.8` from draft source
`5cd26f33a441229abe774b3265570dbdba5a9128`, before the current trust split and
authenticated provenance contract. It is diagnostic-only, not
governance-cleared, and must not be promoted or used for handset readiness. Do
not rerun that historical workflow. Install a newly governed Play APK for the
current native-fingerprint protocol, then publish and test a new canary.

---

## 6. Rolling back the host itself — **[MIKE]**

Blast radius statement: **if this host disappears, phones fall back to
`{"update":false,"reason":"upstream_unavailable"}` from the Hub, which the client renders as
"no update". No crash, no error toast, no change to the running bundle** (route.ts turns every
upstream failure into a 200 with no `downloadUrl`). An already-installed OTA bundle keeps
running from app-private storage; "Recover to packaged version" is always available on the
About screen.

```bash
ssh factorylm-prod
rm -f /etc/nginx/sites-enabled/updates.factorylm.com
nginx -t && systemctl reload nginx
# sites-available copy, the cert, and /srv/factorylm/ota are left in place (harmless, reversible)
```

Then remove (or leave — it is inert without the vhost) the DNS `A` record for `updates`.

---

## 7. Record bootstrap evidence and release evidence separately

Record DNS, TLS, nginx configuration, restricted-account tests, and `/healthz`
results in the host-bootstrap change ticket. Those facts establish that the host
is available; they do **not** prove an OTA is safe for production.

Each production candidate needs a separate, Git-tracked receipt at
`docs/release/evidence/ota/<artifact-sha256>.json` plus hashed transcript and
screenshot files under `docs/release/evidence/ota/files/`. Follow
`docs/release/evidence/ota/README.md` exactly. The receipt binds the physical
Play-installed phone result to:

- the immutable artifact SHA-256 and bundle ID;
- the native fingerprint and exact release SHA;
- the byte-for-byte canary-manifest SHA-256 and its pointer timestamp;
- package `com.factorylm.mira`, installer `com.android.vending`, and the Play
  app-signing certificate;
- successful Update-ready, Restart, and post-restart About verification.

Commit the receipt and files without credentials, account identifiers, or a
device serial. The evidence commit must land on `main` before the production
promotion dispatch, and a human reviewer must still approve the protected
`ota-production` deployment.
