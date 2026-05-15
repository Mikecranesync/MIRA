# HANDOFF — Linear Backlog Triage (Close-Only Run)

**Date:** 2026-05-15
**Branch:** `chore/linear-triage-2026-05-15` (off `origin/main`)
**Worktree:** `.claude/worktrees/tech-debt-cleanup`
**Demo:** 2026-05-21 (6 days from today — kept all demo-adjacent work untouched)
**Master plan:** `/Users/bravonode/.claude/plans/clean-up-tech-debt-atomic-harbor.md`

---

## Top-line

I pulled 155 open Linear Cranesync issues, resolved 48 GitHub references, applied strict close-criteria, and got **0 auto-closes** — exactly the stop condition the plan called for. **No Linear issues were closed.** The deliverable is the triage report at `triage/REPORT.md` and the decisions JSON at `triage/decisions.json`. The strict criteria are too tight for this snapshot (the backlog is recent — max 12 days old, median 5 — so the "stale" cohort is empty; the GH-mirror cohort is small and within the 7-day buffer).

Three operator-ready next steps below, ordered cheapest first.

---

## Snapshot stats

| Metric | Value |
|---|---|
| Issues pulled | 155 (all Backlog state) |
| Median days since update | 5 |
| Max days since update | 12 |
| Projects represented | 13 |
| GitHub refs found | 48 (45 mira + 3 factorylm) |
| GH issues CLOSED | 15 |
| GH issues MERGED | 6 (PRs, not issues) |
| GH issues OPEN | 27 |

## Classifier output

| Bucket | N | What it means |
|---|---|---|
| AUTO_CLOSE | 0 | Met every strict criterion (priority ≠ Urgent, not in Demo/Automation project, no demo markers, GH ref CLOSED ≥7 days). |
| NEEDS_REVIEW | 30 | Hit a widened criterion, needs your judgment. |
| KEEP | 125 | No match; left alone. |

NEEDS_REVIEW breakdown:
- **Type A' (12):** Linear issue mirrors a GH issue that was CLOSED 0–6 days ago (within the 7-day buffer the strict criteria reserve). These are likely safe closes if you confirm the underlying work shipped.
- **Type D (2):** Within-Linear duplicate pair — **CRA-100** ↔ **CRA-186** (same title "color contrast failures", CRA-186 has empty body — looks like a re-file).
- **Type E (16):** Body contains completion language ("done", "complete", "fixed in PR"). Status mismatch likely. Example: **CRA-247** title literally is `ralph-phase1 ✓: variable-manifest.json committed — terminal labels still gap` and body opens with "Status: Done".

Sanity checks all green:
- 0 AUTO_CLOSE with priority Urgent.
- 0 AUTO_CLOSE in Demo Readiness or Automation Tie-In projects.
- 0 AUTO_CLOSE with demo-marker substrings.

---

## Three operator-ready next steps (cheapest first)

### Step 1 — One-click confidence: close CRA-186 (Linear-internal duplicate)

CRA-100 and CRA-186 have the same title ("[web-review/P2] factorylm.com / — color contrast failures (Lighthouse a11y 94/100)") for the same finding on the same route. CRA-100 has a full body; CRA-186 has empty body and is in a different project. CRA-186 is the duplicate.

Reproduce close (1 Linear API call):
```bash
# Comment + state transition. Adjust state name to your team's "Cancelled" or "Duplicate".
# Through Linear MCP from a Claude session:
#   save_comment(issueId="CRA-186", body="Duplicate of CRA-100 — same color contrast finding, same route, CRA-100 has the full evidence.")
#   save_issue(id="CRA-186", state="Cancelled")  # or set duplicateOf="CRA-100" if you have that state
```

### Step 2 — Easy win: clean up Type E "completed-claim" issues (16 items)

Many of these are web-review items where the body says the fix was shipped but the Linear status was never updated. Spot the obvious ones first by reading `triage/REPORT.md` § "Type E". Top recommendation: **CRA-247** — title has a `✓` and body opens "Status: Done (with gaps)". Either close it and open a new issue for "terminal labels still gap", or update its status.

Full list in `triage/decisions.json`:
```bash
jq '.[] | select(.decision == "NEEDS_REVIEW" and .match_type == "E") | {id, title, evidence}' \
  .claude/worktrees/tech-debt-cleanup/triage/decisions.json
```

