# MIRA Weekly Eval Regression Report — 2026-05-31

**Generated:** Sun 2026-05-31 02:00 (scheduled: `eval-regression-weekly`)
**Suite:** offline text (judge disabled) — runs are directly comparable
**Verdict:** ✅ **Improvement.** Pass rate up +10 points. No regression issue filed.

| | Current | Previous |
|---|---|---|
| Run | `2026-05-31T0158-offline-text.md` | `2026-05-30T2140-offline-text.md` |
| Pass rate | **34/57 (59%)** | 28/57 (49%) |
| Runtime | 1064.6s | 2489.7s |

**Delta:** +6 scenarios, **+10 percentage points** (49% → 59%).

## Issue decision

Trigger = file a `qa-regression` issue only if pass rate **drops > 5%**. Pass rate **rose** 10 points, so the trigger is not met. **No GitHub issue filed.** (See "Watch items" — two individual scenarios regressed despite the net gain; flagged for human review, not auto-filed since the aggregate gate wasn't tripped.)

## Movement since last run

**Fixed (fail → pass) — 8:**
`full_diagnosis_happy_path_07`, `gs20_phase_loss_16`, `pf523_heatsink_18`, `yaskawa_a1000_ov_23`, `yaskawa_ga500_gf_25`, `yaskawa_ga700_encoder_26`, `vfd_abb_04_acs150_multi_turn`, `vfd_danfoss_01_vlt_fc102_alarm4`

Most gains are FSM-advancement fixes (Yaskawa scenarios that were stuck at IDLE/Q1 now reach Q2/DIAGNOSIS) plus two manual/parameter scenarios clearing.

**Regressed (pass → fail) — 2:**
`gs4_overload_15` (was 6/6 → now 5/6; `State='IDLE', expected='Q2'`) and `cmms_wo_creation_32` (was 6/6 → now 4/6; `State='DIAGNOSIS', expected='RESOLVED'` + missing "work order/created/CMMS" keywords).

## Top 3 failure patterns (current run — 23 failures)

1. **Question-skip / FSM stall — 10 failures.** The FSM halts short of the expected state (e.g. `Q1→DIAGNOSIS`, `IDLE→Q2`, `DIAGNOSIS→RESOLVED`). Scenarios: `gs10_overcurrent_01`, `pf525_f004_02`, `gs3_ground_fault_14`, `gs4_overload_15`, `sew_overcurrent_29`, `cmms_wo_creation_32`, `self_critique_low_instruction_35`, `vfd_ab_01_pf525_f004_undervoltage`, `vfd_danfoss_04_vlt_fc360_edge`, `vfd_mitsu_03_a700_parameter`.

2. **UNS gate stuck — 5 failures.** Session never leaves `AWAITING_UNS_CONFIRMATION`, so it never reaches the expected Q1/Q2 and the keyword check also misses. Scenarios: `vague_opener_stuck_state_05`, `asset_change_mid_session_08`, `reset_new_session_09`, `abbreviation_heavy_10`, `self_critique_low_groundedness_34`. (Consistent with vague openers, mid-session asset changes, and abbreviation-heavy input failing to resolve a UNS path.)

3. **VFD doc/manual routing — 5 failures.** "Find the manual/datasheet" scenarios end at `ASSET_IDENTIFIED` instead of returning to `IDLE`, and several miss the expected manual-link keywords (vendor domain, manual code). Scenarios: `vfd_ab_04_pf70_find_manual`, `vfd_abb_02_acs880_find_manual`, `vfd_danfoss_02_aqua_drive_manual`, `vfd_mitsu_02_fr_e700_find_datasheet`, `vfd_siemens_02_micromaster_manual`.

*Smaller clusters:* cross-vendor keyword contamination — 2 (`gs2_overvoltage_13` leaks "PowerFlex"; `pf520_hw_overcurrent_17` leaks "AutomationDirect"); keyword-only miss with FSM passing — 1 (`yaskawa_j1000_thermal_24`).

## Watch items for human review

- **`cmms_wo_creation_32` regressed** — work-order creation no longer reaches `RESOLVED`. Possible CMMS-tool / FSM-terminal-state regression in the last ~4h window. Worth a look since it touches the WO-creation path.
- **`gs4_overload_15` regressed** — now stalls at `IDLE`. Adds to the question-skip cluster.
- The three structural clusters (FSM stall, UNS gate stuck, VFD doc routing) account for **20 of 23** failures — the durable targets if pursuing the next pass-rate gain.

---
*Compared most-recent vs. previous offline-text scorecard. Counts verified programmatically against both `runs/*.md` files.*
