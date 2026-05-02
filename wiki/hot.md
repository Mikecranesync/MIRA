# Hot Cache — 2026-05-02 — CHARLIE

## Just Finished

- **Linear board fully operational** — Cranesync workspace, 3 projects (MVP Build / Sales & GTM / Ops & Infra), 15 issues (CRA-5 through CRA-19), all labeled with `user-action` / `agent-action`. All 4 custom statuses created (Shaping, Reviewed, Ready to Deploy, Pending Deployed). Board cleaned up: FactoryLM stale project cancelled, all 3 active projects set to In Progress.
- **Linear MCP plugin confirmed installed** — HTTP transport → `https://mcp.linear.app/mcp`. Config: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json`. Zero config changes needed.
- **YouTube transcript researcher skill shipped** — `tools/youtube_transcript.py` + global skill `.claude/skills/youtube-transcript.md`. Triggers when YouTube URL is pasted and WebFetch would fail.
- **Promo screenshots** — captured to `docs/promo-screenshots/` for video pipeline.
- **Memory snapshot committed** — `docs/memory-snapshots/2026-05-02/` + tag `memory-rollback-2026-05-02`.

## Machine State

- **CHARLIE (this machine):** `main` @ `4c90bf1` — memory snapshot + wiki update. YouTube transcript skill + promo screenshots at `3ede8ef`.
- **VPS:** last known `main` @ `eeb9a4b` (mira-bot-telegram) — not touched this session.
- **Alpha / Bravo:** no changes this session.

## Blocked

- **"In Review" status** — Linear Settings → Workflow → delete it manually. The API cannot manage workflow states; this default status conflicts with the custom "Reviewed". One-minute manual fix.
- **Eval FSM 77%** — CRA-8 (Ops & Infra). Same 13-failure cluster (engine.py + guardrails.py + active.yaml) has run 4 days without progress. Needs human triage — manual-lookup misroute is the highest-leverage fix.

## Next (any machine)

**All active work is tracked in Linear → linear.app/cranesync**

Quick orientation:
- `agent-action` issues = Claude can execute autonomously
- `user-action` issues = needs Mike
- Urgent/blocked: CRA-5 (SPF/DKIM DNS), CRA-6 (NEXTAUTH_SECRET to Doppler), CRA-8 (eval FSM fix)
- In-flight branches: `feat/mvp-unit-4-exports` (CRA-13), `feat/mvp-unit-9a-landing` (CRA-18)

---

## Recent Eval-Fixer Runs (context for eval debugging)

### eval-fixer run — 2026-05-02
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (stale for 4th day; no new run)
- Action: issue-filed (#918)
- Same 13-failure pattern as #884/#916 — engine.py FSM stuck (5) + guardrails/active.yaml content (8). Cluster spread blocks autopatch. Manual-lookup misroute first (3 fixtures get canned "documentation indexed" deflection instead of vendor URL + IDLE state). → **CRA-8 in Linear**

### eval-fixer run — 2026-05-01
- Scorecard: 44/57 passing (77%) — same stale scorecard
- Action: issue-filed (#916)

### eval-fixer run — 2026-04-30
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md`
- Action: issue-filed (#884)
- 13 failures spanning 3 files — exceeds single-file autopatch limit. FSM stuck (5), manual-lookup canned reply (3), cross-vendor RAG bleed (1), thin diagnosis (4).

### eval-fixer run — 2026-04-29
- Scorecard: 0/57 (0%) — stale scorecard, no new run
- Action: issue-filed (#854) — 3rd day of systemic infra failure

## Key NeonDB Facts
```
Total chunks: ~68,000+
Rockwell Automation: 13,686 chunks (main KB)
ABB: 931 chunks — mostly NULL model_number
Siemens: 905 (SINAMICS) + 442 (other)
AutomationDirect: 2,250 chunks (GS10, PF525, etc.)
Yaskawa: 27 chunks (NULL model) + 1 (CIMR-AU4A0058AAA)
Danfoss: 2 chunks (VLT FC302 only)
Mitsubishi Electric: 16 chunks (NULL model)
```
