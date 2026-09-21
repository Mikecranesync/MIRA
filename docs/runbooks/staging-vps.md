# Staging VPS Runbook (Co-Hosted)

**Created:** 2026-05-19. **Authorization model updated:** 2026-09-07.
**Co-hosted on the production VPS:** 2026-09-21 (owner decision, #3930) —
replaces the separate-host requirement from #3909/#3921.

> **Current rule:** staging deploys are manual, protected, and bound to the
> exact `main` SHA named by `approved_rc_sha` (never a moving ref). The
> `staging-deploy` GitHub environment and its scoped non-root identity must
> be provisioned before this workflow is dispatched. `STAGING_HOST` may
> legitimately equal the pinned production host — see "Why co-hosted".

## Why co-hosted

Solo-operator project: **host isolation is not required** — a second VPS
bought no real security margin and cost a live host to maintain.
**Operational isolation is mandatory** and mechanically enforced, not just
documented — every deploy re-checks it and STOPs (not warns) if it doesn't
hold. Accepted trade-off: staging and production share a kernel, Docker
daemon, and public IP; they never share a compose project, network, volume,
Doppler config, Neon database, or nginx vhost.

## What runs in staging

| Service | Staging port (loopback) | Prod equivalent |
|---|---|---|
| stg-mira-hub | 4101 | 3101 |
| stg-mira-pipeline | 4099 | 9099 |
| stg-mira-mcp | 4000 (MCP) / 4001 (REST) | 8009 / 8001 |
| stg-mira-web | 4200 | 3200 |
| stg-atlas-api | 4088 | 8088 |
| stg-atlas-frontend | 4100 | 3100 |
| stg-atlas-db | 4433 | 5433 |
| stg-atlas-minio | 4900 (API) / 4901 (UI) | 9000 / 9001 |
| stg-mira-tika | 9999 | 9998 |

`mira-cmms-sync` also runs (no published port), disabled by default
(`CMMS_SYNC_ENABLED=false`).

## URLs

All ports above bind `127.0.0.1` only — never the bare host IP. Public
access is the two vhosts `deploy-nginx-stg.yml` installs:

- `https://staging.factorylm.com` → `127.0.0.1:4200` (stg-mira-web)
- `https://app-staging.factorylm.com` → `127.0.0.1:4101` (stg-mira-hub)

Any other loopback port needs an SSH tunnel, e.g. `ssh -L
4099:127.0.0.1:4099 staging-deploy@$STAGING_HOST`. TLS starts as HTTP: the
vhost conf is installed and `nginx -t && reload`d first; `deploy-nginx-stg.yml`
then checks whether both hostnames already resolve here and, if so, runs
`certbot --nginx` for both in one certificate. Re-dispatch after DNS
propagates to pick up TLS.

## The seven co-host safeguards

Checked in this order — 1–3 and the production snapshot before anything on the
host is touched; 4–5 after the exact-SHA checkout of `/opt/mira-staging` (they
need the compose file) and before any docker mutation (#6 runs before
the nginx reload). Each is a hard STOP; none can be skipped by an input.
Enforced in `deploy-staging.yml` unless noted:

1. **Path** — checkout must never resolve into `/opt/mira` (`readlink -f`
   catches symlinks). Checked before any `git clone`/`git reset`.
2. **Database identity** — staging `NEON_DATABASE_URL` host must differ from
   production's (compared to the running `mira-hub` container's env, and to
   the known production endpoint name).
3. **Doppler scope** — the deploy identity must resolve `factorylm/stg` and
   must **not** be able to read `factorylm/prd`.
4. **Names** — every container/network/volume the compose file creates must
   be `stg-`/`staging-`/`factorylm-staging`-prefixed and unowned by another
   compose project.
5. **Ports** — every published host port must be `127.0.0.1`-only and
   unheld by a container outside the `factorylm-staging` project.
6. **Nginx isolation** (`deploy-nginx-stg.yml`) — the staging vhost file is
   refused if it names a production `server_name`; the reload step hashes
   every other `sites-enabled/` file before and after and STOPs on any
   change.
7. **Production untouched** — every non-staging container's id, name,
   compose-project label, and creation time is snapshotted before the
   deploy and compared byte-for-byte after.

`tests/test_deploy_staging_authorization.py` pins the STOP text + ordering
(1–3 before the first git mutation, 4–5 before the first docker mutation, 7
compared only after).

## First-time provisioning (on the production host)

1. **Bootstrap the deploy identity** — as root: `sudo bash
   tools/staging/bootstrap-staging-host.sh '<staging-deploy ssh-ed25519
   public key>'` (no `--harden-sshd` — the host's own sshd policy already
   governs it). Creates the non-sudo `staging-deploy` account (`docker`
   group) and `/opt/mira-staging`; prints the host key line.
2. **Mint a scoped Doppler token** — as `staging-deploy`:
   `doppler configure set token <service-token> --scope /opt/mira-staging`,
   a `factorylm/stg` **service** token. Never a personal token; never one
   that can read `prd`.
3. **Set repository variables** — `STAGING_HOST=<production host IP>`,
   `STAGING_DEPLOY_USER=staging-deploy`. `STAGING_HOST_KEY` is only needed
   if `STAGING_HOST` is **not** already pinned in
   `deployment/known_hosts.factorylm-prod` — the co-hosted host is pinned,
   so its key is reused automatically.
4. **Confirm the `STAGING_DEPLOY_SSH_KEY` secret** — the private key paired
   with step 1's public key (also in Doppler `stg` as
   `STAGING_DEPLOY_SSH_PRIVATE_KEY`).
