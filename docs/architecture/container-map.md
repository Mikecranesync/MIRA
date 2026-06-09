# MIRA Container Map

**Source of truth:** this file was assembled by reading every compose file listed below.
**Adjacent docs:** `docs/architecture/c4-containers.md` (stale — shows Anthropic as LLM, BRAVO as prod host, teams/whatsapp as live; do not cite as authoritative), `docs/architecture/SYSTEM_OVERVIEW.md` (stale — v0.5.2 from 2026-03-23; do not cite).
**Environment doctrine:** `docs/environments.md`.

---

## DEV environment (`docker-compose.yml`)

Root `docker-compose.yml` is a pure include list (`docker-compose.yml:1-10`). It includes 8 sub-composes; one (`mira-ops/docker-compose.yml`) references a directory that does not exist on disk — that include silently produces no containers.

All containers join `core-net` (external) unless noted. All have `restart: unless-stopped`.

### mira-core sub-compose (`mira-core/docker-compose.yml`)

| Container | Image / Build | Host Port(s) | Networks | mem_limit | Healthcheck |
|---|---|---|---|---|---|
| `mira-core` | `ghcr.io/open-webui/open-webui:v0.8.10` | `${WEBUI_PORT:-3000}:8080` | core-net, bot-net | 512m | `curl -sf http://localhost:8080/health` |
| `mira-pipeline` | build (root ctx, `mira-core/Dockerfile.pipeline` implied) | `127.0.0.1:${PIPELINE_PORT:-9099}:9099` | core-net | 512m | ⚠️ UNVERIFIED (not shown in read portion) |
| `mira-ingest` | build (`./mira-ingest`) | `127.0.0.1:${INGEST_PORT:-8002}:8001` | core-net | 512m | ⚠️ UNVERIFIED |
| `mira-docling` | `quay.io/docling-project/docling-serve:v1.16.1` | `${DOCLING_PORT:-5001}:5001` | core-net | **3g** | ⚠️ UNVERIFIED |
| `mira-mcpo` | build (`mira-core-mira-mcpo`) | `${MCPO_PORT:-8000}:8000` | core-net | 512m | ⚠️ UNVERIFIED |
| `mira-tika` | `apache/tika:3.1.0.0` | `127.0.0.1:${TIKA_PORT:-9998}:9998` | core-net | 512m | ⚠️ UNVERIFIED |

**mira-core** is the Open WebUI container. Despite the UI being replaced by mira-hub, the container is still active as the chunk/embed/retrieve backend (5 code consumers). See `wiki/references/codegraph.md` for the full consumer list.

**mira-mcpo** and **mira-tika** are DEV ONLY — neither appears in `docker-compose.saas.yml`.

**mira-docling** OOM risk: 3g mem_limit. Two VPS OOM incidents (May 2026) caused by docling + celery. See `wiki/hot.md` and memory entry `project_vps_oom_docling_incidents`.

### mira-bots sub-compose (`mira-bots/docker-compose.yml`)

| Container | Build | Port | Networks | mem_limit | Profile |
|---|---|---|---|---|---|
| `mira-bot-telegram` | build | none | bot-net, core-net | 512m | (always on) |
| `mira-bot-slack` | build | none | bot-net, core-net | 512m | (always on) |
| `mira-bot-teams` | build | `8030:8030` | bot-net, core-net | 512m | `dormant` |
| `mira-bot-whatsapp` | build | `8010:8010` | bot-net, core-net | 512m | `dormant` |
| `mira-bot-reddit` | build | none | bot-net, core-net | 512m | `dormant` |
| `telegram-test-runner` | build | none | bot-net, core-net | 512m | `test` |

**mira-bot-teams** and **mira-bot-whatsapp** are profile `dormant` — they do NOT start with `docker compose up`. `c4-containers.md` incorrectly lists them as live; they are not.

### mira-mcp sub-compose (`mira-mcp/docker-compose.yml`)

| Container | Build | Port(s) | Networks | mem_limit |
|---|---|---|---|---|
| `mira-mcp` | build | `8009:8000` (SSE/FastMCP), `8010:8002` (HTTP), `8001:8001` (REST) | core-net | 512m |

