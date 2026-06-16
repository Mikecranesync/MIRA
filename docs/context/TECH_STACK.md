# MIRA — Tech Stack
**Last Updated:** 2026-05-05

Source of truth for "what we use." Anything not on this list either doesn't exist in this repo or needs a deliberate decision (and probably an ADR) to introduce. Hard constraints from `CLAUDE.md` are restated where relevant.

## Languages & runtimes
| Layer | Choice | Notes |
|---|---|---|
| Engine, ingest, MCP, crawler | Python 3.12 | Use `Optional[X]` only for Python 3.9 in `~/factorylm`; in MIRA repo, use `str \| None` |
| Hub | TypeScript (strict) on Next.js | Custom internal Next; read `node_modules/next/dist/docs/` before assuming |
| Web (PLG) | TypeScript on Bun + Hono | MIT-licensed |
| Atlas API | Java (Spring Boot) | Upstream image only — no code imports |
| PLC layer | Structured Text + ladder | Micro820, deployed via Connected Components Workbench |
| Ignition Project | Jython gateway scripts + Perspective + WebDev | Deployed to Ignition 8.1 |

## Package & build tooling
| Concern | Tool | Notes |
|---|---|---|
| Python deps | `uv` | Not pip / poetry / conda |
| Python lint + format | `ruff` | Not flake8 / pylint / black |
| Python type check | `pyright` (basic) | 57 warnings target → 0 |
| Python tests | `pytest`, `hypothesis` | `asyncio_mode = "auto"` |
| TS / JS deps | Bun (mira-web), npm/pnpm (mira-hub) | Bun.lock + package-lock.json committed |
| Containers | Docker Compose | Pinned tags; `restart: unless-stopped`; healthcheck on every service |
| Image scanning | Trivy | CI-enforced |
| SAST | Semgrep + Bandit | CI-enforced |
| Secrets scanning | Gitleaks | Pre-commit + CI |
| Architecture contracts | Boundary tests | 6 contracts |

## Storage
| System | Use |
|---|---|
| NeonDB (Postgres + pgvector) | KB, tenancy, KG, usage; RLS by tenant |
| SQLite WAL (`mira.db`) | Conversation state, equipment, faults, maintenance notes, photos, feedback |
| MinIO | Atlas asset images + WO attachments |
| Redis | Celery broker for `mira-crawler` |
| ChromaDB | Legacy in `mira-sidecar` (deprecated, ADR-0008) |

## LLMs & inference
- **Cloud cascade (default):** Groq → Cerebras → Gemini (OpenAI-compat). Set via `INFERENCE_BACKEND=cloud`.
- **Local fallback:** Open WebUI → Ollama → `qwen2.5vl:7b`. `INFERENCE_BACKEND=local`.
- **Vision:** Gemini native; Groq via `GROQ_VISION_MODEL`; local via qwen2.5vl.
- **Embeddings:** `nomic-embed-text-v1.5` (768-d) for text; `nomic-embed-vision-v1.5` for image.
- **Forbidden:** Anthropic (removed PR #610, PR #649). Any LangChain / LlamaIndex / TensorFlow / n8n.

## HTTP, async, and DB drivers
- HTTP: `httpx` (async). Never `requests` / `urllib`.
- Async: `asyncio` end-to-end. `asyncio.run()` only at entry points.
- Postgres: SQLAlchemy + `NullPool` (Neon's PgBouncer pools); `sslmode=require`; `pool_pre_ping=True`.
- SQLite: stdlib `sqlite3`, always `PRAGMA journal_mode=WAL`.
- YAML: always `yaml.safe_load()`.

## Frameworks
| Surface | Framework |
|---|---|
| `mira-pipeline` | FastAPI |
| `mira-mcp` | FastMCP + FastAPI |
| `mira-ingest` | FastAPI |
| `mira-bots/*` | python-telegram-bot 21.x, slack-bolt 1.x, botbuilder 4.17, twilio 9.x, custom for reddit/email/gchat/webchat |
| `mira-bridge` | Node-RED 4.1.7-22 (image: `nodered/node-red:4.1.7-22`) |
| `mira-web` | Hono on Bun |
| `mira-hub` | Custom internal Next.js + Refine.dev + shadcn/ui + Tailwind |
| `mira-cmms` (Atlas) | Spring Boot — upstream image |

## Auth
- Mira-web JWT — `jose` library, secret `PLG_JWT_SECRET`.
- Mira-hub JWT — separate secret `HUB_JWT_SECRET`.
- HMAC for inbound webhooks: Stripe (`STRIPE_WEBHOOK_SECRET`), Apps Script magic inbox (`INBOUND_HMAC_SECRET`), monday.com (`MONDAY_APP_SIGNING_SECRET`).
- Magic-link via Resend; Google OAuth on hub; admin bypass via header `x-admin-token`.

## Observability
- Tracing: Langfuse (per-call traces from bot adapters and pipeline).
- Metrics & dashboards: Prometheus + Grafana (`mira-ops` deferred / partial).
- Worker monitoring: Flower (Celery).
- Discord webhooks: `#alpha-status`, `#alpha-nightly`, `#alpha-morning`, `#weekly-review`.

## CI / agent review pipeline
- GH Action `.github/workflows/code-review.yml` triggers on every PR to `main / develop / dev`.
  shellcheck → ast-grep (IPs / secrets / raw FastAPI body / missing socket error handling) → cascade review (Groq → Cerebras → Gemini) → PR comment.
- Self-fix script `scripts/pr_self_fix.sh <PR>` reads 🔴 IMPORTANT comments, asks LLM cascade for patches, applies + pushes (max 3 loops).
- Pre-commit hook `.githooks/pre-commit`: shellcheck + rg credential scan + debug artifact scan.
- Tools required locally: `shellcheck`, `rg`, `sg` (ast-grep), `scc`, `difft`.

## Logging
- Python: stdlib `logging`, never `print()`. Service-specific loggers (`logging.getLogger("mira-gsd")`).
- Never log secrets or full PII; sanitization runs at `InferenceRouter.complete()` boundary.

## What we do NOT use
- LangChain, LlamaIndex, TensorFlow, n8n, Anthropic SDK, OpenAI proper (we use OpenAI-*compat* via Groq/Cerebras/Gemini), Kubernetes.
