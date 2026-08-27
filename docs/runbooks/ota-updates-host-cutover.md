# Runbook: `updates.factorylm.com` OTA release-host cutover

**Goal:** bring the static OTA release host live on the prod VPS so Android phones can discover
and download signed web bundles. This is the last open gate from the OTA program (#3393, #3404).

**Owner split.** Steps marked **[MIKE]** need the DNS account, root on the VPS, or the phone in
hand. Steps marked **[CLAUDE]** are repo/CI work Claude can do afterwards without touching prod.

**Sources of truth (read if anything here looks off):**
`docs/release/android/ota.md` § *VPS hosting*, `deployment/nginx-updates-factorylm.conf`,
`docs/adr/0034-native-mobile-static-capacitor-client.md` § *signed OTA web bundles*,
`mira-mobile/scripts/ota-{publish,deploy,rollback}.mjs`,
`mira-hub/src/app/api/mobile/live-update/manifest/route.ts`.

**Never in this file:** secret values. The only secret involved is `OTA_SIGNING_PRIVATE_KEY`
(Doppler `factorylm/prd`), and it is only ever injected via `doppler run`.

---

## 0. Preconditions (2 min)

- **[MIKE]** You can `ssh factorylm-prod` (alias for `root@165.245.138.91`,
  `docs/runbooks/deploy-to-production.md`). The `ota-deploy.mjs` script uses that exact alias
  (`--host factorylm-prod` default) for `rsync`/`scp`, so the same key must work from the
  machine you publish from.
- **[MIKE]** `deployment/nginx-updates-factorylm.conf` is on `main` (it is — it ships the
  `/healthz` probe, the `no-store` manifest location, and the immutable `/releases/` location).
- **[MIKE]** Local checkout of `main` at a known SHA (record it in §7): `git rev-parse HEAD`.

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

# artifact store the deploy script rsyncs into (root-owned is fine: deploys run as root over ssh)
mkdir -p /srv/factorylm/ota/releases

# certbot HTTP-01 webroot referenced by the port-80 server block
mkdir -p /var/www/certbot

ln -sf /etc/nginx/sites-available/updates.factorylm.com \
       /etc/nginx/sites-enabled/updates.factorylm.com
ls -l /etc/nginx/sites-enabled/ | grep updates
# lrwxrwxrwx ... updates.factorylm.com -> /etc/nginx/sites-available/updates.factorylm.com
```

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

## 4. Verification — **[MIKE]** on the VPS/laptop, **[CLAUDE]** may re-run the curls later

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
# HTTP/2 404      <- expected UNTIL §5 publishes; after: 200 + cache-control: no-store, no-cache, must-revalidate
```

Note: this vhost does **not** set `Strict-Transport-Security` (unlike `app.factorylm.com`).
That is by design in the conf as committed — do not expect an HSTS header. **[CLAUDE]** can
add it in a follow-up PR if wanted.

### 4b. Manifest round-trip through the Hub

The phone never reads `manifest.<channel>.json` directly; it asks
`GET https://app.factorylm.com/api/mobile/live-update/manifest?channel=<c>&fingerprint=<fp>`.
That route is **session-gated** (`sessionOr401`), so an anonymous curl proves only that the route
exists:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://app.factorylm.com/api/mobile/live-update/manifest?channel=canary&fingerprint=0000000000000000"
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

**Verify from the phone (the real test):** open the app → **More → About & updates → Check
now**. The screen shows channel, native fingerprint, last check + result. Before §5 the result
reads as "no update"; after §5 it shows **Update ready** with a Restart action. If it shows
`Update server error (NNN)`, the Hub route returned non-2xx — capture NNN for §7.

---

## 5. Canary publish → deploy → rollback — **[MIKE]** (private key required)

All commands from `mira-mobile/`, on the same commit the installed APK was built from (the
`nativeFingerprint` must match the phone's, and `ota-deploy.mjs` refuses otherwise).

```bash
cd mira-mobile

# 5a. Build + sign + stage locally. Key injected by Doppler, never typed.
doppler run --project factorylm --config prd -- \
  node scripts/ota-publish.mjs --channel canary --version 1.0.2
# published (staged locally — nothing uploaded yet)
#   channel       canary
#   bundleId      1.0.2-<8 hex>
#   artifact      releases/1.0.2/<16 hex>.zip
#   sha256        <64 hex>
#   fingerprint   <16 hex>            <- must equal the phone's About screen fingerprint
#   manifest      ota-out/manifest.canary.json
# next: node scripts/ota-deploy.mjs --channel canary

# 5b. Dry run (default). Prints the plan, uploads nothing.
node scripts/ota-deploy.mjs --channel canary
# channel     canary
# bundleId    1.0.2-<8 hex>
# artifact    https://updates.factorylm.com/releases/1.0.2/<16 hex>.zip
# fingerprint <16 hex>
# plan (artifacts first, manifest last):
#   1. rsync -av --ignore-existing ota-out/releases/ factorylm-prod:/srv/factorylm/ota/releases/
#   2. scp ota-out/manifest.canary.json factorylm-prod:/srv/factorylm/ota/manifest.canary.json
# dry run — re-run with --confirm to upload.

# 5c. Upload: artifacts first, manifest last (the manifest scp is the atomic flip).
node scripts/ota-deploy.mjs --channel canary --confirm
# $ rsync -av --ignore-existing ota-out/releases/ factorylm-prod:/srv/factorylm/ota/releases/
# $ scp ota-out/manifest.canary.json factorylm-prod:/srv/factorylm/ota/manifest.canary.json
# live: https://updates.factorylm.com/manifest.canary.json

curl -s https://updates.factorylm.com/manifest.canary.json | head -c 400   # JSON, downloadUrl on this host
```

Phone (on the **canary** channel): More → About & updates → Check now → **Update ready** →
Restart → About screen shows the new active OTA bundle id. Watch for the ADR-0034 condition 8
auto-rollback: if the app does not reach `LiveUpdate.ready()` it reverts to the previous bundle
on its own — that counts as a failed canary, not a crash.

```bash
# 5d. Rollback drill (repoints the pointer at an artifact that already exists; never rebuilds)
node scripts/ota-rollback.mjs --channel canary --list
# available releases (channel: canary)
#   * 1.0.2/<16 hex>.zip
# * = currently pointed to by manifest.canary.json

doppler run --project factorylm --config prd -- \
  node scripts/ota-rollback.mjs --channel canary --to <version>/<hash>.zip
# rolled back (staged locally — nothing uploaded yet)
#   channel   canary
#   now       <version>/<hash>.zip
#   bundleId  <version>-<8 hex>
# next: node scripts/ota-deploy.mjs --channel canary

node scripts/ota-deploy.mjs --channel canary --confirm
```

If rollback prints `INTEGRITY FAILURE: … does not hash to its own name` and exits 1, stop — the
artifact store has been mutated; do not sign it. (`--list` reads the local `ota-out/releases/`,
so run it from the machine that published.)

Promotion to `production` is the same rollback command with `--channel production`
(`ota.md` § *Promotion*). Do it as a separate, later human action.

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

## 7. Record the evidence — **[MIKE]** captures, **[CLAUDE]** files it

Fill in and paste into the tracking issue / `docs/promo-screenshots/` note. (The task cited
"PRD §13.2 steps 1 and 15"; no such section exists in
`docs/prd/2026-08-13-native-mobile-app-prd.md`, so the fields below are the ones that section
was described as requiring.)

| Field | Value |
|---|---|
| Device | e.g. Pixel 9a |
| Android version | Settings → About phone |
| App build | About & updates → version/build + package `com.factorylm.mira` |
| Native fingerprint (phone) | About & updates |
| Backend SHA | `git rev-parse HEAD` of the deployed Hub (`deploy-vps.yml` run) |
| OTA `bundleId` / `releaseSha` | from `manifest.canary.json` |
| Time (UTC) | of §4a pass and of the phone "Update ready" |
| `curl -sI …/healthz` | paste the 200 |
| Check-now result before / after publish | "no update" → "Update ready" |
| Rollback drill result | bundle id after §5d |
| Screenshots | About & updates before/after, 412x915, into `docs/promo-screenshots/` |

**[CLAUDE] follow-ups after Mike reports green:**
1. Add `updates.factorylm.com` to the `ALLOW` list in
   `.github/workflows/nginx-sites-enabled-hygiene.yml` (today it only warns
   "skipping symlink … add it to ALLOW if it is a real vhost" — not deleted, but noisy).
2. Update `docs/release/android/ota.md` § *VPS hosting* status line and
   `.planning/STATE.md`.
3. Optional: HSTS header on the vhost; `deploy-nginx-updates.yml` mirroring `deploy-nginx-stg.yml`
   so future vhost edits are a workflow dispatch instead of scp.
