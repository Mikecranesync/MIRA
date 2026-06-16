# MIRA Elegance Audit — "Where did the simplicity go?"

## Context

MIRA is a pre-revenue AI diagnostic assistant for industrial maintenance technicians. The core value proposition is simple: a tech sends a photo or message via Telegram/Slack, MIRA walks them through a guided diagnostic flow using RAG-retrieved knowledge from 25K+ manual chunks, and gives them an actionable answer.

That's a beautiful, focused product. But the repo tells a different story.

---

## The Numbers

| Metric | Count | For context |
|--------|-------|-------------|
| Root directories | 35 | Most mature monorepos have 5-8 |
| Docker containers (primary compose) | 39 | Netflix runs ~700 for 230M users |
| Docker containers (all overlays) | 64 | 4 separate compose topologies |
| Dockerfiles | 16 | Each one is a build/deploy surface |
| requirements.txt files | 16 | 16 independent dependency trees |
| Python files | 355 | |
| Python LOC | ~79,000 | |
| Env vars in template | 49 | Each one is a config failure mode |
| Open GitHub issues | 46 | 20 enhancement, 11 GTM, only 1 bug |
| Paying customers | 0 | This is the number that matters |
| Stale remote branches | 9+ | Dead weight in the repo |

---

## The Core Value Chain (What Actually Matters)

The entire product can be described in 6 steps:

```
User message/photo → Guardrails (intent + safety) → FSM (IDLE→Q1→Q2→Q3→DIAGNOSIS)
→ RAG retrieval (NeonDB 25K chunks) → LLM cascade (Gemini→Groq→Cerebras→Claude)
→ Response back to user
```

This lives in **~4 files**:
- `mira-bots/shared/engine.py` — Supervisor FSM
- `mira-bots/shared/guardrails.py` — Intent classification + safety
- `mira-bots/shared/workers/rag_worker.py` — Knowledge retrieval + LLM call
- `mira-bots/shared/inference/router.py` — Multi-provider cascade

Everything else is supporting infrastructure, speculative features, or GTM tooling.

---

## The Sprawl: Module-by-Module Reality Check

### Earning Their Keep (core product)
| Module | LOC | Containers | Verdict |
|--------|-----|------------|---------|
| `mira-bots/shared/` | ~5K | 0 (library) | **Core engine. Well-designed.** |
| `mira-bots/telegram/` | ~1K | 1 | **Primary user channel. Essential.** |
| `mira-bots/slack/` | ~1K | 1 | **Second channel. Keep.** |
| `mira-mcp/` | 1.8K | 2 | **NeonDB recall + tools. Keep.** |
| `mira-web/` | ~2K | 3 | **PLG funnel. Revenue path.** |

### Useful but Oversized
| Module | LOC | Containers | Concern |
|--------|-----|------------|---------|
| `mira-core/` | 6.8K | 9 | **9 containers** for Open WebUI + ingest + MCPO + docling + pipeline. That's a lot of moving parts for "accept a PDF and chunk it." |
| `mira-crawler/` | 11.9K | 5 | **12K LOC** — blog fleet, content gen, LinkedIn automation, discovery, freshness. This is a content marketing platform hiding inside a diagnostic tool. |
| `mira-pipeline/` | ~500 | 1 | OpenAI-compatible wrapper so Open WebUI can talk to the GSD engine. Necessary glue but another container. |
| `tests/` | 15.8K | 0 | 8 test regimes including regimes for features that don't exist yet (Regime 5 Nemotron, Regime 6 Sidecar, Regime 7 Ignition). |

### Speculative / Dormant
| Module | LOC | Containers | Status |
|--------|-----|------------|--------|
| `mira-bots/teams/` | ~1K | 1 | "Code complete, pending Azure" — **dormant since March** |
| `mira-bots/whatsapp/` | ~1K | 1 | "Code complete, pending Twilio" — **dormant since March** |
| `mira-bots/reddit/` | ~500 | 1 | Reddit bot adapter — **unclear if anyone uses this** |
| `mira-cmms/` | 0 (config only) | 8 | **8 containers** (Postgres, Java API, React frontend, MinIO) for a CMMS that is an entirely separate product (Atlas). No custom code — just Docker orchestration of someone else's product. |
| `mira-hud/` | 6.5K | 0 | AR HUD + VIM vision pipeline. **No live users. 25 Python files.** |
| `mira-sidecar/` | ~2K | 1 (saas only) | Path B RAG sidecar — **duplicate of mira-bots RAG, different architecture** |
| `mira-bridge/` | 0 (Node-RED) | 3 | Node-RED routing + SQLite write lock holder. **3 containers for a message router.** |
| `mira-ops/` | ~600 | 3 | Observability dashboard. **No users to observe yet.** |
| `paperclip/` | ~500 | 0 | Multi-agent orchestration on Charlie. **Experiment, not product.** |

