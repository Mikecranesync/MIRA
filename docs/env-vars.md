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
| `MIRA_RETRIEVAL_HYBRID_ENABLED` | mira-bots — Unit 6 hybrid BM25+pgvector kill switch. Default `true`. Set `false` to disable BM25 stream and fall back to pre-Unit-6 vector+ILIKE+product behavior (e.g. if recall regresses in prod or migration 004 hasn't been applied). |
| `MIRA_RRF_K`         | mira-bots — Reciprocal Rank Fusion constant. Default `60` (Cormack et al. 2009). Raise to flatten rank influence, lower to sharpen it. Change only with an eval to back it. |
