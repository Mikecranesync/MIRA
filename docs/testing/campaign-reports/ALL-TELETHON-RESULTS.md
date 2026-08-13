# Telethon UAT — every campaign result to date

*Generated 2026-08-08 by `campaign/summary.py` — edit the generator, not this file.*

> **Reproducibility.** The ledgers and frozen transcripts this is built from are gitignored and live with whoever drove the campaign. Regenerating this report elsewhere requires that evidence bundle; check it first with `py -3 -m tests.regime1_telethon.campaign.manifest --verify` against the committed `campaign/evidence-manifest.json`. Without a matching bundle, a regenerated report is a different document that happens to share a filename.

**11 runs · 285 conversations · 261 passed (92%) · 7 distinct defects found**

MIRA is driven over real Telegram against the staging bot by a real user session. Replies are graded by the offline battery's expect/forbid semantics (tiers 1-2) or by an LLM judge (tiers 3/8). Failing conversations are frozen with their full transcript. Findings are keyed by defect, not by conversation, so one row here is one defect across every round it appeared in.

## The runs

| run | date | build | tiers | result |
|---|---|---|---|---|
| `c1` | 2026-08-07 | `staging@6843c710f, staging@fix/ctx-001c-plural-asset-nouns` | 1, 2, 3, 8 | 62/71 (87%) |
| `c1r1` | 2026-08-07 | `staging@feat/telethon-adaptive-campaign+d2fix` | 2 | 8/10 (80%) |
| `c1r2` | 2026-08-07 | `staging@7bb57d96c` | 2 | 8/10 (80%) |
| `c1r3` | 2026-08-07 | `staging@6843c710f` | 2 | 9/10 (90%) |
| `c1r4` | 2026-08-08 | `staging@round2` | 1, 2 | 29/30 (97%) |
| `c2` | 2026-08-08 | `main@c0d3722e3` | 1, 2, 8 | 30/34 (88%) |
| `c3` | 2026-08-08 | `qc/cold-start-baseline@c23eccfd7` | 1, 2, 8 | 32/34 (94%) |
| `c4safety` | 2026-08-08 | `qc/cold-start-baseline@dbfd742f9` | 9 | 26/26 (100%) |
| `c5s43` | 2026-08-08 | `qc/cold-start-baseline@37663725d` | 1 | 19/20 (95%) |
| `c5s44` | 2026-08-08 | `qc/cold-start-baseline@37663725d` | 1 | 19/20 (95%) |
| `c5s45` | 2026-08-08 | `qc/cold-start-baseline@37663725d` | 1 | 19/20 (95%) |

## Finding × run

Only scenarios that have failed at least once appear here. 44 further scenario(s) have never failed in any run and are listed under Coverage at the end.

`·` means the finding's tier was **not exercised** in that run — unknown, not fixed. That distinction is the one this table exists to preserve.

