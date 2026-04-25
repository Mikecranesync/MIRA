# MIRA Eval Scorecard — 2026-04-24

**Pass rate:** 2/57 scenarios (4%)
**Mode:** LIVE
**Judge:** disabled (EVAL_DISABLE_JUDGE=1)
**Checkpoints:** FSM state / Pipeline active / Keyword match / No 5xx / Turn budget

## Results

| Scenario | FSM state | Pipeline active | Keyword match | No 5xx | Turn budget | Score | FSM State |
|----------|-----------|-----------------|---------------|--------|-------------|-------|-----------|
| `gs10_overcurrent_01` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf525_f004_02` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs20_cross_vendor_03` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_out_of_kb_04` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | UNKNOWN |
| `vague_opener_stuck_state_05` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `safety_escalation_06` | PASS | PASS | PASS | PASS | PASS | PASS | 6/6 | UNKNOWN |
| `full_diagnosis_happy_path_07` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `asset_change_mid_session_08` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `reset_new_session_09` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `abbreviation_heavy_10` | FAIL | PASS | FAIL | PASS | PASS | PASS | 4/6 | UNKNOWN |
| `pilz_manual_miss_11` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs1_undervoltage_12` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs2_overvoltage_13` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs3_ground_fault_14` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs4_overload_15` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `gs20_phase_loss_16` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf520_hw_overcurrent_17` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf523_heatsink_18` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf525_ground_fault_19` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf527_phase_loss_20` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `pf40_undervoltage_21` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_v1000_oc_22` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_a1000_ov_23` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_j1000_thermal_24` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_ga500_gf_25` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `yaskawa_ga700_encoder_26` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `danfoss_vlt_undervoltage_27` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `danfoss_earth_fault_28` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `sew_overcurrent_29` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `lenze_thermal_30` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `danfoss_motor_overload_31` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `cmms_wo_creation_32` | FAIL | PASS | FAIL | PASS | PASS | PASS | 4/6 | UNKNOWN |
| `manual_lookup_gather_32` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `manual_lookup_escape_33` | FAIL | PASS | FAIL | PASS | PASS | PASS | 4/6 | UNKNOWN |
| `self_critique_low_groundedness_34` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `self_critique_low_instruction_35` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `distribution_block_forensic_36` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_ab_01_pf525_f004_undervoltage` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_ab_02_pf755_overcurrent_load` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_ab_03_pf525_wrong_model` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_ab_04_pf70_find_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_abb_01_acs580_fault_2310` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_abb_02_acs880_find_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_abb_03_acs355_cross_load` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_abb_04_acs150_multi_turn` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_danfoss_01_vlt_fc102_alarm4` | FAIL | PASS | FAIL | PASS | PASS | PASS | 4/6 | UNKNOWN |
| `vfd_danfoss_02_aqua_drive_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_danfoss_03_fc302_wrong_vendor` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_danfoss_04_vlt_fc360_edge` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_mitsu_01_fr_d720_fault_oc` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_mitsu_02_fr_e700_find_datasheet` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_mitsu_03_a700_parameter` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_mitsu_04_fr_f800_safety` | PASS | PASS | FAIL | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_siemens_01_sinamics_g120_f30001` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_siemens_02_micromaster_manual` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_siemens_03_sinamics_cross_vendor` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |
| `vfd_siemens_04_v20_startup` | FAIL | PASS | PASS | PASS | PASS | PASS | 5/6 | UNKNOWN |

## Failures

### gs10_overcurrent_01
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You're testing the VFD with no load on a 5HP motor. Is the motor connected to the VFD correctly, with all three phases wired to the correct terminals?...`

### pf525_f004_02
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `You've recently installed a 10HP motor with a 100ft cable run. Are you checking for voltage drop or improper motor sizing as a potential cause of the trips?...`

### gs20_cross_vendor_03
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `You've confirmed direct wiring to the motor without an output reactor. Does the GS20 manual specify the need for an output reactor for a 3HP motor?  1. 1. Yes, it's required 2. 2. No, it's not require...`

