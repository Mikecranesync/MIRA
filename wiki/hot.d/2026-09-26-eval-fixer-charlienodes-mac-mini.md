# eval-fixer run — 2026-09-26 (charlienodes-mac-mini)

- Scorecard: 58/65 passing (89%) — `tests/eval/runs/2026-09-26T0339-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876). No patch.
- **89% is not progress.** 58 is the *maximum* of the observed distribution on frozen code
  (see below). Anyone reading tonight's number cold will bank it as an improvement; it isn't.

## The finding: this agent's own verify gate is structurally invalid

Twelve consecutive runs (2026-09-24T0343 → 2026-09-26T0339), **zero commits** to
`engine.py` / `guardrails.py` / `prompts/diagnose/active.yaml` / `grader.py` since 09-09
(latest touching commit `c748cd8ef`, 2026-09-06; repo HEAD `34f8c42c4`, 2026-09-09):

```
49 51 54 53 52 50 54 55 52 54 52 58   (/65)
n=12  min 49  max 58  range 9  mean 52.83  stdev 2.41
```

**A 9-point swing with the code frozen.** Step 7 of the agent spec verifies a patch by
`new_pass > baseline_pass` from **one** run before and **one** run after. At stdev 2.41 that
comparison cannot separate signal from draw:

| Patch worth | Runs/arm for one-arm SE | Runs/arm for a real before/after test |
|---|---|---|
| +1 fixture | ~24 | **~47** |
| +2 fixtures | ~6 | **~12** |
| +3 fixtures | ~3 | **~6** |
| +5 fixtures | ~1 | **~2** |

**Read the right column.** The first is only the run count that shrinks *one* arm's standard
error to `d/2` (`k = (2·sd/d)²`). A before/after comparison has two arms, so the difference's
SE is `sd·√(2/k)` and the requirement is `k ≥ 8·sd²/d²` — exactly **2×**. Anyone implementing
the spec change below off the left column would under-power it.

So a single-run-each verdict is only trustworthy for a patch worth **+5 or more**, which no
minimal one-file patch under the Step-6 50-line cap is likely to be. Every "+N verified" this
agent has ever reported was a coin flip. The repo memory note `project_offline_eval_not_hermetic`
records "delta <~6 is noise" — that's directionally right and now has a measured basis, but the
observed spread is 9, so the stated threshold is if anything too tight.

**Actionable fix (for a human, this is a spec change):** verify against the
**12/12-chronic subset only**. Those fixtures are deterministic across all 12 runs, so a patch
that flips one is real signal even in a single run, whereas the full-suite count is unusable.
The full 65-fixture pass rate should be reported as a *range over k runs*, never as one number.

## Chronic vs flap — the honest split of tonight's 7 failures

Failure counts over the same 12 runs (29 distinct fixtures failed at least once):

**Chronic — deterministic, real:**
| Fixture | Fails |
|---|---|
| `topic_switch_gs10_to_pf525_22` | 12/12 |
| `self_critique_low_groundedness_34` | 12/12 |
| `pf525_f004_02` | 12/12 |
| `gs3_ground_fault_14` | 11/12 |
| `gs20_cross_vendor_03` | 10/12 |

**Tonight's other four are flap** — they happened to land tonight and carry no information:
`pf523_heatsink_18` 5/12, `pf520_hw_overcurrent_17` 4/12, `gs10_overcurrent_01` 3/12,
`vfd_siemens_03_sinamics_cross_vendor` 2/12. Note `gs3_ground_fault_14` (11/12) and
`gs20_cross_vendor_03` (10/12) *passed* tonight — that is the same coin, other face.

## Why no patch (the real reason — retiring the one given for seven nights)

Prior nights (09-19 → 09-24) all cited the Step-2 `file_clusters` hard stop. **Retire that
reason.** 09-24 already showed the count is inflated — `guardrails.py` and
`prompts/diagnose/active.yaml` carry *identical* fixture lists, so it is 2 clusters, not 3.

The real blocker is stronger and is tonight's finding: **there is no valid way to verify a
patch.** Attempting one and reporting "+N" would be precisely the overclaim the variance data
condemns. That, not the cluster count, is why tonight is a no-patch night — and it will remain
true every night until the verification procedure changes.

(The substantive contradiction 09-23/09-24 identified also still holds: `02` stalls at Q2 and
needs *fewer* qualification questions, `22` bails to IDLE and needs *better* context handling,
and `34` is now confirmed unfixable-by-design — see below. No single ≤50-line edit satisfies them.)

## `self_critique_low_groundedness_34` — verified tonight: not a bug, a stale fixture

09-23 called this "a fixture-vs-gate disagreement where the engine is arguably correct." That
was inherited reasoning; it is now **checked**, and it is stronger than "arguably":

- Fixture `tests/eval/fixtures/*self_critique_low_groundedness*`. One turn: *"My VFD is making
  a strange noise and sometimes stops"* — **no manufacturer, no model, no fault code.** Stated
  intent: "MIRA should ask a targeted clarifying question rather than inventing a confident
  diagnosis from thin air."
- Engine did exactly that: `"Before I diagnose, I need to know the equipment. Tell me the
  manufacturer and model (e.g., 'Allen-Bradley PowerFlex 525')."` — a clarifying question, no
  invented diagnosis. **The fixture's own intent is satisfied behaviourally.**
- It fails on two stale expectations:
  1. `expected_final_state: Q1`, but the engine routes to `AWAITING_UNS_CONFIRMATION`. With no
     asset resolved, that is the **mandatory** path per `.claude/rules/uns-confirmation-gate.md`
     ("No confirmed namespace context, no troubleshooting"). The engine is correct by doctrine.
  2. `expected_keywords` = `[detail, fault, alarm, code, telling, vibration, noise, vfd,
     troubleshoot, drive]` — which omits **equipment / manufacturer / model**, the words the UNS
     gate actually uses.
- The fixture's own comment block dates its tuning to LIVE behaviour on **2026-04-16**
  ("`DIAGNOSIS_REVISION` is not a real FSM state; LIVE (2026-04-16) shows DIAGNOSIS", "Groq asks
  about vibration signals rather than fault codes"). It predates the UNS confirmation gate.

**Consequence:** this fixture can never pass, and the fixer is barred from fixing it — Step 6
says "NEVER modify `tests/eval/fixtures/` — fixtures are ground truth." It needs a human ruling
(re-baseline the fixture to the gate, or exempt it). **So the real chronic-defect count is 2,
not 3:** `pf525_f004_02` and `topic_switch_gs10_to_pf525_22`.

## `topic_switch_gs10_to_pf525_22` — grounded cause, best hand-off available

12/12 chronic, and the cause is now located rather than guessed:

- Fixture `tests/eval/fixtures/60_topic_switch_gs10_to_pf525.yaml`. Turn 1 asks about **CE10 on
  a DURApulse GS10**; turn 2 asks how to reset a **PowerFlex 525** after undervoltage.
  `forbidden_keywords: [CE10, GS10, Modbus, polling]`.
- The forbidden check scans **`last_response` only**, not the transcript
  (`tests/eval/grader.py:225` `resp_lower = last_response.lower()`, used at `:257`). So the
  user typing "CE10" in turn 1 cannot trip it — **`CE10` is genuinely present in the engine's
  PowerFlex 525 reply.** Real session-context bleed across an explicit equipment switch.
- The expected keywords would have passed (the reply opens
  "**Resetting a PowerFlex 525 after an Undervoltage Fault**"). This fixture fails on the
  forbidden token *alone*, plus `expected_final_state: Q1` vs actual `IDLE`.
- **Not established:** *where* in the reply `CE10` appears (prose vs. a `[Source:]`/footer
  line). The scorecard truncates the last response at ~150 chars, so that needs a targeted
  re-run to see the full text. Worth knowing, because a leak in a source footer is a different
  fix from a leak in the generated prose.

## Already-escalated — referenced, not re-litigated

- `pf523_heatsink_18` safety STOP false positive: flagged 09-19/09-23/09-24; SAFETY-tagged and
  outside this agent's permitted edits. Also 5/12 flap, not chronic.
- Modbus control-write (read-only-in-beta violation): owns issue **#3985**. Absent tonight.
- `--publish` "not running": retired 09-24 as never-real (4/4 sampled branches carried their
  fragment). Not re-flagged.

## Proof

- Watchdog: 7 failures, 6 patchable, 1 skip, `"clean": false`, no regressions.
- Variance + frequency figures computed directly from the 12 scorecards in
  `tests/eval/runs/*offline-text.md`; command trail in the tracker comment.
- Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5843381539
  (verified newest comment on #1876, author Mikecranesync, 2026-09-26T05:03:49Z, 5812 bytes)
- Corrections applied post-review to **both** the fragment and the posted comment
  (comment PATCHed, `updated_at` 2026-09-26T05:05:39Z, 8212 bytes, byte-identical to the
  local body):
  1. The runs-needed table was labelled "runs needed per arm" but the figures were a *one-arm*
     SE target. A two-arm before/after test needs `k ≥ 8·sd²/d²` — exactly 2× — so the table now
     carries both columns and points at the right one. Conclusion unchanged (it makes
     single-run-each *more* clearly invalid), but the original figures would have under-powered
     anyone implementing the spec change.
  2. `self_critique_low_groundedness_34` was carried forward on 09-23's inherited wording
     ("arguably correct"). Checked tonight against the fixture and
     `.claude/rules/uns-confirmation-gate.md`: the engine is correct and the fixture is stale,
     which drops the real chronic-defect count from 3 to 2.
- Not established (deliberately, not overlooked): the exact position of `CE10` in fixture 22's
  reply, and no re-run to "confirm" 58 — a second draw carries ~2.4 stdev of noise and would
  cost ~20 min of live inference for no information.
