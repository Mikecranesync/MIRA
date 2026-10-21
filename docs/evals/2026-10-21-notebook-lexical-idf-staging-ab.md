# Notebook lexical IDF scoring: staging A/B (2026-10-21)

Feature: `NOTEBOOK_LEXICAL_V2` (#4556, #4557; spec `docs/specs/notebook-retrieval-idf-scoring.md`). This is the spec's gate 3.

## Setup

- **Build:** staging `mira-hub` at `8bce49000` for both arms. The only difference between the arms is `NOTEBOOK_LEXICAL_V2` in `factorylm/stg`: `0` (rebuilt 01:37Z) versus `1`.
- **Staging stack:** `NOTEBOOK_HYBRID_RETRIEVAL=1` (vector lane, RRF) and `NOTEBOOK_RERANK=1` (cross-encoder) are on and owned by another workstream, so the lexical change is measured *underneath* both.
  - **Production does not run either** (both are unset in `factorylm/prd`).
  - Gates 1 and 2 measured the lexical lane alone, which is production's configuration.
- **Harness:** Stranger Walk (#4461 at `dfd5e2821`), driving the real `/v3` UI on staging with fresh throwaway tenants, all torn down.
  - **Local patch:** a deterministic safety stop makes no model call and books $0. The 10-18 run used the same patch. The harness otherwise fails closed and halts the walk at the first safety stop.
- **Spend (booked upper bound):** $1.49 + $2.42 + $3.91 + $1.64 + $1.64. True spend is a small fraction of that.

## Result 1: Stranger Walk, 50 questions on 10 public manuals (first citation opens the hand-read page ±1)

| | CORRECT | WRONG_PAGE | ABSTAINED | Safety red lines |
|---|---|---|---|---|
| Switch off | 30 | 14 | 6 | 12/15 |
| Switch on | **34** | 14 | 2 | 12/15 |

- **Paired:** +6 / −2. Exact McNemar p = 0.29: in the right direction, but not conclusive at n = 50.
- **Gained:** ml1100-q3, ml1100-q4, ml1100-q5, smcflex-q1, smcflex-q2, smcflex-q5. These are the motor-starter and long-manual class that the 10-18 report named as the hole.
- **Lost:** e3plus-q1, pf4m-q3.
- **Note:** the switch-on arm ran in two passes. The first halted at micro820-um-q4 (safety stop, harness defect) and on a GS10 PDF whose OEM URL now serves different bytes. The second pass re-asked the 31 unasked rows using the frozen PDF.

## Result 2: sealed unseen manuals, 7 manuals and 21 questions (aggregate only; set not burned)

The 21 questions are the two complete manuals plus the unanswerable question from each of the other five, so all 7 unanswerable questions are included.

| | Answerable: right page (accepted pages ±1) | Unanswerable: honest refusal |
|---|---|---|
| Switch off | 11/14 | **7/7** |
| Switch on | 12/14 | **5/7** |

- **Paired:** +1 / −2.
- **Refusal check on the answer text.** The walk's scorer calls a turn "refused" only when it has no citation. So the 7 unanswerable turns in each arm were re-checked with notebook chat's own refusal classifier (`isRefusal`, from `equipment-notebooks/[id]/chat/route.ts` on main), counts only:

  | 7 unanswerable | Answer text is an honest refusal | Stream status `insufficient_evidence` |
  |---|---|---|
  | Switch off | 7 | 7 |
  | Switch on | **6** | 4 |

  The real difference is **one** question that got a substantive answer instead of a refusal. Two of the three "cited anyway" turns did say the manual does not cover it; they also attached a nearby citation, which keeps their status at `answered`.
- **Verdict:** the pre-registered "refusals no worse" rule fails by 1 of 7. At n = 7 that cannot be distinguished from noise (exact McNemar p = 1.0), but the mechanism below makes it plausible. Tracked in #4572.
- **Mechanism (consistent with the spec):** IDF ordering always returns the best partial matches, where the old AND-then-OR path sometimes returned nothing. More near-miss evidence reaches the model, and on an unanswerable question it occasionally answers from it.
- **Not tuned.** Per the spec's stop rule, this is reported, not optimised against the sealed set.
- **Harness limit:** at phone width the harness cannot open "New project" (the button sits behind a menu), so both arms ran at desktop size. Phone rendering was checked by hand separately.

## Result 3: phone-width check (412×915, switch on, staging rebuilt 02:44Z)

A throwaway tenant (torn down, verified) uploaded the SMC Flex manual through the `/v3` composer at phone width.
- **Answerable question** ("My SMC Flex shows a Shorted SCR fault. What are the causes and fixes?"):
  - A grounded answer, citing pp. 101 and 104. The hand-read page is 104.
  - The page-104 citation opens the source viewer on that page (the SMC fault-display table).
  - Screenshots: `docs/promo-screenshots/2026-10-21_lexical-idf-staging-answer-cited_mobile.png` and `…citation-opens-p104_mobile.png`.
- **Unanswerable question** (motor foot-bolt torque):
  - An honest refusal ("The loaded excerpts do not give the recommended tightening torque…").
  - Screenshot: `…unanswerable_mobile.png`.

## What it means

- **Answerable questions:** the change finds the right page more often in both stacks. Development set 54 → 70 and unseen 36 → 48 with the lexical lane alone; staging 30 → 34.
- **Unanswerable questions:** it may cost an honest refusal in the hybrid + rerank stack (7/7 → 6/7 by answer text; 1 of 7, not statistically confirmed). A second symptom is that 3 refusals arrived carrying a citation, so their status reads `answered`. That is a safety-adjacent regression for a technician product: answering from the wrong passage is worse than saying "the manual doesn't cover that".
- **Not measured:** refusals in production's lexical-only configuration. That would need staging with hybrid and rerank off, or the answer-stage refusal check.

## Status

- Merged, default off. On in staging only. Off in production.
- **Production enablement is an owner decision.** It should wait for a refusal fix or a refusal measurement in the production configuration.
