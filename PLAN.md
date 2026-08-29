# Autonomous Run Plan — PR #3481 Gate 9 Gap Closure

**Date:** 2026-08-29  
**Branch:** `fix/pr3268-gate9-gaps`  
**PR:** #3481, follow-up closure for PR #3268 / CU-03  
**Operator:** Claude Code, actively supervised and independently verified by Codex

## Objective

Close every sustained Gate 9 finding against PR #3268 through PR #3481, prove the
Gate 7 calibration mechanism is structurally fail-closed, preserve an honest evidence
record, and leave the PR green and reviewable. Do not merge it.

## Numbered scope

1. **Finish the Gate 7 contract fixes**
   - Remove the contradiction between “re-run at most once” and “Gate 7 has no round cap.”
   - Preserve every malformed attempt and require fresh calls until a valid verdict exists.
   - Treat a BLOCK with no parsed finding as UNKNOWN.
   - Require the strict adjudication shape promised by the prompt and doctrine: exactly one
     `## VERDICT` and one `## RULINGS`, with the verdict computed from identity-matched rulings.
   - Lock these properties with deterministic tests and mutations.

2. **Obtain honest fresh Gate 7 closure on the final code head**
   - Commit and push root fixes before reviewing them.
   - Run complete docs and code scopes with receipts and no diff truncation.
   - Preserve malformed attempts without widening parsers or imposing an attempt cap.
   - Root-fix sustained findings and freshly review the new head; rebut only false findings
     with verbatim visible evidence and fresh adjudication on the unchanged head.

3. **Complete the audit record and visible GitHub communication**
   - Keep every review, crash/malformed log, rebuttal, adjudication, and receipt tracked.
   - Update CU-03, its evidence README, PR #3481 body/comments, PR #3268 closure comments,
     and issues #3482/#3483 so all claims match the final head and live evidence.

4. **Verify the implementation independently**
   - Run the Gate 7 lane suite, focused crawler/OEM/tenant/provenance suites, architecture
     checks, allowlist check, formatting/lint, secret scan, and the documented mutations.
   - Run commands without pipelines that can hide an exit code.
   - Inspect the final diff for scope drift and evidence omissions.

5. **Verify final-head CI and hand off**
   - Wait for every required GitHub check on the final pushed SHA.
   - Write `HANDOFF.md` with exact head, tests, mutations, Gate 7 outcomes, CI, residuals,
     visible links, and reproduce commands.
   - Commit and push the handoff; leave the PR unmerged for the human Gate 9 decision.

## Explicitly out of scope

- Merging PR #3481 or PR #3268.
- Marking the convergence backlog DONE, release/tag work, or worktree cleanup.
- Starting CU-04 or any later convergence unit. CU-04 is already recorded as completed.
- Production deploys, production mutations, hardware actions, or secret changes.
- Product features, unrelated refactors, or edits outside the files already touched by #3481,
  except this task-specific `PLAN.md` and `HANDOFF.md`.
- Weakening Gate 7 parsers, reducing review scope, waiving a valid BLOCK, or treating UNKNOWN
  as PASS/BLOCK.

## Success criteria

- The doctrine, command, implementation, and tests agree on a no-cap, fail-closed protocol.
- Both final-head review groups have valid structural outcomes; every high finding is either
  root-fixed and freshly reviewed or REFUTED by a valid identity-matched adjudication.
- All affected deterministic tests and mutations pass with independently captured exit codes.
- Every evidence artifact claimed by the records is tracked at the exact final head.
- Required CI is green on the exact final SHA; non-required failures are precisely classified.
- PR/issue comments are visible and honest, `HANDOFF.md` is complete, and no merge occurs.

## Hard stops

- A fix requires an architecture, security, or product-policy decision not already established
  by the Gate 7 doctrine or the user’s instructions.
- A required provider is externally unavailable and no configured independent reviewer can run.
- Five consecutive turns make no progress on the same deterministic failure.
- The stop gate blocks the same gate twice, or work would cross the explicit out-of-scope list.
- The only remaining action is human Gate 9 approval or merge.

## Coordination evidence

- Worktree is isolated at `.claude/worktrees/pr3268-gate9-gaps` on the feature branch.
- PR #3481 is the visible ownership marker for this exact branch.
- `git fetch origin main`, the ten-commit log, and the open-PR scan were run on 2026-08-29;
  no other open branch owns this CU-03/Gate 7 closure.
- `.claude/settings.json` wires SessionStart, PreToolUse, PostToolUse, and Stop hooks, including
  `prod-guard.sh` and `stop-gate.sh`; production/stop-gate override variables are unset.