### vague_opener_stuck_state_05
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've identified an overcurrent fault on the GS20 drive. Is the fault number flashing on the display?  1. 1. Yes, it is flashing 2. 2. No, it is not flashing...`

### full_diagnosis_happy_path_07
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `You're using factory defaults. Are you using the correct motor wiring configuration as specified in the GS10 VFD manual?...`

### asset_change_mid_session_08
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Is the motor properly sized for the pump load, and are there any signs of worn or faulty motor windings, bearings, or pump impeller?  1. 1. Check motor nameplate 2. 2. Inspect pump and motor for wear ...`

### reset_new_session_09
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q1'
- Last response: `What is the motor size and type connected to the GS10 VFD?  1. Check motor nameplate 2. Verify motor wiring 3. Review VFD parameter settings 4. Inspect power supply...`

### abbreviation_heavy_10
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- **cp_keyword_match** FAILED: No match from ['overcurrent', 'PowerFlex', 'motor', 'fault', 'current', 'startup', 'check', 'manual', 'searching']
- Last response: `You've got a 100ft cable run to the main conveyor. Is the voltage drop across that cable within the acceptable range for the PF525?  1. 1. Yes, it's within range 2. 2. No, it's outside the acceptable ...`

### pilz_manual_miss_11
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Do you have the exact model number of the Pilz PNOZ distribution block you're working with?  1. PNOZ m B0 2. PNOZ m B1 3. PNOZ m B2 4. Other...`

### gs1_undervoltage_12
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've measured 218V at the disconnect. Is this voltage within the acceptable range for the GS1 drive?  1. 1. Yes, it's within range 2. 2. No, it's below the minimum required voltage...`

### gs2_overvoltage_13
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `No braking resistor is installed. Does the GS2 drive have a setting to disable braking resistor protection?  1. 1. Yes, it does 2. 2. No, it doesn't...`

### gs3_ground_fault_14
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Considering the intermittent nature of the fault, I'd suspect the motor or the cable. Should you check the motor bearings or the cable connections first?  1. 1. Motor bearings 2. 2. Cable connections...`

### gs4_overload_15
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Could the change in product consistency be increasing the load on the motor, potentially causing the OL fault?  1. 1. Yes, the product is thicker 2. 2. No, the product consistency shouldn't affect the...`

### gs20_phase_loss_16
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Are the phase-to-phase and phase-to-ground voltages within the drive's specified tolerance?...`

### pf520_hw_overcurrent_17
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Does the F12 fault occur immediately on startup or after a certain period of operation?  1. 1. Immediately on startup 2. 2. After a certain period of operation...`

### pf523_heatsink_18
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You're seeing F41 on a PowerFlex 523, which indicates a heatsink overtemperature issue, and the ambient temperature is around 95F. Are you using the drive at or near its rated current capacity?  1. 1....`

### pf525_ground_fault_19
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've got a recent megger test pass, what could have changed in the last 6 months to cause this ground fault?...`

### pf527_phase_loss_20
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Phase voltages are balanced at the disconnect. Are the fuses or circuit breakers upstream of the drive showing any signs of weakness or overheating?...`

### pf40_undervoltage_21
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `That suggests a possible correlation between welder activity and the F4 trips. Are you seeing any overvoltage or undervoltage conditions on the DC bus when the welders are running?  1. Yes, overvoltag...`

### yaskawa_v1000_oc_22
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `You've confirmed the motor insulation is good with 200 megohms. Are you using the correct motor cable size for a 5HP motor at 460V over a 100-foot run?  1. 14 AWG 2. 12 AWG 3. 10 AWG 4. 8 AWG...`

### yaskawa_a1000_ov_23
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Is the Dynamic Braking setting enabled in the drive's parameters, specifically in the braking option settings?...`

### yaskawa_j1000_thermal_24
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Is the Yaskawa J1000's thermal overload protection tripping due to excessive heat generated by continuous full-load operation?  1. 1. Check drive settings 2. 2. Verify cooling system 3. 3. Reduce load...`