### mira-bridge sub-compose (`mira-bridge/docker-compose.yml`)

| Container | Build | Port | Networks | mem_limit |
|---|---|---|---|---|
| `node-red` (service name: `mira-bridge`) | build | `${NODERED_PORT:-1880}:1880` | core-net | 512m |

### mira-cmms sub-compose (`mira-cmms/docker-compose.yml`)

| Container | Image | Port(s) | Networks | mem_limit |
|---|---|---|---|---|
| `atlas-db` | `postgres:16-alpine` | `${ATLAS_DB_PORT:-5433}:5432` | cmms-net | 1g |
| `atlas-minio` | `minio/minio` | `9000:9000`, `9001:9001` | cmms-net | 512m |
| `atlas-api` | `intelloop/atlas-cmms-backend@sha256:21c4...` | `${ATLAS_API_PORT:-8088}:8080` | cmms-net, core-net | 512m |
| `atlas-frontend` | `mira/atlas-cmms-frontend:mobile` | `${ATLAS_FRONTEND_PORT:-3100}:3000` | cmms-net | 512m |

**atlas-frontend** build context is `/Users/bravonode/` — cannot be built on CHARLIE or the VPS. Requires the Bravo node.

**cmms-net** is `external: true` with name `cmms-net` (`mira-cmms/docker-compose.yml:networks`). **core-net** is also external here.

### mira-web sub-compose (`mira-web/docker-compose.yml`)

| Container | Build | Port | Networks | mem_limit |
|---|---|---|---|---|
| `mira-web` | build | `${MIRA_WEB_PORT:-3200}:3000` | core-net, cmms-net | 512m |

Dev still carries `SIDECAR_URL` env var; removed from prod saas.yml per ADR-0014.

### mira-crawler sub-compose (`mira-crawler/docker-compose.yml`)

| Container | Image / Build | Port | Networks | mem_limit |
|---|---|---|---|---|
| `mira-redis` | `redis:7.4.2-alpine` | none | core-net | 512m |
| `mira-celery-worker` | build (`mira-crawler/Dockerfile.celery`) | none | core-net | **1g** |
| `mira-task-bridge` | build (`mira-crawler/Dockerfile.bridge`) | `8003:8003` | core-net | 512m |

**mira-celery-worker** carries `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` env vars (`mira-crawler/docker-compose.yml:37-38`). These are dead anchors — Anthropic was removed as a provider in PR #610. Do not reintroduce. Also carries `OLLAMA_BASE_URL=http://192.168.1.11:11434` (Bravo LAN IP, only reachable on the 192.168.1.x subnet).

### mira-ops sub-compose (MISSING)

`docker-compose.yml` includes `mira-ops/docker-compose.yml` but **the directory does not exist on disk**. No Prometheus, Grafana, or Flower containers are defined in this repo. ⚠️ UNVERIFIED whether these run via a separate mechanism.

---

## PROD environment (`docker-compose.saas.yml`)

All containers join `mira-net` (internal). `cmms-ext` is an external network named `factorylm-cmms_default` (shared with the Atlas CMMS stack). All ports bound to `127.0.0.1` (Nginx reverse-proxy in front, not included in this compose). `restart: unless-stopped` throughout.

Source: `docker-compose.saas.yml` (fully read).

