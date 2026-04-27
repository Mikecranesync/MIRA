# PLAN — tech-debt/hub-ux-fixes-2026-04-26

**Date queued:** 2026-04-26 21:07 UTC
**Operator:** Mike
**Branch:** `tech-debt/hub-ux-fixes-2026-04-26`
**Worktree:** `.claude/worktrees/tech-debt-hub-ux-2026-04-26`
**Baseline tag:** `pre-tech-debt-hub-ux-2026-04-26-2107`
**Wall-clock budget:** 3 hours (hard stop ~0007 UTC)
**Session model:** Cowork (NOT Claude Code) — Stop hook does NOT fire automatically; operator-side discipline only

---

## Goal (one sentence)

Ship five customer-visible mira-hub UX bug fixes from the open-issue list as five independently-revertable commits, leaving a clean HANDOFF.md so Mike can review and push tomorrow morning.

## In scope — execute in this order, STOP after #5

| # | Issue | Fix | Files (verified to exist) |
|---|-------|-----|---------------------------|
| 1 | **#688** P1 | WO wizard step 1 button: replace "Save" with step-appropriate label ("Next" / "Continue") matching the existing 3-step pattern | `mira-hub/src/app/(hub)/workorders/...` (locate via grep before edit) |
| 2 | **#719** P1 | Overdue WO red flag in WO list: due-date text in `#DC2626` + small "Overdue" pill when `due_date < now()`. Reuse the token from `mira-hub/src/app/(hub)/schedule/page.tsx:36` (`#DC2626` / `#FEE2E2`) | `mira-hub/src/app/(hub)/workorders/page.tsx` (or its list-row component) |
| 3 | **#720** P2 | KB empty-state: when `totalDocs === 0`, replace the "0 chunks in RAG" stat line with onboarding copy ("Upload your first manual to start getting source-cited answers from MIRA.") | `mira-hub/src/messages/en.json` + `mira-hub/src/app/(hub)/knowledge/page.tsx` (sticky-header `<p>` conditional) |
| 4 | **#721** P2 | Assets empty-state copy: don't show "Try a different search or filter" on a fresh tenant with zero assets — show first-asset-add CTA instead | `mira-hub/src/messages/en.json` + `mira-hub/src/app/(hub)/assets/page.tsx` |
| 5 | **#722** P2 | Upload picker: when cloud-source buttons (Google Drive, etc.) are disabled, show tooltip/hint explaining why (e.g., "Connect Google Drive in Integrations to enable") | upload modal component + en.json |

## Explicitly OUT of scope (do NOT touch)

- `mira-web/` — anything in this dir. **`mira-web/public/index.html` is in flight on `feat/mvp-unit-9a-landing` (agent-claude, started 2026-04-25 20:30 UTC).**
- The 14 overnight branches from 2026-04-25 (`agent/issue-*-0405`, `agent/p2-batch-*`, etc.) — they need a dedicated cleanup pass with the security checklist applied; this session is not it.
- Any auth / RLS / crypto / SAML / SSO code. Per `mira_security_checklist` operator memory, those are not autonomous decisions.
- Python / backend code in `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, etc.
- New features. This is tech-debt cleanup, not feature work.
- `CLAUDE.md`, top-level `README.md`, `docs/plans/*`.
- Node module installs, `package.json` changes, lockfile rewrites — too high blast radius for this slot.
- The other 95 open issues. Five fixes only — no scope creep.

## Per-task gates (run before commit)

For each fix:
1. The issue's referenced file actually exists at the expected path.
2. Edit confined to the issue's stated change — no drive-by refactors.
3. `cd mira-hub && npx eslint <changed-files>` clean (lint).
4. `git diff` reviewed: no unrelated changes, no console.logs, no debug artifacts.
5. Commit with conventional format including `Closes #N` and a `Rollback:` line in the body.

## Final gates (before "done" / writing HANDOFF)

1. All 5 commits present, in order, each closing exactly one issue.
2. `cd mira-hub && npx eslint .` clean across full changed set.
3. `git log --oneline pre-tech-debt-hub-ux-2026-04-26-2107..HEAD` shows exactly 6 commits (5 fixes + 1 PLAN.md).
4. `git diff --name-only pre-tech-debt-hub-ux-2026-04-26-2107..HEAD` shows zero files outside scope.
5. HANDOFF.md written and committed as the final commit.
6. Post-session note in HANDOFF: **operator must run `cd mira-hub && npm run build` on Mac before merging** (sandbox can't due to FUSE/.next).

## Stop conditions (any one → write HANDOFF, stop)

- All 5 fixes complete.
- Wall-clock 3 hours hit (~0007 UTC).
- A fix needs >30 min of real work → commit what's done as `wip(hub):`, mark fix "deferred" in HANDOFF, move to next.
- Lint fails twice on the same file with no clear fix path.
- A fix would touch an OUT-of-scope path (e.g., turns out the fix lives in an api route or a package.json — STOP, document in HANDOFF, move on).
- Any unexpected SECURITY or AUTH adjacency surfaces (e.g., issue body said "UX" but the code path is in an auth middleware) — STOP, document, move on.
- 5 consecutive failed attempts at the same fix.

## Rollback procedure

```bash
# Revert a single fix by SHA (commit messages include exact rollback line):
git -C .claude/worktrees/tech-debt-hub-ux-2026-04-26 revert <sha>

# Revert ALL fixes back to baseline (nuke the branch's progress):
git -C .claude/worktrees/tech-debt-hub-ux-2026-04-26 reset --hard pre-tech-debt-hub-ux-2026-04-26-2107

# Drop the whole branch + worktree:
git worktree remove --force .claude/worktrees/tech-debt-hub-ux-2026-04-26
git branch -D tech-debt/hub-ux-fixes-2026-04-26
git tag -d pre-tech-debt-hub-ux-2026-04-26-2107   # optional
```

## Sandbox limitations (operator must do these on Mac)

- `git push` — sandbox FUSE blocks `.git/index.lock` reliably enough that pushes fail. Operator pushes from Mac.
- `cd mira-hub && npm run build` — FUSE blocks `unlink` on `.next/.fuse_hidden*`. Operator runs full build on Mac before merge.
- Playwright e2e — same `.next/` issue. Operator runs.

In-sandbox verification we WILL run: `npx eslint`, `npx tsc --noEmit` (if applicable), and visual diff review.

## When this PLAN is done

Final commit will be `docs(handoff): tech-debt/hub-ux-fixes-2026-04-26 session complete` containing HANDOFF.md. Operator's morning checklist is in HANDOFF.md.
