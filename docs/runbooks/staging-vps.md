# Staging VPS Runbook

**Created:** 2026-05-19 — replaces the abandoned Coolify approach.

Lightweight staging environment **co-tenanted on the production VPS**
(165.245.138.91). Completely isolated from production via separate Docker
network, container names, volumes, and host ports.

## Why this design

- **No new infra cost** — reuses the existing VPS.
- **Same image build, same Dockerfiles** — staging is just the prod compose
  graph with a smaller subset of services and offset ports.
- **Separate NeonDB branch** — `ep-polished-hall-ahcqtcxe-pooler`, has the
  garage namespace already seeded.
- **No bots in staging** — Slack/Telegram tokens are shared with prod and a
  second poller would conflict. Staging is API + Hub only for now.

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
mira-bot-telegram, mira-bot-slack, mira-cmms-sync. Hub will render KB and
proposal data from the staging NeonDB branch — no LLM-backed ingest is
required for Phase 1.

## URLs

- Hub: <http://165.245.138.91:4101>
- Pipeline health: <http://165.245.138.91:4099/health>
- Web: <http://165.245.138.91:4200>
- Atlas API: <http://165.245.138.91:4088>

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
7. The deploy workflow ends with a guard that fails loudly if the count of
   running production `mira-*` containers drops below 3.

## First-time deploy (manual)

Until the GitHub Action is approved end-to-end, the first deploy is manual:

```bash
ssh root@165.245.138.91
# Clone into a separate path so production isn't touched
git clone https://github.com/Mikecranesync/MIRA.git /opt/mira-staging
cd /opt/mira-staging
mkdir -p data data/sessions data/agent-runs

# Verify Doppler can read staging config
doppler run --project factorylm --config stg -- env | grep NEON_DATABASE_URL

# Build + start
DOCKER_BUILDKIT=1 doppler run --project factorylm --config stg -- \
  docker compose -f docker-compose.staging.yml build
doppler run --project factorylm --config stg -- \
  docker compose -f docker-compose.staging.yml up -d

# Verify
curl -s http://127.0.0.1:4101/api/health
curl -s http://127.0.0.1:4099/health
docker ps --filter "name=^stg-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

## Routine deploy (GitHub Action)

```
gh workflow run deploy-staging.yml
```

Or push to `staging` / `release/*` to auto-deploy.

To rebuild a single service:

```
gh workflow run deploy-staging.yml -f services="mira-hub"
```

To wipe the staging Atlas DB volumes (e.g., to re-seed from scratch):

```
gh workflow run deploy-staging.yml -f reset_volumes=true
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
