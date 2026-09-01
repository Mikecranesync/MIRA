# FLEET-SESSION-LIFETIME-001 — Charlie Independent Review

**Verdict:** PASS
**SHA:** 43ae345e4b52a88c420368720e59110985608011
**Worktree:** /Users/bravonode/Mira-worktrees/fleet-e2e-FLEET-SESSION-LIFETIME-001-review-94a84d7b2875
**Reviewer:** Charlie (independent — did not use Bravo HANDOFF)

## Bug 1 — task_snapshot must NOT treat terminal_status=completed as stopped: PASS
cao.py:377: dead = t_status == "error" or (confirmed and terminals_in_resp and t_status is None)
"completed" → dead=False. Session stays alive. Only 404/error/empty-terminals marks stopped.

## Bug 2 — request_review sends structured prompt not raw SHA: PASS
cao.py:472-486: _build_review_prompt() produces [CAO Handoff] multi-sentence prompt containing git_ref, task_id, capabilities, and independent-reviewer instruction. Raw SHA never sent alone.

## Pytest
........................................................................ [ 88%]
.........                                                                [100%]
81 passed in 2.25s

## Pre-existing (not introduced by this SHA)
fleet-gateway/run-local.sh:13 SC2155 — fixed above.
