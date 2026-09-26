# eval-fixer run — 2026-09-24 (charlienodes-mac-mini)

- Scorecard: 49/65 passing (75%) — `tests/eval/runs/2026-09-24T0343-offline-text.md`
  (identical to 09-21; inside the 49–56 live-inference spread, not a regression)
- Action: issue-filed (rolling tracker #1876), no patch. No baseline eval run (no-patch night).
- Sixth consecutive night on the Step-2 `file_clusters` hard stop. Merits reason unchanged
  from 09-23: the five engine.py fixtures pull in opposite directions, so no single patch
  satisfies them.

## New tonight — the citation-groundedness bucket is ONE grader false positive, located

All 6 skip-bucket failures trace to `tests/eval/grader.py:338`:
`_CITATION_SPEC_RE.findall(last_response)` scans the **whole reply**, so any `number+unit`
token anywhere is scored as a citation.

The engine holds the opposite doctrine and says so explicitly: `_asserts_nothing()`
(engine.py:1280) and `_H4_SKIP_PREFIXES` (engine.py:1275) declare question-only and
canned-choice-menu replies claim-free and exempt them from the KB-gap footer. The grader has
no equivalent notion. **Engine and grader disagree about what counts as an assertion.**

- 5 of 6 are that class. `gs4_overload_15`, `pf525_ground_fault_19`, `yaskawa_j1000_thermal_24`
  all end on the canned menu at engine.py:4319, whose literal example text is
  `"pressure at 120 PSI, temp at 90°C"` — the grader is grading the engine's own placeholder
  values, which is why those three report the identical `['120PSI','90°C']` pair.
  `pf40_undervoltage_21` is a pure question; `pf527_phase_loss_20` is a question plus one
  declarative echoing the technician's own measurement.
- 1 of 6 is NOT. `yaskawa_a1000_ov_23` asserts and carries
  `[Source: Yaskawa V1000 — E1-01 < 400 V Vdc = 660 V]` on an **A1000** fixture. The cross-vendor
  pull itself is *known* — the fixture's own comment says the KB returns AB/AD content for A1000 OV
  queries and was deliberately widened for it. What is unmeasured is that the cross-vendor chunk
  ships inside a `[Source:]` tag that reads as manual-verified, with **no checkpoint on
  source-label / asset-model agreement**. Right verdict, wrong reason — do not fix this one by
  fixing the grader.

This extends (and supersedes) 09-21's narrower "120PSI/90°C canned-menu" finding: it is not
two classes, it is one mechanism plus one genuine defect hiding inside it.

## Retired — a flag filed three times that was never real

09-20 and 09-21 reported "`--publish` not running, N unpublished fragments". **Wrong.**
Verified 4 of the 14 (09-19, 09-20, 09-21, 09-23): each has its
`origin/docs/eval-fixer-<date>-charlienodes-mac-mini` branch carrying the fragment. The untracked
copies left in `wiki/hot.d/` are the designed residue — Step 10 instructs the fragment be left
uncommitted in the shared checkout. 4/4 sampled is strong evidence the mechanism works; the
remaining 10 were not individually checked. Nothing to fix; stop re-flagging it.

## Watchdog tool artifact (why this stop keeps firing)

`guardrails.py` and `prompts/diagnose/active.yaml` have **identical** fixture lists (the same
6). The watchdog emits two keys for one cluster that has two candidate target files, so the
key count that trips the 3-cluster hard stop is inflated — the real cluster count is 2, not 3.
Not permission to patch (the engine cluster is still genuinely contradictory), but it is the
fix for the tool that keeps producing the same no-op night after night.

## Flagged for a human

- **Best-scoped:** `help_mid_session_no_kbgap_24`. The N1 guard at engine.py:3622 exempts
  `help` from the general_question steal, yet the reply still carries both forbidden tokens
  (`KB-gap`, `nameplate`). Either the help lane isn't claiming the turn or H4 appends after it.
- **Escalated to its own issue:** MIRA answering with a Modbus control write ("writing 2 to
  register 0x2002" to reset a drive fault), evidenced in 5 dated scorecards (09-07/10/13/15/23,
  absent tonight). Read-only-in-beta doctrine violation, no checkpoint measures it. Five flags
  on a rolling tracker is the wrong venue for a product ruling.
- `pf523_heatsink_18` — safety STOP false positive on a heatsink-temperature question
  ("STOP — describe the hazard. De-energize."). Recurs: flagged 09-19, passed 09-20, back
  tonight. SAFETY-tagged, outside the fixer's permitted edits by rule.

## Proof

- Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5808032952
- Escalation link: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5808039173
- Modbus control-write issue: https://github.com/Mikecranesync/MIRA/issues/3985
  (verified on project board 4 — 1 entry, not duplicated by the retry)
- Correction (post-review, applied to both the fragment and the posted comment): the a1000 case
  was first written as "the real defect is a wrong-model source label". Overstated — the fixture's
  own comment already records the cross-vendor pull as known. The unmeasured part is narrower: the
  chunk ships inside a `[Source:]` tag with no checkpoint on source-label/asset-model agreement.
  Also scoped the `--publish` retirement to the 4 dates actually verified, not all 14.
