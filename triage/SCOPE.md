# SCOPE — Linear Backlog Triage (Close-Only)

Branch: `chore/linear-triage-2026-05-15`
Worktree: `.claude/worktrees/tech-debt-cleanup`
Master plan: `/Users/bravonode/.claude/plans/clean-up-tech-debt-atomic-harbor.md`
Operator demo: 2026-05-21 — Florida Automation Expo (6 days from start).

## Scope IN
1. Linear team `Cranesync` only (no GitHub closes, no code changes).
2. Issues in Backlog/Todo/Unstarted only.
3. Close criteria (ALL must hold):
   - Not `Urgent` priority.
   - Project NOT `Demo Readiness — Florida Expo May 21` (`7ede293a-34a8-4690-bd1d-883500855a7b`).
   - Project NOT `Automation Tie-In` (`5455a2fe-7bec-4c69-bf78-864cb3c72683`).
   - Title/body has no demo-marker substring: `demo`, `expo`, `florida`, `2026-05-21`, `T-0..T-6`.
   - AND one match type:
     - **A** GH reference (`#NNN`, `[CRA-NNN]`, `issues/NNN`) — GH issue closed for ≥7 days.
     - **B** Stale low-priority — `updatedAt` > 90d AND priority Medium/Low AND no comment in 30d.
     - **C** Explicit duplicate marker in title — referenced GH closed.

## Scope OUT — STOP signals
- GitHub issue changes of any kind.
- Active branches: `feat/mvp-unit-9a-landing`, `feat/mvp-unit-4-exports`, `feature/mira-seo`.
- Any code file change.
- Prod systems (SSH, docker, nginx).
- CI workflows (#913).
- Linear delete (use Cancelled state, preserve history).
- Bulk action without per-issue close comment.

## Stop conditions
- >500 issues discovered → STOP, scope too big.
- AUTO_CLOSE count > 50 → STOP, human eyeball needed.
- AUTO_CLOSE count = 0 → STOP, criteria too tight.
- Filter leak (Demo Readiness or Automation Tie-In in AUTO_CLOSE) → STOP.
- 2 consecutive Linear API failures in Phase 4 → STOP, partial HANDOFF.
- Turn count > 150 → STOP, HANDOFF.

## Deliverables
- `triage/linear-snapshot.json`, `triage/gh-status.json`, `triage/age.json` (Phase 1)
- `triage/decisions.json`, `triage/REPORT.md` (Phase 2)
- `triage/closed-log.json` (Phase 4)
- `HANDOFF-linear-triage.md` (Phase 5 — separate filename to not overwrite existing HANDOFF.md)