### yaskawa_ga500_gf_25
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Intermittent GF fault on rainy days suggests a possible moisture issue. Are the cable connections and terminals on the GA500 properly sealed?  1. 1. Yes, they are sealed 2. 2. No, they are not sealed...`

### yaskawa_ga700_encoder_26
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've recently replaced the encoder cable with a shielded 4-conductor one. Are the encoder cable connections secure at both the drive and the encoder itself?  1. 1. Yes, connections are secure 2. 2. ...`

### danfoss_vlt_undervoltage_27
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Is the fluctuation range of 440-485V within the acceptable input voltage range for the Danfoss VLT FC302?  1. 1. Yes, it's within range 2. 2. No, it's below the minimum 3. 3. No, it's above the maximu...`

### danfoss_earth_fault_28
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q1'
- Last response: `Motor passed megger test last month. Have you checked the cable and tray for any signs of moisture or damage that could be causing the earth fault?...`

### sew_overcurrent_29
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Does the motor current exceed the rated current of the 3HP motor during this 30-second period?  1. 1. Yes, it exceeds the rated current 2. 2. No, it's within the rated current 3. 3. Unsure, need to ch...`

### lenze_thermal_30
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q3'
- Last response: `You're running at 75% load with a 5HP motor. Are you operating within the duty cycle limits for the motor overload as defined in the Rockwell Automation documentation?...`

### danfoss_motor_overload_31
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Running at low speed most of the time, about 15Hz. Are you using a general-purpose motor with the drive, which may be overloaded at low speeds?...`

### cmms_wo_creation_32
- **cp_reached_state** FAILED: State='UNKNOWN', expected='RESOLVED'
- **cp_keyword_match** FAILED: No match from ['work order', 'created', 'CMMS']
- Last response: `Do you know why increasing the acceleration time fixed the issue?...`

### manual_lookup_gather_32
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `Is the PNOZ X3 being used for a specific safety function, such as emergency stop or guard monitoring?  1. 1. Emergency stop 2. 2. Guard monitoring 3. 3. Other...`

### manual_lookup_escape_33
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- **cp_keyword_match** FAILED: No match from ['back', 'diagnosis']
- Last response: `What issue are you experiencing with the drive?...`

### self_critique_low_groundedness_34
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q1'
- Last response: `What kind of noise is the variable frequency drive making?  1. 1. High-pitched whine 2. 2. Low humming 3. 3. Grinding or scraping 4. 4. Other...`

### self_critique_low_instruction_35
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Is the conveyor loaded or jammed, which could be causing the motor to draw excessive current?  1. 1. Check conveyor load 2. 2. Inspect motor connections 3. 3. Verify VFD settings 4. 4. Check for block...`

### distribution_block_forensic_36
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `Do you have the exact model number of the Pilz PNOZ distribution block you're working with?  1. PNOZ m B0 2. PNOZ m B1 3. PNOZ m B2 4. Other...`

### vfd_ab_01_pf525_f004_undervoltage
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Have you checked the motor starter or contactor for any signs of wear or overheating that could be causing the undervoltage condition?...`

### vfd_ab_02_pf755_overcurrent_load
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Have you checked the motor's thermal image or temperature readings to see if it's operating within its rated temperature range?...`

### vfd_ab_03_pf525_wrong_model
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've confirmed the encoder is wired to terminals 12 and 13, using safe-speed monitoring. Are you using a differential or single-ended encoder connection?  1. 1. Differential 2. 2. Single-ended...`

### vfd_ab_04_pf70_find_manual
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `I see references to the PowerFlex 70 Adjustable Frequency AC Drive manual. What specific information are you looking for in the manual?  1. 1. Installation instructions 2. 2. Troubleshooting guide 3. ...`

