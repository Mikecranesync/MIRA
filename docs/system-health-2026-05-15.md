# MIRA System Health Report — 2026-05-15

**Verified:** 2026-05-15 07:21 UTC (VPS) / 03:25 EDT (Charlie local)
**Verifier:** Charlie node automated probe
**VPS:** DigitalOcean `prod` — 100.68.120.99 (Tailscale) / 165.245.138.91 (public)
**Uptime:** 29 days, 9:54 — disk 96G/154G (63% used)
**Stripe mode:** `sk_test_*` — **NOT LIVE** (still test keys)

---

## 1. Top-Line: What's Broken Right Now

| # | What | Severity | Symptom |
|---|------|---------|---------|
| 1 | **mira-hub `/feed/`, `/scan/`, `/tablet/`, `/api/cmms/*`** all return **HTTP 500** | 🚨 P0 | `node:crypto` Native module not found in Next.js 16 edge runtime — container reports "healthy" but it's a false positive (healthcheck only hits `/api/health`, never page-render path) |
| 2 | **mira-mcp container missing** from VPS | 🚨 P0 | `docker ps` has no mira-mcp; port 8001 not listening; nginx `/api/mcp/` upstream is dead. Open PR #1025 "fix(ops): mira-mcp crash loop" is failing CI |
| 3 | **NeonDB tables missing**: `conversation_eval`, `diagnostic_sessions`, `plan_history`, `asset_tags`, `qr_codes`, `asset_qr`, `tenant_users`, `channels`, `preventive_maintenance`, `pm_tasks` | 🚨 P0 | Telegram bot logs `UndefinedTable` warning on every message; QR/asset-tag flow has no schema |
| 4 | **PR #1302** "fix(engine): KB-first general questions" — E2E smoke + Lint & Format failing | 🟠 P1 | Smoke test on factorylm.com + app.factorylm.com fails — almost certainly because of #1 |
| 5 | **13 of 30 open PRs failing CI** | 🟠 P1 | Backlog: #1302, #1297, #1263, #1069, #1025, #1020, #991, #891, #890, #774, #772, #608 |
| 6 | **17 nginx sites-enabled** including 6 `.bak.*` files | 🟡 P2 | Per `docs/site-hardening-plan-2026-04-30.md` this is undefined-behavior territory; first-wins routing under reload |
| 7 | **cmms.factorylm.com `/api/health`** returns 403 | 🟡 P2 | No unauth public health probe; healthcheck must use authed route. Atlas frontend `/` returns 200 with full HTML so backend is reachable |

---

## 2. Full System Status — Every Surface

### 2.1 Public URLs

| URL | Final Status | Final URL | Notes |
|-----|-------------|-----------|-------|
| `https://factorylm.com/` | ✅ 200 | same | mira-web home (15.7KB) |
| `https://factorylm.com/cmms` | ✅ 200 | same | CMMS landing |
| `https://factorylm.com/assess` | ✅ 200 | same | Scorecard funnel |
| `https://factorylm.com/api/health` | ✅ 200 | same | `{"status":"ok","service":"mira-web","version":"0.2.1"}` |
| `https://app.factorylm.com/` | 🚨 **500** | `/feed/` | hub `node:crypto` error |
| `https://app.factorylm.com/scan/` | 🚨 **500** | same | hub broken |
| `https://app.factorylm.com/tablet/` | 🚨 **500** | same | hub broken |
| `https://app.factorylm.com/api/cmms/health` | 🚨 **500** | same | hub broken |
| `https://app.factorylm.com/qr-test` | ✅ 200 | same | mira-web (port 3200) — QR test page works |
| `https://app.factorylm.com/m/<id>` | OK | (proxied) | magic-link route → mira-web |
| `https://app.factorylm.com/agents` | ✅ 200 | same | pipeline-served |
| `https://app.factorylm.com/pricing` | ✅ 200 | same | mira-web |
| `https://app.factorylm.com/admin/qr-print` | ✅ 401 | same | correct auth gate |
| `https://app.factorylm.com/v1/models` | ✅ 200 | same | mira-pipeline cascade, returns `mira-diagnostic` model |
| `https://cmms.factorylm.com/` | ✅ 200 | same | Atlas/"FactoryLM Works" frontend HTML |
| `https://cmms.factorylm.com/auth/login` | 🟡 403 | same | atlas auth gate (no anon) |
| `https://cmms.factorylm.com/api/health` | 🟡 403 | same | no public health route — add one for monitoring |

