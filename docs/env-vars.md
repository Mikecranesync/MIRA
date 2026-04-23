# MIRA Environment Variables (Doppler: factorylm/prd)

Full reference. Top 10 are in `CLAUDE.md`; this file has all of them.

| Var                  | Used By                              |
|----------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram                    |
| `SLACK_BOT_TOKEN`    | mira-bot-slack                       |
| `SLACK_APP_TOKEN`    | mira-bot-slack (Socket Mode)         |
| `ANTHROPIC_API_KEY`  | mira-bots (Claude inference)         |
| `INFERENCE_BACKEND`  | mira-bots — `"cloud"` (cascade) or `"local"` |
| `GEMINI_API_KEY`     | mira-bots, mira-pipeline (Gemini — primary free tier) |
| `GEMINI_MODEL`       | mira-bots, mira-pipeline — default: gemini-2.5-flash |
| `GEMINI_VISION_MODEL`| mira-bots, mira-pipeline — default: gemini-2.5-flash |
| `GROQ_API_KEY`       | mira-bots, mira-pipeline (Groq — secondary free tier) |
| `GROQ_MODEL`         | mira-bots, mira-pipeline — default: llama-3.3-70b-versatile |
| `GROQ_VISION_MODEL`  | mira-bots, mira-pipeline — default: meta-llama/llama-4-scout-17b-16e-instruct |
| `CEREBRAS_API_KEY`   | mira-bots (Cerebras — tertiary free tier) |
| `CEREBRAS_MODEL`     | mira-bots — default: llama3.1-8b |
| `CLAUDE_MODEL`       | mira-bots — default: claude-sonnet-4-6 |
| `OPENWEBUI_API_KEY`  | mira-bots, mira-ingest, mira-pipeline |
| `PIPELINE_API_KEY`   | mira-pipeline (bearer auth), mira-core (OPENAI_API_KEYS) |
| `MCP_REST_API_KEY`   | mira-mcp (server), mira-bots (client)|
| `NEON_DATABASE_URL`  | mira-ingest (NeonDB)                 |
| `MIRA_TENANT_ID`     | mira-ingest (tenant scoping)         |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest          |
| `LANGFUSE_SECRET_KEY`| mira-bots (tracing)                  |
| `LANGFUSE_PUBLIC_KEY`| mira-bots (tracing)                  |
| `MIRA_SERVER_BASE_URL` | Remote clients (no port)           |
| `ATLAS_DB_PASSWORD`  | atlas-db (PostgreSQL)                |
| `ATLAS_JWT_SECRET`   | atlas-api (JWT signing)              |
| `ATLAS_MINIO_PASSWORD`| atlas-minio (file storage)          |
| `ATLAS_PUBLIC_API_URL` | mira-cmms atlas-api + atlas-frontend — public URL for Atlas CMMS API (e.g. `http://bravo:8088`) |
| `ATLAS_PUBLIC_FRONT_URL` | mira-cmms atlas-api — public URL for Atlas CMMS frontend |
| `ATLAS_PUBLIC_MINIO_URL` | mira-cmms atlas-api + atlas-frontend — public URL for MinIO |
| `BRAVO_HOST`         | mira-core/docker-compose.oracle.yml — Tailscale IP or hostname of Bravo compute node (e.g. `100.86.236.11`). Required when running Oracle Cloud overrides. |
| `MIRA_MCPO_VERSION`  | mira-core/docker-compose.yml — image tag for locally-built mira-mcpo container. Default: `3.4`. Bump when Dockerfile.mcpo changes. |
| `MIRA_PLC_ENABLED`   | mira-bots/shared/engine.py — set `1`/`true`/`yes` to instantiate PLCWorker (Config 4 / deferred PLC integration). Default: disabled. |
| `MIRA_RETRIEVAL_HYBRID_ENABLED` | mira-bots — Unit 6 hybrid BM25+pgvector kill switch. Default `true`. Set `false` to disable BM25 stream and fall back to pre-Unit-6 vector+ILIKE+product behavior (e.g. if recall regresses in prod or migration 004 hasn't been applied). |
| `MIRA_RRF_K`         | mira-bots — Reciprocal Rank Fusion constant. Default `60` (Cormack et al. 2009). Raise to flatten rank influence, lower to sharpen it. Change only with an eval to back it. |
| `SESSION_RECORDING_PATH` | mira-pipeline — directory for per-chat NDJSON session files. Default `/data/sessions`. VPS host path: `/opt/mira/mira-bridge/data/sessions`. Read by `tests/eval/analyze_sessions.py` cron to auto-generate eval fixtures. |
| `EVAL_DISABLE_JUDGE` | `tests/eval/analyze_sessions.py` — set `"1"` to skip LLM grading (deterministic grades only; saves Groq tokens). |

## Hub Connector OAuth (mira-web — `factorylm/prd`)

Already in Doppler:

| Var | Used By | Notes |
|-----|---------|-------|
| `GOOGLE_CLIENT_ID` | mira-web `/api/oauth/google/*` | OAuth 2.0 client ID — **register redirect URIs** in Google Cloud Console: `https://app.factorylm.com/api/oauth/google/callback` and `http://localhost:3200/api/oauth/google/callback` |
| `GOOGLE_CLIENT_SECRET` | mira-web `/api/oauth/google/*` | OAuth 2.0 client secret |

Add before Playwright E2E run:

| Var | Used By | Notes |
|-----|---------|-------|
| `PLAYWRIGHT_TEST_TENANT_TOKEN` | `mira-web/tests/hub.e2e.ts` | Active tenant JWT (from `/api/me` or activation email) |
| `PLAYWRIGHT_GOOGLE_USER` | `mira-web/tests/hub.e2e.ts` | Google test account email |
| `PLAYWRIGHT_GOOGLE_PASS` | `mira-web/tests/hub.e2e.ts` | Google test account password |

Pre-upload these files to the test Google Drive account before running E2E:
- `tests/fixtures/nameplate_gs10.jpg`
- `tools/sample-labels.pdf`
- `docs/proposals/MIRA-Projects-PRD-v1.docx`