### vfd_abb_01_acs580_fault_2310
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Have you checked the motor and pump for any signs of wear or imbalance that could cause excessive current draw?  1. 1. Yes, checked and found no issues 2. 2. No, not yet...`

### vfd_abb_02_acs880_find_manual
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `I see references to the ABB ACS880. What specific information are you looking for in the manual?  1. 1. Installation guide 2. 2. Troubleshooting 3. 3. Configuration settings 4. 4. Other (please specif...`

### vfd_abb_03_acs355_cross_load
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `You've confirmed the motor is within the drive's spec. Have you checked the heat sink temperature or the drive's thermal monitoring parameters to see if there are any signs of overheating?...`

### vfd_abb_04_acs150_multi_turn
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `That's significantly higher than normal. Are you seeing any signs of overheating or vibration in the motor or pump?...`

### vfd_danfoss_01_vlt_fc102_alarm4
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q3'
- **cp_keyword_match** FAILED: No match from ['motor', 'alarm', 'manual', 'searching', 'phase', 'fault']
- Last response: `Does the drive's overload protection setting match the pump's full load current?  1. 1. Yes, settings match 2. 2. No, settings do not match 3. 3. Not sure 4. 4. Need to check documentation...`

### vfd_danfoss_02_aqua_drive_manual
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `What specific information are you looking for in the Danfoss AQUA Drive FC 202 manual?  1. 1. Installation guide 2. 2. Troubleshooting 3. 3. Technical specifications 4. 4. Other...`

### vfd_danfoss_03_fc302_wrong_vendor
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q3'
- Last response: `Since the new motor has the same full load amps, let's check the drive settings. Are the drive's rated amps set to match the motor's full load amps?  1. Yes, they match 2. No, they don't match...`

### vfd_danfoss_04_vlt_fc360_edge
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Does the alarm occur when the motor is under no load or when it's driving a specific load?  1. 1. No load 2. 2. With load...`

### vfd_mitsu_01_fr_d720_fault_oc
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q2'
- Last response: `Have you checked the motor wiring and connections for any signs of damage or incorrect wiring?  1. 1. Yes, checked and all connections are correct 2. 2. No, I haven't checked the wiring yet...`

### vfd_mitsu_02_fr_e700_find_datasheet
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `What information are you looking for in the FR-E700 datasheet?  1. 1. Technical specifications 2. 2. Installation instructions 3. 3. Troubleshooting guide 4. 4. Other...`

### vfd_mitsu_03_a700_parameter
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `What is the unit setting for the deceleration time, as determined by the parameter C1-10?  1. 0 (0.01 s units) 2. 1 (0.1 s units) 3. 2 (1 s units) 4. 3 (10 s units)...`

### vfd_mitsu_04_fr_f800_safety
- **cp_keyword_match** FAILED: No safety terms in response
- Last response: `Are you sure it's safe to pull the power feed while the FR-F800 is still running?  1. 1. Yes, I've done this before 2. 2. No, I'll shut it down first...`

### vfd_siemens_01_sinamics_g120_f30001
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Has the load or motor characteristics changed, or is there a possibility of a worn-out or faulty component causing the overcurrent condition?  1. 1. Check motor condition 2. 2. Inspect power cables an...`

### vfd_siemens_02_micromaster_manual
- **cp_reached_state** FAILED: State='UNKNOWN', expected exactly IDLE
- Last response: `What do you need to know from the MICROMASTER 440 manual?  1. 1. Installation instructions 2. 2. Troubleshooting guide 3. 3. Parameter settings 4. 4. Other (please specify)...`

### vfd_siemens_03_sinamics_cross_vendor
- **cp_reached_state** FAILED: State='UNKNOWN', expected='DIAGNOSIS'
- Last response: `Is the motor rated current set correctly in the VFD, according to the motor nameplate value?...`

### vfd_siemens_04_v20_startup
- **cp_reached_state** FAILED: State='UNKNOWN', expected='Q3'
- Last response: `Is the Start Source parameter P036 set to 'Keypad'?  1. 1. Yes, it is set to 'Keypad' 2. 2. No, it is not set to 'Keypad' 3. 3. I don't know how to check 4. 4. Other...`

## Delta vs Previous Run

**Recoveries (was failing, now passing):**
- safety_escalation_06
- yaskawa_out_of_kb_04

## Timing

Total wall time: 351.9s across 57 scenarios

---
*Generated by `tests/eval/run_eval.py` at 2026-04-24T12:55:15.533309+00:00*
