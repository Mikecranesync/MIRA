# Runbook — Low-cost OVH recovery of MIRA (incident #3800)

**Status (2026-09-14 22:05Z):** prepared and tested locally; **VPS identified (read-only), SSH not yet
verified, no DNS changed, no production write made.** Preflight with the re-issued `GET *` key:

| Field | Value (from the OVH API, GET only) |
|---|---|
| Service | `vps-2d884531.vps.ovh.us` — the only VPS on the account (0 Public Cloud projects, 0 dedicated) |
| Plan | **VPS-3 2027** — 6 vCore, 12 GB RAM, 100 GB NVMe, `offerType=ssd` |
| Region | Hillsboro, US-WEST-OR-2 (`os-us-west-or-2`) |
| IPv4 / IPv6 | `40.160.141.61` / `2604:2dc0:202:300::1fc6` |
| State | `running`, created 2026-09-14 21:09Z, order 8863121 **delivered** |
| OS | "Linux" on the order; exact image not exposed on this API version — read it over SSH |
| Actual billing | **$14.50 USD / month**, `rental`, `P1M`, automatic renewal, **no engagement**; next billing 2026-10-14 |
| Included options | Automated Backup Standard (enabled, rotation 1, 17:10 daily) + Local Storage — $0.00 |
| Ports from CHARLIE | 22 open; 80/443 closed (nothing serving yet) |
| Host keys seen on first scan (unverified) | ED25519 `SHA256:yslCH8KRVJu0281ztiTXYxD9o8Ogg32OQ2rZ5pn8FrY` · RSA `SHA256:Uv/uhxnk/jHBbp2Ew8CFXE+SeAdVpwn4EmMdGXknmms` · ECDSA `SHA256:jsd5uFks1PCxwEYrv6Gv4wjYh9Fg/qa2uxk5+FX9MGI` |
| API credential | `GET *` only, expires 2026-09-15 18:37 -04:00 | The DigitalOcean droplet `factorylm-prod` (165.245.138.91) was powered off
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

1. **OVH consumer key** — ✅ done 2026-09-14: re-issued with `GET *` only (the first key had
   empty-path rules and granted nothing), saved to Doppler as `OVH_APPLICATION_KEY` /
   `OVH_APPLICATION_SECRET` / `OVH_CONSUMER_KEY`, old key revoked. Expires 2026-09-15 18:37 -04:00;
   re-issue the same way when it lapses. Preflight, any time:
   ```bash
   doppler run -p factorylm -c prd -- python3 tools/ovh/preflight.py        # GET-only
   ```
