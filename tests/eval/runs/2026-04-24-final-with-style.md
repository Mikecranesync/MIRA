# MIRA Eval Scorecard — 2026-04-24

**Pass rate:** 53/66 scenarios (80%)
**Mode:** LIVE
**Judge:** disabled (EVAL_DISABLE_JUDGE=1)
**Checkpoints:** FSM state / Pipeline active / Keyword match / No 5xx / Turn budget

## Results

| Scenario | FSM state | Pipeline active | Keyword match | No 5xx | Turn budget | Score | FSM State |
|----------|-----------|-----------------|---------------|--------|-------------|-------|-----------|
| `gs10_overcurrent_01` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `pf525_f004_02` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `gs20_cross_vendor_03` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_out_of_kb_04` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vague_opener_stuck_state_05` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `safety_escalation_06` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `full_diagnosis_happy_path_07` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `asset_change_mid_session_08` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `reset_new_session_09` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `abbreviation_heavy_10` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | Q2 |
| `pilz_manual_miss_11` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | MANUAL_LOOKUP_GATHERING |
| `gs1_undervoltage_12` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS |
| `gs2_overvoltage_13` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `gs3_ground_fault_14` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `gs4_overload_15` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `gs20_phase_loss_16` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `pf520_hw_overcurrent_17` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `pf523_heatsink_18` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS_REVISION |
| `pf525_ground_fault_19` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `pf527_phase_loss_20` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `pf40_undervoltage_21` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_v1000_oc_22` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_a1000_ov_23` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_j1000_thermal_24` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_ga500_gf_25` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `yaskawa_ga700_encoder_26` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `danfoss_vlt_undervoltage_27` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `danfoss_earth_fault_28` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `sew_overcurrent_29` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `lenze_thermal_30` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS_REVISION |
| `danfoss_motor_overload_31` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `cmms_wo_creation_32` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | RESOLVED |
| `manual_lookup_gather_32` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `manual_lookup_escape_33` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `self_critique_low_groundedness_34` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `self_critique_low_instruction_35` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `distribution_block_forensic_36` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | DIAGNOSIS_REVISION |
| `why_undervoltage_trips_37` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `how_ground_fault_protection_38` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS |
| `why_acceleration_matters_39` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `multimeter_technique_40` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS |
| `why_derating_41` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `plc_ton_timer_scan_42` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `studio5000_io_config_43` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `cop_command_usage_44` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | Q2 |
| `troubleshooting_workflow_45` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `vfd_ab_01_pf525_f004_undervoltage` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_ab_02_pf755_overcurrent_load` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_ab_03_pf525_wrong_model` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_ab_04_pf70_find_manual` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `vfd_abb_01_acs580_fault_2310` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS_REVISION |
| `vfd_abb_02_acs880_find_manual` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `vfd_abb_03_acs355_cross_load` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | DIAGNOSIS_REVISION |
| `vfd_abb_04_acs150_multi_turn` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_danfoss_01_vlt_fc102_alarm4` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_danfoss_02_aqua_drive_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | Q1 |
| `vfd_danfoss_03_fc302_wrong_vendor` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_danfoss_04_vlt_fc360_edge` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | Q1 |
| `vfd_mitsu_01_fr_d720_fault_oc` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_mitsu_02_fr_e700_find_datasheet` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | Q1 |
| `vfd_mitsu_03_a700_parameter` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `vfd_mitsu_04_fr_f800_safety` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | IDLE |
| `vfd_siemens_01_sinamics_g120_f30001` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_siemens_02_micromaster_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | Q1 |
| `vfd_siemens_03_sinamics_cross_vendor` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |
| `vfd_siemens_04_v20_startup` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | DIAGNOSIS |

## Failures

### pilz_manual_miss_11
- **cp_reached_state** FAILED: State='MANUAL_LOOKUP_GATHERING', expected='DIAGNOSIS'
- Last response: `Got it — Pilz. What's the **exact model number**? It's usually printed on the nameplate. (Say 'skip' to try with what I have, or 'back to troubleshooting' to drop the manual search.)...`

### gs1_undervoltage_12
- **cp_keyword_match** FAILED: Forbidden keywords present: ['Yaskawa']
- Last response: `You mentioned the voltage at the disconnect is 218V. Is this voltage reading within the acceptable range for the GS1 drive's input voltage specification?  1. Yes, it's within range 2. No, it's below t...`

### pf523_heatsink_18
- **cp_keyword_match** FAILED: Forbidden keywords present: ['Danfoss']
- Last response: `Before I can give you a confident diagnosis, could you share one more detail — what exact fault code, alarm number, or behaviour is the equipment showing right now? (e.g. fault light colour, code disp...`

### lenze_thermal_30
- **cp_keyword_match** FAILED: No match from ['motor', 'load']
- Last response: `Before I can give you a confident diagnosis, could you share one more detail — what exact fault code, alarm number, or behaviour is the equipment showing right now? (e.g. fault light colour, code disp...`

