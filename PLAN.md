# Autonomous Run Plan — Baseline Defect Discovery & Remediation

**Date:** 2026-09-13 (overnight)
**Branch:** `evals/baseline-testing-standard` (PR #3760)
**Base:** `origin/main`
**Tested SHA:** `f06922ac6` (deployed prod) / eval scripts at branch HEAD
**Goal doc:** `~/Downloads/FactoryLM Baseline Defect Discovery and Remediation Goal.md`
**Policy:** `evals/BASELINE_TESTING_STANDARD.md`
**Device:** Pixel 9a `55081JEBF07026`, build com.factorylm.mira 1.1.0(10), our debug cert.

## Objective
Exhaust the currently-runnable baseline until no untriaged failures remain. Loop:
TEST → EVIDENCE → TRIAGE → ISSUE → FIX → PR → RE-TEST → EXPAND. Convert what the
baseline discovers into reproducible tests, tracked GitHub issues, and evidence-backed
fixes — not merely a greener score.

## In-scope (numbered)
1. **Re-run technician + safety cases at full embedding coverage.** Poll the eval notebook
   until its manuals are chat_ready with high coverage; re-run all 40 cases; re-judge.
   Success: fresh `evals/results/<run>/` with grounded_correctness reflecting real coverage.
2. **Triage every failure by evidence** into: PRODUCT / SAFETY / GROUNDING-CORPUS /
   TEST-RUBRIC / JUDGE / ENV-INFRA. Success: each of the 30+10 cases has a written
   classification; safety FAIL cases individually adjudicated (dangerous vs missing-framing).
3. **Durable issues for confirmed defects.** Search first; create focused GitHub issues with
   reproduction, expected/actual, SHA, severity, evidence, acceptance criteria. Success:
   every confirmed distinct defect has an issue number.
4. **Judge/rubric correctness pass.** Determine whether the safety judge conflates
   "missing NFPA 70E framing" with "actively dangerous" (advisor flagged safety-05 as a
   probable FP). If the judge is demonstrably miscalibrated, fix the rubric/judge as a
   *documented* change and RE-RUN (never override a run). Success: a documented judge
   decision + re-run, or evidence the judge is correct as-is.
5. **Run the remaining product-parity workflows on the Pixel** (wf-06,07,08,10,11,12,13,14)
   + the Golden Conversation end-to-end. Success: product.json finalized 15/15 with real
   device evidence, or honest NOT RUN with a concrete blocker per item.
6. **Architecture-drift check** must pass (already green — re-confirm at HEAD).
7. **Focused fix PRs** for confirmed TEST/RUBRIC/JUDGE/GROUNDING defects that are safely
   fixable in-session (eval harness + case corpus are ours to fix). Each PR: regression
   coverage, failing-before evidence, prove-at-head, re-run affected cases.

## OUT-of-scope (do NOT touch)
- **Product-code fixes to MIRA's safety/answer behavior** (mira-bots engine, prompts,
  guardrails). A SAFETY/PRODUCT DEFECT gets a durable ISSUE with evidence — the *fix* is a
  separate reviewed slice, not an overnight change to the diagnostic engine. Scope here is
  the eval regime + corpus + issue-filing.
- Migrations, `mira-hub/db/**`, guarded legacy UI trees, `packages/factorylm-ui/**`
  product code, `.github/workflows/**`.
- Merging/deploying anything. No push to main/develop/dev. No prod psql/SSH/OTA.
- The 3 uncommitted android build-sync files (`capacitor.build.gradle`,
  `capacitor.settings.gradle`, `gradlew`) — local artifacts, never staged.

## Success criteria (goal COMPLETE)
- Every runnable baseline test executed at the best-available corpus coverage.
- Every failure explained + classified.
- Every confirmed product/safety defect has a GitHub issue.
- Every in-scope (harness/corpus/judge) defect has a PR with regression evidence.
- Reruns expose no untriaged failures.
- Remaining NOT RUN/BLOCKED items have concrete external blockers + GitHub tracking.

## Hard stops → write HANDOFF.md
- Any OUT-of-scope path would need editing → stop, file issue, handoff.
- A product/safety fix is genuinely required (engine behavior) → issue + handoff (human-gated).
- Device becomes unavailable / not foreground / another app in front.
- 5 consecutive turns stuck on one failure.
- Token budget > 70% or turn count > 200.
- Judge recalibration would *flip* the safety gate to PASS → that's the tell it's weakening
  the test; stop and handoff for human review.

## Evidence & etiquette
- Real device only; check `mCurrentFocus` before every tap batch; restore rotation at end;
  one clearly-named test notebook; never delete tenant data.
- Every result keyed to exact SHA. No PASS from partial execution (§10.1).
- Commit every 20–30 turns; push to this branch only.
