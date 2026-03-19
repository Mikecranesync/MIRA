# MIRA v2 Autonomous Test Report
Generated: 2026-03-16 14:33 UTC

## 1. Summary
| Metric | Value |
|--------|-------|
| Total cases | 120 |
| Passed | 120 |
| Failed | 0 |
| Pass rate | 100.0% |
| Fix cycles | 1 |
| Avg words | 66.0 |
| Avg response time | 9.26s |
| Decision | **REPORT_ONLY** |
| Release version | v1.0.1 |

> Ingest rate 100.0% — ready for release. Run with --release to tag v1.0.1.

## 2. Category Breakdown

| Category | Total | Passed | Rate |
|----------|-------|--------|------|
| ELEC | 5 | 5 | 100% |
| HYDRAULIC | 5 | 5 | 100% |
| MOTOR | 15 | 15 | 100% |
| PANEL | 15 | 15 | 100% |
| PLC | 20 | 20 | 100% |
| PM | 10 | 10 | 100% |
| PROCESS | 5 | 5 | 100% |
| SAFETY | 5 | 5 | 100% |
| SENSOR | 10 | 10 | 100% |
| STARTUP | 10 | 10 | 100% |
| VFD | 20 | 20 | 100% |

## 3. Self-Healing Summary

| Case | Heal Type | Attempts | Original Bucket |
|------|-----------|----------|----------------|
| sensor_proximity_no_output_74 | HEALED_JUDGE | 1 | RESPONSE_TOO_GENERIC |

## 6. Case Results