5. **Point staging's URLs at the staging hostnames** in Doppler `stg`:
   `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `PLG_HUB_URL`,
   `PLG_API_ALLOWED_ORIGINS`, `ATLAS_PUBLIC_API_URL`,
   `ATLAS_PUBLIC_FRONT_URL` → `https://app-staging.factorylm.com` /
   `https://staging.factorylm.com` as appropriate.
6. **DNS (human, Namecheap)** — A records for `staging.factorylm.com` and
   `app-staging.factorylm.com` → the production host's IP.
7. **Install the nginx vhosts**: `gh workflow run deploy-nginx-stg.yml --ref
   main`. HTTP-only first; re-run after DNS propagates for TLS.
8. **Deploy**: `gh workflow run deploy-staging.yml --ref main -f
   approved_rc_sha=<exact main SHA>` (see "Routine deploy" for the full
   command).

The workflow creates `/opt/mira-staging` on first run if absent. Until the
`staging-deploy` GitHub environment and scoped account exist, deployment is
intentionally on HOLD — do not fall back to a root procedure.

## Retiring the `mira-preview` stack

A hub-only preview predating this design (compose project `mira-preview`,
`/opt/mira-preview`, vhost `preview.40.160.141.61.nip.io`) already holds
host port **4101** — the port `factorylm-staging` needs for `stg-mira-hub`.
Its owner must stop it (`docker compose -p mira-preview down`, from
`/opt/mira-preview`) **before the first `factorylm-staging` deploy** —
safeguard 5 will STOP the deploy otherwise, correctly. The staging workflow
must never remove `mira-preview` itself; it's a different compose project,
out of its authority.

## Routine deploy

```bash
APPROVED_RC_SHA="$(gh api repos/Mikecranesync/MIRA/git/ref/heads/main --jq '.object.sha')"
gh workflow run deploy-staging.yml --ref main -f approved_rc_sha="$APPROVED_RC_SHA"
```

Rebuild one service (allowlist: `atlas-api`, `atlas-db`, `atlas-frontend`,
`atlas-minio`, `mira-bot-telegram`, `mira-cmms-sync`, `mira-hub`,
`mira-mcp`, `mira-pipeline`, `mira-tika`, `mira-web`):

```bash
gh workflow run deploy-staging.yml --ref main \
  -f approved_rc_sha="$APPROVED_RC_SHA" -f services="mira-hub"
```

Wipe the staging Atlas DB volumes and re-seed from scratch:

```bash
gh workflow run deploy-staging.yml --ref main \
  -f approved_rc_sha="$APPROVED_RC_SHA" -f reset_volumes=true
```

If `main` moves between authorization and credential access, or the
checked-out SHA doesn't match `approved_rc_sha`, the run fails closed and
must be re-dispatched.

## Evidence a deploy run prints

1. Safeguard line — `Co-host safeguards hold: path ok, doppler=stg (prd
   unreadable), db endpoint '<host>' != prod, names/ports free; N
   non-staging container(s) snapshotted`.
2. Built image id == running image id, per rebuilt service.
3. Runtime identity — `mira-hub reports gitSha=<sha> (== approved)` / same
   for `mira-web`, read from `/api/version` / `/api/health`.
4. The `staging-receipt-<sha>.json` artifact (90-day retention), verified by
   `tools/staging_receipt.py` against the approved SHA.
5. Closing line — `Production untouched: non-staging container set
   identical before and after`.

## What is deliberately NOT in staging

`mira-core` (Open WebUI), `mira-ingest`, `mira-docling` (1.7GB RAM),
`mira-sidecar`, `mira-bridge`, `mira-relay`, and `mira-bot-slack` (a second
connection on the shared Slack token would dual-poll production). Hub reads
KB/proposal data straight from the staging NeonDB branch — no LLM-backed
ingest service required.

## Doppler `factorylm/stg` — required keys

- `NEON_DATABASE_URL` — the staging Neon branch.
- `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `PLG_HUB_URL`,
  `PLG_API_ALLOWED_ORIGINS`, `ATLAS_PUBLIC_API_URL`, `ATLAS_PUBLIC_FRONT_URL`
  — pointed at the staging hostnames, never a bare host:port or a
  production hostname.
- `AUTH_SECRET`, `OAUTH_TOKEN_ENC_KEY`, `ATLAS_DB_PASSWORD`,
  `ATLAS_JWT_SECRET`, `ATLAS_MINIO_PASSWORD` — separate from prod.
- `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHERAI_API_KEY` — same as prod is
  fine.
- `MCP_REST_API_KEY`, `PIPELINE_API_KEY` — separate from prod.
- `TELEGRAM_BOT_TOKEN_STG` — the dedicated `@Mira_stagong_bot` token, never
  the production poller token.

**`SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` MUST NOT be set on `factorylm/stg`**
— shared with prod; a second connection would dual-poll. Memory:
`project_slack_token_stg_prd_shared`.

## When prod and staging collide on the shared host

- **STOPs on safeguard 4 or 5** → another compose project already owns a
  `stg-*` name or a `4xxx` port — exactly what `mira-preview` does on 4101
  until stopped (see above).
- **`stg-atlas-db` won't start** → check `docker volume ls | grep
  stg-atlas` and logs. Never `rm` `atlas_pgdata` — that's production's.
- **Hub 500s on `/api/health`** → usually `NEON_DATABASE_URL` missing on
  `factorylm/stg`.
- **STOPs on safeguard 7** → a production container was
  restarted/recreated during the run — diff the logged `PROD_BEFORE`/
  `PROD_AFTER` sets before re-running.
