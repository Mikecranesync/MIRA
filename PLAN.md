# Autonomous Run Plan — MIRA Intelligence Contract, real-path proof

**Date:** 2026-09-22 (overnight, ≤5h) · **Branch:** `feat/mira-intelligence-contract`
**Base SHA (rollback point R0):** `c2c8e44cb` · **origin/main:** `ebde0ccf5`
**Worktree:** `.claude/worktrees/mira-contract-night`
**Prior work:** `docs/specs/mira-intelligence-contract.md`,
`docs/audits/2026-09-22-mira-persona-inventory.md`,
`docs/proofs/2026-09-22-mira-intelligence-contract-acceptance.md`

## Objective
Make the contract real on the phone/web chat paths and prove it on STAGING.
Not another audit, not a dormant flag.

## Product law (the test every change is judged against)
MIRA amplifies technicians through model intelligence, evidence, tools and
guardrails. Blank chat + question, optionally photos/files, with no project or
machine prerequisite. Manuals and Jev SUPPORT intelligence; they are not the
product.

## IN SCOPE — numbered, with success criteria

1. **Parameter speculation.** "Typically" must not launder an invented parameter
   identity, fault meaning, terminal assignment or exact setting. Withhold the
   unsupported specific, keep the useful general explanation.
   *Done when:* mode blocks updated; tests cover ≥4 distinct fabrication classes
   (parameter identity, fault-code meaning, terminal assignment, exact setting);
   A/B rerun shows no fabricated specifics and no loss of general usefulness.

2. **Mode routing.** Normal authenticated chat is **augmented** WITH or WITHOUT
   attached/selected documents. Attaching evidence is NOT consent to
   document-only answers. Strict cite-or-refuse (**grounded**) requires an
   explicit source-only request.
   *Done when:* notebook chat selects augmented by default; grounded only on
   explicit source-only intent; source authorization, citation entailment and
   machine-evidence boundaries all preserved; contract + tests updated.

3. **Trace UI → adapter → route → prompt → gates → rendered answer.** Fix the
   EARLIEST wrong decision, not the prompt text. Remove mandatory
   diagnostic/bullet/word-count templates. Context must report actual search
   results/skips/failures and never imply a tool ran when it did not.
   *Done when:* the trace is written down with file:line per hop; the earliest
   wrong decision is identified and fixed; template mandates removed.

4. **Ship to STAGING only.** Independent exact-head review + required CI, then
   merge and deploy the pinned SHA to staging and enable the flag THERE.
   *Done when:* deployed SHA recorded, staging flag on, container config
   verified, rollback preserved, **production flag OFF**.

5. **Proof.** Suites flag OFF/ON; full live staging retrieval acceptance; real-path
   cases (blank chat; photo+question and follow-up; irrelevant/empty attached
   sources still allow general help; citations; explicit source-only miss;
   unsupported specifics; hazards; tenant isolation; provider-fallback persona).
   Exercise changed branches, not lucky wording. Capture web + phone/emulator
   evidence, traces, prompt hash, model used.

## OUT OF SCOPE — do not touch
- **Production deploy or production flag enable.** Prod flag stays OFF.
- **OT / PLC / fieldbus writes** of any kind.
- **New services.**
- **Jev promotion** — Jev stays shadow-only. Do not edit Jev gating.
- **Secondary-route migration** — `assets/[id]/chat`, `namespace/node/[id]/chat`,
  `mira/ask`, `quickstart/ask`, `manual-rag.ts`, and the whole Python
  `mira-bots/` runtime stay on their current personas this run.
- Review/gate bypasses (`MIRA_SKIP_STOP_GATE`, `MIRA_ALLOW_PROD`, `--force`).
- Deleting any existing protection to make a test pass.

## Budget
Evaluation spend **≤ $1.00** total (prior run used $0.0071). Every paid lane
declares its bound before it runs and hard-stops at it.

## Coordination risk (checked, not assumed)
Open PRs **#3957** and **#3958** (Jev shadow) both modify
`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`, the same file item
2 rewrites — different region (semantic safety / chunk choice vs prompt
composition + mode selection). If either merges first, rebase onto it; do not
touch their Jev code. #3917 has no overlap.

## Rollback
R0 = `c2c8e44cb`. Every commit pushed to the branch. Staging rollback = redeploy
previous staging SHA and unset `MIRA_PERSONA_CONTRACT`.

## Stop conditions
All PLAN rows done · >70% budget · >200 turns · 5 turns on one failing test ·
architecture/security decision needed · any OUT-of-scope path required ·
remaining work human-gated → write HANDOFF once and stop.