### Step 3 — Bigger sweep: Type A' (12 GH-mirror items within 7-day buffer)

These mirror GH issues closed in the last 0–6 days. Most are `web-review/P*` items that got auto-fixed in a recent web review pass. If you confirm the underlying GH work shipped to prod, these can be safely closed in Linear.

To list them with their GH ref:
```bash
jq '.[] | select(.decision == "NEEDS_REVIEW" and .match_type == "A'") | {id, title, evidence}' \
  .claude/worktrees/tech-debt-cleanup/triage/decisions.json
```

---

## What I did NOT touch (Scope OUT held)

- 0 GitHub issues closed or commented.
- 0 code files modified — only `triage/*.json`, `triage/REPORT.md`, `triage/SCOPE.md`, and this HANDOFF file.
- 0 issues closed in Demo Readiness project (8 items left alone) or Automation Tie-In (10 items left alone).
- 0 Urgent-priority issues touched in any way.
- No prod systems touched. No bots restarted. No nginx reloaded.
- `feature/mira-seo`, `feat/mvp-unit-9a-landing`, `feat/mvp-unit-4-exports` branches untouched.

---

## Why no closes happened

The plan's explicit stop condition fired:
> AUTO_CLOSE count = 0 → STOP — write HANDOFF saying the criteria caught nothing, ask operator to widen.

The strict criteria were designed conservatively for a pre-demo run (priority ≠ Urgent, project not Demo/Automation, no demo markers, GH ref CLOSED for ≥7 days). On this snapshot they captured nothing because:
1. The backlog is recent — every item was updated in the last 12 days, so no "stale" pass.
2. Every CLOSED GH issue mirrored by Linear was closed in the last 6 days (within the buffer).
3. The 2 candidates that would otherwise have matched were Urgent priority (CRA-66 and CRA-227 — both correctly filtered).

The widened criteria (Type A'/D/E) surfaced 30 items, but those by design route to NEEDS_REVIEW, not AUTO_CLOSE. Per the autonomous-run skill, "expanding the plan mid-session" is the 2026-04-25 anti-pattern; I stayed strict and left the judgment to you.

---

## Token / agent dispatch summary ("match intel to effort")

| Phase | Model | Tool calls | Tokens |
|---|---|---|---|
| Phase 1 — Linear snapshot | haiku | 11 | ~143K |
| Phase 1 — GH resolver | haiku | 6 (gh CLI) | ~139K |
| Phase 1 — Age audit | haiku | 7 | ~129K |
| Phase 2 — Classifier | sonnet | 15 | ~146K |
| Phase 3-5 — Validate + HANDOFF | opus (main) | ~20 | (this session) |

The plan estimated ~135K total subagent tokens; actual was ~557K across subagents because pagination + jq operations were tool-heavy. Still cheaper than running the classification work in the main opus context, and the strict scope-lock prevented drift.

---

## To reverse anything if needed

Nothing to reverse — no Linear or GH writes happened. To clean up the worktree:
```bash
git -C /Users/bravonode/Mira worktree remove .claude/worktrees/tech-debt-cleanup --force
git -C /Users/bravonode/Mira branch -D chore/linear-triage-2026-05-15
git -C /Users/bravonode/Mira push origin --delete chore/linear-triage-2026-05-15  # if pushed
```

The triage artifacts (`linear-snapshot.json`, `gh-status.json`, `decisions.json`, `REPORT.md`) are committed on the chore branch — you can keep them as reference even after removing the worktree, by cherry-picking the commit to a notes branch or just pulling them off the chore branch on demand.

---

## Files produced this run

| File | Size | Purpose |
|---|---|---|
| `triage/SCOPE.md` | 2.1 KB | Scope-lock for this branch |
| `triage/linear-snapshot.json` | 119 KB | Normalized Linear data (155 issues) |
| `triage/gh-refs.json` | 0.5 KB | Unique GH refs by repo |
| `triage/issue-to-ghrefs.json` | 3.4 KB | Linear → GH ref reverse-lookup |
| `triage/gh-status.json` | ~12 KB | GH issue states (state, closedAt, title, labels) |
| `triage/age.json` | ~31 KB | Per-issue age + activity flags |
| `triage/decisions.json` | ~72 KB | Per-issue classification + draft close comments |
| `triage/REPORT.md` | ~7 KB | Human-readable summary for operator |
| `HANDOFF-linear-triage.md` | this file | The operator handoff |