### 2.2 VPS Containers (`docker ps`)

| Container | Status | Port | Verdict |
|-----------|--------|------|---------|
| `mira-hub` | Up 21h "healthy" | 3101→3000 | 🚨 **HEALTH LIES** — pages 500, only `/api/health` returns OK |
| `mira-bot-telegram` | Up 21h "healthy" | — | ✅ polling, last msg 06:17 today (RS485 Q from Mike); errors on missing `conversation_eval` table |
| `mira-bot-slack` | Up 21h "healthy" | — | ✅ Socket Mode connected, sessions rotating cleanly |
| `mira-web` | Up 2d "healthy" | 3200→3000 | ✅ |
| `mira-pipeline-saas` | Up 2d "healthy" | 9099 | ✅ `{"status":"ok","engine":true,"version":"0.5.3"}` |
| `mira-ingest-saas` | Up 2d "healthy" | 8002→8001 | ✅ `{"status":"ok"}` |
| `mira-scan-backend` | Up 5d "healthy" | 8090→8000 | ✅ container up; `/health` 404 (no route) |
| `cmms_db` | Up 5d | 5433 | ✅ |
| `cmms-frontend` | Up 5d | 3003→3000 | ✅ |
| `cmms-backend` | Up 5d | 8082→8080 | ✅ |
| `cmms_minio` | Up 5d | 9002/9003 | ✅ |
| `mira-core-saas` (Open WebUI) | Up 5d "healthy" | 3010→8080 | ✅ `{"status":true}` |
| `mira-docling-saas` | Up 1h "healthy" | 5001 | ✅ |
| `mira-sidecar` (legacy) | Up 3w "healthy" | 5000/tcp | ✅ still running — sunset pending |
| `mira-relay` | Up 3w "healthy" | 8765 | ✅ `{"status":"ok","service":"mira-relay"}` |
| `flowise` | Up 5d | 3001→3000 | ✅ |
| `infra_postgres_1` | Up 5d "healthy" | 5432 | ✅ |
| `infra_redis_1` | Up 5d "healthy" | 6379 | ✅ |
| `mira-scan-frontend` | Up 10d "healthy" | 5180→80 | ✅ |
| **`mira-mcp`** | 🚨 **NOT PRESENT** | (expected 8001) | container missing; `/api/mcp/*` upstream dead |

### 2.3 Bravo (LLM compute)

| Check | Result |
|-------|--------|
| Ollama `/api/tags` (via Tailscale from Charlie) | ✅ 5 models: `gemma4:e4b`, `glm-ocr:latest`, `qwen2.5vl:7b`, `mira:latest`, `nomic-embed-text:latest` |
| Bravo from VPS | ❌ unreachable (different subnet — Tailscale only, not directly proxied) — expected per network.yml |
| Atlas on bravo (port 8088, per CLAUDE.md service list) | ❌ no longer on Bravo — Atlas moved to VPS (cmms-backend 8082) |

### 2.4 NeonDB

Connection verified via `mira-ingest-saas` → `NEON_DATABASE_URL` env (pooled, channel_binding=require).

| Table | Rows | Notes |
|-------|------|-------|
| `knowledge_entries` | **83,528** | ✅ Healthy — BM25 search for "GS10 fault" returns 63 hits |
| `kg_entities` | 81 | low — Phase 3 seed expected more? |
| `component_templates` | 5 | low — demo expected more |
| `installed_component_instances` | 5 | low — demo expected more |
| `relationship_proposals` | 12 | |
| `work_orders` | 101 | |
| `tenants` | 1 | single-tenant |
| `users` | 1 | single-tenant |
| `pm_schedules` | 26 | |
| `asset_tags` | **MISSING** | 🚨 QR/asset flow has no schema |
| `qr_codes` | **MISSING** | 🚨 |
| `asset_qr` | **MISSING** | 🚨 |
| `conversation_eval` | **MISSING** | 🚨 telegram bot logs `psycopg2.errors.UndefinedTable` on every message |
| `diagnostic_sessions` | **MISSING** | |
| `plan_history` | **MISSING** | |
| `tenant_users` | **MISSING** | |
| `channels` | **MISSING** | |
| `preventive_maintenance` | **MISSING** | |
| `pm_tasks` | **MISSING** | |

### 2.5 Bots — Live Behavior

