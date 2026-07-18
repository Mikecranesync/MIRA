# MIRA Environment Variables (Doppler: factorylm/prd)

Full reference. Top 10 are in `CLAUDE.md`; this file has all of them.

| Var                  | Used By                              |
|----------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram                    |
| `PRINTSENSE_COMMERCIAL_ROOT` | mira-bot-telegram — PrintSense concierge storage root (default `/data/printsense_commercial`; container-ephemeral unless volume-mounted) |
| `PRINTSENSE_REVIEWER_CHAT_IDS` | mira-bot-telegram — comma-separated Telegram chat ids allowed the admin `/ps_review` reviewer commands (empty = reviewer surface disabled) |
| `SLACK_BOT_TOKEN`    | mira-bot-slack                       |
| `SLACK_APP_TOKEN`    | mira-bot-slack (Socket Mode)         |
| `INFERENCE_BACKEND`  | mira-bots — `"cloud"` (cascade) or `"local"` |
| `GROQ_API_KEY`       | mira-bots, mira-pipeline (Groq — first in cascade, fastest) |
| `GROQ_MODEL`         | mira-bots, mira-pipeline — default: llama-3.3-70b-versatile |
| `GROQ_VISION_MODEL`  | mira-bots, mira-pipeline — default: **empty since v3.162.2** (Groq removed all vision models 2026-07-18; image requests skip Groq). Set only if Groq re-adds a vision model. |
| `CEREBRAS_API_KEY`   | mira-bots, mira-pipeline (Cerebras — second in cascade) |
| `CEREBRAS_MODEL`     | mira-bots, mira-pipeline — default: gpt-oss-120b |
| `TOGETHERAI_API_KEY`     | mira-bots, mira-pipeline (Together AI — third in cascade; OpenAI-compatible) |
| `TOGETHERAI_MODEL`       | mira-bots, mira-pipeline — default: meta-llama/Llama-3.3-70B-Instruct-Turbo |
| `TOGETHERAI_VISION_MODEL`| mira-bots, mira-pipeline — default: **google/gemma-3n-E4B-it since v3.162.2** (the only serverless vision model on this Together account, verified live 2026-07-18; carries the free-path image cascade after the Groq vision deprecation). Empty-string env falls back to the default (`or`-form parse). |
| `OPENAI_API_KEY` | **Print-vision ONLY** (owner-authorized, isolated) — the PrintSense electrical-print interpreter (`printsense/interpret.py`) default provider since v3.153.0 (gpt-5.5, Responses API). **NOT** in the Groq→Cerebras→Together cascade. Inert unless `PRINT_VISION_PROVIDER=openai`. |
| `ANTHROPIC_API_KEY` | **Print-vision ONLY** (owner-authorized, isolated) — the retained Claude path of the PrintSense interpreter. **NOT** in the cascade, which stays No-Anthropic per PR #610. Inert unless `PRINT_VISION_PROVIDER=anthropic`. |
| `PRINT_AUTOEVAL_ENABLED` | mira-bot-telegram — per-turn $0 deterministic auto-eval of every print-translator reply (grade → `conversation_eval` meta → flood-guarded ntfy P0 push). **Default ON** via the `or`-form parse (empty string = ON — compose `${VAR:-}` shape); set `0` to disable. Zero inference cost by construction. |
| `PRINT_VISION_PROVIDER` | mira-bot-telegram — selects the electrical-print interpreter: `openai` (default since v3.153.0; needs `OPENAI_API_KEY`) or `anthropic` (needs `ANTHROPIC_API_KEY`); anything else = the free OCR cascade. Optional tuning read by `printsense/interpret.py`: PRINT_VISION_MODEL (default gpt-5.5 / claude-opus-4-8 per provider), PRINT_VISION_EFFORT, PRINT_VISION_MAX_TOKENS. |
| `PRINT_VISION_EFFORT` | mira-bot-telegram — interpreter reasoning effort. Code default `xhigh` (mapped to OpenAI `high`); **stg runs `medium`** (bench-decided v3.154.2: 8/8 twice at ~94s vs high's floating 6-8/8 at 141-294s). Prod = explicit owner choice. |
| `PRINT_VISION_MODEL` | mira-bot-telegram — interpreter model override; empty = per-provider default (`gpt-5.5` / `claude-opus-4-8`). `gpt-5.5-pro` is the slower/pricier explicit knob. |
| `PRINT_VISION_MAX_TOKENS` | mira-bot-telegram — interpreter per-call output cap. Code default `12000` (ZTA-2, v3.156.0: bounds a runaway reasoning chain at ~$0.36/call on gpt-5.5 $30/M-output vs ~$0.96 at the old 32000); empty = code default. Truncation is grader-visible, never silent. |
| `PRINT_BENCH_BUDGET_USD` | mira-bot-telegram — hard dollar budget for every paid PrintSense bench lane (`/printsense_test` phase2/3/4 + the local bench loop). Code default `1.50`; metered spend (ZTA-1 cost meter) hard-stops the lane at the ceiling. Empty = code default. |
| `OCR_MODEL_LANE` | shared engine images (telegram primary; others default off/0) — model-OCR enrichment lane via the inference cascade. Values: `off` (default — uses free Tesseract floor only) or `on` (adds model inference cost). The deterministic Tesseract floor runs in-image; model lane is benchmarked separately. Keep off unless benchmarked. Containers: default off. |
| `OCR_EXPECT_TESSERACT` | shared engine images (telegram primary; others default off/0) — boot self-check Tesseract floor status. Values: `1` (containers/prod — floor required, self-check reports DEAD if missing) or `0` (local dev/Windows machines — floor optional). Default: `1` in `docker-compose.staging-vps.yml` + `docker-compose.saas.yml`, `0` in `mira-bots/docker-compose.yml`. |
| ~~`CLAUDE_MODEL`~~      | **REMOVED PR #610** — see above |
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
| `HUB_BASE_PATH`     | mira-hub — URL base path the Hub is served under (e.g. `/hub`). Default `/hub` in `docker-compose.saas.yml`. Must match the NextAuth basePath / reverse-proxy prefix. |
| `HUB_INGEST_TOKEN`  | mira-hub + mira-bot-telegram — bearer token authorizing server-side file intake to the Hub `/api/uploads/folder` ingest path (Telegram file routing, #2547). Empty disables the authenticated ingest shortcut. |
| `HUB_SSO_SECRET`    | mira-hub + Atlas CMMS API — shared HS256 secret for Hub-to-Atlas SSO assertions. Must match on both services. |
| `HUB_SSO_ISSUER`    | mira-hub + Atlas CMMS API — optional SSO issuer override. Default `factorylm-hub`. |
| `HUB_SSO_AUDIENCE`  | mira-hub + Atlas CMMS API — optional SSO audience override. Default `atlas-cmms`. |
| `BRAVO_HOST`         | mira-core/docker-compose.oracle.yml — Tailscale IP or hostname of Bravo compute node (e.g. `100.86.236.11`). Required when running Oracle Cloud overrides. |
| `MIRA_MCPO_VERSION`  | mira-core/docker-compose.yml — image tag for locally-built mira-mcpo container. Default: `3.4`. Bump when Dockerfile.mcpo changes. |
| `MIRA_PLC_ENABLED`   | mira-bots/shared/engine.py — set `1`/`true`/`yes` to instantiate PLCWorker (Config 4 / deferred PLC integration). Default: disabled. |
| `MIRA_UNS_GATE_ENABLED` | mira-bots/shared/engine.py — UNS Confirmation Gate kill-switch. Default `1` (enabled). Set `0` to revert to pre-gate behavior (engine answers diagnose_equipment turns without first confirming the asset). Flag-off regression path is part of namespace-builder Phase 1 acceptance — see `docs/plans/2026-05-15-maintenance-namespace-builder.md`. |
| `MIRA_RETRIEVAL_HYBRID_ENABLED` | mira-bots — Unit 6 hybrid BM25+pgvector kill switch. Default `true`. Set `false` to disable BM25 stream and fall back to pre-Unit-6 vector+ILIKE+product behavior (e.g. if recall regresses in prod or migration 004 hasn't been applied). |
| `MIRA_RRF_K`         | mira-bots — Reciprocal Rank Fusion constant. Default `60` (Cormack et al. 2009). Raise to flatten rank influence, lower to sharpen it. Change only with an eval to back it. |
| `ENABLE_WO_EVIDENCE` | mira-pipeline + mira-bot-telegram + mira-bot-slack + mira-ask (every service running `shared.engine.Supervisor`) — CMMS work-order-history evidence context (#2445/#2472). Default `0` (**OFF**). Set `1` to inject a citable `[WO <number>]` block of the confirmed asset's recent Hub `work_orders` (JOIN `cmms_equipment`, UNS-scoped) into the diagnosis prompt so answers can cite prior repairs. Best-effort: `""` on any miss (no tenant/asset, DB unreachable, timeout) — diagnosis is byte-for-byte unchanged when off. Wired default-off in `docker-compose.saas.yml` (prod) **and** `docker-compose.staging-vps.yml` + `docker-compose.staging.yml` (staging: pipeline + Telegram only — Slack/mira-ask aren't deployed on staging); enable via Doppler staging→gate→prod. Requires Hub `work_orders` rows to surface anything. |
| `MIRA_WO_EVIDENCE_TIMEOUT_S` | same 4 engine services — per-turn timeout (seconds) for the `ENABLE_WO_EVIDENCE` work-order recall. Default `3.0`. On timeout the block is `""` and diagnosis proceeds unaffected. |
| `MIRA_WO_EVIDENCE_LIMIT` | same 4 engine services — max work orders injected per turn under `ENABLE_WO_EVIDENCE`. Default `5` (most recent first). |
| `SESSION_RECORDING_PATH` | mira-pipeline — directory for per-chat NDJSON session files. Default `/data/sessions`. VPS host path: `/opt/mira/mira-bridge/data/sessions`. Read by `tests/eval/analyze_sessions.py` cron to auto-generate eval fixtures. |
| `EVAL_DISABLE_JUDGE` | `tests/eval/analyze_sessions.py` — set `"1"` to skip LLM grading (deterministic grades only; saves Groq tokens). |
| `INBOUND_HMAC_SECRET` | mira-web — shared HMAC-SHA256 secret used to verify inbound webhook payloads from the Google Apps Script poller (Unit 3 magic email inbox). Generate: `openssl rand -hex 32`. Set this same value as the `HMAC_SECRET` Script Property in `tools/apps-script/inbox-poller.gs` after pasting it into Apps Script. |
| `MIRA_INGEST_URL`    | mira-web — base URL for mira-ingest (Unit 3 magic inbox forwards PDFs here). Default in saas compose: `http://mira-ingest-saas:8001`. |
| `INBOX_DOMAIN`       | mira-web — domain shown in `/api/me` for the per-tenant address `kb+<slug>@<INBOX_DOMAIN>`. Default `factorylm.com` (uses Gmail plus-addressing on the apex; no subdomain MX needed). |
| `RELEVANCE_GATE_ENABLED` | mira-ingest — set `"true"` to run the LLM relevance check on PDFs ingested via the inbox path (Unit 3.5). Default off (backward-compat for web upload + nightly cron callers, which leave the gate's `relevance_gate=on` form field unset). Cost ~$0.00005/file via Groq. Fail-open on any Groq error. |
| `GROQ_API_KEY`       | mira-bots, mira-pipeline (existing); also mira-ingest when `RELEVANCE_GATE_ENABLED=true` for the magic-inbox relevance classifier. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | mira-crawler/agents/gdrive_photo_scanner.py — raw or base64 service-account JSON. Preferred auth for VPS cron. Pair with `GOOGLE_DRIVE_IMPERSONATE` for domain-wide delegation. |
| `GOOGLE_DRIVE_IMPERSONATE` | mira-crawler/agents/gdrive_photo_scanner.py — Workspace user to impersonate (e.g. `mike@factorylm.com`). Defaults to the service account itself if unset (only sees files explicitly shared with the SA). |
| `GOOGLE_DRIVE_TOKEN`       | mira-crawler/agents/gdrive_photo_scanner.py — pre-issued OAuth access token. For local testing only; expires in ~1 h. |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | mira-crawler/agents/gdrive_photo_scanner.py — OAuth refresh token; needs `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Same client as `tools/google_photos_ingest.py`. |
| `MIRA_SCAN_BACKEND_URL`    | mira-crawler/agents/gdrive_photo_scanner.py — base URL for the MIRA Scan backend's `/scan/extract`, `/kb/lookup`, `/queue/manual-request`. Default `http://localhost:8090`. |
| `MIRA_SCAN_API_KEY`        | mira-crawler/agents/gdrive_photo_scanner.py — bearer token for the scan backend. Optional; omit if running on the same loopback network. |
| `LEAD_HUNTER_TIMEOUT_SECS` | tools/lead-hunter — hard timeout for hourly run; default 1500 (25 min) |
| `HARDENING_LOCK_DIR` | tools/lead-hunter — directory for singleton lock file; default `/tmp` |
| `HARDENING_ALERT_LOG` | tools/lead-hunter — JSONL alert log path; default `marketing/prospects/hardening-alerts.jsonl` |
| `DISCORD_ALERT_WEBHOOK` | tools/lead-hunter — optional Discord webhook URL for degraded/failed runs |
| `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` | mira-hub — comma-separated exact hosts allowed as Command Center display targets (e.g. `127.0.0.1,192.168.1.20,100.72.2.99`). The tree route server-side-probes each registered display host; **set this in prod** to bound the SSRF surface of `POST /api/command-center/display` to known proxy/HMI origins. Unset = no restriction beyond the validator's link-local/metadata block (dev/bench). Interim control until #578 enables a true admin-role gate. |
| `CSP_FRAME_SRC_DISPLAY_HOSTS` | mira-hub `src/middleware.ts` — comma-separated hosts added to the site-wide CSP `frame-src` allowlist (for any framed display surface). Distinct from the allowlist above: this governs what the browser may frame, not what may be registered. |
| `MIRA_MACHINE_MEMORY_UNS_PATHS` | `mira-crawler/tasks/historize_runs.py` — extra `uns_path`s (comma-separated) to derive state windows + A0-A12 anomaly diffs for, even without a `MIRA_RUN_TRIGGERS` entry (migration 040). |
| `MQTT_INGEST_BROKER_HOST` | `mira-relay/mqtt_ingest/config.py` — Sparkplug B subscriber broker hostname. Default `mosquitto`. |
| `MQTT_INGEST_BROKER_PORT` | `mira-relay/mqtt_ingest/config.py` — broker port. Default `1883` (`8883` for TLS). |
| `MQTT_INGEST_TLS` | `mira-relay/mqtt_ingest/config.py` — `"1"`/`"true"` enables TLS to the broker. |
| `MQTT_INGEST_USERNAME` | `mira-relay/mqtt_ingest/config.py` — broker username (optional). |
| `MQTT_INGEST_PASSWORD` | `mira-relay/mqtt_ingest/config.py` — broker password (optional; never logged). |
| `MQTT_INGEST_GROUP_IDS` | `mira-relay/mqtt_ingest/config.py` — comma list of Sparkplug `group_id`s to subscribe to (`""` = all). |
| `MQTT_INGEST_EDGE_NODES` | `mira-relay/mqtt_ingest/config.py` — comma list of `edge_node_id`s to subscribe to (`""` = all). |
| `MQTT_INGEST_DEVICES` | `mira-relay/mqtt_ingest/config.py` — comma list of `device_id`s to subscribe to (`""` = all). |
| `MQTT_INGEST_TENANT_ID` | `mira-relay/mqtt_ingest/config.py` — REQUIRED: the tenant every ingested tag lands under (tenant is config, never derived from the topic — Lane 3 design). |
| `MQTT_INGEST_SOURCE_SYSTEM` | `mira-relay/mqtt_ingest/config.py` — `source_system` stamped on the ingest batch. Default `ignition`. |
| `MQTT_INGEST_DRY_RUN` | `mira-relay/mqtt_ingest/config.py` — `"1"` decodes + logs Sparkplug payloads but never writes to the DB. |
| `MQTT_INGEST_AUTO_DISCOVER` | `mira-relay/mqtt_ingest/config.py` — `"1"` records unknown tags as seen instead of dropping them (default disabled). |
| `MQTT_INGEST_DEBUG` | `mira-relay/mqtt_ingest/config.py` — `"1"` enables debug logging for the subscriber. |
