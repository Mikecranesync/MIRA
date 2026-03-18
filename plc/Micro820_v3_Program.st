PROGRAM Prog2
(* ================================================================ *)
  (* MIRA -- Micro820 Complete Program v3.2                           *)
  (* PLC: 2080-LC20-20QBB  |  IP: 192.168.1.100                      *)
  (*                                                                  *)
  (* Physical terminal labels (printed on PLC):                       *)
  (*   Inputs:  I-00..I-11, common = COM0                             *)
  (*   Outputs: O-00..O-03 (grp 0, +CM0/-CM0)                        *)
  (*            O-04..O-06 (grp 1, +CM1/-CM1)                        *)
  (*                                                                  *)
  (* I/O Assignment:                                                  *)
  (*   I-00 = SelectorFWD    O-00 = LightGreen (running)              *)
  (*   I-01 = SelectorREV    O-01 = LightRed (fault/e-stop)           *)
  (*   I-02 = EStopNC        O-02 = ContactorQ1 (safety)              *)
  (*   I-03 = EStopNO        O-03 = PBRunLED (pushbutton light)       *)
  (*   I-04 = PBRun                                                   *)
  (*                                                                  *)
  (* v3.2 changes: fixed CCW compile errors                           *)
  (*   - All non-ASCII chars removed from comments                    *)
  (*   - Timers called once per scan outside CASE branches            *)
  (*   - Hex literals converted to decimal                            *)
  (* ================================================================ *)

  (* ================================================================ *)
  (* SECTION 1 -- E-STOP SUPERVISION (highest priority)               *)
  (*   I-02 (EStopNC) = NC contact (healthy = 1, pressed = 0)        *)
  (*   I-03 (EStopNO) = NO contact (healthy = 0, pressed = 1)        *)
  (*   Dual-channel: I-02 XOR I-03 must be TRUE                      *)
  (* ================================================================ *)
  IF (_IO_EM_DI_02 XOR _IO_EM_DI_03) THEN
    (* Contacts are complementary -- wiring OK *)
    IF NOT _IO_EM_DI_02 AND _IO_EM_DI_03 THEN
      (* NC opened + NO closed = E-stop PRESSED *)
      e_stop_active := TRUE;
    ELSE
      (* NC closed + NO open = E-stop RELEASED *)
      e_stop_active := FALSE;
    END_IF;
    estop_wiring_fault := FALSE;
  ELSE
    (* Both contacts same state -- WIRING FAULT *)
    e_stop_active := TRUE;
    fault_alarm := TRUE;
    estop_wiring_fault := TRUE;
  END_IF;

  (* ================================================================ *)
  (* SECTION 2 -- OPERATOR STATION I/O MAPPING                       *)
  (*   I-00 (SelectorFWD) = NO, closed when knob LEFT                *)
  (*   I-01 (SelectorREV) = NO, closed when knob RIGHT               *)
  (*   I-04 (PBRun) = Illuminated pushbutton, NO momentary           *)
  (* ================================================================ *)
  dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_rev := NOT _IO_EM_DI_00 AND _IO_EM_DI_01;
  dir_off := NOT _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
  dir_fault := _IO_EM_DI_00 AND _IO_EM_DI_01;

  sensor_1_active := _IO_EM_DI_05;
  sensor_2_active := _IO_EM_DI_06;

  (* Rising edge detection on RUN pushbutton *)
  button_rising := _IO_EM_DI_04 AND NOT prev_button;
  prev_button := _IO_EM_DI_04;

  (* ================================================================ *)
  (* SECTION 3 -- SAFETY CONTACTOR Q1 (O-02)                         *)
  (*   Energized when E-stop OK and no wiring fault                   *)
  (*   When de-energized, 3-phase power to VFD is physically cut      *)
  (* ================================================================ *)
  _IO_EM_DO_02 := NOT e_stop_active AND NOT estop_wiring_fault;

  (* ================================================================ *)
  (* SECTION 4 -- CONVEYOR STATE MACHINE                              *)
  (*   States: 0=IDLE, 1=STARTING, 2=RUNNING, 3=STOPPING, 4=FAULT    *)
  (* ================================================================ *)
  CASE conv_state OF

    0: (* IDLE -- waiting for RUN command *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      motor_speed := 0;
      vfd_cmd_word := 1;  (* GS10 stop command = 0x0001 *)

      IF button_rising AND (dir_fwd OR dir_rev)
         AND NOT e_stop_active AND NOT fault_alarm
         AND NOT dir_fault THEN
        conv_state := 1;
      END_IF;

    1: (* STARTING -- motor ramping up *)
      motor_running := TRUE;

      (* Set VFD command based on direction *)
      IF dir_fwd THEN
        vfd_cmd_word := 18;  (* GS10 FWD+RUN = 0x0012 *)
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;  (* GS10 REV+RUN = 0x0014 *)
      END_IF;

      IF e_stop_active OR fault_alarm OR dir_fault THEN
        vfd_cmd_word := 1;  (* GS10 stop = 0x0001 *)
        conv_state := 4;
      ELSIF start_timer.Q THEN
        conveyor_running := TRUE;
        conv_state := 2;
      END_IF;

    2: (* RUNNING -- motor at speed *)
      motor_running := TRUE;
      conveyor_running := TRUE;

      (* Maintain VFD direction command *)
      IF dir_fwd THEN
        vfd_cmd_word := 18;  (* GS10 FWD+RUN *)
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;  (* GS10 REV+RUN *)
      END_IF;

      (* Fault conditions *)
      IF e_stop_active OR fault_alarm OR dir_fault THEN
        vfd_cmd_word := 1;  (* GS10 stop *)
        conv_state := 4;
      (* Normal stop: selector to OFF *)
      ELSIF dir_off THEN
        vfd_cmd_word := 1;  (* GS10 stop *)
        conv_state := 3;
      END_IF;

      (* Item counting at exit sensor *)
      IF sensor_2_active AND NOT SensorEnd_Prev THEN
        item_count := item_count + 1;
      END_IF;
      SensorEnd_Prev := sensor_2_active;

      (* Speed setpoint from external (Modbus TCP write) or analog *)
      motor_speed := conveyor_speed_cmd;

    3: (* STOPPING -- coast down *)
      motor_running := FALSE;
      vfd_cmd_word := 1;  (* GS10 stop *)
      motor_speed := 0;

      IF e_stop_active OR fault_alarm THEN
        conv_state := 4;
      ELSIF stop_timer.Q THEN
        conveyor_running := FALSE;
        conv_state := 0;
      END_IF;

    4: (* FAULT -- latched, requires reset *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      vfd_cmd_word := 1;  (* GS10 stop *)
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

      (* Reset: pushbutton + E-stop clear + selector not OFF *)
      IF button_rising AND NOT e_stop_active
         AND NOT estop_wiring_fault AND NOT dir_off THEN
        fault_alarm := FALSE;
        error_code := 0;
        conv_state := 0;
      END_IF;

  ELSE
    conv_state := 0;
  END_CASE;

  (* Timers called ONCE per scan, unconditionally *)
  start_timer(IN := (conv_state = 1), PT := T#3000ms);
  stop_timer(IN := (conv_state = 3), PT := T#2000ms);

  (* ================================================================ *)
  (* SECTION 5 -- LED INDICATORS + PUSHBUTTON ILLUMINATION            *)
  (*   O-00 (LightGreen) = Green pilot light (running)                *)
  (*   O-01 (LightRed)   = Red pilot light (fault/e-stop)             *)
  (*   O-03 (PBRunLED)   = RUN pushbutton LED (Sweideer, running)     *)
  (* ================================================================ *)
  IF ALL_LEDS_ON THEN
    _IO_EM_DO_00 := TRUE;
    _IO_EM_DO_01 := TRUE;
    _IO_EM_DO_03 := TRUE;
  ELSE
    _IO_EM_DO_00 := motor_running;                           (* O-00 green panel light *)
    _IO_EM_DO_01 := e_stop_active OR fault_alarm OR estop_wiring_fault
                     OR dir_fault OR (vfd_fault_code > 0);   (* O-01 red panel light *)
    _IO_EM_DO_03 := motor_running;                           (* O-03 pushbutton LED *)
  END_IF;

  (* ================================================================ *)
  (* SECTION 6 -- VFD MODBUS RTU COMMUNICATION                       *)
  (*   Channel 2 = embedded RS-485 serial port                        *)
  (*   GS10 VFD at slave address 1, 9600/8N2                          *)
  (*   Three MSG blocks alternate: read -> write_cmd -> write_freq    *)
  (* ================================================================ *)

  (* --- Configure Modbus parameters (every scan) --- *)
  read_local_cfg.Channel := 2;
  read_local_cfg.TriggerType := 0;
  read_local_cfg.Cmd := 3;
  read_local_cfg.ElementCnt := 4;
  read_target_cfg.Addr := 8451;
  read_target_cfg.Node := 1;

  write_cmd_local_cfg.Channel := 2;
  write_cmd_local_cfg.TriggerType := 0;
  write_cmd_local_cfg.Cmd := 6;
  write_cmd_local_cfg.ElementCnt := 1;
  write_cmd_target_cfg.Addr := 8192;  (* v3.3: 0x2000 = GS10 control command register *)
  write_cmd_target_cfg.Node := 1;

  write_freq_local_cfg.Channel := 2;
  write_freq_local_cfg.TriggerType := 0;
  write_freq_local_cfg.Cmd := 6;
  write_freq_local_cfg.ElementCnt := 1;
  write_freq_target_cfg.Addr := 8193;  (* v3.3: 0x2001 = GS10 frequency command register *)
  write_freq_target_cfg.Node := 1;

  (* --- Compute VFD frequency setpoint --- *)
  IF motor_speed > 0 THEN
    vfd_freq_setpoint := (motor_speed * 400) / 4095;
  ELSE
    vfd_freq_setpoint := 0;
  END_IF;

  (* NOTE: write_cmd_data and write_freq_data array loading *)
  (* requires CCW-specific MODBUSLOCADDR handling.          *)
  (* VFD reads work; write data loading TBD after PLC is online. *)

  (* --- Poll timer --- *)
  vfd_poll_timer(IN := NOT vfd_poll_active, PT := T#500ms);

  IF vfd_poll_timer.Q AND NOT vfd_poll_active THEN
    vfd_poll_active := TRUE;
    vfd_msg_done := FALSE;
    vfd_poll_step := vfd_poll_step + 1;
    IF vfd_poll_step > 3 THEN
      vfd_poll_step := 1;
    END_IF;
  END_IF;

  (* --- Call all three MSG blocks once per scan (only one active) --- *)
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

  (* --- Check results (CASE only reads .Q and .Error) --- *)
  IF vfd_poll_active AND NOT vfd_msg_done THEN
    CASE vfd_poll_step OF
      1: (* READ results *)
        IF mb_read_status.Q THEN
          vfd_frequency := read_data(1);
          vfd_current := read_data(2);
          vfd_dc_bus := read_data(3);
          vfd_voltage := read_data(4);
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

      2: (* WRITE CMD results *)
        IF mb_write_cmd.Q OR mb_write_cmd.Error THEN
          IF mb_write_cmd.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      3: (* WRITE FREQ results *)
        IF mb_write_freq.Q OR mb_write_freq.Error THEN
          IF mb_write_freq.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

    ELSE
      vfd_poll_step := 1;
      vfd_poll_active := FALSE;
    END_CASE;
  END_IF;

  (* --- VFD error handling --- *)
  IF vfd_comm_err THEN
    vfd_fault_code := error_code;
  END_IF;

  vfd_err_timer(IN := vfd_comm_err, PT := T#5000ms);
  IF vfd_err_timer.Q THEN
    vfd_comm_err := FALSE;
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