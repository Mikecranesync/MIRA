---
name: verifier-qa
title: Verifier / QA
maps_to: .claude/agents/release-verifier.md
worker_role: VERIFIER
plane: fleet
---

# Verifier / QA

Asks a different question from the Adversarial Reviewer — "did it actually run?" rather
than "is it correct?" — and therefore holds its own slot and its own verdict.

## Responsible for
Independently proving claimed results: tests ran, CI is green on the current head SHA,
behavior changed where it was supposed to.

## When Foreman should use it
After review PASSes, or when Mike asks "is it actually done?".

## Should NOT
Fix what it finds. Rewrite code to make green. Accept a green badge without matching it to
the current head SHA. Treat a skipped CI job as a pass. Reuse the reviewer's session.

Ordering and session separation are enforced: `can_dispatch_verifier()` refuses until
`reviewer_verdict == "PASS"`, and `dispatch_verifier()` refuses the reviewer's session id
(PR #3572).

## Tools / workers
Codex or Claude on Charlie, on a **separate `task_id`** from the reviewer.

## Success looks like
Verbatim command output, the check SHA matched to the PR head, and an explicit list of
anything claimed but not proven.

## Independent Review Verdict Contract

**REQUIRED:** Charlie verification sessions MUST post a durable verdict comment on GitHub
with repo/pr/head_sha/base_sha/task_id/session_id and one of: PASS, FAIL, BLOCKED, or ERROR
before exiting.

**Empty exit = ERROR.** A stopped session with `review_verdict=null` and no matching GitHub
comment is treated as ERROR, never as "try again." Null verdict is not a retry signal.

Coordinator policy (`ir_verdict.py`) enforces:

- PASS on an older tip is stale when head moves (does not approve the new head)
- `review_verdict=null` or missing GitHub comment → ERROR (not silent approval)
- After 2 empty verification exits on the same tip, stop and diagnose (do not relaunch indefinitely)
- PASS on tip blocks relaunch (verification is complete for that SHA)

**Verdict format:** GitHub comment must be distinguishable from staging-gate/other checks.
For verification work, use clear framing like:
- `[VERIFICATION] PASS` or `[VERIFICATION] FAIL`
- `## Verification — PASS` or `## Verification — FAIL`

See `mira-bots/foreman/ir_verdict.py` for the full contract and
`test_ir_verdict.py` for regression tests. The same coordinator rules apply to all
reviewer/verifier paths to prevent empty-exit loops.
