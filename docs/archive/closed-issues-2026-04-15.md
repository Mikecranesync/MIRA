# Archived Issue Knowledge — 2026-04-15

Closed during kanban triage. Purely mechanical or fully-shipped issues are noted inline.
Issues with non-obvious architectural insight get a full entry.

---

## #249 — feat: implement mira-pipeline

**Superseded by:** mira-pipeline shipped in v2.3.0+. GSDEngine, intent guard, NeonDB recall, KB gap detection, and scrape-trigger all live. ADR-0007 fully implemented.

---

## #222 — feat: verify Gemini 2.5 Pro vision integration

**Superseded by:** PR #194 shipped vision integration. Gemini key 403 is a Doppler rotation issue (documented in CLAUDE.md Known Broken), not a code gap. Cascade falls to Groq Scout for vision when Gemini key is invalid.

---

## #212 — crawl monitoring dashboard Phase 3

**Dupe of:** #218. Alerting + weekly digest features deferred post-v1.

---

## #5 — Cross-platform acceptance test (all 4 platforms, 8 golden cases)

**Original idea:** PRD §9 criterion #3 — full 8-golden-case test run across Telegram, Slack, Teams, WhatsApp with results in `docs/TEST_RESULTS_BASELINE.md`.

**Why it matters later:** The `mira-bots/telegram_test_runner/test_manifest.yaml` and `mira-bots/prompts/golden_dataset/v0.1.json` are the test harness. When Teams + WhatsApp ship, this is the acceptance gate. The 10-second response SLA should be a hard pass/fail criterion.

