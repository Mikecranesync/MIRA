# MIRA — File Structure
**Last Updated:** 2026-05-05

Top-level repo map with one-line descriptions, plus where to look inside each module. For deep contracts, see `docs/specs/SPEC_INDEX.md`. For architecture rules, see `docs/context/ARCHITECTURE.md`.

```
MIRA/
├── CLAUDE.md                       # Build state + hard constraints (target ~120 lines)
├── NORTH_STAR.md                   # The flywheel; read before any feature work
├── STRATEGY.md                     # ICP, pricing tiers, GTM motion
├── docker-compose.yml              # Local stack
├── docker-compose.saas.yml         # SaaS overlay (mira-relay, mira-ingest-saas)
│
├── mira-bots/                      # Adapters + shared diagnostic engine
│   ├── shared/                     # Engine: Supervisor, workers, guardrails, InferenceRouter
│   │   ├── engine.py               # Supervisor — entry point
│   │   ├── workers/                # vision_worker, rag_worker, print_worker, plc_worker (stub)
│   │   ├── guardrails.py           # intent classification, safety, abbreviations
│   │   ├── inference/router.py     # Cascade Groq → Cerebras → Gemini, sanitizer
│   │   ├── recall.py               # NeonDB recall paths
│   │   └── agents/infra_guardian.py
│   ├── prompts/                    # Active prompt registry (active.yaml hot-swap)
│   ├── telegram/ slack/ teams/ whatsapp/ reddit/ webchat/ gchat/ email/
│   ├── tests/                      # Engine + adapter unit tests
│   ├── benchmark/                  # Latency + cost benchmarks
│   └── v2_test_harness/            # Self-test harness + healer
│
├── mira-pipeline/                  # OpenAI-compat API on :9099 (active VPS chat path)
│   ├── main.py                     # FastAPI app
│   ├── eval_api.py                 # /eval/* endpoints
│   ├── feedback_sync.py            # Feedback rollup
│   ├── memory.py                   # Per-chat session NDJSON
│   └── tools/                      # Pipeline-specific helpers
│
├── mira-mcp/                       # FastMCP server + REST proxy (CMMS bridge)
│   ├── server.py                   # 4 equipment + 7 CMMS tools, /ingest/pdf, /api/cmms/*
│   ├── cmms/                       # Adapter dispatch: atlas / maintainx / limble / fiix
│   ├── atlas_client.py             # Atlas REST client
│   ├── tenant_resolver.py          # Tenant resolution
│   ├── exports.py                  # Bulk export endpoints
│   └── tests/
│
├── mira-core/                      # Open WebUI + MCPO + ingest
│   ├── docker-compose.yml          # mira-core stack
│   ├── docker-compose.oracle.yml   # Oracle Cloud overrides
│   ├── Dockerfile.mcpo             # MCPO image
│   ├── Modelfile / Modelfile.staging
│   ├── mcpo-config.json
│   ├── entrypoint-mira.sh
│   ├── mira-ingest/                # FastAPI ingest service
│   │   ├── main.py                 # /ingest/photo, /ingest/search, /health/*
│   │   ├── db/neon.py              # SQLAlchemy + NullPool, RLS
│   │   └── ...
│   └── scripts/                    # ingest_manuals.py, ingest_equipment_photos.py, etc.
│
├── mira-bridge/                    # Node-RED + canonical mira.db owner
│   ├── flows/                      # Committed JSON (dashboard, scheduled, setup wizard)
│   └── data/                       # mira.db (WAL) — bind-mounted to readers
│
├── mira-cmms/                      # Atlas CMMS overlay
│   ├── docker-compose.yml          # 4 containers (db, api, frontend, minio)
│   ├── docker-compose.local.yml
│   └── smoke_test.sh
│
├── mira-crawler/                   # Celery ingestion fleet
│   ├── celery_app.py celeryconfig.py bridge.py
│   ├── agents/                     # 13 task agents incl. inbox_triage
│   ├── tasks/                      # discover, ingest, freshness, rss, social, youtube, foundational, playwright
│   ├── ingest/                     # Cross-task helpers
│   ├── reporting/                  # agent_report, weekly_digest, telegram_notify
│   ├── linkedin/                   # LinkedIn pipeline
│   ├── social/                     # Reddit + LinkedIn signals
│   └── sources.yaml manual_scrape_targets.csv
│
├── mira-web/                       # Public marketing + PLG funnel
│   ├── server.js                   # Hono app
│   ├── src/                        # views, lib (activation, mira-chat, scan)
│   ├── emails/                     # Resend templates
│   ├── tools/                      # Apps Script bridge
│   └── docker-compose.yml
│
├── mira-hub/                       # Authenticated workspace (Next.js + Refine.dev)
│   ├── src/app/(hub)/              # 17 sections (workorders, schedule, parts, ...)
│   ├── src/app/api/                # Route handlers (proxy + aggregate)
│   ├── auth.ts middleware.ts       # Magic-link / Google OAuth / admin bypass
│   ├── db/migrations/              # Including 001_knowledge_graph.sql
│   ├── playwright.*.config.ts      # smoke / signup / e2e suites
│   └── tests/
│
├── mira-sidecar/                   # ⚠️ LEGACY (ADR-0008) — sunset pending OEM migration
├── mira-relay/                     # Cloud relay endpoint for Ignition factory→cloud streaming (saas.yml)
├── mira-connect/                   # ⚠️ DEFERRED to Config 4 (Modbus/PLC drivers)
│
├── ignition/                       # Ignition 8.1 ConveyorMIRA project
│   ├── project/  tags/  gateway-scripts/  webdev/  config/  db/
│   └── deploy_ignition.ps1         # 3-command Windows deployer
├── plc/                            # PLC programs (Micro820)
│
├── nango-integrations/             # Nango credential vault + connectors (MaintainX first)
│
├── deployment/                     # nginx, network.yml, runbooks, customer agreement
│
├── docs/                           # PRDs, ADRs, C4, runbooks, specs (this index)
│   ├── ARCHITECTURE.md             # Layered domain map (canonical rules)
│   ├── PRD_v1.0.md                 # Top-level PRD
│   ├── adr/                        # 12 ADRs (e.g. 0008-sidecar-deprecation)
│   ├── architecture/               # C4, RAG pipeline, ingest pipelines, system overview
│   ├── api-reference/              # External API references (Atlas, MaintainX, ...)
│   ├── integrations/               # Per-integration API reference docs
│   ├── runbooks/                   # cmms-onboarding, factorylm-vps, sidecar-oem-migration
│   ├── specs/                      # PER-MODULE SPECS (this audit's focus)
│   ├── context/                    # PROJECT_BRIEF, ARCHITECTURE, TECH_STACK, this file, RULES, PROGRESS
│   ├── plans/                      # 90-day MVP plan, harness plan
│   ├── design-history/             # Before/after screenshot pairs (mandatory for UI changes)
│   └── promo-screenshots/          # Append-only archive (YYYY-MM-DD_feature_viewport.png)
│
├── tests/                          # 5-regime testing framework
│   ├── eval/                       # 39 golden cases + analyze_sessions.py
│   ├── property/                   # 11 hypothesis property tests
│   ├── architecture/               # 6 boundary contracts
│   └── regime7_ignition/           # Ignition-specific tests
│
├── tools/                          # photo pipeline, GDrive ingest, migrations, lead-hunter, video gen
│
├── wiki/                           # LLM-maintained ops wiki (Karpathy pattern)
│   ├── hot.md                      # Read at session start, update at session end
│   ├── SCHEMA.md                   # Wiki schema rules
│   └── references/                 # coding-principles, kanban, dev-loop
│
├── .claude/                        # Agent rules, skills, hooks, settings
│   ├── rules/                      # python-standards, security-boundaries
│   ├── skills/
│   └── settings.json
│
└── install/                        # Smoke tests + one-shot installers
    └── smoke_test.sh
```

## Branch + commit conventions
- Branch prefixes: `feat/`, `fix/`, `chore/`, `ops/`, `docs/`, `security/` — never push to `main` directly.
- Commit format: `feat(scope): …`, `fix(scope): …`, etc. (Conventional Commits).
- Safety tags: `# SAFETY`, `# PLC`, `# CRITICAL` — never modify without approval.