### distribution_block_forensic_36
- **cp_reached_state** FAILED: State='DIAGNOSIS_REVISION', expected exactly IDLE
- Last response: `I already have documentation indexed for that equipment — just ask me about fault codes, specs, or wiring and I'll pull from it directly....`

### how_ground_fault_protection_38
- **cp_keyword_match** FAILED: No match from ['current', 'imbalance', 'phase', 'leakage', 'sum', 'winding', 'insulation']
- Last response: `Does the ground fault detection occur on the line side of the VFD, where the input power is connected, or on the load side, where the output is connected to the motor?  1. Line side 2. Load side  --- ...`

### multimeter_technique_40
- **cp_keyword_match** FAILED: No safety terms in response
- Last response: `Based on general knowledge, a standard multimeter like the Fluke 87V may not be sufficient for detecting internal shorts in motor windings. Would you consider using a megohmmeter to measure insulation...`

### cop_command_usage_44
- **cp_reached_state** FAILED: State='Q2', expected='DIAGNOSIS'
- Last response: `You're working with REAL type data for your recipes. Are you trying to copy the entire 20-element table at once or just specific elements from one recipe to another?...`

### vfd_abb_03_acs355_cross_load
- **cp_keyword_match** FAILED: Forbidden keywords present: ['AutomationDirect']
- Last response: `Before I can give you a confident diagnosis, could you share one more detail — what exact fault code, alarm number, or behaviour is the equipment showing right now? (e.g. fault light colour, code disp...`

### vfd_danfoss_02_aqua_drive_manual
- **cp_reached_state** FAILED: State='Q1', expected exactly IDLE
- Last response: `I don't have documentation for the Danfoss AQUA Drive FC 202 in my knowledge base. Based on general knowledge (not from specific documentation), you may be able to find the manual on the official Danf...`

### vfd_danfoss_04_vlt_fc360_edge
- **cp_reached_state** FAILED: State='Q1', expected='Q2'
- Last response: `Does the display show the alarm icon and then a code, or just the alarm light?  1. Alarm icon and code 2. Just alarm light  --- Sources --- [1] knowledge base — 8.2 Alarms [2] knowledge base — Note [3...`

### vfd_mitsu_02_fr_e700_find_datasheet
- **cp_reached_state** FAILED: State='Q1', expected exactly IDLE
- Last response: `I don't have documentation for this equipment in my knowledge base. Based on general knowledge (not from specific documentation), the FR-E700 might be a product from Mitsubishi Electric. Can you provi...`

### vfd_siemens_02_micromaster_manual
- **cp_reached_state** FAILED: State='Q1', expected exactly IDLE
- Last response: `I don't have documentation for the MICROMASTER 440 in my knowledge base. Based on general knowledge (not from specific documentation), I can suggest searching the Siemens website for the manual. Can y...`

## Delta vs Previous Run

**Recoveries (was failing, now passing):**
- abbreviation_heavy_10
- asset_change_mid_session_08
- cmms_wo_creation_32
- danfoss_earth_fault_28
- danfoss_motor_overload_31
- danfoss_vlt_undervoltage_27
- full_diagnosis_happy_path_07
- gs10_overcurrent_01
- gs20_cross_vendor_03
- gs20_phase_loss_16
- gs2_overvoltage_13
- gs3_ground_fault_14
- gs4_overload_15
- manual_lookup_escape_33
- manual_lookup_gather_32
- pf40_undervoltage_21
- pf520_hw_overcurrent_17
- pf525_f004_02
- pf525_ground_fault_19
- pf527_phase_loss_20
- plc_ton_timer_scan_42
- reset_new_session_09
- safety_escalation_06
- self_critique_low_groundedness_34
- self_critique_low_instruction_35
- sew_overcurrent_29
- studio5000_io_config_43
- troubleshooting_workflow_45
- vague_opener_stuck_state_05
- vfd_ab_01_pf525_f004_undervoltage
- vfd_ab_02_pf755_overcurrent_load
- vfd_ab_03_pf525_wrong_model
- vfd_ab_04_pf70_find_manual
- vfd_abb_01_acs580_fault_2310
- vfd_abb_02_acs880_find_manual
- vfd_abb_04_acs150_multi_turn
- vfd_danfoss_01_vlt_fc102_alarm4
- vfd_danfoss_03_fc302_wrong_vendor
- vfd_mitsu_01_fr_d720_fault_oc
- vfd_mitsu_03_a700_parameter
- vfd_mitsu_04_fr_f800_safety
- vfd_siemens_01_sinamics_g120_f30001
- vfd_siemens_03_sinamics_cross_vendor
- vfd_siemens_04_v20_startup
- why_acceleration_matters_39
- why_derating_41
- why_undervoltage_trips_37
- yaskawa_a1000_ov_23
- yaskawa_ga500_gf_25
- yaskawa_ga700_encoder_26
- yaskawa_j1000_thermal_24
- yaskawa_out_of_kb_04
- yaskawa_v1000_oc_22

## Timing

Total wall time: 2674.0s across 66 scenarios

---
*Generated by `tests/eval/run_eval.py` at 2026-04-24T15:19:47.367969+00:00*
