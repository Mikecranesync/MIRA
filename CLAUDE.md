# MIRA — Build State

**Version:** v3.4.0 | **Updated:** 2026-04-17
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=cloud` → Gemini → Groq → Cerebras → Claude (cascade) | `local` → Open WebUI → qwen2.5vl:7b
**Chat path (VPS):** User phone → Open WebUI → mira-pipeline (:9099) → GSDEngine → Anthropic API

---

## Coding Principles → `wiki/references/coding-principles.md`
## KANBAN Board → `wiki/references/kanban.md`

---

## Hard Constraints (PRD §4)

1. **Licenses:** Apache 2.0 or MIT ONLY.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Secrets:** All via Doppler (`factorylm/prd`). Never in `.env` files committed to git.
5. **Containers:** One per service. `restart: unless-stopped` + healthcheck. Pinned image versions.
6. **Commits:** Conventional format (`feat/fix/security/docs/refactor/test/chore/BREAKING`).

---

## Repo Map

```
MIRA/
├── mira-core/       # Open WebUI + MCPO proxy + ingest service
├── mira-bots/       # Telegram, Slack adapters + shared diagnostic engine
├── mira-bridge/     # Node-RED orchestration, SQLite WAL shared state
├── mira-mcp/        # FastMCP server, NeonDB recall, equipment diagnostic tools
├── mira-pipeline/   # OpenAI-compat API wrapping GSDEngine — active VPS chat path
├── mira-web/        # PLG funnel — Hono/Bun, Stripe, /cmms landing + Mira AI chat
├── mira-cmms/       # Atlas CMMS — work orders, PM scheduling, asset registry
├── mira-crawler/    # KB ingest + manual chunker (OEM discovery pipeline)
├── mira-ops/        # Observability dashboards (Prometheus, Grafana, Flower)
├── mira-relay/      # Cloud relay endpoint for Ignition factory→cloud tag streaming (SaaS-only, in saas.yml)
├── mira-sidecar/    # ⚠️ LEGACY — ChromaDB RAG, superseded by mira-pipeline (ADR-0008); sunset pending OEM migration
├── mira-connect/    # ⚠️ DEFERRED — Modbus/PLC drivers (post-MVP, "Config 4")
├── wiki/            # LLM-maintained ops wiki (Karpathy pattern) — Obsidian vault
├── tests/           # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/            # PRD, ADRs, C4 diagrams, runbooks, CHANGELOG, env-vars, known-issues
├── tools/           # Photo pipeline, Google Drive ingest, migration scripts
└── plc/             # PLC program files
```

See local CLAUDE.md in each module for deep context.

## Container Map

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-core | 3000→8080 | core-net, bot-net |
| mira-pipeline | 9099 | core-net |
| mira-ingest | 8002→8001 | core-net |
| mira-mcp | 8000, 8001 | core-net |
| mira-docling | 5001 | core-net |
| mira-bridge | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack | — | bot-net, core-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-db | 5433 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |

## Node Map

| Node | Hostname | User | Role | Tailscale IP | LAN IP | Subnet |
|------|----------|------|------|-------------|--------|--------|
| Alpha | Michaels-Mac-mini-2 | factorylm | Orchestrator (Celery) | 100.107.140.12 | 192.168.4.28 | 192.168.4.x |
| Bravo | FactoryLM-Bravo | bravonode | Compute (Ollama) | 100.86.236.11 | 192.168.1.11 | 192.168.1.x |
| Charlie | CharlieNodes-Mac-mini | charlienode | KB Host (MIRA) | 100.70.49.126 | 192.168.1.12 | 192.168.1.x |

**Connectivity:** Alpha↔Bravo/Charlie via Tailscale only (different subnets). Bravo↔Charlie via LAN (same subnet) with Tailscale fallback.
**SSH keys:** stored in Doppler `factorylm/prd` as `SSH_{NODE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS}`.
**Canonical source:** `deployment/network.yml`

---

## Start / Stop

```bash
doppler run --project factorylm --config prd -- docker compose up -d
docker compose down
docker compose logs -f <service>
bash install/smoke_test.sh
```

---

## Key Env Vars → `docs/env-vars.md` (25 vars, all Doppler `factorylm/prd`)

---

## Where to Resume → `wiki/hot.md`
## Offline Testing → `tests/eval/README.md`

---

## Gotchas

- **macOS keychain over SSH** — `docker build`/`doppler` fail on Bravo/Charlie. Workaround: `docker cp` + restart. Bravo fixed with `doppler configure set token-storage file`.
- **NeonDB SSL from Windows** — `channel_binding` fails. Use macOS hosts instead.
- **Intent classifier** — defaults to `industrial` for unrecognized queries (biased toward helping); short greetings route to `greeting` only when <20 chars AND contain a greeting word. Fixed 2026-04-15 in #280. Still: test with realistic phrasing before assuming a bounce is a bug.
- **Competing Telegram pollers** — Only one process per bot token. Check CHARLIE for stale pollers.
- **Gemini key blocked** — 403 in Doppler. Cascade falls through to Groq/Claude.

---

## Pointers

- **Architecture (layer map + dependency rules):** `docs/ARCHITECTURE.md`
- **Quality score (domain grades):** `docs/QUALITY_SCORE.md`
- **Harness plan (security/measurement/arch phases):** `docs/superpowers/plans/2026-04-17-harness-engineering-industrial-grade.md`
- **Release notes:** `docs/CHANGELOG.md`
- **All env vars:** `docs/env-vars.md`
- **Known issues / deferred / abandoned:** `docs/known-issues.md`
- **ADRs:** `docs/adr/`
- **Ops wiki:** `wiki/` — **Session start: read `wiki/hot.md`. Session end: update it.**
- **Wiki schema:** `wiki/SCHEMA.md`
- **Skills:** `.claude/skills/`
- **Sprint state:** `.planning/STATE.md`
- **Active 90-day MVP plan:** `docs/plans/2026-04-19-mira-90-day-mvp.md` — locked 2026-04-19 → 2026-07-19; **read its "Currently in-flight" section + run the 3-command coordination check before claiming any work**
- **Dev loop (pre-commit + watcher):** `wiki/references/dev-loop.md`

---

## Deferred / Archived Modules

| Module | Status | Why | Where to find it |
|---|---|---|---|
| `mira-hud` | **Archived 2026-04-19** | AR HMI demo, hardware-gated (Ignition + MCI badge reader), not in any compose, not customer-shippable in MVP window | branch `archive/mira-hud-2026-04` |
| `mira-prototype` | **Archived 2026-04-19** | Pre-VIM Flask MJPEG prototype, replaced by mira-pipeline + qwen2.5vl | branch `archive/mira-prototype-2026-04` |
| `mira-sidecar` | **Sunset pending** | ChromaDB RAG; awaiting OEM migration to Open WebUI KB before stop. Tracked in `docs/known-issues.md`. | still in repo |
| `mira-connect` | **Deferred to "Config 4"** (post-MVP) | Modbus TCP / PLC drivers; not in MVP critical path | still in repo, dormant |
| `mira-relay` | **Active SaaS infrastructure** (NOT deferred) | Cloud endpoint for Ignition factory→cloud tag streaming; powers MIRA Connect activation flow on `factorylm.com`. Lives in `docker-compose.saas.yml` only. | still in repo + saas.yml |

To restore an archived module: `git checkout archive/<branch> -- <module-dir>` then commit on a new branch.

---

## CLAUDE.md Maintenance

This file targets **~120 lines** (map, not encyclopedia). Agent compliance drops past ~150.
- If you repeat an instruction in chat >2x, add it here.
- Delete rules Claude follows naturally. Audit monthly.
- Deep content lives in: `docs/`, `wiki/references/`, `tests/eval/`.
- Line count as of last audit: see `wc -l CLAUDE.md`