**Superseded by:** CUT from v1 scope. Telegram is tested via the eval suite. Teams + WhatsApp blocked on cloud setup (#3, #4).

---

## #4 — Activate Twilio WhatsApp sandbox

**Superseded by:** CUT v1 scope. Code built at `mira-bots/whatsapp/bot.py`. When resuming: 10 minutes on Twilio console, 3 secrets needed in Doppler: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`. Setup doc: `docs/SETUP_WHATSAPP.md`.

---

## #3 — Create Azure Bot resource for Teams adapter

**Superseded by:** CUT v1 scope. Code built at `mira-bots/teams/bot.py`. When resuming: 30 minutes in Azure portal (F0 free tier), 2 secrets needed in Doppler: `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`. Messaging endpoint: `https://<domain>/api/messages`. Setup doc: `docs/SETUP_TEAMS.md`.

---

## #64 — Teams + WhatsApp cloud setup

**Superseded by:** Rolled into #3 and #4 above. Both adapters code-complete, blocked on external cloud accounts only.

---

## #35 — Twilio SMS install link (PLG funnel Phase 5)

**Original idea:** After first work order creation, send an SMS with the PWA install link. Hook lives in the CMMS flow post-work-order-created event.

**Why it matters later:** PLG activation funnel — work order creation is the activation event. SMS delivers a second nudge for install without relying on the user to return to the web app. Implementation: `mira-web/src/lib/sms.ts`, `POST /api/send-app-link` in server.ts. Three Doppler secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. The PWA install prompt handles primary flow; SMS is an incremental nudge.

**Superseded by:** Nothing — genuinely deferred. Priority: low.

---

## #57 — Path B /route vs /rag endpoint design

**Original idea:** Two competing endpoint designs for sidecar tier routing: inject tier logic into `/rag` behind `TIER_ROUTING_ENABLED` flag (Option A, chosen) vs keep a separate `/route` endpoint for Path B (Option B).

**Why it matters later:** If we re-introduce a local-first inference tier (Ollama on-prem — e.g., BRAVO at inference scale), Option A's pattern (feature-flag inside `/rag`) is the right shape. It keeps the bot adapter call surface unchanged (`/rag` always) and routes at the infrastructure level. Kill the endpoint, not the concept. See ADR-0008 §4 for sidecar deprecation context.

**Superseded by:** mira-pipeline OpenAI-compat endpoint (v2.3.0). Sidecar deprecated ADR-0008.

---

## #58 — Path B dual-provider init for Ollama + Claude fallback

**Original idea:** `llm/factory.py` initialized only one LLM provider at startup. When Tier 1 (Ollama) was unavailable and the router fell back to Tier 3 (Claude), the Claude provider was never initialized.

**Decision made:** Option A — VPS owns all routing, CHARLIE is a stateless Ollama host. VPS initializes both `OllamaProvider` (Tier 1, pointing at `TIER1_OLLAMA_URL`) and `AnthropicProvider` (Tier 3). CHARLIE never needs `ANTHROPIC_API_KEY`.

**Why it matters later:** This separation-of-concerns principle applies to any future BRAVO/CHARLIE Ollama scale-out. The inference node should be stateless — no fallback logic, no API keys, just the model server. The cascade logic lives in one place (VPS/pipeline).

**Superseded by:** mira-pipeline cascade (Gemini → Groq → Cerebras → Claude). Sidecar deprecated ADR-0008.

---

## #27 — claude-peers cross-node peer discovery and messaging

**Original idea:** Deploy `louislva/claude-peers-mcp` across ALPHA/BRAVO/CHARLIE/TRAVEL so Claude Code sessions can discover each other and route tasks cross-node via `send_message`. ALPHA hosts the broker on port 7899. Other nodes point at ALPHA's Tailscale IP.

**Current state (as of 2026-04-05):** ALPHA broker IS live — Bun v1.3.11, repo cloned, broker listening on `0.0.0.0:7899`, launchd plist deployed at `~/Library/LaunchAgents/com.factorylm.claude-peers.plist`. **The broker.ts patch is uncommitted on ALPHA (local-only)**. BRAVO, CHARLIE, TRAVEL not configured.

**Why it matters later:** When MIRA scales to distributed agents (BRAVO inference + CHARLIE KB + VPS pipeline), a messaging layer for cross-node task delegation becomes non-optional. The broker is already running on ALPHA — it just needs the worker nodes wired up (MCP registration via `claude mcp add`). Total work: ~1 hour to complete the rollout.

**Superseded by:** Deferred until Config 1 MVP ships. Celery + Redis handles inter-node coordination for now.

---

## #38 — commit claude-peers broker.ts patch

**Critical — patch is uncommitted on ALPHA:** The `broker.ts` patch adds one line: `const HOST = process.env.CLAUDE_PEERS_HOST ?? "127.0.0.1"` (line 27 of broker.ts in `louislva/claude-peers-mcp`). This replaces the hardcoded `"127.0.0.1"` with `HOST` so the broker can bind on `0.0.0.0`. The launchd plist at `~/Library/LaunchAgents/com.factorylm.claude-peers.plist` sets `CLAUDE_PEERS_HOST=0.0.0.0`.

**To preserve:** SSH to ALPHA, `cd ~/claude-peers-mcp`, fork the upstream repo, commit the one-line patch, push. Or open a PR upstream. If ALPHA is reimaged without this, the cross-node broker config is lost.

**Superseded by:** Deferred. Patch is on ALPHA only — needs SSH to commit. Tracked in remote ops backlog.

---

## #100 — Business OS dashboard Phase 2

**Original idea:** Extend `mira-ops/` (Phase 1: FastAPI + Jinja2 + htmx on Bravo:8500) into a full approval workflow dashboard: inbox fleet view for pending blog/social drafts, approve/reject/edit flow, React migration, content calendar, Buffer/YouTube analytics.

**Why it matters later:** The approval workflow (approve/reject/edit before publish) is the right pattern for any human-in-the-loop content pipeline. The status column on `mira-crawler/tasks/blog.py` and `social.py` already supports this. React migration from htmx is a genuine architectural upgrade, not just cosmetic.

**Superseded by:** Not v1 scope. `mira-ops/` remains at Phase 1. Resume post-MVP.

---

## #174 — Video frame extraction for equipment diagnosis

**Original idea:** Technician records a 10-second video of vibrating motor or flashing fault indicator → MIRA extracts N key frames (1fps or scene-change detection via ffmpeg/opencv) → analyzes each frame via vision worker (Groq Scout) → combined analysis fed to GSD engine.

**Why it matters later:** This is the highest-value vision moat expansion after static photos. Phone video of a belt drive, bearing, or VFD display panel captures dynamic state that a single photo misses. Implementation is clean: `ffmpeg` in the pipeline container for extraction, existing vision worker handles frames. Max 50MB, MP4/MOV/AVI support. No new architecture needed — just ffmpeg + loop.

**Superseded by:** Nothing — genuinely deferred. P3 priority. Build after photo diagnosis is solid.

---

## #190 — Learning Pipeline Phase 4 — monthly fine-tune scripts

**Original idea:** `export_training_data.py` → `train.py` (Unsloth QLoRA on BRAVO Mac Mini M4 Metal) → `swap_model.sh`. Requires 50+ approved conversations (check `/v1/learning-stats ready_to_finetune`). Gate: 50+ thumbs-up ratings in `feedback_log`.

**Why it matters later:** The QLoRA fine-tune loop on BRAVO M4 Metal is the path to a MIRA-specific model that doesn't need expensive API calls for routine diagnostics. The 50-conversation threshold is the meaningful gate — track thumbs-up velocity to know when it's ready. Unsloth was the chosen framework for memory-efficient QLoRA on Metal.

**Superseded by:** Nothing — genuinely deferred. Blocked on 50+ rated conversations. Check `feedback_log` count before scheduling.

---

## #78 — Physical check PLC at 192.168.1.100

**Purely mechanical:** Physical site visit required. Power, Ethernet switch, cable check. PLC v3.1 program files ready on PLC laptop. Once reachable, deploy via Connected Components Workbench. No code value.

---

## #69 — Restart Nautobot on CHARLIE

**Purely mechanical:** All 5 containers exited (celery_beat=1, others=255) as of ~2026-03-27. Restart: `ssh charlie && cd ~/nautobot-docker-compose && docker compose up -d`. Diagnose `celery_beat` exit code 1 (likely DB migration or Redis connectivity). Not core to MIRA v1.

---

## #48 — Enforce frontend skill invocation before mira-web sessions

**Original idea:** Process gate — invoke the frontend skill before any `mira-web/` session to load component/SSE/Hono patterns into context. Missing this step caused rework. Memory source: `~/.claude/projects/.../memory/feedback_mira_chat_widget_skill.md` on BRAVO.

**Why it matters later:** This process insight applies broadly: any module with unusual patterns (Hono vs Express, SSE vs WebSocket, htmx vs React) needs a context-load step at session start. The specific skill may be obsolete (mira-web → mira-pipeline cutover ADR-0008), but the pattern is sound.

**Superseded by:** mira-web → mira-pipeline cutover pending (ADR-0008 Phase 4, issue #197). Once the cutover ships, mira-web is read-only.

---

## #81 — Expand social eval suite

**Original idea:** Expand from 20 scenarios to 30+ targeting specific edge cases: multilingual/ESL phrasing, angry/hostile user (MIRA stays calm and technical), overconfident junior (MIRA redirects without condescension), vague senior (MIRA asks for specifics, doesn't guess), conflicting signals ("quick question" + describes 3-day outage).

**Why it matters later:** These five archetypes cover real ICP interactions. The hostile/ESL scoring logic note is important — standard similarity scoring doesn't penalize hostility-matching the way a binary "stayed technical" check would. Files: `tests/benchmark/social_scenarios.json` (add entries), `tests/social_eval.py` (may need new scoring logic).

**Superseded by:** Sprint A VFD eval corpus + Karpathy eval alignment (ADR-0010) took priority. Social eval is still at 20 scenarios.
