# Patch: 3rd proposal-state-drift canary check (reverse drift)

**Target:** `origin/main` (deploy truth) — `tests/canary/proposal_state_drift.sql`
**Closes:** the open "next action" on Lens B — *"Confirm the 3rd canary check (verified-proposal→stale-suggestion) exists."* It does not; this adds it.
**Risk:** ZERO runtime risk. Pure additive detective control (a read-only SELECT in a nightly canary). No app/engine code path touched.

## Why
ADR-0017 has three status projections. PR #1845's `applyHubProposalTransition()` keeps `relationship_proposals` + `ai_suggestions` in lockstep on the **Hub** path. But the **engine** helper `mira-bots/shared/proposal_transition.py` writes `relationship_proposals.status` and **disowns `ai_suggestions`** (see its L7-8 docstring). Since `mira-hub/.../api/proposals` GET now **reads `ai_suggestions`** (×6, PR #1845), an engine-triggered accept/reject/supersede can surface a stale `pending` suggestion for a proposal that is already terminal — a user-visible review-state "lie" in the admin queue. The existing 2 canary checks are forward-direction only and are blind to it.

The new check excludes the `flag_review`→`reviewed` and `contradict`→`contradicted` triggers, which map to `aiSuggestion='pending'` **by design** (would otherwise false-positive). It only flags `verified`/`rejected`/`deprecated` proposals whose paired suggestion is still `pending`. Legacy-safe: joins on the explicit `extracted_data->>'relationship_proposal_id'` link.

## Apply
```bash
cd <MIRA repo>
git fetch origin main && git checkout -b fix/canary-reverse-drift origin/main
git apply -p1 wiki/orchestrator/patches/2026-06-10-canary-reverse-drift-check.patch
git add tests/canary/proposal_state_drift.sql
git commit -m "test(canary): add ADR-0017 reverse-drift check (terminal proposal vs stale pending suggestion)"
```

## Verify (before opening PR)
```bash
# 1) file now has 3 @check blocks
grep -c '@check:' tests/canary/proposal_state_drift.sql   # expect 3
# 2) run the canary harness against STAGING (never prod) — expect 0 offending rows on healthy data
python3 tests/canary/run_proposal_canary.py               # uses NEON_STG_DATABASE_URL
# 3) the nightly workflow picks it up automatically (.github/workflows/proposal-state-canary.yml runs the whole file)
```

## Founder-gated follow-up (NOT in this patch)
The detective control catches the drift; the **preventive** fix is to make `proposal_transition.py` project engine-triggered terminal transitions onto `ai_suggestions` too (mirror of the TS helper). That edits the live engine write path → founder/CI-gated, separate PR. This canary should land first so the follow-up has a regression guard.