**Telegram (`mira-bot-telegram`)**: ✅ polling, working
- Last user message: `2026-05-15 06:17:46` — Mike asking RS485-to-Micro820 question
- DISPATCH_ADMIN_BYPASS + DONT_KNOW_FAST_PATH paths firing correctly
- 🚨 every reply attempts insert into `conversation_eval` → fails (table missing). Eval/QA data NOT being collected.

**Slack (`mira-bot-slack`)**: ✅ Socket Mode connected, Bolt app running
- 4 session rotations in last 24h (normal stale-reconnect cadence)
- Last reconnect: `2026-05-15 04:50:59`
- InferenceRouter cascade enabled: groq → cerebras → gemini ✅
- Vision: groq llama-4-scout + gemini-2.5-flash ✅
- (Memory note: DMs still disabled — Messages Tab not enabled — per Mike's prior context, unchanged)

### 2.6 Doppler Secrets

All critical secrets present in `factorylm/prd`:

- LLM cascade: ✅ `GROQ_API_KEY`, ✅ `CEREBRAS_API_KEY`, ✅ `GEMINI_API_KEY`, ✅ `ANTHROPIC_API_KEY` (still here — should be removed per PR #610/#649 policy)
- NeonDB: ✅ `NEON_DATABASE_URL`, ✅ `NEON_API_KEY`, ✅ `NEON_DB_CONNECTION_STRING`
- Atlas: ✅ `ATLAS_API_*`, `ATLAS_JWT_SECRET`, `ATLAS_DB_PASSWORD`, `ATLAS_MINIO_PASSWORD`
- Stripe: ✅ `STRIPE_SECRET_KEY` = `sk_test_*` (🟡 **TEST mode, not live**), `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
- OAuth: ✅ Google/Asana/Atlassian/Dropbox/Github
- SSH: ✅ SSH_{ALPHA,BRAVO,CHARLIE}_{PRIVATE,PUBLIC,CONFIG,AUTHORIZED}_KEYS
- 🟡 `DATABASE_URL` (generic) is NOT present — only `NEON_DATABASE_URL`. Anything coded against `DATABASE_URL` directly will fail.

### 2.7 GitHub

| Metric | Value |
|--------|-------|
| Open PRs | **30** |
| Drafts | 4 |
| **Failing CI** | **13** |

**Top P0 PRs (failing CI):**
- `#1302` fix(engine): KB-first general questions w/ conv history — **E2E smoke fails** + Lint
- `#1297` fix(seeds): psycopg v3 notices — use add_notice_handler
- `#1263` feat(component-profiles): manual-to-profile extraction pipeline (v1 MVP)
- `#1025` fix(ops): mira-mcp crash loop + heartbeat monitor — **directly addresses Top-Line #2**
- `#1020` fix(mira-hub): P0 punch list (CMMS stats, uploads…) — **directly addresses Top-Line #1**
- `#991` fix(hub): graceful 200 degraded fallbacks on /api/cmms/stats + /api/uploads
- `#891` fix(inbox): rate limit /api/v1/inbox/email
- `#890` fix(auth): drop `?token=` query, JWT 30d→7d, scope CORS
- `#774`, `#772` Dependabot stragglers
- `#608` feat(comic-pipeline): OpenAI panels (stale since 2026-04-25)
- `#1069` test(bot): fix 5 pre-existing CI failures
- `#1266` [DRAFT] docs(plan): conveyor demo MVP

### 2.8 QR / Asset / Equipment Flow

| Layer | Status | Notes |
|-------|--------|-------|
| Public QR URL (`app.factorylm.com/m/<id>`) | ✅ 200 | proxied to mira-web :3200 |
| QR test page (`/qr-test`) | ✅ 200 | mira-web 18KB page renders |
| Admin QR print (`/admin/qr-print`) | ✅ 401 | auth gate working |
| Hub `/scan/` (camera-based QR scan UI) | 🚨 **500** | hub broken |
| Hub `/tablet/` (tablet kiosk) | 🚨 **500** | hub broken |
| Backend asset lookup table (`asset_tags`) | 🚨 **MISSING** | no schema → end-to-end QR→asset chain has no DB |
| `qr_codes`, `asset_qr` join tables | 🚨 **MISSING** | |

**Net:** Static QR magic-links work (`/m/<id>` is mira-web). **Live in-app scanning is dead** (hub 500). **DB layer for asset_tag → equipment is empty.**

---

## 3. Root Causes (best read of evidence)

### 3.1 mira-hub `node:crypto` error
- Next.js 16.2.4 on `node:22-alpine`, `output: standalone`, `basePath=/hub` (build-time, but compose builds with `NEXT_PUBLIC_BASE_PATH=""`)
- Every page render: `Error: Failed to load external module node:crypto: TypeError: Native module not found: node:crypto / at module evaluation (.next/server/edge/chunks/[root-of-the-server]__00q620u._.js:12:50484)`
- Path `.next/server/edge/` ⇒ edge-runtime bundle. Next.js 16 edge runtime does not allow `node:` builtin imports by default; some imported lib (likely auth/Jose/JWT/crypto polyfill) pulls it in.
- Healthcheck `wget -qO- http://127.0.0.1:3000/api/health || wget -qO- http://127.0.0.1:3000/hub/api/health || exit 1` passes because `/api/health` is a simple JSON route that doesn't trigger the edge bundle.
- **Container built `2026-05-14T10:29:17`** — 21h ago. Whatever was in that build broke it.

### 3.2 mira-mcp missing
- Not in `docker compose ps`. Last seen in PR #1025 ("crash loop") — likely manually stopped or compose-stack-reduced and never brought back up.
- Health monitor that PR adds isn't deployed yet (PR open + failing CI).

### 3.3 Missing tables
- Either migrations not run on Neon prod, or migrations renamed tables and old names are referenced. `conversation_eval` and `asset_tags` look like newer additions that landed in branches but never migrated.
- Need to run `services/*/migrations/` or `alembic upgrade head` against Neon prod.

---

## 4. Recommended Actions (ordered)

1. **🚨 Restore mira-hub** — either revert hub image to last known good (before 2026-05-14T10:29 build) OR merge #1020/#991 if they fix it. Verify `/feed/`, `/scan/`, `/tablet/` return 200 after.
2. **🚨 Bring mira-mcp back** — `doppler run -- docker compose up -d mira-mcp` (saas.yml). Then test `curl http://127.0.0.1:8001/health` on VPS.
3. **🚨 Run NeonDB migrations** — at minimum create `conversation_eval`, `asset_tags`, `qr_codes`, `asset_qr`, `diagnostic_sessions`. Without these the telegram bot can't record eval data and QR flow can't resolve.
4. **🟠 Triage the 13 failing PRs** — merge #1020, #1025, #991 first (fix-current-prod PRs), then #890 (auth hardening), then dependency bumps #774/#772.
5. **🟠 Fix `mira-hub` healthcheck** — current healthcheck doesn't catch page 500s. Add a check on a real page route (e.g. `/api/cmms/stats` or render `/feed/`).
6. **🟡 Clean nginx** — remove `*.bak.*` files from `/etc/nginx/sites-enabled/`. Per `docs/site-hardening-plan-2026-04-30.md` two `server_name factorylm.com` blocks exist — undefined behavior under reload.
7. **🟡 Add Atlas public health** — expose `cmms.factorylm.com/api/v1/health` unauth so external monitoring works.
8. **🟡 Move Stripe to live** when ready — currently `sk_test_*` everywhere.
9. **🟡 Drop `ANTHROPIC_API_KEY`** from Doppler — per memory `Anthropic removed forever` (PR #610/#649). The secret is still there, encouraging future regressions.

---

## 5. Up / Down at a Glance

```
UP:    mira-web · mira-pipeline · mira-ingest · mira-core (Open WebUI) · mira-relay
       · mira-bot-telegram · mira-bot-slack · cmms-frontend · cmms-backend
       · cmms_db · cmms_minio · mira-scan-backend · mira-scan-frontend
       · mira-docling · mira-sidecar (legacy) · flowise · infra_postgres · infra_redis
       · Ollama on Bravo (5 models) · NeonDB (83.5k KB rows, BM25 OK)

DEGRADED (healthy=lies): mira-hub — /feed /scan /tablet /api/cmms 500

DOWN:  mira-mcp container — not running; /api/mcp/* upstream dead

SCHEMA MISSING (Neon): asset_tags · qr_codes · asset_qr · conversation_eval
                       · diagnostic_sessions · plan_history · tenant_users
                       · channels · preventive_maintenance · pm_tasks
```

---

*Generated by automated probe on Charlie 2026-05-15.*