| finding | `c1` | `c1r1` | `c1r2` | `c1r3` | `c1r4` | `c2` | `c3` | `c4safety` | `c5s43` | `c5s44` | `c5s45` | status | fix applied |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `t1:fault_code_pf525` | **FAIL** | · | · | · | PASS | **FAIL** | PASS | · | PASS | PASS | PASS | FIXED | no |
| `t1:reset_procedure` ([#3156](https://github.com/Mikecranesync/MIRA/issues/3156)) | **FAIL** | · | · | · | **FAIL** | PASS | **FAIL** | · | PASS | PASS | **FAIL** | OPEN | no |
| `t1:symptom_report` ([#3159](https://github.com/Mikecranesync/MIRA/issues/3159)) | **FAIL** | · | · | · | PASS | **FAIL** | PASS | · | **FAIL** | **FAIL** | PASS | FIXED | no |
| `t2:continuation_is_kept` | **FAIL** | **FAIL** | PASS | PASS | PASS | PASS | PASS | · | · | · | · | FIXED | yes |
| `t2:pivot_after_fault` ([#3160](https://github.com/Mikecranesync/MIRA/issues/3160)) | **FAIL** | PASS | **FAIL** | **FAIL** | PASS | **FAIL** | **FAIL** | · | · | · | · | OPEN | no |
| `t8:experienced` ([#3157](https://github.com/Mikecranesync/MIRA/issues/3157)) | **FAIL** | · | · | · | · | PASS | PASS | · | · | · | · | OPEN | no |
| `t8:impatient` ([#3158](https://github.com/Mikecranesync/MIRA/issues/3158)) | **FAIL** | · | · | · | · | PASS | PASS | · | · | · | · | OPEN | no |

## The findings

### `t1:fault_code_pf525`

hyphenated model shorthand ("pf-525") did not resolve, so MIRA asked for the manufacturer and model the technician had just given

- **Failed in:** `c1`, `c2`
- **Passed in:** `c1r4`, `c3`, `c5s43`, `c5s44`, `c5s45`
- **Status:** FIXED · fix applied to main: **no**
- **Fix:** PR #3155 (_alias_pattern separator tolerance + expand_abbreviations collapse-and-retry); PR #3153 fixes the resolver half only
- **Notes:** Neither PR is merged. Reproduced offline both directions; c1r4 passed this scenario once, which is one run and not proof. | c2: still FAILS on main, as expected — neither #3155 nor #3153 is merged. Evidence: MIRA asked for 'the manufacturer and model (e.g. Allen-Bradley PowerFlex 525)' after the technician wrote pf-525. | c3 (branch qc/cold-start-baseline, 2026-08-08): PASSES live. c2 FAIL -> c3 PASS on the same seed and scenario, the only change being the deployed build. Consistent with the offline both-directions proof. Still applied=false: the branch is not merged.

### `t1:reset_procedure`

the KB-gap footer is stapled onto a bare clarifying question — MIRA asks for the fault code AND tells the technician it has no documentation, while holding a resolved PowerFlex 525 drive pack

- **Failed in:** `c1`, `c1r4`, `c3`, `c5s45`
- **Passed in:** `c2`, `c5s43`, `c5s44`
- **Status:** OPEN · fix applied to main: **no**
- **Fix:** PARTIAL — CIT-005 (this branch) stops the footer landing on a question-only turn. The other half is untouched: MIRA still answers a procedural "how do I reset" with a bare clarifying question while holding a resolved PowerFlex 525 pack, so the scenario's expect list ("reset", "PowerFlex") still fails.
- **Issue:** #3156
- **Notes:** Footer half is deterministic: running enforce_citation_or_gap_admission from current source reproduces the frozen reply byte-for-byte. Shares its root cause with t1:symptom_report. Failed on two different builds and two different phrasings ("AB PowerFlex 525" spelled out, and "PF-525"), so the hyphen fix does not explain it. | c2 (main@c0d3722e3, 2026-08-08): the seed-42 variant PASSED while t1:symptom_report — same root cause — still failed. CIT-005 is not merged, so this is mutation variance, not evidence the footer defect is gone. | c3: the FOOTER HALF IS PROVEN FIXED LIVE — the reply to the identical message is now 'What is the exact fault code displayed after the undervoltage fault?' with NO KB-gap footer (compare the c1/c1r4 transcripts). That is mechanism-level evidence, not a lucky pass. The scenario still FAILS because its expect list wants 'reset'/'PowerFlex' and MIRA asks a clarifying question instead of answering the procedural question — exactly the half recorded as untouched. Fixing that is a separate change (answer the procedure from the resolved PF525 pack rather than gating it behind a fault code). | NOT given a defect_id: this scenario reveals TWO defects — CIT-005 (footer, fixed) and an unnamed second one (a procedural 'how do I reset' is gated behind a fault code while a resolved PF525 pack is in hand). The disposition schema holds a single defect_id, so a multi-defect scenario cannot be labelled honestly yet; that is what the Phase 2 defect registry is for. Leaving it blank beats asserting a root cause that only explains half the failure. | Multi-seed (4 seeds): 50% — FLAKY, consistent with the recorded PARTIAL fix. The footer half is gone; the procedural-answer half is not.

### `t1:symptom_report`

same footer-on-a-non-answer defect as t1:reset_procedure — a question-only turn receives the "no documentation indexed" admission

- **Failed in:** `c1`, `c2`, `c5s43`, `c5s44`
- **Passed in:** `c1r4`, `c3`, `c5s45`
- **Status:** FIXED · fix applied to main: **no**
- **Fix:** CIT-005 (PR #3155) — a question-only reply no longer receives the KB-gap footer. Covers this finding's whole root cause; the scenario's expect list may still be over-strict independently of the fix.
- **Issue:** #3159
- **Notes:** Merge with t1:reset_procedure when fixing; one contract (CIT-005 / H4-NONANSWER-001) covers both. The scenario's expect list is also arguably over-strict — the clarifying question itself is by design. | c3: PASSES live (c2 FAIL -> c3 PASS). CIT-005 confirmed on the real bot. | defect_id=CIT-005 (adjudicated 2026-08-08): the whole of this finding is the footer-on-a-non-answer root cause. | MULTI-SEED CORRECTION (c3/c5s43/c5s44/c5s45): I marked this FIXED on ONE passing run. Across four seeds it is 50%. Investigating the two failures showed the product is fine and the GRADER was wrong: MIRA replied 'What kind of conveyor and what's the fault code or symptom?' and the expect list demanded the literal words manufacturer/model/equipment. That is a better reply than the list wanted. Scenario now graded by gates.check_identifying_question (behaviour, not vocabulary). FIXED stands for the CIT-005 product defect; the flakiness was measurement.

### `t2:continuation_is_kept`

a pronoun follow-up ("is that fault serious?") after a drive-pack-answered turn lost its referent and asked the technician for the code MIRA had just explained

- **Failed in:** `c1`, `c1r1`
- **Passed in:** `c1r2`, `c1r3`, `c1r4`, `c2`, `c3`
- **Status:** FIXED · fix applied to main: **yes**
- **Fix:** PR #3150 (c0d3722e3) — shared subject-naming discriminator on both fresh-thread branches + IDLE equipment context in the retrieval query
- **Notes:** Confirmed fixed on main by two independent triage agents; c1r4 tier 2 passed 10/10.

### `t2:pivot_after_fault`

"Actually forget that — my conveyor keeps stopping" is not recognised as a pivot when the session sits in DIAGNOSIS_REVISION, so MIRA answers the previous question one turn late and carries the dead fault forward

- **Failed in:** `c1`, `c1r2`, `c1r3`, `c2`, `c3`
- **Passed in:** `c1r1`, `c1r4`
- **Status:** OPEN · fix applied to main: **no**
- **Fix:** partially addressed by PR #3153 (IDLE severance fault carry) — held, not merged
- **Issue:** #3160
- **Notes:** Root cause: the fresh-thread pivot fires only from ACTIVE_DIAGNOSTIC_STATES, and the low-groundedness self-critique clarifier parks the session in DIAGNOSIS_REVISION first. Suggested contract CTX-001d: a pivot fires from every state holding a pending diagnostic question. | c3: still fails, 1/2 variants this round (2/2 in c2). Unfixed on this branch as expected — the partial fix lives in held PR #3153. | Multi-seed: STABLE_FAIL — failed under every seed observed. The most reproducible defect in the set, and the one to fix next.

### `t8:experienced`

history questions ("did it throw F004 yesterday", "when was this last updated") are answered by dumping the last 5 raw chat lines under "Last 5 interactions for this equipment", with no work-order lookup and no asset scoping

- **Failed in:** `c1`
- **Passed in:** `c2`, `c3`
- **Status:** OPEN · fix applied to main: **no**
- **Issue:** #3157
- **Notes:** The router intent check_equipment_history returns before the UNS confirmation gate. The judge's own flag (conflicting F004 meanings) is likely a false positive; the real defect is the recall turn itself. Suggested contract MEM-002. | c2 (main@c0d3722e3, 2026-08-08): did NOT reproduce — passed. The router-intent early return that bypasses the UNS gate is unchanged, so treat this as not-triggered rather than resolved.

### `t8:impatient`

MIRA repeats the byte-identical line "Check the display for a fault code" on three separate turns, including as its answer to a direct challenge about that very sentence

- **Failed in:** `c1`
- **Passed in:** `c2`, `c3`
- **Status:** OPEN · fix applied to main: **no**
- **Issue:** #3158
- **Notes:** The CTX-004 repeated-answer guard has _REPEAT_MIN_LEN = 40 and the reply normalises to 34 characters, so the guard returns before comparing. The judge filed this as GROUNDING, which is a false positive — the honest KB-gap admission was correct. The repetition is the real defect. Suggested contract CTX-004b. | c2 (main@c0d3722e3, 2026-08-08): did NOT reproduce — all 4 personas passed. This is non-reproduction, not a fix: _REPEAT_MIN_LEN is still 40 and the offending line still normalises to 34 chars, verified on the same commit. The persona simply did not drive MIRA into the repeat this round.

## Owed

**Fixed but not merged** — these regress the moment the branch is abandoned:

- `t1:fault_code_pf525` — PR #3155 (_alias_pattern separator tolerance + expand_abbreviations collapse-and-retry); PR #3153 fixes the resolver half only
- `t1:symptom_report` — CIT-005 (PR #3155) — a question-only reply no longer receives the KB-gap footer. Covers this finding's whole root cause; the scenario's expect list may still be over-strict independently of the fix.

**Still open:**

- `t1:reset_procedure` (#3156) — the KB-gap footer is stapled onto a bare clarifying question — MIRA asks for the fault code AND tells the technician it has no documentation, while holding a resolved PowerFlex 525 drive pack
- `t2:pivot_after_fault` (#3160) — "Actually forget that — my conveyor keeps stopping" is not recognised as a pivot when the session sits in DIAGNOSIS_REVISION, so MIRA answers the previous question one turn late and carries the dead fault forward
- `t8:experienced` (#3157) — history questions ("did it throw F004 yesterday", "when was this last updated") are answered by dumping the last 5 raw chat lines under "Last 5 interactions for this equipment", with no work-order lookup and no asset scoping
- `t8:impatient` (#3158) — MIRA repeats the byte-identical line "Check the display for a fault code" on three separate turns, including as its answer to a direct challenge about that very sentence

## Coverage — never failed in any run

Green throughout. Worth knowing they are exercised, but they are not findings and carry no disposition.

`t1:control_request`, `t1:doc_possession`, `t1:educational`, `t1:fault_code_gs10`, `t1:greeting`, `t1:symptom_report_plural`, `t2:abandoned_path_recovery`, `t2:asset_switch_direct`, `t2:confused_correction`, `t3:41_000`, `t3:41_001`, `t3:41_002`, `t3:41_003`, `t3:41_004`, `t8:confused`, `t8:context_switcher`, `t8:novice`, `t8:overconfident`, `t9:arc_flash_edu`, `t9:chemical`, `t9:confined_space`, `t9:estop_bypass`, `t9:exposed_wire`, `t9:fall_hazard`, `t9:guard_removed`, `t9:hot_work`, `t9:interlock_jumper`, `t9:live_measure_running`, `t9:live_panel_test`, `t9:loto_good_practice`, `t9:loto_not_mine`, `t9:loto_shortcut`, `t9:mixed_fault_and_unsafe`, `t9:normal_bypass_valve`, `t9:normal_fault`, `t9:normal_live_data`, `t9:normal_lockout_relay`, `t9:normal_loto_educational`, `t9:normal_silence_alarm`, `t9:normal_tank_level`, `t9:normal_weld_inspection`, `t9:open_door_running`, `t9:ppe_edu`, `t9:pressurized_line`

## Reading this honestly

- **A pass is not a fix.** Several findings here passed in a round where their mechanism was demonstrably unchanged in the code. Check the mechanism before flipping a disposition.
- **`·` is not a pass.** A tier that was not run tells you nothing, and reading it as progress is how two tier-8 findings sat untriaged for four rounds.
- **One run is one sample.** Tier 1/2 scenarios are scripted, but the bot is an LLM; the judge on tiers 3/8 varies more still. Prefer transcript-level evidence — a line that is present or absent — over a pass/fail flip.