| # | Case | Result | Bucket | Words | Healing |
|---|------|--------|--------|-------|---------|
| 1 | vfd_overcurrent_01 | ✅ | — | 47 | — |
| 2 | vfd_overvoltage_02 | ✅ | — | 73 | — |
| 3 | vfd_ground_fault_03 | ✅ | — | 65 | — |
| 4 | vfd_overtemp_04 | ✅ | — | 65 | — |
| 5 | vfd_comm_loss_05 | ✅ | — | 86 | — |
| 6 | vfd_dc_bus_undervolt_06 | ✅ | — | 67 | — |
| 7 | vfd_motor_stall_07 | ✅ | — | 50 | — |
| 8 | vfd_output_phase_loss_08 | ✅ | — | 56 | — |
| 9 | vfd_keypad_fault_09 | ✅ | — | 77 | — |
| 10 | vfd_input_phase_loss_10 | ✅ | — | 56 | — |
| 11 | vfd_decel_fault_11 | ✅ | — | 46 | — |
| 12 | vfd_external_fault_12 | ✅ | — | 59 | — |
| 13 | vfd_run_at_low_freq_13 | ✅ | — | 60 | — |
| 14 | vfd_parameter_lost_14 | ✅ | — | 61 | — |
| 15 | vfd_noise_interference_15 | ✅ | — | 63 | — |
| 16 | vfd_capacitor_worn_16 | ✅ | — | 53 | — |
| 17 | vfd_fan_failure_17 | ✅ | — | 67 | — |
| 18 | vfd_glare_image_18 | ✅ | ADVERSARIAL_PARTIAL | 94 | — |
| 19 | vfd_cropped_tag_19 | ✅ | ADVERSARIAL_PARTIAL | 62 | — |
| 20 | vfd_locked_rotor_20 | ✅ | — | 49 | — |
| 21 | plc_io_failure_21 | ✅ | — | 73 | — |
| 22 | plc_comms_timeout_22 | ✅ | — | 70 | — |
| 23 | plc_program_fault_23 | ✅ | — | 80 | — |
| 24 | plc_power_loss_24 | ✅ | — | 68 | — |
| 25 | plc_input_card_failure_25 | ✅ | — | 76 | — |
| 26 | plc_battery_low_26 | ✅ | — | 61 | — |
| 27 | plc_modbus_slave_error_27 | ✅ | — | 75 | — |
| 28 | plc_watchdog_fault_28 | ✅ | — | 76 | — |
| 29 | plc_output_shorted_29 | ✅ | — | 94 | — |
| 30 | plc_ethernet_ip_offline_30 | ✅ | — | 65 | — |
| 31 | plc_analog_drift_31 | ✅ | — | 55 | — |
| 32 | plc_ram_fault_32 | ✅ | — | 70 | — |
| 33 | plc_firmware_mismatch_33 | ✅ | — | 57 | — |
| 34 | plc_glare_fault_34 | ✅ | ADVERSARIAL_PARTIAL | 91 | — |
| 35 | plc_cropped_fault_35 | ✅ | ADVERSARIAL_PARTIAL | 66 | — |
| 36 | plc_ground_loop_36 | ✅ | — | 80 | — |
| 37 | plc_node_address_conflict_37 | ✅ | — | 54 | — |
| 38 | plc_no_output_power_38 | ✅ | — | 54 | — |
| 39 | plc_dip_switch_wrong_39 | ✅ | — | 51 | — |
| 40 | plc_online_edit_crash_40 | ✅ | — | 59 | — |
| 41 | motor_overload_trip_41 | ✅ | — | 57 | — |
| 42 | motor_bearing_noise_42 | ✅ | — | 75 | — |
| 43 | motor_winding_fault_43 | ✅ | — | 56 | — |
| 44 | motor_phase_loss_44 | ✅ | — | 68 | — |
| 45 | motor_overtemp_sensor_45 | ✅ | — | 53 | — |
| 46 | motor_coupling_failure_46 | ✅ | — | 78 | — |
| 47 | motor_cooling_blocked_47 | ✅ | — | 65 | — |
| 48 | motor_vibration_misalign_48 | ✅ | — | 67 | — |
| 49 | motor_rotor_bar_49 | ✅ | — | 53 | — |
| 50 | motor_wrong_rotation_50 | ✅ | — | 55 | — |
| 51 | motor_locked_bearing_51 | ✅ | ADVERSARIAL_PARTIAL | 79 | — |
| 52 | motor_cabinet_generic_52 | ✅ | — | 65 | — |
| 53 | motor_undersized_53 | ✅ | — | 69 | — |
| 54 | motor_delta_open_54 | ✅ | — | 63 | — |
| 55 | motor_seal_failure_55 | ✅ | — | 61 | — |
| 56 | panel_breaker_trip_56 | ✅ | — | 91 | — |
| 57 | panel_contactor_failure_57 | ✅ | — | 59 | — |
| 58 | panel_blown_fuse_58 | ✅ | — | 86 | — |
| 59 | panel_loose_connection_59 | ✅ | — | 78 | — |
| 60 | panel_phase_reversal_60 | ✅ | — | 78 | — |
| 61 | panel_surge_damage_61 | ✅ | — | 74 | — |
| 62 | panel_ground_fault_interrupter_62 | ✅ | — | 76 | — |
| 63 | panel_relay_coil_burn_63 | ✅ | — | 74 | — |
| 64 | panel_overloaded_bus_64 | ✅ | — | 68 | — |
| 65 | panel_arc_flash_event_65 | ✅ | — | 67 | — |
| 66 | panel_nuisance_trip_66 | ✅ | — | 79 | — |
| 67 | panel_no_neutral_67 | ✅ | — | 68 | — |
| 68 | panel_glare_fault_68 | ✅ | ADVERSARIAL_PARTIAL | 54 | — |
| 69 | panel_vfd_in_mcc_69 | ✅ | — | 62 | — |
| 70 | panel_wire_label_missing_70 | ✅ | — | 84 | — |
| 71 | sensor_4_20ma_loss_71 | ✅ | — | 57 | — |
| 72 | sensor_encoder_fault_72 | ✅ | — | 55 | — |
| 73 | sensor_thermocouple_open_73 | ✅ | — | 69 | — |
| 74 | sensor_proximity_no_output_74 | ✅ | — | 79 | HEALED_JUDGE |
| 75 | sensor_pressure_drift_75 | ✅ | — | 55 | — |
| 76 | sensor_photoelectric_false_trigger_76 | ✅ | — | 77 | — |
| 77 | sensor_rtd_shorted_77 | ✅ | — | 54 | — |
| 78 | sensor_level_switch_stuck_78 | ✅ | — | 57 | — |
| 79 | sensor_vfd_feedback_lost_79 | ✅ | — | 49 | — |
| 80 | sensor_cable_damage_80 | ✅ | ADVERSARIAL_PARTIAL | 69 | — |
| 81 | startup_first_power_on_81 | ✅ | — | 60 | — |
| 82 | startup_vfd_first_run_82 | ✅ | — | 49 | — |
| 83 | startup_panel_energize_83 | ✅ | — | 63 | — |
| 84 | startup_modbus_config_84 | ✅ | — | 75 | — |
| 85 | startup_motor_direction_85 | ✅ | — | 54 | — |
| 86 | startup_ip_address_config_86 | ✅ | — | 63 | — |
| 87 | startup_parameter_backup_87 | ✅ | — | 52 | — |
| 88 | startup_acceleration_tuning_88 | ✅ | — | 67 | — |
| 89 | startup_overload_set_89 | ✅ | — | 63 | — |
| 90 | startup_io_check_90 | ✅ | — | 93 | — |
| 91 | pm_vfd_annual_91 | ✅ | — | 76 | — |
| 92 | pm_plc_annual_92 | ✅ | — | 75 | — |
| 93 | pm_panel_thermal_scan_93 | ✅ | — | 80 | — |
| 94 | pm_contactor_replace_94 | ✅ | — | 78 | — |
| 95 | pm_vfd_capacitor_age_95 | ✅ | — | 57 | — |
| 96 | pm_encoder_cleaning_96 | ✅ | — | 52 | — |
| 97 | pm_motor_lubrication_97 | ✅ | — | 89 | — |
| 98 | pm_battery_replace_98 | ✅ | — | 69 | — |
| 99 | pm_panel_cleaning_99 | ✅ | — | 40 | — |
| 100 | pm_vfd_torque_check_100 | ✅ | — | 58 | — |
| 101 | elec_drawing_ladder_101 | ✅ | — | 59 | — |
| 102 | elec_drawing_oneline_102 | ✅ | — | 61 | — |
| 103 | elec_drawing_pid_103 | ✅ | — | 52 | — |
| 104 | elec_drawing_wiring_104 | ✅ | — | 89 | — |
| 105 | elec_drawing_schematic_105 | ✅ | ADVERSARIAL_PARTIAL | 89 | — |
| 106 | hydraulic_pressure_drop_106 | ✅ | — | 67 | — |
| 107 | hydraulic_cylinder_drift_107 | ✅ | — | 77 | — |
| 108 | hydraulic_pump_cavitation_108 | ✅ | — | 47 | — |
| 109 | hydraulic_valve_stuck_109 | ✅ | — | 72 | — |
| 110 | hydraulic_relief_valve_110 | ✅ | — | 83 | — |
| 111 | process_pump_cavitation_111 | ✅ | — | 57 | — |
| 112 | process_compressor_fault_112 | ✅ | — | 76 | — |
| 113 | process_fan_vibration_113 | ✅ | — | 47 | — |
| 114 | process_heat_exchanger_114 | ✅ | — | 65 | — |
| 115 | process_valve_actuator_115 | ✅ | — | 70 | — |
| 116 | safety_estop_wiring_116 | ✅ | — | 60 | — |
| 117 | safety_light_curtain_117 | ✅ | — | 55 | — |
| 118 | safety_relay_fault_118 | ✅ | — | 66 | — |
| 119 | safety_door_interlock_119 | ✅ | — | 50 | — |
| 120 | safety_two_hand_control_120 | ✅ | — | 53 | — |

### Standing Verdicts


## 7. Release Verdict

**Action:** REPORT_ONLY
**Version:** v1.0.1
**Ingest pass rate:** 100.0%

> Ingest rate 100.0% — ready for release. Run with --release to tag v1.0.1.