| Container | Image / Build | Host Binding | mem_limit | Notes |
|---|---|---|---|---|
| `mira-core` | `ghcr.io/open-webui/open-webui:v0.8.10` | `127.0.0.1:3010:8080` | 512m | Chunk/embed/retrieve backend. UI replaced by mira-hub. |
| `mira-ingest` | build | `127.0.0.1:8002:8001` | 512m | Chunking/embedding API. `INGEST_URL=disabled://` on staging (uploads accepted, not ingested). |
| `mira-pipeline-saas` | build | `127.0.0.1:9099:9099` | **2g** | Active VPS chat path. Wraps `shared/engine.py` as OpenAI-compat API. |
| `mira-docling-saas` | `quay.io/docling-project/docling-serve:v1.16.1` | `127.0.0.1:5001:5001` | **3g** | OOM risk. See VPS OOM incidents in memory. |
| `mira-mcp` | build | `127.0.0.1:8009:8000`, `127.0.0.1:8001:8001` | 512m | FastMCP SSE + REST. No `:8010` port in prod. |
| `mira-hub` | build (`mira-hub/`) | `127.0.0.1:3101:3000` | 512m | Next.js 16. Parent surface for all channels. |
| `mira-relay` | build (`mira-relay/`) | `127.0.0.1:4010:4010` | 512m | Ignition factory→cloud tag streaming. `POST /api/v1/tags/ingest`. |
| `mira-bot-telegram-saas` | build | none | 512m | Telegram adapter. Polling-mode (no webhook). |
| `mira-bot-slack-saas` | build | none | 512m | Slack adapter. Socket Mode. |
| `mira-ask-saas` | build | `100.68.120.99:8011:8011` | 512m | **Tailscale-only** (bound to Tailscale IP, not 127.0.0.1). Ignition "Ask MIRA" kiosk. `MIRA_UNS_GATE_ENABLED=0`, `MIRA_DIRECT_ANSWER_MODE=1`. |
| `nango-db` | `postgres:16-alpine` | `127.0.0.1:5435:5432` | 512m | Nango credential vault DB. |
| `nango-server` | `nangohq/nango-server:hosted` | `127.0.0.1:3003:3003` | 512m | CMMS credential auth proxy. |
| `mira-cmms-sync` | build (`mira-relay/`) | none | 512m | CMMS sync worker. `CMMS_SYNC_ENABLED=false` by default. Only flip for a single paying tenant. |

**Dead volumes** still declared in saas.yml: `mira-chroma`, `mira-docs` (legacy from mira-sidecar, removed 2026-05-20). Safe to ignore; no containers mount them.

**Dead env anchors** in `bot-common-env`: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` are YAML anchors in saas.yml but Anthropic is NOT an active provider (removed PR #610). Do not use these values.

**LLM cascade (prod):** Groq → Cerebras → Gemini. Never Anthropic. See `CLAUDE.md` Hard Constraints §2.

---

## Network topology

| Network name | Type | Who uses it |
|---|---|---|
| `core-net` | external (bridged) | Most DEV containers |
| `bot-net` | external | Bot containers (DEV) |
| `cmms-net` | external (`name: cmms-net`) | Atlas CMMS containers (DEV) |
| `mira-net` | internal (in saas.yml) | All PROD containers |
| `cmms-ext` | external (`name: factorylm-cmms_default`) | mira-web, mira-hub, mira-cmms-sync sharing Atlas stack (PROD) |

---

## What can go wrong

| Failure mode | Where to look |
|---|---|
| `mira-docling-saas` or `mira-celery-worker` OOM | `docker stats`; both have high mem_limits; docling caused two VPS outages May 2026 |
| `mira-hub` container removed (not crashed) | Self-healer can only `docker restart` (can't recreate); use `gh workflow run deploy-vps.yml` — see memory `project_self_healer_recreate_gap` |
| `mira-ask-saas` unreachable | Bound to Tailscale IP `100.68.120.99:8011` — only accessible when Tailscale is up |
| `atlas-frontend` won't build | Build context is `/Users/bravonode/` — must be built on Bravo node |
| `mira-bot-slack` on staging | Slack tokens identical in Doppler stg and prd — never run mira-bot-slack-saas in staging against production workspace. See `docs/environments.md` §Gaps |
| `mira-celery-worker` can't reach Ollama | `OLLAMA_BASE_URL=http://192.168.1.11:11434` — only reachable on 192.168.1.x LAN (not VPS) |
| `mira-cmms-sync` accidentally enabled | `CMMS_SYNC_ENABLED=false` by default; flipping to `true` on a multi-tenant system will sync wrong tenant data |
| `mira-ops` containers missing | `mira-ops/` directory does not exist; Prometheus/Grafana/Flower status unknown |
