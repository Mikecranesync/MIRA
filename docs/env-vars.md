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
| `INBOUND_HMAC_SECRET` | mira-web — shared HMAC-SHA256 secret used to verify inbound webhook payloads from the Google Apps Script poller (Unit 3 magic email inbox). Generate: `openssl rand -hex 32`. Set this same value as the `HMAC_SECRET` Script Property in `tools/apps-script/inbox-poller.gs` after pasting it into Apps Script. |
| `MIRA_INGEST_URL`    | mira-web — base URL for mira-ingest (Unit 3 magic inbox forwards PDFs here). Default in saas compose: `http://mira-ingest-saas:8001`. |
| `INBOX_DOMAIN`       | mira-web — domain shown in `/api/me` for the per-tenant address `kb+<slug>@<INBOX_DOMAIN>`. Default `factorylm.com` (uses Gmail plus-addressing on the apex; no subdomain MX needed). |
| `RELEVANCE_GATE_ENABLED` | mira-ingest — set `"true"` to run the LLM relevance check on PDFs ingested via the inbox path (Unit 3.5). Default off (backward-compat for web upload + nightly cron callers, which leave the gate's `relevance_gate=on` form field unset). Cost ~$0.00005/file via Groq. Fail-open on any Groq error. |
| `GROQ_API_KEY`       | mira-bots, mira-pipeline (existing); also mira-ingest when `RELEVANCE_GATE_ENABLED=true` for the magic-inbox relevance classifier. |
| `LEAD_HUNTER_TIMEOUT_SECS` | tools/lead-hunter — hard timeout for hourly run; default 1500 (25 min) |
| `HARDENING_LOCK_DIR` | tools/lead-hunter — directory for singleton lock file; default `/tmp` |
| `HARDENING_ALERT_LOG` | tools/lead-hunter — JSONL alert log path; default `marketing/prospects/hardening-alerts.jsonl` |
| `DISCORD_ALERT_WEBHOOK` | tools/lead-hunter — optional Discord webhook URL for degraded/failed runs |
