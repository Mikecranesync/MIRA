PROGRAM Prog2
(* ================================================================ *)
(*  MIRA Conveyor Control -- Micro820 2080-LC20-20QBB               *)
(*  Version:  v5.1.0  (Trends V2 -- full GS10 monitoring)           *)
(*  Date:     2026-06-12                                            *)
(*  Author:   MIRA/Claude                                           *)
(*                                                                  *)
(*  Changelog:                                                      *)
(*  v5.1.0 - Trends V2 (docs/plans/2026-06-12-trends-v2-full-vfd-   *)
(*           monitoring.md). Based on DEPLOYED v5.0.0 (Prog2.stf),  *)
(*           NOT the stale Micro820_v4.1.9_Program.st.              *)
(*           1. Step-1 read widened: 0x2103 x6 -> 0x2100 x7. One    *)
(*              FC03 now covers the whole documented monitor block: *)
(*              Status Monitor 1 (warn|error bytes), Status         *)
(*              Monitor 2 (status bits), freq command, output       *)
(*              freq/current/DC bus/voltage. read_data indices      *)
(*              shift by +3 -- decode below re-indexed.             *)
(*           2. SM1 byte split -> vfd_fault_code (low byte, was     *)
(*              never written before -- the red-light term          *)
(*              vfd_fault_code > 0 now actually fires) and NEW      *)
(*              vfd_warn_code (high byte).                          *)
(*           3. NEW vfd_last_fault latch: holds the last nonzero    *)
(*              fault code; survives the drive's own fault reset.   *)
(*              Cleared ONLY by operator coil last_fault_clear.     *)
(*           4. NEW steps 5/6: FC03 0x210B x2 (torque %x10, motor   *)
(*              rpm) and FC03 0x210F x1 (power kW x1000).           *)
(*              Separate reads -- 0x210D/0x210E are reserved; do    *)
(*              not span them in one transaction.                   *)
(*           5. Poll cycle 4 -> 6 steps; fault-reset skip now goes  *)
(*              4 -> 5 (was 4 -> 1) so the new reads still fire.    *)
(*  v5.0.0 - Clean rebuild from v4.1.9. Per-step MSG timeout so     *)
(*           poll never hangs if serial driver is not loaded.       *)
(*           Channel 0 = built-in RS-485 (confirmed Rockwell docs). *)
(*                                                                  *)
(*  NOTE: All variables declared in CCW Controller Variables table  *)
(*        (PrjLibrary.accdb). Do NOT add a VAR block here.          *)
(*        NEW variables for v5.1.0: see                             *)
(*        plc/CCW_VARIABLES_v5.1.0_DELTA.md                         *)
(*                                                                  *)
(*  Physical I/O:                                                   *)
(*    I-00 = SelectorFWD    O-00 = LightGreen (running)             *)
(*    I-01 = SelectorREV    O-01 = LightRed (fault/e-stop)          *)
(*    I-02 = EStopNC        O-02 = ContactorQ1 (safety)             *)
(*    I-03 = EStopNO        O-03 = PBRunLED (pushbutton light)      *)
(*    I-04 = PBRun                                                  *)
(*                                                                  *)
(*  VFD: AutomationDirect GS10 DURApulse                            *)
(*    RS-485 Modbus RTU, slave addr 1, 9600/8N2                     *)
(*    Command register:  0x2000 (8192) -- bit field                 *)
(*    Freq setpoint reg: 0x2001 (8193) -- Hz x 10                   *)
(*    Fault reset reg:   0x2002 (8194) -- write 2 to reset          *)
(*    Monitor block:     0x2100 (8448) x7 -- SM1, SM2, freq cmd,    *)
(*                       out freq, current, DC bus, out voltage     *)
(*    Load block:        0x210B (8459) x2 -- torque %x10, rpm       *)
(*    Power:             0x210F (8463) x1 -- kW x1000               *)
(*    FWD+RUN=18  REV+RUN=20  STOP=1                               *)
(*                                                                  *)
(*    GS10 0x2101 Status Monitor 2 bits (UM 1st Ed Rev B p4-196):   *)
(*      bits 1-0: 00 stop / 01 decel / 10 standby / 11 operating    *)
(*      bit  2:   JOG command                                       *)
(*      bits 4-3: 00 FWD / 01 REV->FWD / 10 FWD->REV / 11 REV       *)
(*      bit  8:   master freq from comms                            *)
(*      bit  9:   master freq from analog/terminal                  *)
(*      bit 10:   operation command from comms                      *)
(*      bit 11:   parameters locked                                 *)
(*      bit 12:   keypad copy enabled                               *)
(*      bits 15-13: reserved                                        *)
(*      (The v4.1.9 comment claimed bit 13 = drive fault. The       *)
(*       manual has no such bit -- fault truth is SM1 low byte.)    *)
(* ================================================================ *)

  (* ================================================================ *)
  (* SECTION 1 -- E-STOP SUPERVISION (highest priority)               *)
  (*   I-02 (EStopNC) = NC contact (healthy = 1, pressed = 0)        *)
  (*   I-03 (EStopNO) = NO contact (healthy = 0, pressed = 1)        *)
  (*   Dual-channel: I-02 XOR I-03 must be TRUE                      *)
  (* ================================================================ *)
  IF (_IO_EM_DI_02 XOR _IO_EM_DI_03) THEN
    IF NOT _IO_EM_DI_02 AND _IO_EM_DI_03 THEN
      e_stop_active := TRUE;
    ELSE
      e_stop_active := FALSE;
    END_IF;
    estop_wiring_fault := FALSE;
  ELSE
    e_stop_active := TRUE;
    fault_alarm := TRUE;
    estop_wiring_fault := TRUE;
  END_IF;

  (* ================================================================ *)
  (* SECTION 2 -- OPERATOR STATION I/O MAPPING                       *)
  (* ================================================================ *)
  dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_rev := NOT _IO_EM_DI_00 AND _IO_EM_DI_01;
  dir_off := NOT _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_fault := _IO_EM_DI_00 AND _IO_EM_DI_01;

  sensor_1_active := _IO_EM_DI_05;
  sensor_2_active := _IO_EM_DI_06;

  button_rising := _IO_EM_DI_04 AND NOT prev_button;
  prev_button := _IO_EM_DI_04;

  (* ================================================================ *)
  (* SECTION 3 -- SAFETY CONTACTOR Q1 (O-02)                         *)
  (* ================================================================ *)
  _IO_EM_DO_02 := NOT e_stop_active AND NOT estop_wiring_fault;

  (* ================================================================ *)
  (* SECTION 4 -- CONVEYOR STATE MACHINE                              *)
  (*   States: 0=IDLE, 1=STARTING, 2=RUNNING, 3=STOPPING, 4=FAULT    *)
  (* ================================================================ *)
  CASE conv_state OF

    0: (* IDLE *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      motor_speed := 0;
      vfd_cmd_word := 1;

      IF fault_alarm OR e_stop_active OR dir_fault THEN
        conv_state := 4;
      ELSIF button_rising AND (dir_fwd OR dir_rev) THEN
        conv_state := 1;
      END_IF;

    1: (* STARTING *)
      motor_running := TRUE;
      IF dir_fwd THEN
        vfd_cmd_word := 18;
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;
      END_IF;

      IF e_stop_active OR fault_alarm OR dir_fault THEN
        vfd_cmd_word := 1;
        conv_state := 4;
      ELSIF start_timer.Q THEN
        conveyor_running := TRUE;
        conv_state := 2;
      END_IF;

    2: (* RUNNING *)
      motor_running := TRUE;
      conveyor_running := TRUE;
      IF dir_fwd THEN
        vfd_cmd_word := 18;
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;
      END_IF;

      IF e_stop_active OR fault_alarm OR dir_fault THEN
        vfd_cmd_word := 1;
        conv_state := 4;
      ELSIF dir_off THEN
        vfd_cmd_word := 1;
        conv_state := 3;
      END_IF;

      IF sensor_2_active AND NOT SensorEnd_Prev THEN
        item_count := item_count + 1;
      END_IF;
      SensorEnd_Prev := sensor_2_active;
      motor_speed := conveyor_speed_cmd;

    3: (* STOPPING *)
      motor_running := FALSE;
      vfd_cmd_word := 1;
      motor_speed := 0;

      IF e_stop_active OR fault_alarm THEN
        conv_state := 4;
      ELSIF stop_timer.Q THEN
        conveyor_running := FALSE;
        conv_state := 0;
      END_IF;

    4: (* FAULT *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      vfd_cmd_word := 1;
      motor_speed := 0;

      IF e_stop_active THEN
        error_code := 6;
      ELSIF estop_wiring_fault THEN
        error_code := 7;
      ELSIF dir_fault THEN
        error_code := 8;
      ELSIF vfd_comm_err THEN
        error_code := 9;
      END_IF;

      IF button_rising AND NOT e_stop_active
         AND NOT estop_wiring_fault AND NOT dir_off THEN
        fault_alarm := FALSE;
        error_code := 0;
        vfd_fault_reset_pending := TRUE;
        conv_state := 0;
      END_IF;

  ELSE
    conv_state := 0;
  END_CASE;

  start_timer(IN := (conv_state = 1), PT := T#3000ms);
  stop_timer(IN := (conv_state = 3), PT := T#2000ms);

  (* ================================================================ *)
  (* SECTION 5 -- LED INDICATORS                                      *)
  (* ================================================================ *)
  IF ALL_LEDS_ON THEN
    _IO_EM_DO_00 := TRUE;
    _IO_EM_DO_01 := TRUE;
    _IO_EM_DO_03 := TRUE;
  ELSE
    _IO_EM_DO_00 := motor_running;
    _IO_EM_DO_01 := e_stop_active OR fault_alarm OR estop_wiring_fault
                     OR dir_fault OR (vfd_fault_code > 0);
    _IO_EM_DO_03 := motor_running;
  END_IF;

  (* ================================================================ *)
  (* SECTION 6 -- VFD MODBUS RTU COMMUNICATION (v5.1.0 Trends V2)    *)
  (*   Channel 0 = built-in RS-485 serial port on 2080-LC20-20QBB    *)
  (*   GS10 DURApulse at slave address 1, 9600 baud, 8N2             *)
  (*                                                                  *)
  (*   Six MSG steps cycle:                                           *)
  (*     1: READ MONITOR -- FC03 0x2100 x7 (SM1/SM2/freq cmd/out     *)
  (*        freq/current/DC bus/out voltage)                          *)
  (*     2: WRITE CMD    -- FC06 0x2000                               *)
  (*     3: WRITE FREQ   -- FC06 0x2001                               *)
  (*     4: FAULT RESET  -- FC06 0x2002 (only when pending,           *)
  (*        otherwise skip straight to 5)                             *)
  (*     5: READ LOAD    -- FC03 0x210B x2 (torque, rpm)              *)
  (*     6: READ POWER   -- FC03 0x210F x1 (kW x1000)                 *)
  (*                                                                  *)
  (*   v5.0: msg_step_timer -- 2s timeout per step. If neither Q nor  *)
  (*   Error fires within 2s, the step is force-completed with an     *)
  (*   error. Prevents silent hangs when the serial driver is not     *)
  (*   loaded (ErrorID=255).                                          *)
  (* ================================================================ *)

  (* --- Configure Modbus READ MONITOR parameters (v5.1.0: 0x2100 x7) --- *)
  read_local_cfg.Channel := 0;
  read_local_cfg.TriggerType := 0;
  read_local_cfg.Cmd := 3;
  read_local_cfg.ElementCnt := 7;
  read_target_cfg.Addr := 8448;
  read_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE COMMAND parameters --- *)
  write_cmd_local_cfg.Channel := 0;
  write_cmd_local_cfg.TriggerType := 0;
  write_cmd_local_cfg.Cmd := 6;
  write_cmd_local_cfg.ElementCnt := 1;
  write_cmd_target_cfg.Addr := 8192;
  write_cmd_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE FREQUENCY parameters --- *)
  write_freq_local_cfg.Channel := 0;
  write_freq_local_cfg.TriggerType := 0;
  write_freq_local_cfg.Cmd := 6;
  write_freq_local_cfg.ElementCnt := 1;
  write_freq_target_cfg.Addr := 8193;
  write_freq_target_cfg.Node := 1;

  (* --- Configure Modbus FAULT RESET parameters --- *)
  fault_reset_local_cfg.Channel := 0;
  fault_reset_local_cfg.TriggerType := 0;
  fault_reset_local_cfg.Cmd := 6;
  fault_reset_local_cfg.ElementCnt := 1;
  fault_reset_target_cfg.Addr := 8194;
  fault_reset_target_cfg.Node := 1;

  (* --- v5.1.0 NEW: Configure Modbus READ LOAD parameters (0x210B x2) --- *)
  read_load_local_cfg.Channel := 0;
  read_load_local_cfg.TriggerType := 0;
  read_load_local_cfg.Cmd := 3;
  read_load_local_cfg.ElementCnt := 2;
  read_load_target_cfg.Addr := 8459;
  read_load_target_cfg.Node := 1;

  (* --- v5.1.0 NEW: Configure Modbus READ POWER parameters (0x210F x1) --- *)
  read_power_local_cfg.Channel := 0;
  read_power_local_cfg.TriggerType := 0;
  read_power_local_cfg.Cmd := 3;
  read_power_local_cfg.ElementCnt := 1;
  read_power_target_cfg.Addr := 8463;
  read_power_target_cfg.Node := 1;

  (* --- Compute VFD frequency setpoint --- *)
  vfd_freq_setpoint := conveyor_speed_cmd * 10;
  IF vfd_freq_setpoint = 0 AND motor_running THEN
    vfd_freq_setpoint := 300;
  END_IF;

  (* --- Load write data buffers via COP --- *)
  fault_reset_cmd := 2;
  cop_cmd(Enable := TRUE, Src := vfd_cmd_word, SrcOffset := 0,
          Dest := write_cmd_data, DestOffset := 0, Length := 1, Swap := FALSE);
  cop_freq(Enable := TRUE, Src := vfd_freq_setpoint, SrcOffset := 0,
           Dest := write_freq_data, DestOffset := 0, Length := 1, Swap := FALSE);
  cop_reset(Enable := TRUE, Src := fault_reset_cmd, SrcOffset := 0,
            Dest := fault_reset_data, DestOffset := 0, Length := 1, Swap := FALSE);

  (* --- Poll timer: 500ms between each MSG step --- *)
  vfd_poll_timer(IN := NOT vfd_poll_active, PT := T#500ms);

  IF vfd_poll_timer.Q AND NOT vfd_poll_active THEN
    vfd_poll_active := TRUE;
    vfd_msg_done := FALSE;
    vfd_poll_step := vfd_poll_step + 1;
    IF vfd_poll_step > 6 THEN
      vfd_poll_step := 1;
    END_IF;
    (* v5.1.0: skip fault reset to the NEW read steps, not back to 1 *)
    IF vfd_poll_step = 4 AND NOT vfd_fault_reset_pending THEN
      vfd_poll_step := 5;
    END_IF;
  END_IF;

  (* --- Per-step timeout: 2s max per MSG transaction --- *)
  (* v5.0: catches silent failures when serial driver not loaded *)
  msg_step_timer(IN := vfd_poll_active AND NOT vfd_msg_done, PT := T#2000ms);
  IF msg_step_timer.Q THEN
    vfd_comm_ok := FALSE;
    vfd_comm_err := TRUE;
    vfd_msg_done := TRUE;
    vfd_poll_active := FALSE;
  END_IF;

  (* --- Call all six MSG blocks once per scan --- *)
  mb_read_status(IN := (vfd_poll_step = 1) AND vfd_poll_active,
                 LocalCfg := read_local_cfg,
                 TargetCfg := read_target_cfg,
                 LocalAddr := read_data);

  mb_write_cmd(IN := (vfd_poll_step = 2) AND vfd_poll_active,
               LocalCfg := write_cmd_local_cfg,
               TargetCfg := write_cmd_target_cfg,
               LocalAddr := write_cmd_data);

  mb_write_freq(IN := (vfd_poll_step = 3) AND vfd_poll_active,
                LocalCfg := write_freq_local_cfg,
                TargetCfg := write_freq_target_cfg,
                LocalAddr := write_freq_data);

  mb_fault_reset(IN := (vfd_poll_step = 4) AND vfd_poll_active,
                 LocalCfg := fault_reset_local_cfg,
                 TargetCfg := fault_reset_target_cfg,
                 LocalAddr := fault_reset_data);

  mb_read_load(IN := (vfd_poll_step = 5) AND vfd_poll_active,
               LocalCfg := read_load_local_cfg,
               TargetCfg := read_load_target_cfg,
               LocalAddr := read_load_data);

  mb_read_power(IN := (vfd_poll_step = 6) AND vfd_poll_active,
                LocalCfg := read_power_local_cfg,
                TargetCfg := read_power_target_cfg,
                LocalAddr := read_power_data);

  (* --- Check MSG results --- *)
  IF vfd_poll_active AND NOT vfd_msg_done THEN
    CASE vfd_poll_step OF
      1: (* READ MONITOR -- v5.1.0 re-indexed: block starts at 0x2100 *)
        IF mb_read_status.Q THEN
          (* SM1 0x2100: high byte = warning code, low byte = fault code *)
          vfd_fault_code := read_data(1) AND 16#00FF;
          vfd_warn_code := SHR(read_data(1), 8);
          (* SM2 0x2101: status bits -- decoded downstream (trend viewer) *)
          vfd_status_word := read_data(2);
          (* 0x2102: commanded frequency (same scale as output freq) *)
          vfd_freq_cmd := read_data(3);
          vfd_frequency := read_data(4);
          vfd_current := read_data(5);
          vfd_dc_bus := read_data(6);
          vfd_voltage := read_data(7);

          (* v5.1.0: latch the trip cause. The drive zeroes SM1 low    *)
          (* byte on its own fault reset; this latch keeps the last    *)
          (* nonzero code until an operator deliberately clears it     *)
          (* via the last_fault_clear coil (C24).                      *)
          IF vfd_fault_code > 0 THEN
            vfd_last_fault := vfd_fault_code;
          END_IF;

          vfd_comm_ok := TRUE;
          vfd_comm_err := FALSE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_read_status.Error THEN
          vfd_comm_ok := FALSE;
          vfd_comm_err := TRUE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      2:
        IF mb_write_cmd.Q OR mb_write_cmd.Error THEN
          IF mb_write_cmd.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      3:
        IF mb_write_freq.Q OR mb_write_freq.Error THEN
          IF mb_write_freq.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      4:
        IF mb_fault_reset.Q OR mb_fault_reset.Error THEN
          vfd_fault_reset_pending := FALSE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      5: (* READ LOAD -- v5.1.0 NEW: torque % x10, motor speed rpm *)
        IF mb_read_load.Q THEN
          vfd_torque := read_load_data(1);
          vfd_motor_rpm := read_load_data(2);
          vfd_comm_ok := TRUE;
          vfd_comm_err := FALSE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_read_load.Error THEN
          vfd_comm_err := TRUE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      6: (* READ POWER -- v5.1.0 NEW: kW x1000 *)
        IF mb_read_power.Q THEN
          vfd_power := read_power_data(1);
          vfd_comm_ok := TRUE;
          vfd_comm_err := FALSE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_read_power.Error THEN
          vfd_comm_err := TRUE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

    ELSE
      vfd_poll_step := 1;
      vfd_poll_active := FALSE;
    END_CASE;
  END_IF;

  (* --- v5.1.0: operator clear for the last-fault latch (coil C24) --- *)
  IF last_fault_clear THEN
    vfd_last_fault := 16#0000;
    last_fault_clear := FALSE;
  END_IF;

  (* --- VFD comm watchdog: 5s of errors latches fault --- *)
  vfd_err_timer(IN := vfd_comm_err, PT := T#5000ms);
  IF vfd_err_timer.Q THEN
    fault_alarm := TRUE;
    error_code := 9;
  END_IF;

  (* ================================================================ *)
  (* SECTION 7 -- DIAGNOSTICS                                        *)
  (* ================================================================ *)
  heartbeat := NOT heartbeat;
  cycle_count := cycle_count + 1;
  uptime_timer(IN := NOT uptime_timer.Q, PT := T#1000ms);
  IF uptime_timer.Q THEN
    uptime_seconds := uptime_seconds + 1;
  END_IF;
  system_ready := NOT fault_alarm AND NOT e_stop_active AND (conv_state = 2);
  motor_stopped := NOT motor_running;
  conveyor_speed := conveyor_speed_cmd;

END_PROGRAM
