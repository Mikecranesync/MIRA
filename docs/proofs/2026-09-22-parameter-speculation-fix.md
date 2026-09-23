# Closing the hedge loophole — A/B evidence

**Date:** 2026-09-22 · **Branch:** `feat/mira-intelligence-contract`
**Harness:** `2026-09-22-mira-contract-ab2-harness.py`
**Raw:** `…-ab2-before-fix.json` (before) · `…-ab2-final.json` (after)
**Model:** `openai/gpt-oss-120b` via Groq, `temperature 0.2`, `reasoning_effort low`, `max_tokens 500`

## What was measured

13 questions × 4 conditions. Nine invite a **fabrication class** — parameter
identity, fault/alarm meaning, terminal assignment, exact setting, torque, part
number — across six different manufacturers, so the result is not one lucky
question. Four are **usefulness probes** that must still get real engineering.

Conditions: `base` (raw model, no MIRA prompt), `legacy` (the pre-contract
`GENERAL_SYSTEM_PROMPT` still in the route), `general` and `augmented` (contract).

Every answer was **hand-read**. A first pass used regex and was discarded: it
scored `general` as *worse* than `base`, because the contract's own correct
phrasing — *"P042 is a parameter ID; its meaning is specific to this drive"* —
matches `P\d+\s+is`. A grader that cannot tell withholding from asserting is a
reading, not a finding.

## Result — fabrications of an unsupported specific (9 cases)

| condition | before fix | after fix |
|---|---|---|
| `base` (raw model) | **9 / 9** | — (unchanged, no prompt) |
| `legacy` | 1 / 9 | — |
| `general` | 2 / 9 | **0 / 9** |
| `augmented` *(the new default)* | 3 / 9 | **0 / 9** |

**The contract started out WORSE than legacy.** That is the finding that drove
the fix, and it is why the goal said to test beyond P042: on P042 alone the
contract looked fine.

### What the raw model does without MIRA

`base` did not merely guess — it invented with formatting that reads like a
datasheet:

- *"Hitachi WJ200 (the 'WJ-200 Series' laser printer / multifunction device),
  parameter b001 is the Default Paper-Tray Selection"* — the WJ200 is a VFD.
- *"Fault code F004 on a **Dell** PowerFlex 525 (formerly Compellent / SC
  Series) — Power Supply Failure"* — confused a drive with a storage array.
- *"Part number: 5M-001-001"* — a plausible-looking invention.
- Markdown tables of torque specs, defaults and terminal functions throughout.

This is the strongest argument in the record for wrapping the model at all.

### Why the contract was worse than legacy, and what fixed it

The model classifies **vendor code meanings as general engineering knowledge**.
The contract's "never refuse a question general knowledge can answer" then
licensed exactly the guesses the specificity rule forbids — legacy's blunter
refusal style accidentally avoided this.

Three changes, each verified by its own A/B round:

1. *"A vendor's fault and alarm code meanings, parameter numbering, and terminal
   numbering are NOT general engineering knowledge… 'Answer from general
   knowledge' NEVER licenses these."* → general 2→0, augmented 3→1.
2. In augmented: the answer-anyway permission *"covers ENGINEERING. It does not
   cover the identifiers…"* → closed the remaining VALUE guesses.
3. **Split a compound question.** *"What is the default accel time **and** what
   should I set it to?"* is a value you don't have plus a judgement you can
   make. Withhold the first, answer the second. → augmented 1→0.

Round 3 said the default accel time was **0.5 s**; round 4 said **0 seconds**.
Different wrong answer each run, which is what guessing looks like.

## The opposite failure was checked too

A rule this strong can produce an assistant that refuses everything. It did not:

| probe | base | augmented |
|---|---|---|
| VFD low-speed overheating | 319 w | 318 w |
| motor hums, won't start | 323 w | 351 w |
| hydraulic press loses pressure | 328 w | 305 w |
| contactor chatter | 309 w | 268 w |
| **carried ordered steps** | **1 / 4** | **4 / 4** |

Same depth, more actionable, and every augmented answer carried the
energy-isolation clause. On the compound question it withheld the default,
named the exact manual section, and still answered the commissioning half with
concrete ranges.

## Residual, stated plainly

The surviving compound answer says *"look up parameter 001 (Accel Time) … that
entry gives the factory-set value (typically 0.5 s for many drives, but verify
for your firmware version)."* It names the document and demands verification,
but it still volunteers a parameter number and a typical value. Much weaker than
before; not perfectly clean.

**Not tuned further, deliberately.** Four rounds against thirteen fixed
questions is the point where further prompt edits start fitting the test set
rather than the problem. Filed as a follow-up to be judged on the staging
acceptance loop against real traffic.

## Cost

| round | calls | cost |
|---|---|---|
| prior session | 24 | $0.0071 |
| before-fix | 52 | $0.0180 |
| after change 1 | 52 | $0.0187 |
| after change 2 | 52 | $0.0192 |
| final | 52 | $0.0199 |
| **total** | **232** | **$0.0829** |

Declared bound was **$1.00**. Spend is **8.3%** of it.
