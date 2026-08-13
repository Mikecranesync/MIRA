# 5-seed consistency on the merge candidate — analysis

**Date:** 2026-08-09
**Build:** `qc/cold-start-baseline@ba0a7cab2` (staging)
**Runs:** `c12s42`, `c12s43`, `c12s44`, `c12s45`, `c12s46` — tiers 1+2, seeds 42–46
**Volume:** 150 conversations, 144 passed

Machine-generated verdict table: `2026-08-09-consistency-5seed.md`. This document
is the part a generator cannot produce — what the failures actually were.

## Why five fresh seeds and not one more

The existing 4-seed set (`c3`, `c5s43`, `c5s44`, `c5s45`) ran on a **pre-CTX-001d
build**. Adding a fifth seed on the current build would have produced a mixed-build
verdict — a worse artifact than four clean seeds, dressed as a better one. All five
seeds here ran on one build, and that build has **zero production-code delta** from
branch HEAD `51ff1b5e8` (the three commits between them touch only harness, hooks
and docs). So this measures exactly the code proposed for merge.

## Verdicts, against the old build

| finding | old build (4 seeds) | this build (5 seeds) | reading |
|---|---|---|---|
| `t1:symptom_report` | FLAKY 50% | **STABLE_PASS 100%** | CIT-005 confirmed |
| `t2:pivot_after_fault` | STABLE_FAIL (0/5 runs) | **FLAKY 40%** | improved, **not fixed** |
| `t1:reset_procedure` | FLAKY 50% | FLAKY 60% | unchanged within noise (#3156) |
| 11 others | STABLE_PASS | STABLE_PASS | **zero regressions** |

**Zero stable failures.** No scenario failed under every seed.

## The correction this run forces

`c6` and `c7` both ran seed 42 and both passed `t2:pivot_after_fault`, and that was
recorded as STABLE_FAIL broken. Five seeds say the pass rate is **40%**. Seed 42 is
one of the two seeds where it passes. **Two runs at one seed are one sample.**

## What the four failures actually are — per-turn grades, not last replies

Failing-turn histogram across all six failing conversations:

| turn | failures |
|---|---|
| 1 | 2 |
| **2** | **4** |
| 3 | 1 |

All four `t2:pivot_after_fault` failures fail at **turn 2** — `"How do I reset it?"`
— where MIRA restates what CE10 *means* instead of answering how to reset it:

> `CE10 = Communication error 10, RS-485 Modbus transmission time-out. Check if the
> upper unit transmits the communication command within the setting time for P09.03…`

`expect=["reset"]` misses. Every time.

Only **one** of the four also fails at turn 3 (the actual pivot turn). In the other
three the pivot is clean: the topic switches to the conveyor, no `CE10` survives.

Both `t1:reset_procedure` failures are the identical shape one turn earlier:

> `Diagnosing... What is the exact undervoltage fault code on the display?`

against `expect=["reset", "PowerFlex"]`.

### Conclusion

**`t2:pivot_after_fault` and `t1:reset_procedure` are the same root cause.** MIRA
cannot answer *"how do I reset it"* — the defect diagnosed in
`docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md` (#3165):
"reset" is polysemous in a drive manual, the correct fault-clear chunks never enter
the top 10, and the model fills the gap.

**The pivot mechanism itself works in 4/4.** CTX-001d and CTX-005 do what they claim.
The fingerprint has been failing under a misleading name — it fails *upstream* of the
behaviour it is named for, on a turn that belongs to #3156.

This is the same lesson as the c6 masked-repeat, inverted: there, a green cell hid a
defect; here, a red cell hid a **fix**. Both are only visible in the per-turn grades.

## Secondary finding — the KB-gap footer survives on option-menu clarifiers

Not what any scenario was grading, found while reading transcripts. Two replies carry
the KB-gap footer beneath a pure clarifying question:

- `c12s43 t2_000` turn 3 — `Got it — switching to a new asset. What equipment do you
  need help with? --- *Describe the machine* | *Scan the QR code* | *Upload a nameplate
  photo*` **+ `I don't have specific documentation indexed for this…`**
- `c12s44 t2_005` turn 3 — `Are the sensors and their connections intact? Reply: Yes…
  or No…` **+ the same footer**

CIT-005 suppresses the footer on question-only turns, but exempts the option-menu
clarifier **by declaration** (template prefix), because an option line is textually
indistinguishable from a claim line. These two replies are the residue of that
exemption. Same class as #3159, narrower. Not fixed here; recorded so it is not
rediscovered from scratch.

## Third finding — the drive-pack fast-path re-emits its template, unguarded

Surfaced by the offline lab, not by any grader: `c12s46 t2_002_continuation_is_kept`
turn 2 reproduces turn 1 at ratio 0.960 / frac 0.923.

```
tech:  What does F004 mean on a PowerFlex 525?
mira:  F004 = UnderVoltage — the DC bus dropped below the minimum. Most common
       causes: low incoming line or a supply sag during start. Measure the
       incoming voltage at L1-L2-L3. [Source: … Fault Code Table]
tech:  is that fault serious?
mira:  Diagnosing... F004 = UnderVoltage — the DC bus dropped below the minimum.
       Most common causes: … [Source: … Fault Code Table]      ← verbatim
```

The question "is that fault serious?" is never answered. The conversation **passes**,
because the scenario only grades that context was *kept* — and it was, uselessly.

Why no guard fired: CTX-004/004b live in `_call_with_correction`, and the drive-pack
fast-path never passes through it. This is the fourth distinct defect traced to that
same structural gap (CON-004a/b/c were the other three).

**Pre-existing, not a regression from this branch.** The lab's template view shows the
same reply template in `c1r4` (main-era) as well as `c6` and `c12s46`. The two GS10
variants of the same scenario (`c12s42`, `c12s43`) answer it correctly — only the
PowerFlex 525 asset, which the pack claims, repeats. Seed choice of asset decides
whether it is visible.

This is also a lead for **#3156**: the same fast-path is the suspect for
`"quickest way to reset a PF-525"` being answered with a clarifier.

## Bearing on the merge

Every failure on the merge candidate traces to **one pre-existing, already-filed,
undiagnosed root cause** (#3156 / #3165) that this branch does not claim to fix.
Nothing regressed; one finding (`t1:symptom_report`) is measurably fixed; eleven
others hold at 100%.
