# Staging VPS Runbook

**Created:** 2026-05-19. **Authorization model updated:** 2026-09-07. **Separate host:** 2026-09-21 (#3909).

> **Current rule:** staging deploys are manual, protected, and bound to the
> exact current `main` SHA. Push-triggered deploys, feature-ref deploys, direct
> root SSH bootstrap, and caller-selected moving refs are retired. The
> `staging-deploy` GitHub environment and its scoped non-root identity must be
> provisioned before this workflow is dispatched.

Lightweight staging environment on a **separate staging host** (never the
production VPS — #3909, PRD §5/SC3). The host is named only by the
`STAGING_HOST` repository variable; its SSH host key is pinned by
`STAGING_HOST_KEY`. The deploy workflow refuses any host that appears in
`deployment/known_hosts.factorylm-prod`, and STOPs if it finds production
containers, `/opt/mira`, or a Doppler token that can read `factorylm/prd` on
the box. (The 2026-05 co-tenant design on the DigitalOcean VPS is retired:
that host is dead, and container isolation is not host isolation.)

## Why this design

- **No host-level path to production secrets** — a sudo-capable account on a
  shared host could read the prod Doppler token; a separate cheap VPS cannot.
- **Same image build, same Dockerfiles** — staging is just the prod compose
  graph with a smaller subset of services and offset ports.
- **Separate NeonDB branch** — `ep-polished-hall-ahcqtcxe-pooler`, has the
  garage namespace already seeded.
- **Dedicated Telegram bot only** — staging uses `TELEGRAM_BOT_TOKEN_STG` and
  never the production poller token. Slack remains intentionally absent.

## What runs in staging

| Service | Staging port | Prod equivalent |
|---|---|---|
| stg-mira-hub | 4101 | 3101 |
| stg-mira-pipeline | 4099 | 9099 |
| stg-mira-mcp | 4000 (MCP) / 4001 (REST) | 8009 / 8001 |
| stg-mira-web | 4200 | 3200 |
| stg-atlas-api | 4088 | 8088 |
| stg-atlas-db | 4433 | 5433 |
| stg-atlas-minio | 4900 (API) / 4901 (UI) | 9000 / 9001 |

**Not in staging** (intentionally): mira-core (Open WebUI), mira-ingest,
mira-docling (1.7GB RAM), mira-sidecar, mira-bridge, mira-relay,
mira-bot-slack, mira-cmms-sync. Hub will render KB and
proposal data from the staging NeonDB branch — no LLM-backed ingest is
required for Phase 1.

## URLs

- Hub: `http://$STAGING_HOST:4101`
- Pipeline health: `http://$STAGING_HOST:4099/health`
- Web: `http://$STAGING_HOST:4200`
- Atlas API: `http://$STAGING_HOST:4088`

(`STAGING_HOST` is the repository variable; the workflow prints the URLs.)

These are **plain HTTP** in Phase 1 — no TLS, no DNS. Mike can hit them from
his phone over the public internet. Phase 2 is to add TLS via either:

1. Caddy on port 8443 with a Cloudflare DNS-01 challenge, or
2. A `staging.factorylm.com` server block in whatever reverse proxy already
   owns ports 80/443 on the VPS.

Both deferred until the Phase 1 preview is working end-to-end.

## Isolation guarantees

1. Separate Docker network: `staging-net` (production is on `mira-net`).
2. All container names prefixed with `stg-`.
3. Working copy lives at `/opt/mira-staging/` — production is `/opt/mira/`.
4. Atlas DB has its own volume (`stg-atlas-pgdata`) — never reads or writes
   `atlas_pgdata`.
5. Bind ports use the `4xxx` range — no overlap with prod's `3xxx`/`8xxx`/`9xxx`.
6. Doppler config is `factorylm/stg` — production reads `factorylm/prd`.
7. Separate host: the deploy workflow ends with a guard that STOPs if any
   production-named `mira-*` container, `/opt/mira`, or prd-readable Doppler
   token exists on the staging host.

## First-time provisioning (maintainer-owned)

1. Order a small VPS (OVH VPS-1/2 class, Ubuntu 24.04) that is **not** the
   production host. The stored OVH API credential is GET-only, so this is a
   panel step.
2. As root on the fresh box, run once:
   `sudo bash tools/staging/bootstrap-staging-host.sh '<staging-deploy public key>'`
   (public key: Doppler `factorylm/stg` `STAGING_DEPLOY_SSH_PUBLIC_KEY`). It
   installs Docker + the Doppler CLI, creates the non-root `staging-deploy`
   account (docker group, no sudo), hardens sshd to keys-only, creates
   `/opt/mira-staging`, and prints the host key line.
3. As `staging-deploy`, configure a `factorylm/stg` **service** token scoped to
   `/opt/mira-staging` (`doppler configure set token … --scope /opt/mira-staging`).
   Never a personal token, never anything that can read `prd`.
4. Set repository variables `STAGING_HOST` (IP or hostname) and
   `STAGING_HOST_KEY` (the `ssh-ed25519 AAAA…` line printed in step 2), and
   confirm `STAGING_DEPLOY_USER=staging-deploy` plus the `STAGING_DEPLOY_SSH_KEY`
   secret (private key; also in Doppler stg as `STAGING_DEPLOY_SSH_PRIVATE_KEY`).
5. Update the Doppler stg public URLs (`ATLAS_PUBLIC_API_URL`,
   `ATLAS_PUBLIC_FRONT_URL`, `NEXTAUTH_URL`) to the new host if they still name
   an old one; the workflow defaults the rest from `STAGING_HOST`.
6. Dispatch `deploy-staging.yml` with the approved `main` SHA. Evidence for
   #3909 is in the run log: `id` of the deploy user, the separate-host
   invariant line, and the `staging-receipt-<sha>` artifact.

The workflow creates the staging checkout if it is absent. Until the protected
environment and scoped account exist, staging deployment is intentionally on
HOLD; do not fall back to the retired root procedure.

## Routine deploy (GitHub Action)

Resolve the exact current `main` SHA, then dispatch the workflow itself from
`main` with both immutable target fields:

```bash
# The approved release-candidate SHA (normally current main). Staging deploys
# an exact SHA, never a moving ref.
APPROVED_RC_SHA="$(gh api repos/Mikecranesync/MIRA/git/ref/heads/main --jq '.object.sha')"
gh workflow run deploy-staging.yml --ref main \
  -f approved_rc_sha="$APPROVED_RC_SHA"
```

If `main` moves between authorization and credential access, the run fails and
must be dispatched again. There is no push trigger and no feature-branch path.

To rebuild a single service:

```bash
gh workflow run deploy-staging.yml --ref main \
  -f approved_rc_sha="$APPROVED_RC_SHA" \
  -f services="mira-hub"
```

To wipe the staging Atlas DB volumes (e.g., to re-seed from scratch):

```bash
gh workflow run deploy-staging.yml --ref main \
  -f approved_rc_sha="$APPROVED_RC_SHA" \
  -f reset_volumes=true
```

## Doppler `factorylm/stg` — required keys

The compose file gracefully no-ops when these are missing, but for a
useful preview the following should be set on `factorylm/stg`:

- `NEON_DATABASE_URL` — staging branch (`ep-polished-hall-ahcqtcxe-pooler`)
- `AUTH_SECRET`, `OAUTH_TOKEN_ENC_KEY` — separate from prod
- `ATLAS_DB_PASSWORD`, `ATLAS_JWT_SECRET`, `ATLAS_MINIO_PASSWORD`
- `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` — same as prod is fine
- `MCP_REST_API_KEY`, `PIPELINE_API_KEY` — separate from prod
- `HUB_AUTH_GOOGLE_CLIENT_ID/_SECRET` — only if you've registered a staging
  OAuth client; otherwise leave blank and sign-in won't work in staging
  (the Hub will still render unauthenticated views).

**Slack tokens (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) MUST NOT be set on
`factorylm/stg`.** Tokens are shared with prod and a second connection would
dual-poll. See memory: `project_slack_token_stg_prd_shared`.

## What to do when prod and staging collide

- **Port already in use** → check `lsof -i :4xxx` on the VPS. The prod stack
  is bound to `127.0.0.1` for its services and `0.0.0.0` is open. If a port
  in the 4xxx range collides, pick the next free 4xxx.
- **`stg-atlas-db` won't start** → `docker volume ls | grep stg-atlas` and
  inspect logs. Don't `rm` the `atlas_pgdata` volume — that's prod.
- **Hub returns 500 on /api/health** → most common cause is
  `NEON_DATABASE_URL` missing on `factorylm/stg`. `doppler run --project
  factorylm --config stg -- printenv NEON_DATABASE_URL` should print a
  `postgres://` URL pointing at the staging branch.

## TLS / DNS — Phase 2

Two routes when needed:

1. **Caddy on a non-conflicting port** (e.g. 8443) — Caddyfile would proxy
   `staging.factorylm.com:8443` → `stg-mira-hub:3000`. Caddy needs to obtain
   a cert via DNS-01 because 80/443 belong to the production proxy.

2. **Add staging server blocks to the existing prod reverse proxy** — if
   nginx already terminates TLS for `app.factorylm.com`, add a
   `staging.factorylm.com` upstream → `127.0.0.1:4101`. This is the simpler
   option once DNS is pointed.

Neither is needed for the "see Hub from phone" wedge.