2. **VPS** — ✅ exists (table above): VPS-3 2027, $14.50/month, no engagement. Nothing to buy.
   (For reference the storefront's "from $4.54 / $8.50" for VPS-1/VPS-2 are annual-upfront rates.)
3. **SSH access — ⛔ BLOCKED on an account-expiry loop; one console action needed from Mike.**

   Investigated 2026-09-14 ~23:05Z. The credential is identified and works, but the account cannot
   reach a shell over SSH:
   - **Doppler secret that held the initial credential:** `OVH_VPS_INITIAL_ROOT_PASSWORD` (the working
     user is **`ubuntu`**, the OVH default — **not** `OVH_ROOT_USER`, which is `root` and is rejected;
     `root` and `debian` both give `Permission denied`). ⚠️ **This value is now DEAD** — the password
     was changed away from it during this investigation; anyone trying it now gets `Permission denied`
     and must use `OVH_VPS_UBUNTU_PASSWORD` instead. Do not conclude the box is unreachable from that.
   - Host key **verified**: server ED25519 == `SHA256:yslCH8KRVJu0281ztiTXYxD9o8Ogg32OQ2rZ5pn8FrY`,
     pinned via `-o UserKnownHostsFile` + `StrictHostKeyChecking=yes` on every call.
   - `ubuntu` + the initial password **authenticates**, but the account is **password-expired** and
     the image closes the session after the forced change ("you must change your password now and
     login again"). It was changed **twice** (each `passwd: password updated successfully`), and
     **every** subsequent login re-expires — i.e. a password change does **not** clear the aging
     (consistent with `chage -M 0` / `PASS_MAX_DAYS 0`). A password login therefore **never** reaches
     a shell, so the key cannot be installed and `chage` cannot be run from here. With `UsePAM yes`
     an expired account also blocks non-interactive **pubkey** command execution, so installing a key
     without clearing the aging would not help.
   - The live `ubuntu` password now lives in Doppler as **`OVH_VPS_UBUNTU_PASSWORD`** (all three
     configs; the transient `_NEXT` staging secret was deleted). `OVH_VPS_INITIAL_ROOT_PASSWORD` is
     now historical (superseded by two changes).

   **The one action needed (OVH web KVM console — not a service change, not destructive):** open the
   VPS console in the OVH panel, log in as `ubuntu` with `OVH_VPS_UBUNTU_PASSWORD` (completing the
   forced change on the local TTY drops you to a shell, unlike SSH), then paste CHARLIE's key onto
   **root** and clear the aging so pubkey works:
   ```bash
   sudo install -d -m 700 /root/.ssh
   echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPB8r+WjEIGtY3MM3/SDEvaWL/ELtO8MMflBLf2hU+N5 charlienode@CharlieNodes-Mac-mini.local' | sudo tee -a /root/.ssh/authorized_keys
   sudo chmod 600 /root/.ssh/authorized_keys
   sudo chage -M -1 -d "$(date +%F)" ubuntu   # stop the re-expiry loop for ubuntu
   sudo passwd -S root ubuntu                  # (optional) show password status for the record
   ```
   Then tell CHARLIE. I verify `ssh -i ~/.ssh/id_ed25519 -o PreferredAuthentications=publickey root@40.160.141.61 id`
   from a fresh forced-pubkey connection, add a **new** `~/.ssh/known_hosts` line (never
   `StrictHostKeyChecking=no`, never touch the `prod`/`factorylm-prod` aliases), and continue the
   inspection → bootstrap → private Hub stages below.

   **➡️ SUPERSEDED 2026-09-14 by rescue-mode recovery — see § 1a.** Mike booted the VPS into OVH
   rescue mode instead of using the KVM console, which is the cleaner fix (offline chroot, no
   forced-change dance). The console path above stays only as a fallback.

### 1a. Rescue-mode account-aging fix (the chosen path)

The VPS is in OVH rescue mode (`netbootMode=rescue`, `state=rescued`, confirmed via the GET API).
Rescue is a **temporary OS with its own host key and its own one-time root password** — the
production disk is attached but not booted.

**Host-key trust — two distinct pins, do not conflate:**
- Rescue OS ED25519 `SHA256:uT8BMh04K3wLfJlfFAvQfAshizpd3zC+gQFhxXvZw4A` — **TOFU only, unverified**
  against any provider-published value (OVH does not publish the rescue key). Pinned in a *separate*
  `rescue_known_hosts`, never the production pin.
- Production OS ED25519 `SHA256:yslCH8KRVJu0281ztiTXYxD9o8Ogg32OQ2rZ5pn8FrY` — **verified** (Mike-supplied),
  unchanged by rescue, and is the strong pin for the **post-reboot** proof.

**Rescue credential:** OVH emails a one-time Secret-as-a-Service link; the password is **not** in
Doppler and neither existing secret opens rescue (both `Permission denied`), nor does CHARLIE's key
(account has 0 registered keys). Mike retrieves it and stores it as **`OVH_VPS_RESCUE_PASSWORD`**
(`factorylm/prd`). Do **not** open the link from tooling — it's a hash-route SPA WebFetch can't read,
opening it starts the 7-day clock, and pulling a credential into the session context is disallowed.

**Procedure once `OVH_VPS_RESCUE_PASSWORD` exists (run from CHARLIE, secret injected by Doppler):**
```bash
# 1. Authenticate to rescue (host key pinned to the rescue TOFU file), identify the disk BY CONTENT.
ssh ... root@40.160.141.61 'lsblk -f'                 # find the ext4 partition with the real OS
# 2. Mount READ-ONLY and inspect before any write.
mkdir -p /mnt/sys; mount -o ro /dev/<part> /mnt/sys
cat /mnt/sys/etc/os-release; cat /mnt/sys/etc/hostname
getent -s files:/mnt/sys/etc/shadow ubuntu 2>/dev/null || awk -F: '/^ubuntu:/' /mnt/sys/etc/shadow
#    STOP if the disk shows unexpected app/customer state: /opt/mira present, docker volumes with
#    data, non-empty /var/www. This box was delivered today and never bootstrapped → expect none.
# 3. Diagnose the exact aging field, then apply the MINIMUM fix (chroot so chage reads the disk's files).
mount -o remount,rw /mnt/sys
for m in dev dev/pts proc sys; do mount --bind /$m /mnt/sys/$m; done
chroot /mnt/sys /bin/bash -c '
  getent shadow ubuntu | awk -F: "{print \"lstchg=\"\$3\" min=\"\$4\" max=\"\$5\" warn=\"\$6\" inact=\"\$7\" expire=\"\$8}"
  chage -l ubuntu; passwd -S ubuntu; grep -E "^PASS_(MAX|MIN)_DAYS" /etc/login.defs
  # Apply ONLY what the fields show is wrong:
  #   max==0            -> chage -M -1 ubuntu
  #   lstchg==0/expired -> chage -d "$(date +%F)" ubuntu
  # 4. Install CHARLIE key for ubuntu (chown resolves via the disk /etc/passwd inside chroot).
  install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPB8r+WjEIGtY3MM3/SDEvaWL/ELtO8MMflBLf2hU+N5 charlienode@CharlieNodes-Mac-mini.local" >> /home/ubuntu/.ssh/authorized_keys
  chmod 600 /home/ubuntu/.ssh/authorized_keys; chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
'
# 5. Unmount in REVERSE, verify clean, sync.
for m in sys proc dev/pts dev; do umount /mnt/sys/$m 2>/dev/null; done; umount /mnt/sys; mount | grep /mnt/sys && echo "STILL MOUNTED"; sync
```
**Then:** Mike sets netboot back to **hard disk (normal)** in the OVH panel (a write my `GET *` key
can't make) and reboots. CHARLIE then proves `ssh -i ~/.ssh/id_ed25519 -o PreferredAuthentications=publickey
-o UserKnownHostsFile=<prod pin> ubuntu@40.160.141.61 id` against the **production** host key, and
continues § 2 → § 3.

**✅ DONE 2026-09-15 ~00:10Z (rescue work complete; awaiting netboot→normal from Mike).**
- Authenticated to rescue (Debian 12 on `/dev/sda1`) with `OVH_VPS_INITIAL_ROOT_PASSWORD` — Mike
  stored the OVH one-time rescue password under that existing name. Rescue host key pinned (TOFU).
- Real rootfs = **`/dev/sdb1`** (`cloudimg-rootfs`, **Ubuntu 24.04.4 LTS**). Mounted read-only, inspected:
  **clean stock image, never bootstrapped** — no `/opt/mira`, no Docker, empty `/var/www`, only
  `ubuntu` (uid 1000). No app/customer state ⇒ no STOP.
- **Exact expiry cause found:** cloud-init `cc_set_passwords` ran `passwd --expire ubuntu` at delivery
  (21:10:28Z) → `sp_lstchg=0`, a one-shot first-login force-change (`once-per-instance`; logs confirm
  it did **not** re-run on later boots). It is **not** a permanent policy. My three earlier SSH
  password changes already set `sp_lstchg` to today, so the disk's authoritative `chage -l` shows the
  account **healthy: Password expires never, status `P`**. ⇒ **minimum aging fix = none** (already cleared).
- **Keys installed (chroot, ownership via the disk's `/etc/passwd`):** CHARLIE `SHA256:9QDf…` →
  `/home/ubuntu/.ssh/authorized_keys` (ubuntu:ubuntu, 600) **and** `/root/.ssh/authorized_keys`
  (root, 600) as insurance against any re-expire (root is immune to the ubuntu one-shot).
- **Security note:** auth.log shows an internet brute-force against `root` from `120.48.125.245`
  (no success; likely what tripped OVH's anti-hack rescue). `PasswordAuthentication` is currently
  `yes` on the box — it is **left on** until key auth is proven post-reboot (constraint: don't disable
  the only working access before the replacement is verified). `bootstrap-host.sh` (§2) then hardens
  to keys-only, which stops the brute-force.
- Unmounted in reverse, verified nothing under `/mnt/sys`, `sync`. **No password rotated in rescue**
  (still three total from the SSH loop; live value = `OVH_VPS_UBUNTU_PASSWORD`).

**Remaining: Mike flips netboot → hard disk (normal) + reboots; then CHARLIE proves key auth against
the production pin `SHA256:yslC…8FrY` and continues § 2 → § 3 (private stage only).**

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