### Dead Weight
| Directory | What it is | Action |
|-----------|-----------|--------|
| `mira-prototype/` | Original demo script | Delete |
| `mira_copy/` | Claude-powered copywriting tool | Not the product. Separate repo or delete. |
| `observability/` | Grafana + Prometheus configs (duplicates `mira-ops/`) | Consolidate or delete |
| `Pics/` | One Ignition screenshot | Delete |
| `MIRA test case 1/` | Directory with space in name | Delete or move into tests/ |
| `artifacts/` | One NeonDB snapshot JSON | Move to backups or delete |
| `bravo/` | One evaluation script + empty dir | Delete |
| `demo/` | Demo conversation script | Fold into docs/ or delete |
| `outreach/` | NSF STTR letters and notes | Not code. Move to Google Drive. |
| `ignition-sdk-examples/` | Ignition SDK examples (Config 4 deferred) | Delete or archive |
| `ignition/` | Ignition integration (Config 4 deferred) | Delete or archive |
| `output/` | ? | Likely gitignore candidate |
| `PRDS/` | Duplicate of `docs/PRDS/` | Delete duplicate |
| `gsd_engine.py` | Backwards-compat wrapper that just delegates to `engine.py` | Delete, update 2 import sites |

---

## Five Structural Problems

### 1. The Product is Three Products Pretending to Be One

MIRA the repo contains:
- **Product A:** AI diagnostic chatbot (mira-bots + mira-mcp + inference router) — the actual product
- **Product B:** Atlas CMMS deployment (mira-cmms) — someone else's CMMS wrapped in Docker
- **Product C:** Content marketing platform (mira-crawler blog fleet + mira_copy + tools/linkedin_drafter) — GTM tooling

These have different users, different lifecycles, and different deployment targets. Bundling them into one monorepo with one compose creates a "deploy everything or deploy nothing" problem.

### 2. Container Explosion

39 containers for a product that's talking to maintenance techs via Telegram. The mental model for "what's running" requires a spreadsheet. Each container is:
- A Dockerfile to maintain
- A requirements.txt to keep in sync
- A healthcheck to monitor
- A network route to configure
- A failure mode to debug at 2am

Many of these containers exist because each concern got its own service from the start, rather than earning separation through scale demands.

### 3. Speculative Feature Debt

