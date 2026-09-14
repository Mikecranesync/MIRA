# Runbook — Low-cost OVH recovery of MIRA (incident #3800)

**Status (2026-09-14):** prepared and tested locally; **no VPS identified yet, no DNS changed, no
production write made.** The DigitalOcean droplet `factorylm-prod` (165.245.138.91) was powered off
by DigitalOcean on 2026-09-14 10:12Z because the DO account is locked (#3800). This runbook rebuilds
the *technician surface* on a small OVH VPS from the existing repo components, without touching DO.

Source SHA prepared and tested: `1d20ab5e6cf32b5dc85904a9cc4255904d26fafd` (main).

## 0. What the minimum recovery is — and is not

| Recovered by this runbook (fresh app) | NOT recovered (historical data on the dead droplet) |
|---|---|
| `mira-hub` at `app.factorylm.com` — login, chat, projects/threads, uploads, retrieval, citations, document access, mobile API | `/opt/mira/data/*` — SQLite `mira.db` (pipeline/mcp/ingest), photos, session recordings, agent runs, eval runs |
| All state that lives in **Neon** (unchanged, untouched): users, tenants, notebooks, turns, `knowledge_entries`, uploaded originals (`BYTEA`), KG | Atlas CMMS (`cmms_db` Postgres + MinIO) — work orders, PM schedules: **separate compose project, on the droplet only** |
| Embedding contract preserved: `nomic-embed-text` (768-d) via `OLLAMA_BASE_URL` → Bravo over Tailscale; BM25-only if unreachable (designed degrade, #1385) | Nango DB (connector OAuth tokens), Redis, `mira-leads-data` (PrintSense `leads.jsonl`), OTA artifacts under `/srv/factorylm/ota` (`updates.factorylm.com`) |
| | `factorylm.com` marketing site (mira-web + `factorylm-landing` rsync) — rebuildable, not part of the minimum |

**Off-VPS copy of the historical data exists:** DigitalOcean weekly **backups are enabled** on the
droplet — 4 images: 2026-08-18, 08-25, 09-01, **09-08 (142.7 GB)**. They are usable only once the DO
account is unlocked (restore/snapshot is an account action). Neon rows for uploads are metadata *and*
originals for the namespace/evidence paths; `hub_uploads` rows whose bytes went to the legacy ingest
path have **rows without files** — do not report those as recovered.

Services deliberately **not** started (dependency-checked): `mira-pipeline`, `mira-mcp`, `mira-ingest`,
`mira-tika`, `mira-ask`, `mira-web`, bots, Foreman, Nango, Celery workers, relay. The Hub's calls to
them fail closed via `disabled://recovery` / unresolvable hostnames (same pattern as staging).

## 1. Prerequisites (human)

1. **OVH consumer key with real rules.** The key saved in Doppler on 2026-09-14 (`OVH_KEY`,
   `OVH_SECRET_KEY`, `OVH_CONSUMER_KEY`, all three configs) is *validated* but every rule has an
   **empty `path`**, so `GET /me`, `GET /vps`, `/cloud/project`, `/dedicated/server` all return
   `This call has not been granted`. Re-create it at <https://api.us.ovhcloud.com/createToken/> with
   **`GET /*` only** (read-only is enough for the preflight), optionally an IP allowlist and an
   expiry, and save it as `OVH_CONSUMER_KEY`. Then run:
   ```bash
   doppler run -p factorylm -c prd -- python3 tools/ovh/preflight.py        # GET-only
   ```
   Expected: `auth: AUTH_OK`, then `VPS_LISTED (n)` with model/RAM/disk/IP/OS/expiry/**billing**,
   or `VPS_NONE` (nothing purchased yet — API keys are not a purchase).
2. **If `VPS_NONE`:** buy one at <https://us.ovhcloud.com/vps/> — **VPS-2 (4 vCores / 8 GB / 75 GB
   NVMe, "starting at $8.50/mo")** matches the droplet's 8 GB; **VPS-1 (2 vCores / 4 GB / 40 GB,
   "$4.54/mo")** is enough for the Hub-only minimum (measured idle 66–69 MiB, 1 GiB limit). The
   "starting at" price is the annual-upfront rate; monthly billing is higher — read the actual
   monthly total from `serviceInfos`/`/services/{id}` in the preflight, not the storefront.
3. **SSH key** for root on the new box (API keys are not SSH credentials). Get the host key
   fingerprint from the OVH control panel / installation email and add the host to a **new**
   `~/.ssh/known_hosts` line — never `StrictHostKeyChecking=no`, never edit the existing
   `prod`/`factorylm-prod` aliases.
4. **Scoped Doppler service tokens**: one for `factorylm/stg` (private test) and, only at cutover,
   one for `factorylm/prd`. Never a personal token on the host.
5. **Tailscale auth key** (optional, for the Bravo embedder + private testing over the tailnet).

## 2. Host bootstrap (new, empty VPS only)

```bash
ssh root@<OVH-IP> 'bash -s' -- --sha 1d20ab5e6cf32b5dc85904a9cc4255904d26fafd \
    --admin-key "$(cat ~/.ssh/id_ed25519.pub)" < tools/recovery/bootstrap-host.sh
```
Idempotent. **Refuses** to run if `/opt/mira`, running containers, or a non-empty `/var/www` exist.
Installs docker + compose, nginx, ufw (deny in; 22/80/443 only), fail2ban, unattended-upgrades,
2 GiB swap, clones MIRA at the exact SHA, creates data dirs, installs the Doppler CLI. sshd goes
keys-only **only after** the admin key is present. No DNS, no certs, no secrets, no app start.

## 3. Deploy the minimum stack

Build the image where there is RAM (CHARLIE, measured: 373 MB image), ship it, run:
```bash
# on CHARLIE
docker compose -f docker-compose.saas.yml build mira-hub
docker save ovh-recovery-mira-hub:latest | gzip > /tmp/mira-hub.tar.gz && scp /tmp/mira-hub.tar.gz root@<OVH-IP>:/opt/
# on the VPS — PRIVATE TEST (Neon STAGING, emails off, bound to 127.0.0.1)
cd /opt/mira && DOPPLER_TOKEN=<stg service token> DOPPLER_CONFIG=stg \
  RECOVERY_PUBLIC_URL=http://localhost:3101 bash tools/recovery/deploy-recovery.sh --image /opt/mira-hub.tar.gz
```
Test privately over an SSH tunnel (`ssh -L 3101:127.0.0.1:3101 root@<OVH-IP>`), then run §4.
Nothing is exposed publicly until nginx is enabled in §6.

## 4. Evidence (what "works" means)

```bash
# from CHARLIE, against the tunnel: two throwaway strangers on Neon staging
( cd mira-hub && HUB_BASE=http://localhost:3101 doppler run -p factorylm -c stg -- bun run scripts/provision-beta-gate.ts ) > /tmp/gateA.out
( cd mira-hub && HUB_BASE=http://localhost:3101 doppler run -p factorylm -c stg -- bun run scripts/provision-beta-gate.ts ) > /tmp/gateB.out
set -a; . <(grep '^ENV:' /tmp/gateA.out | sed 's/^ENV://'); set +a
python -m pytest tests/beta/beta_ready_upload_retrieval_citation.py --confcutdir=tests/beta -v   # upload → cited answer
HUB=http://127.0.0.1:3101 GATE_ENV_A=/tmp/gateA.out GATE_ENV_B=/tmp/gateB.out bash tools/recovery/verify.sh
( cd mira-hub && doppler run -p factorylm -c stg -- bun run scripts/provision-beta-gate.ts --cleanup "$BETA_GATE_TENANT" )   # and B
bash tools/recovery/backup.sh backup && bash tools/recovery/backup.sh restore-test /var/backups/mira/<file>
```

### Result of this exact procedure on CHARLIE, 2026-09-14 21:41Z (Colima, image built from `1d20ab5e`)

| Check | Result |
|---|---|
| Hub image builds from main SHA | ✅ `ovh-recovery-mira-hub:latest`, 373 MB |
| `/api/health/` | ✅ 200, `gitSha=1d20ab5e…`, `approvedRetrievalEnforced=false` |
| Login (provisioned credentials session → `/api/me`) | ✅ 200; anonymous → 401 |
| Project/thread create | ✅ notebook created |
| Streamed chat (`text/event-stream`) | ✅ 7 SSE events (general turn); 89 events (node chat) |
| Saved + reloaded history | ✅ 1 turn on `GET /api/equipment-notebooks/{id}/` |
| Upload → ingest → cited answer (beta gate) | ✅ `1 passed` — `gs10_fault_codes.pdf` |
| Cited answer content | ✅ "oC … over-current … 200 % of rated current", 1 citation → `gs10_fault_codes.pdf` p.1 |
| Document access (byte door) | ✅ `/api/namespace/files/{id}/` → 200 `application/pdf` from Neon `BYTEA` |
| Tenant isolation (stranger B on A's files / notebook / bytes) | ✅ 404 / 404 / 404 |
| Restart persistence (`docker restart`) | ✅ turn and file still served |
| Embedder reachable from container (`OLLAMA_BASE_URL` from `factorylm/stg`) | ✅ HTTP 200 |
| Footprint | idle 66–69 MiB RAM of 1 GiB limit; image 373 MB |
| Backup + restore-test (`backup.sh`) | ✅ archive written, `sha256 OK`, contents listed |
| Staging cleanup | ✅ both tenants swept, "auth + data rows verified gone" |

Emails, billing, webhooks, background jobs: **not exercised** — `RESEND_API_KEY` empty in test mode;
Stripe/Nango/bots/workers not started; `factorylm/stg` has no Stripe keys.

## 5. Backup / restore / rollback

- **System of record is Neon** (PITR + branches). The Hub-only host has no durable local state except
  transient upload-retry buffers (`backup.sh` covers the volume, `/opt/mira/data`, nginx + certs).
- **Rollback of the app** = `git -C /opt/mira checkout <previous SHA>` + redeploy, or `docker load` the
  previous image tarball. Keep the last two image tarballs under `/opt/`.
- **Rollback of the cutover** = point DNS back (§6). Nothing on the OVH host writes anywhere DO did.

## 6. Cutover (human-gated — STOP before each step)

1. Preflight on the OVH host with **prd**: `DOPPLER_CONFIG=prd RECOVERY_ALLOW_PROD=1
   RECOVERY_PUBLIC_URL=https://app.factorylm.com RECOVERY_RESEND_API_KEY=<from Doppler at runtime>`.
   (`deploy-recovery.sh` refuses `prd` without `RECOVERY_ALLOW_PROD=1`.)
2. Install the existing vhost: `cp deployment/nginx-app-factorylm.conf /etc/nginx/sites-enabled/app-factorylm`
   — it already proxies `/` → `127.0.0.1:3101` (Hub) and the marketing/`/m/` paths → `:3200` (mira-web,
   not started: those paths 502 until mira-web is added; acceptable for the minimum).
3. **DNS:** lower TTL first, then `app.factorylm.com` A → `<OVH-IP>`; `certbot --nginx -d app.factorylm.com`.
   `updates.factorylm.com` / `factorylm.com` stay down until their artifacts are restored from the DO backup.
4. `bash install/smoke_test.sh`; sign in on the phone; run `tools/mobile-e2e/run.sh` against the new host.
5. Point CI at the new host only in a follow-up PR (`deploy-vps.yml` still hardcodes `165.245.138.91`
   and `deployment/known_hosts.factorylm-prod`).

## 7. Files

| Path | Purpose |
|---|---|
| `tools/ovh/preflight.py` | GET-only OVH auth + VPS/billing inventory (official SDK, Doppler-injected, name-mapped in-process) |
| `tools/recovery/compose.recovery.yml` | Hub-only overlay on `docker-compose.saas.yml` (`--no-deps mira-hub`) |
| `tools/recovery/bootstrap-host.sh` | Idempotent, refuse-if-not-empty host bootstrap |
| `tools/recovery/deploy-recovery.sh` | Build-or-load + up + readiness; prd requires explicit opt-in |
| `tools/recovery/verify.sh` | The evidence run above (sanitized PASS/FAIL output) |
| `tools/recovery/backup.sh` | backup / restore-test / restore of local state |
