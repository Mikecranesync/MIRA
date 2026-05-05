## eval-fixer run — 2026-05-05
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (same stale scorecard as 2026-05-04)
- Action: no-op — duplicate of yesterday's run, existing issue #985 still open
- Hard-stop: same 13 failures, same 3 file clusters (engine.py + guardrails.py + active.yaml). No fresh eval has run for 6 days. Need to either re-run the judge eval or merge a fix on issue #985.

## eval-fixer run — 2026-05-04
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md`
- Action: issue-filed (#985 — added to Kanban)
- Hard-stop: 13 failures span 3 file clusters (engine.py + guardrails.py + active.yaml). Top pattern: manual-lookup intent returns canned "already indexed" deflection instead of OEM URL across Danfoss/Mitsubishi/Siemens fixtures. Also: MANUAL_LOOKUP_GATHERING state leaking into non-manual fixtures, and Yaskawa content bleeding into Danfoss diagnosis (RAG cross-vendor leak).

---

# Hot Cache — 2026-05-03 — CHARLIE

## Session — 2026-05-03 (CHARLIE, Marketing Director audit)

**What was done:**
- Full marketing audit: MIRA + FactoryLM repos, Linear board (Cranesync), all open PRs
- **PR #941 merged** — competitor analysis refresh (COMPETITOR_ANALYSIS.md)
- **PR #927 merged** — gitignore audio/video outputs in marketing/videos
- **PR #945 opened** — Unit 9a landing page rewrite (feat/mvp-unit-9a-landing) — 1,516-line index.html, three features above fold, $97/mo pricing
- **PR #946 opened** — LinkedIn 6-part series + warm outreach DM templates (feat/marketing-content-clean)
- **feature-cartoons.js** — already on main via PR #931, no action needed
- **PR #790** — promo director playbook v1.0.0 — CI re-triggered (pushed YAML change), pending pass

**New files:**
- `marketing/content/linkedin-series-2am-vfd-problem.md` — 6 posts, weekly from 2026-05-10
- `marketing/content/warm-outreach-dm-templates.md` — 6 DM templates + tracking sheet

**Critical path (first paid demo May 4):**
- Unit 9a: PR #945 open, CI pending, needs Lighthouse ≥90 + Stripe test charge
- Unit 2 (citations): CRA-11, branch feat/mvp-unit-2-citations — TODO
- Unit 6 (hybrid retrieval): CRA-15 — TODO

## Next Actions (2026-05-03 priority order)

1. **Merge PR #790** — watch CI on feat/promo-director-playbook; merge when lint green
2. **Merge PR #946** — markdown-only, CI will skip, can merge now
3. **Merge PR #945** — needs Lighthouse ≥90 + Stripe test charge
4. **Start LinkedIn Post 1** — schedule "The 2 AM Call" for Tue 2026-05-10, 7-9 AM Eastern
5. **HubSpot API key** — add `HUBSPOT_API_KEY` to Doppler `factorylm/prd` to unlock 330-prospect import
6. **Unit 2 + 6** — needed for first paid demo May 4

---

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

### eval-fixer run — 2026-05-03
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (stale for 5th day; no new run)
- Action: issue-filed (#932)
- Same 13-failure pattern persists. Issue groups failures into Cluster A (FSM, 5) and Cluster B (keyword/content, 8) with B1–B4 sub-patterns. B1 (manual-lookup canned "I already have documentation indexed" deflection, 4 fixtures) flagged as highest-leverage fix in `engine.py`. → **CRA-8**

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
