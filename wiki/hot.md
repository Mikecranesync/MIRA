# Hot Cache — 2026-04-16 — CHARLIE Node (MES Track Kickoff)

## Just Finished
- Created MES track issues #327–#330 (Week 1 MQTT, Week 2 ISA-95, cross-session memory, ADR-0012)
- Created label `mes-track` on Mikecranesync/MIRA
- Created `docs/mes-architecture-adr-0012` branch with ADR-0012 + mes-stack-diagram.md
- PR in progress for ADR-0012 docs

## MES Track Overview (Walker Reynolds UNS Framework)
Full architecture decision: `docs/adr/0012-mes-architecture-walker-uns-framework.md`
Stack diagram: `docs/architecture/mes-stack-diagram.md`

| Issue | Week | What | Status |
|-------|------|------|--------|
| #327 | Week 1 | Mosquitto MQTT broker + UNS topic schema | OPEN |
| #328 | Week 2 | ISA-95 asset namespace + NeonDB registry | OPEN |
| #321 | Week 3 | OEE calculator service (60s tick) | OPEN |
| #322 | Week 4 | Work order CRUD + scheduling model | OPEN |
| #323 | Week 5 | Downtime tracking (auto + manual + NLP) | OPEN |
| #324 | Week 6 | Atlas CMMS bidirectional sync | OPEN |
| #325 | Week 7 | Open WebUI fleet OEE dashboard | OPEN |
| #326 | Week 8 | MES integration test suite | OPEN |
| #329 | Cross | Cross-session equipment memory | OPEN |
| #330 | Cross | ADR-0012 tracking issue | OPEN |

## Eval Status (2026-04-15 v0.8)
- **Score: 8/56 (14%)** — FAR below 40/56 target
- FSM stuck in IDLE across nearly all scenarios — `cp_reached_state` failing everywhere
- Only 2 perfect: `safety_escalation_06`, `pilz_manual_miss_11`
- Root cause: FSM state transition bug (engine not advancing past IDLE)
- PR #297 (training loop): DO NOT merge — eval regression, not improvement

## Current Branch (CHARLIE/MIRA)
- `docs/mes-architecture-adr-0012` — ADR + stack diagram, ready to push + PR
- `feat/training-loop-v1` — main MIRA repo branch, 6 commits ahead of main

## PR Triage Needed
- **PR #279** — CONFLICTING — Atlas CMMS work orders (rebase needed)
- **PR #281** — CONFLICTING — Vendor coverage data (rebase needed)
- **PRs #315, #316, #317** — Lint fail, feature freeze violations → label `post-5-users` + close
- **PR #297** — Training loop: eval is 8/56 (FAIL, threshold was 40/56) → DO NOT merge, needs FSM fix first

## Machine State
- **CHARLIE (192.168.1.12):** MIRA repo on feat/training-loop-v1, pensive-williams worktree on docs/mes-architecture-adr-0012
- **Qdrant** :8000 running
- **SCADA stack** 4 Docker containers running (factorylm-modbus/plc/diagnosis/hmi)
- **Nautobot** :8443 running (Colima)

## Next Actions
1. Push `docs/mes-architecture-adr-0012` + open PR (this session)
2. Add all 4 new issues to project board
3. Fix FSM IDLE regression (eval 8/56 → target 40/56) — new issue needed
4. Rebase PR #279 + #281 onto main
5. Close #315 #316 #317 as post-5-users
