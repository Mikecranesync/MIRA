---
name: Paperclip Self-Hosted Instance — Status + Known Issues
description: Paperclip AI orchestration running on Charlie, auth broken for REST API
type: project
---

Paperclip v2026.325.0 running at http://localhost:3200 (also http://100.70.49.126:3200 via Tailscale).
Started via: `PORT=3200 npx paperclipai run --repair`
Data dir: `~/.paperclip/instances/default/`
Embedded Postgres on port 54329 (user: paperclip, db: paperclip).

**8 registered agents** (all using ollama/gemma4:e4b):
CEO (idle), CTO (paused), Channel Director (paused), Content Quality Reviewer (paused),
Backend Engineer (paused), Data Ingestion Engineer (paused), Research Agent (paused), Worker (paused)

**Known issue — REST API auth broken:**
`board_api_keys` and `agent_api_keys` tables are empty. Keys created in dashboard UI
do not persist to DB. Returns 401 on all Bearer token attempts.
Workaround: use `npx paperclipai auth login --api-base http://localhost:3200` (browser flow)
to get CLI credentials stored in `~/.paperclip/` config.

**Company ID:** `20de00e5-5a2b-42af-b4ef-a91bb7d82ae8`
**CEO agent ID:** `8aa3266b-c3e4-49f3-8e62-8a500cdaf665`

MIRA agent configs in `~/MIRA/paperclip/agents/` (6 agents: orchestrator/opus, 4x sonnet workers, haiku tester).
Paperclip is a dev orchestration tool only — not a MIRA production component.
