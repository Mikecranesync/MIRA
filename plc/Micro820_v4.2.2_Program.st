PROGRAM Prog2
(* ================================================================ *)
(*  MIRA Conveyor Control -- Micro820 2080-LC20-20QBB               *)
(*  Version:  v4.2.2                                                *)
(*  Date:     2026-06-27                                            *)
(*  Author:   MIRA/Codex                                            *)
(*                                                                  *)
(*  v4.2.2 is a bench/demo logic update on top of v4.1.9. It adds   *)
(*  supervised SimLab discharge request handling for the garage      *)
(*  conveyor when used as bottling-line discharge_conveyor01. This  *)
(*  is not production-certified machinery control. The real         *)
(*  Micro820/GS10 bench still owns motion and safety authority.     *)
(*                                                                  *)
(*  Changelog vs v4.1.9:                                            *)
(*   0. FIX v4.2.2 -- remove the extra safety-ok global requirement. *)
(*      CCW build proved that variable was not in the v4.2.0 delta.  *)
(*      Use existing e_stop_active / estop_wiring_fault directly.    *)
(*   1. NEW -- simlab_discharge_request is request-only. It never   *)
(*      writes directly to the VFD, motor, contactor, or outputs.   *)
(*   2. NEW -- discharge_pending_acceptance requires a local human  *)
(*      acceptance rising edge from PBRun / _IO_EM_DI_04.           *)
(*   3. NEW -- discharge_accept_timer rejects pending requests      *)
(*      after 30 seconds if no local acceptance arrives.             *)
(*   4. NEW -- photoeye_clear_timer requires DI05/photoeye clear    *)
(*      for 30 seconds before the next accepted discharge can run.  *)
(*   5. NEW -- accepted discharge stops when photoeye_blocked goes  *)
(*      TRUE, or on E-stop, stop/selector-off, drive comm fault,    *)
(*      active fault, heartbeat loss, request drop, or shutdown.    *)
(*   6. NEW -- amber_led_flash now drives the bench amber lamp on   *)
(*      O-04 / _IO_EM_DO_04 while discharge acceptance is pending.  *)
(*      Do not reuse DO0/DO1/DO2/DO3.                               *)
(*                                                                  *)
(*  Still deliberately deferred beyond v4.2.2:                      *)
(*   - Removal of vfd_cmd_word := N assignments throughout the      *)
(*     state machine. The TODO calls for the motor_starter UDFB     *)
(*     in Prog4 to become the sole writer. Until Prog4 ships,       *)
(*     removing these writes here would leave nothing commanding    *)
(*     the drive. Two writers in one scan is bad, zero writers      *)
(*     is worse. Will rip them out atomically with the Prog4 add.   *)
(*   - mb_read_status -> mb_read_monitor rename. That's a CCW       *)
(*     IDE instance rename + cross-reference cleanup. Not safe to   *)
(*     do via ST edit alone; do it in CCW. Comments below use the   *)
(*     accurate name (mb_read_monitor) so the rename is obvious.    *)
(*   - Poll timer 500ms -> 50ms tuning. Cosmetic right now; first   *)
(*     prove comms work, then tune.                                 *)
(*                                                                  *)
(*  NEW VARIABLES to declare in CCW Controller Variables table      *)
(*  (PrjLibrary.accdb -- DO NOT add a VAR block here):              *)
(*                                                                  *)
(*    Name                          Type                  Init      *)
(*    ----                          ----                  ----      *)
(*    commissioning_mode            BOOL                  (none)    *)
(*    read_status_word_local_cfg    MSGMODBUSPARA_LOCAL   (none)    *)
(*    read_status_word_target_cfg   MSGMODBUSPARA_TARGET  (none)    *)
(*    read_status_word_data         MODBUSLOCADDR[1..1]   (none)    *)
(*    mb_read_status_word           MSG_MODBUS2           (none)    *)
(*    vfd_status_word               WORD                  (none)    *)
(*    vfd_running_bit               BOOL                  (none)    *)
(*    vfd_at_speed_bit              BOOL                  (none)    *)
(*    vfd_drive_fault               BOOL                  (none)    *)
(*    last_err_step                 INT                   (none)    *)
(*    last_err_at_uptime            DINT                  (none)    *)
(*    last_ok_at_uptime             DINT                  (none)    *)
(*    last_msg_error_id             INT                   (none)    *)
(*    read_err_count                DINT                  (none)    *)
(*    write_cmd_err_count           DINT                  (none)    *)
(*    write_freq_err_count          DINT                  (none)    *)
(*    fault_reset_err_count         DINT                  (none)    *)
(*    read_status_word_err_count    DINT                  (none)    *)
(*                                                                  *)
(*    v4.2.2 discharge acceptance variables:                        *)
(*    simlab_discharge_request       BOOL                  FALSE     *)
(*    simlab_discharge_heartbeat     BOOL                  FALSE     *)
(*    discharge_pending_acceptance   BOOL                  FALSE     *)
(*    discharge_accepted             BOOL                  FALSE     *)
(*    discharge_running              BOOL                  FALSE     *)
(*    discharge_complete             BOOL                  FALSE     *)
(*    discharge_rejected_or_faulted  BOOL                  FALSE     *)
(*    discharge_accept_timeout       BOOL                  FALSE     *)
(*    amber_led_flash                BOOL                  FALSE     *)
(*    green_start_pb                 BOOL                  FALSE     *)
(*    photoeye_blocked               BOOL                  FALSE     *)
(*    photoeye_clear_30s             BOOL                  FALSE     *)
(*    bench_permissive_ok            BOOL                  FALSE     *)
(*    local_stop_active              BOOL                  FALSE     *)
(*    remote_start_allowed           BOOL                  FALSE     *)
(*    manual_start_allowed           BOOL                  FALSE     *)
(*    green_start_rising             BOOL                  FALSE     *)
(*    prev_green_start_pb            BOOL                  FALSE     *)
(*    discharge_pending_was_active   BOOL                  FALSE     *)
(*    amber_blink_phase              BOOL                  FALSE     *)
(*    discharge_accept_timer         TON                   (none)    *)
(*    photoeye_clear_timer           TON                   (none)    *)
(*    amber_blink_timer              TON                   (none)    *)
(*                                                                  *)
(*  And expose them in MbSrvConf.xml so vfd_diag.py / live_monitor  *)
(*  / mira-bridge can read them over Modbus TCP. Suggested map:     *)
(*                                                                  *)
(*    HR400118 vfd_status_word                                      *)
(*    HR400119 last_err_step                                        *)
(*    HR400120 last_msg_error_id                                    *)
(*    HR400121 read_err_count        (low word of DINT)             *)
(*    HR400122 last_err_at_uptime    (low word of DINT)             *)
(*    HR400123 last_ok_at_uptime     (low word of DINT)             *)
(*    C23      vfd_running_bit                                      *)
(*    C24      vfd_at_speed_bit                                     *)
(*    C25      vfd_drive_fault                                      *)
(*    C26      commissioning_mode                                   *)
(*    C27      simlab_discharge_request       (write, bench only)   *)
(*    C28      simlab_discharge_heartbeat     (write, bench only)   *)
(*    C29      discharge_pending_acceptance                         *)
(*    C30      discharge_accepted                                   *)
(*    C31      discharge_running                                    *)
(*    C32      discharge_complete                                   *)
(*    C33      discharge_rejected_or_faulted                        *)
(*    C34      discharge_accept_timeout                             *)
(*    C35      amber_led_flash               (amber state readback) *)
(*    C36      green_start_pb                                       *)
(*    C37      photoeye_blocked                                      *)
(*    C38      photoeye_clear_30s                                   *)
(*    C39      bench_permissive_ok                                  *)
(*                                                                  *)
(*  Physical I/O (DO0-DO3 unchanged from v4.1.7/v4.1.8):            *)
(*    I-00 = SelectorFWD    O-00 = LightGreen (running)             *)
(*    I-01 = SelectorREV    O-01 = LightRed (fault/e-stop)          *)
(*    I-02 = EStopNC        O-02 = ContactorQ1 (safety)             *)
(*    I-03 = EStopNO        O-03 = PBRunLED (pushbutton light)      *)
(*    I-04 = PBRun                                                  *)
(*    I-05 = Photoeye / PE-101, confirm blocked polarity on bench    *)
(*                            O-04 = AmberLight (pending accept)    *)
(*                                                                  *)
(*  Only Prog2 may drive _IO_EM_DO_04. Before download, remove or    *)
(*  disable any legacy Prog1 rung that still drives DO4 as a          *)
(*  direction-indicator output.                                      *)
(*                                                                  *)
(*  VFD: AutomationDirect GS10 DURApulse                            *)
(*    RS-485 Modbus RTU, slave addr 1, 9600/8N2                     *)
(*    P09.00 = 1   (slave addr)                                     *)
(*    P09.01 = 96  (9600 baud)                                      *)
(*    P09.02 = 0   (warn + continue on comm loss -- confirmed)      *)
(*    P09.03 = 5   (5 sec timeout)                                  *)
(*    P09.04 = 13  (8N2 RTU)                                        *)
(*    P09.09 = 20  (response delay ms -- bump to 50 if CRC errs)    *)
(*    P00.21 = 2   (run source = RS-485)                            *)
(*                                                                  *)
(*    GS10 Register Map:                                            *)
(*      0x2000 (8192)  Control Command         (W FC06, bit field)  *)
(*      0x2001 (8193)  Frequency Setpoint      (W FC06, Hz x 10)    *)
(*      0x2002 (8194)  Fault Reset             (W FC06, write 2)    *)
(*      0x2101 (8449)  Status Word             (R FC03, bit field)  *)
(*      0x2103 (8451)  Output Frequency        (R FC03, Hz x 10)    *)
(*      0x2104 (8452)  Output Current          (R FC03, A x 10)     *)
(*      0x2105 (8453)  DC Bus Voltage          (R FC03, V)          *)
(*      0x2106 (8454)  Output Voltage          (R FC03, V)          *)
(*    Command bit-field: FWD+RUN=18  REV+RUN=20  STOP=1             *)
(* ================================================================ *)

  (* ================================================================ *)
  (* SECTION 1 -- E-STOP SUPERVISION (highest priority)               *)
  (* Existing v4.x E-stop state. Use the existing variables directly  *)
  (* so this package does not require a new safety-ok global.         *)
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
  (* SECTION 2 -- OPERATOR STATION I/O MAPPING (unchanged)            *)
  (* ================================================================ *)
  dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_rev := NOT _IO_EM_DI_00 AND _IO_EM_DI_01;
  dir_off := NOT _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_fault := _IO_EM_DI_00 AND _IO_EM_DI_01;

  sensor_1_active := _IO_EM_DI_05;
  sensor_2_active := _IO_EM_DI_06;

  green_start_pb := _IO_EM_DI_04;
  green_start_rising := green_start_pb AND NOT prev_green_start_pb;
  button_rising := green_start_rising;
  prev_green_start_pb := green_start_pb;
  prev_button := green_start_pb;

  photoeye_blocked := sensor_1_active;
  local_stop_active := dir_off;

  (* ================================================================ *)
  (* SECTION 3 -- SIMLAB DISCHARGE HUMAN ACCEPTANCE (bench/demo logic) *)
  (*                                                                  *)
  (* SimLab may request discharge, but the Micro820 remains control    *)
  (* authority. Remote request cannot start the conveyor directly.     *)
  (* Human acceptance requires a clean rising edge on PBRun / I-04.    *)
  (* This is bench/demo logic and not production-certified machinery   *)
  (* control.                                                         *)
  (* ================================================================ *)
  discharge_pending_was_active := discharge_pending_acceptance;

  photoeye_clear_timer(IN := NOT photoeye_blocked, PT := T#30s);
  photoeye_clear_30s := photoeye_clear_timer.Q;

  bench_permissive_ok :=
       NOT e_stop_active
   AND NOT estop_wiring_fault
   AND NOT local_stop_active
   AND NOT fault_alarm
   AND NOT dir_fault
   AND vfd_comm_ok
   AND NOT vfd_comm_err
   AND NOT vfd_drive_fault
   AND simlab_discharge_heartbeat
   AND NOT photoeye_blocked
   AND photoeye_clear_30s;

  manual_start_allowed :=
       green_start_rising
   AND (dir_fwd OR dir_rev)
   AND NOT simlab_discharge_request
   AND NOT discharge_pending_acceptance
   AND NOT discharge_accepted
   AND NOT discharge_running;

  remote_start_allowed :=
       discharge_accepted
   AND bench_permissive_ok
   AND (dir_fwd OR dir_rev)
   AND simlab_discharge_request
   AND simlab_discharge_heartbeat;

  discharge_accept_timer(IN := discharge_pending_acceptance, PT := T#30s);
  amber_blink_timer(IN := discharge_pending_acceptance AND NOT amber_blink_timer.Q, PT := T#500ms);

  IF NOT discharge_pending_acceptance THEN
    amber_blink_phase := FALSE;
  ELSIF amber_blink_timer.Q THEN
    amber_blink_phase := NOT amber_blink_phase;
  END_IF;
  amber_led_flash := discharge_pending_acceptance AND amber_blink_phase;

  IF NOT simlab_discharge_request THEN
    discharge_pending_acceptance := FALSE;
    discharge_accepted := FALSE;
    discharge_running := FALSE;
    discharge_complete := FALSE;
    discharge_rejected_or_faulted := FALSE;
    discharge_accept_timeout := FALSE;
  END_IF;

  IF simlab_discharge_request
     AND NOT discharge_pending_acceptance
     AND NOT discharge_accepted
     AND NOT discharge_running
     AND NOT discharge_complete
     AND NOT discharge_rejected_or_faulted
     AND NOT discharge_accept_timeout THEN
    discharge_pending_acceptance := TRUE;
  END_IF;

  IF discharge_pending_acceptance THEN
    motor_running := FALSE;
    conveyor_running := FALSE;
    vfd_cmd_word := 1;

    IF (NOT simlab_discharge_request) OR (NOT simlab_discharge_heartbeat) THEN
      discharge_pending_acceptance := FALSE;
      discharge_rejected_or_faulted := TRUE;
    ELSIF discharge_accept_timer.Q THEN
      discharge_pending_acceptance := FALSE;
      discharge_accept_timeout := TRUE;
      discharge_rejected_or_faulted := TRUE;
    ELSIF discharge_pending_was_active AND green_start_rising AND bench_permissive_ok THEN
      discharge_pending_acceptance := FALSE;
      discharge_accepted := TRUE;
    END_IF;
  END_IF;

  IF discharge_running AND photoeye_blocked THEN
    discharge_running := FALSE;
    discharge_accepted := FALSE;
    discharge_complete := TRUE;
  ELSIF discharge_running AND NOT bench_permissive_ok THEN
    discharge_running := FALSE;
    discharge_accepted := FALSE;
    discharge_rejected_or_faulted := TRUE;
  ELSIF discharge_running AND NOT simlab_discharge_request THEN
    discharge_running := FALSE;
    discharge_accepted := FALSE;
    discharge_rejected_or_faulted := TRUE;
  ELSIF discharge_running AND NOT simlab_discharge_heartbeat THEN
    discharge_running := FALSE;
    discharge_accepted := FALSE;
    discharge_rejected_or_faulted := TRUE;
  END_IF;

  (* ================================================================ *)
  (* SECTION 4 -- SAFETY CONTACTOR Q1 (O-02) (unchanged)              *)
  (* ================================================================ *)
  _IO_EM_DO_02 := NOT e_stop_active AND NOT estop_wiring_fault;

  (* ================================================================ *)
  (* SECTION 5 -- CONVEYOR STATE MACHINE                              *)
  (*                                                                  *)
  (* NOTE for v4.2.2: when Prog4 motor_starter UDFB exists, every     *)
  (* "vfd_cmd_word := N;" assignment in this section gets deleted,    *)
  (* and the UDFB becomes the sole writer of vfd_cmd_word. Until      *)
  (* then they stay, otherwise the drive gets no commands at all.    *)
  (* ================================================================ *)
  CASE conv_state OF

    0: (* IDLE *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      motor_speed := 0;
      vfd_cmd_word := 1;

      IF fault_alarm OR e_stop_active OR dir_fault THEN
        conv_state := 4;
      ELSIF (manual_start_allowed OR remote_start_allowed) THEN
        conv_state := 1;
      END_IF;

    1: (* STARTING *)
      motor_running := TRUE;

      IF dir_fwd THEN
        vfd_cmd_word := 18;
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;
      END_IF;

      IF e_stop_active OR fault_alarm OR dir_fault OR discharge_rejected_or_faulted THEN
        vfd_cmd_word := 1;
        conv_state := 4;
      ELSIF discharge_accepted AND NOT remote_start_allowed THEN
        vfd_cmd_word := 1;
        conv_state := 3;
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

      IF e_stop_active OR fault_alarm OR dir_fault OR discharge_rejected_or_faulted THEN
        vfd_cmd_word := 1;
        conv_state := 4;
      ELSIF dir_off OR discharge_complete OR (discharge_accepted AND NOT remote_start_allowed) THEN
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

  IF discharge_accepted THEN
    discharge_running := motor_running AND ((conv_state = 1) OR (conv_state = 2));
  END_IF;

  (* ================================================================ *)
  (* SECTION 6 -- LED INDICATORS                                      *)
  (* ================================================================ *)
  IF ALL_LEDS_ON THEN
    _IO_EM_DO_00 := TRUE;
    _IO_EM_DO_01 := TRUE;
    _IO_EM_DO_03 := TRUE;
    _IO_EM_DO_04 := TRUE;
  ELSE
    _IO_EM_DO_00 := motor_running;
    _IO_EM_DO_01 := e_stop_active OR fault_alarm OR estop_wiring_fault
                     OR dir_fault OR (vfd_fault_code > 0);
    _IO_EM_DO_03 := motor_running;
    _IO_EM_DO_04 := amber_led_flash;
  END_IF;

  (* ================================================================ *)
  (* SECTION 7 -- VFD MODBUS RTU COMMUNICATION (v4.1.9 rebuild)       *)
  (*                                                                  *)
  (* 5-step poll cycle. Step skipped if vfd_poll_step lands on a       *)
  (* disabled step (commissioning_mode masks writes; fault_reset      *)
  (* only fires when pending).                                        *)
  (*                                                                  *)
  (*   Step 1: READ MONITOR  -- FC03 @ 0x2103, 4 regs (freq/cur/dc/v) *)
  (*   Step 2: WRITE CMD     -- FC06 @ 0x2000 (skipped if commission) *)
  (*   Step 3: WRITE FREQ    -- FC06 @ 0x2001 (skipped if commission) *)
  (*   Step 4: FAULT RESET   -- FC06 @ 0x2002 (only if pending)       *)
  (*   Step 5: READ STATUSW  -- FC03 @ 0x2101, 1 reg  (NEW v4.1.9)    *)
  (* ================================================================ *)

  (* --- Configure Modbus READ MONITOR (step 1, 0x2103, 4 regs) --- *)
  read_local_cfg.Channel := 2;
  read_local_cfg.TriggerType := 0;
  read_local_cfg.Cmd := 3;
  read_local_cfg.ElementCnt := 4;     (* v4.1.9: was 6, GS10 monitor block ends at 0x2106 *)
  read_target_cfg.Addr := 8451;       (* 0x2103 *)
  read_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE COMMAND (step 2, 0x2000) --- *)
  write_cmd_local_cfg.Channel := 2;
  write_cmd_local_cfg.TriggerType := 0;
  write_cmd_local_cfg.Cmd := 6;
  write_cmd_local_cfg.ElementCnt := 1;
  write_cmd_target_cfg.Addr := 8192;   (* 0x2000 *)
  write_cmd_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE FREQUENCY (step 3, 0x2001) --- *)
  write_freq_local_cfg.Channel := 2;
  write_freq_local_cfg.TriggerType := 0;
  write_freq_local_cfg.Cmd := 6;
  write_freq_local_cfg.ElementCnt := 1;
  write_freq_target_cfg.Addr := 8193;   (* 0x2001 *)
  write_freq_target_cfg.Node := 1;

  (* --- Configure Modbus FAULT RESET (step 4, 0x2002) --- *)
  fault_reset_local_cfg.Channel := 2;
  fault_reset_local_cfg.TriggerType := 0;
  fault_reset_local_cfg.Cmd := 6;
  fault_reset_local_cfg.ElementCnt := 1;
  fault_reset_target_cfg.Addr := 8194;   (* 0x2002 *)
  fault_reset_target_cfg.Node := 1;

  (* --- v4.1.9 NEW: Configure Modbus READ STATUS WORD (step 5, 0x2101) --- *)
  read_status_word_local_cfg.Channel := 2;
  read_status_word_local_cfg.TriggerType := 0;
  read_status_word_local_cfg.Cmd := 3;        (* FC03 *)
  read_status_word_local_cfg.ElementCnt := 1; (* single register *)
  read_status_word_target_cfg.Addr := 8449;   (* 0x2101 = Status Monitor 2 *)
  read_status_word_target_cfg.Node := 1;

  (* --- Compute VFD frequency setpoint --- *)
  vfd_freq_setpoint := conveyor_speed_cmd * 10;
  IF vfd_freq_setpoint = 0 AND motor_running THEN
    vfd_freq_setpoint := 300;
  END_IF;

  (* --- Load write data buffers via COP function blocks (unchanged from v4.1.8) --- *)
  fault_reset_cmd := 2;
  cop_cmd(Enable := TRUE, Src := vfd_cmd_word, SrcOffset := 0,
          Dest := write_cmd_data, DestOffset := 0, Length := 1, Swap := FALSE);
  cop_freq(Enable := TRUE, Src := vfd_freq_setpoint, SrcOffset := 0,
           Dest := write_freq_data, DestOffset := 0, Length := 1, Swap := FALSE);
  cop_reset(Enable := TRUE, Src := fault_reset_cmd, SrcOffset := 0,
            Dest := fault_reset_data, DestOffset := 0, Length := 1, Swap := FALSE);

  (* --- Poll timer: 500ms between each MSG step (tune only after comms proof) --- *)
  vfd_poll_timer(IN := NOT vfd_poll_active, PT := T#500ms);

  IF vfd_poll_timer.Q AND NOT vfd_poll_active THEN
    vfd_poll_active := TRUE;
    vfd_msg_done := FALSE;
    vfd_poll_step := vfd_poll_step + 1;
    IF vfd_poll_step > 5 THEN
      vfd_poll_step := 1;
    END_IF;

    (* Skip fault reset step unless a reset is pending *)
    IF vfd_poll_step = 4 AND NOT vfd_fault_reset_pending THEN
      vfd_poll_step := 5;
    END_IF;

    (* v4.1.9 NEW: commissioning_mode masks writes -- only steps 1 and 5 *)
    (* (the two reads) fire. Lets us prove bidirectional comms without  *)
    (* commanding the drive. Drop back to step 1 on every other step.   *)
    IF commissioning_mode AND (vfd_poll_step = 2 OR vfd_poll_step = 3
                                OR vfd_poll_step = 4) THEN
      vfd_poll_step := 5;
    END_IF;
  END_IF;

  (* --- Call all five MSG blocks once per scan, only one fires --- *)
  (* mb_read_status is the OLD name for what should be mb_read_monitor.  *)
  (* Rename the FB instance in CCW for v4.2.2. Keeping the old name      *)
  (* here so this file compiles without an IDE-side rename.              *)
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

  mb_read_status_word(IN := (vfd_poll_step = 5) AND vfd_poll_active,
                      LocalCfg := read_status_word_local_cfg,
                      TargetCfg := read_status_word_target_cfg,
                      LocalAddr := read_status_word_data);

  (* --- Check MSG results (v4.1.9: per-step counters + last_err_step) --- *)
  IF vfd_poll_active AND NOT vfd_msg_done THEN
    CASE vfd_poll_step OF
      1: (* READ MONITOR *)
        IF mb_read_status.Q THEN
          vfd_frequency := read_data(1);
          vfd_current   := read_data(2);
          vfd_dc_bus    := read_data(3);
          vfd_voltage   := read_data(4);
          vfd_comm_ok   := TRUE;
          vfd_comm_err  := FALSE;
          last_ok_at_uptime := uptime_seconds;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_read_status.Error THEN
          vfd_comm_ok := FALSE;
          vfd_comm_err := TRUE;
          read_err_count := read_err_count + 1;
          last_err_step := 1;
          last_err_at_uptime := uptime_seconds;
          last_msg_error_id := mb_read_status.ErrorID;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      2: (* WRITE COMMAND *)
        IF mb_write_cmd.Q THEN
          last_ok_at_uptime := uptime_seconds;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_write_cmd.Error THEN
          vfd_comm_err := TRUE;
          write_cmd_err_count := write_cmd_err_count + 1;
          last_err_step := 2;
          last_err_at_uptime := uptime_seconds;
          last_msg_error_id := mb_write_cmd.ErrorID;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      3: (* WRITE FREQUENCY *)
        IF mb_write_freq.Q THEN
          last_ok_at_uptime := uptime_seconds;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_write_freq.Error THEN
          vfd_comm_err := TRUE;
          write_freq_err_count := write_freq_err_count + 1;
          last_err_step := 3;
          last_err_at_uptime := uptime_seconds;
          last_msg_error_id := mb_write_freq.ErrorID;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      4: (* FAULT RESET *)
        IF mb_fault_reset.Q THEN
          vfd_fault_reset_pending := FALSE;
          last_ok_at_uptime := uptime_seconds;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_fault_reset.Error THEN
          vfd_comm_err := TRUE;
          fault_reset_err_count := fault_reset_err_count + 1;
          last_err_step := 4;
          last_err_at_uptime := uptime_seconds;
          last_msg_error_id := mb_fault_reset.ErrorID;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      5: (* READ STATUS WORD -- v4.1.9 NEW *)
        IF mb_read_status_word.Q THEN
          vfd_status_word := read_status_word_data(1);
          (* GS10 0x2101 bit map (per AutomationDirect GS10 user manual): *)
          (*   bit 0..1  = 00 stop / 01 decel / 10 standby / 11 running   *)
          (*   bit 2     = JOG cmd                                        *)
          (*   bit 3..4  = 00 stop / 01 decel / 10 standby / 11 running   *)
          (*               (direction status)                             *)
          (*   bit 8     = master freq controlled by comm                 *)
          (*   bit 9     = master freq controlled by analog               *)
          (*   bit 11    = operation cmd controlled by comm               *)
          (*   bit 12    = parameter is locked                            *)
          (*   bit 13    = drive is in fault                              *)
          vfd_running_bit := (vfd_status_word AND 16#0003) = 16#0003;
          vfd_at_speed_bit := (vfd_status_word AND 16#000C) = 16#000C;
          vfd_drive_fault := (vfd_status_word AND 16#2000) <> 0;
          vfd_comm_ok := TRUE;
          vfd_comm_err := FALSE;
          last_ok_at_uptime := uptime_seconds;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;
        IF mb_read_status_word.Error THEN
          vfd_comm_ok := FALSE;
          vfd_comm_err := TRUE;
          read_status_word_err_count := read_status_word_err_count + 1;
          last_err_step := 5;
          last_err_at_uptime := uptime_seconds;
          last_msg_error_id := mb_read_status_word.ErrorID;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

    ELSE
      vfd_poll_step := 1;
      vfd_poll_active := FALSE;
    END_CASE;
  END_IF;

  (* --- VFD comm watchdog (unchanged) --- *)
  vfd_err_timer(IN := vfd_comm_err, PT := T#5000ms);
  IF vfd_err_timer.Q THEN
    fault_alarm := TRUE;
    error_code := 9;
  END_IF;

  (* ================================================================ *)
  (* SECTION 8 -- DIAGNOSTICS (inherited from v4.1.9)                *)
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