VIM/AR HUD (6.5K LOC), PLC worker (stub), Path B sidecar, Ignition integration, Teams/WhatsApp bots, Observability stack, Paperclip multi-agent — these are features built for a future that hasn't arrived yet. Each one:
- Adds cognitive load when onboarding (or context-loading Claude)
- Creates test obligations (Regimes 5-7 test features that don't work)
- Spreads attention across too many surfaces
- Makes "what does this project do?" harder to answer

### 4. GTM Tooling in the Product Repo

Blog fleet generation, LinkedIn automation, content calendars, STTR outreach letters, email drip sequences — these are sales/marketing tools, not the product. The last 20 commits include content generation, social media scheduling, and pricing page fixes. The kanban board has more GTM issues (11) than bot-logic issues (5).

This isn't wrong per se — you need GTM to get customers. But mixing it with the product codebase means:
- Every `docker compose up` pulls in content generation infrastructure
- The 49 env vars include both product secrets AND marketing API keys
- The test suite has to care about blog schema integrity

### 5. Multiple Inference Paths That Don't Converge

There are at least 3 ways a message gets to an LLM:
- `InferenceRouter` in mira-bots (the cascade: Gemini → Groq → Cerebras → Claude)
- `mira-pipeline` (OpenAI-compatible wrapper for Open WebUI → GSD engine)
- `mira-sidecar` (Path B: Gemma on Charlie via Ollama)

Each has its own prompt loading, error handling, and retry logic. The sidecar even has its own FSM implementation.

---

## Recommendations: The Simplification Path

### Tier 1 — Delete dead weight (0 risk, do today)

1. **Delete dead directories:** `mira-prototype/`, `Pics/`, `MIRA test case 1/`, `artifacts/`, `bravo/`, `output/`, `PRDS/` (duplicate)
2. **Delete `gsd_engine.py`** wrapper — update the 2 import sites to use `Supervisor` directly
3. **Move non-code out:** `outreach/` → Google Drive, `demo/` → `docs/examples/`
4. **Clean branches:** Delete 9+ stale remote branches and merged local branches
5. **Gitignore:** `output/`, `__pycache__/`, any generated content directories

### Tier 2 — Archive speculative features (low risk, this week)

6. **Archive `mira-hud/` + VIM** — Move to `archives/` or a separate branch. No live users. Can be restored when AR HUD becomes a priority.
7. **Archive `ignition/` + `ignition-sdk-examples/`** — Config 4 is explicitly deferred.
8. **Archive `paperclip/`** — Experiment, not product.
9. **Archive `mira-sidecar/`** — Path B is dormant. The cascade in InferenceRouter already handles Ollama fallback.
10. **Archive `mira-ops/` + `observability/`** — Observability for what? No users to monitor. Add it back when there's traffic.
11. **Disable Teams/WhatsApp/Reddit in compose** — Comment them out. They're not running. Every disabled container is one fewer thing to debug.

### Tier 3 — Separate concerns (medium effort, this sprint)

12. **Extract GTM tooling** — Move `mira-crawler/tasks/blog.py`, `mira-crawler/tasks/content.py`, `mira-crawler/tasks/linkedin.py`, `mira_copy/`, and `tools/linkedin_drafter/` into a separate `factorylm-gtm/` repo or at minimum a separate compose profile that doesn't run by default.
13. **Collapse mira-bridge** — Node-RED is overkill for holding a SQLite write lock. The bridge pattern could be replaced by having the engine write to SQLite directly (it already does via Supervisor). If Node-RED flows are actually used for routing, document which ones are active. If not, replace with a simple Python service or eliminate entirely.
14. **Consolidate mira-core containers** — 9 containers is too many. Open WebUI + pipeline could share a process. Docling could be an on-demand service (spin up for PDF ingest, spin down). The MCPO proxy might not need its own container if mira-mcp is already accessible.

### Tier 4 — Architectural simplification (larger effort, next sprint)

15. **Single inference path** — Converge InferenceRouter, mira-pipeline, and sidecar into one inference layer. The cascade logic in `router.py` is already good. Make it the single entry point.
16. **Unify dependency management** — 16 separate `requirements.txt` files is a maintenance nightmare. Consider a shared `pyproject.toml` with optional dependency groups, or at minimum a constraints file that pins shared dependencies.
17. **Reduce to 2 compose profiles:**
    - `core` — The product: bots + engine + mcp + web (target: 8-10 containers)
    - `full` — Everything including CMMS, crawler, bridge, observability

### Tier 5 — Product focus (strategic, ongoing)

18. **Define "done" for v1** — What's the minimum product that a paying customer needs? Almost certainly: Telegram bot + Slack bot + knowledge base + diagnostic engine + PLG signup. Not: AR HUD, CMMS, content generation, observability, PLC integration.
19. **Stop building features. Start getting users.** The kanban has 20 enhancement issues and 1 bug. That ratio should be inverted for a pre-revenue product. The existing diagnostic engine is solid — it passed 50/50 stress tests. Ship what you have, find 5 users, and let their feedback drive the next 5 features.
20. **Kill the free tier decisively** — The memory says "kill free tier, $97/mo Stripe." If that decision was made, remove all the free-tier code paths. Half-killed features are worse than alive or dead.

---

## What Elegance Looks Like for MIRA

After Tiers 1-3, the repo would look like:

```
MIRA/
├── mira-bots/          # Telegram + Slack + shared engine (3 containers)
├── mira-core/          # Open WebUI + ingest (4-5 containers, down from 9)
├── mira-mcp/           # FastMCP server (1-2 containers)
├── mira-web/           # PLG funnel (1-2 containers)
├── mira-crawler/       # Knowledge ingest only (2-3 containers, blog/content removed)
├── tests/              # Regimes 1-4 only (active features)
├── docs/               # PRDs, ADRs, runbooks
├── wiki/               # Ops wiki
├── install/            # Setup scripts
└── deployment/         # Admin guide
```

**~12-15 containers** instead of 39. **~10 root directories** instead of 35. **~20 env vars** instead of 49.

The diagnostic engine stays exactly as-is — it's well-designed. The inference cascade stays. The RAG pipeline stays. The FSM stays. Everything that serves a maintenance tech asking "why is my VFD faulting?" stays untouched.

What goes away is everything built for a future user that hasn't arrived yet.

---

## Verification

This is an analysis document, not a code change plan. To validate these recommendations:
1. Walk through each "archive" candidate and confirm it has no active callers in the core product path
2. Check `docker compose ps` on Bravo/VPS to see which containers are actually running vs. defined-but-stopped
3. Review the last 30 days of Telegram bot usage to confirm which features real users actually exercise
4. Count how many of the 46 open issues would disappear if speculative features were archived
