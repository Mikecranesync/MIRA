PROGRAM Prog2
(* ================================================================ *)
(*  MIRA Conveyor Control -- Micro820 2080-LC20-20QBB               *)
(*  Version:  v4.1.5                                                *)
(*  Date:     2026-03-16                                            *)
(*  Author:   MIRA/Claude                                           *)
(*                                                                  *)
(*  Changelog:                                                      *)
(*  v4.1.5 - Use COP for MODBUSLOCADDR writes (can't assign via    *)
(*           parenthesis on LHS). Read with (n) is fine.            *)
(*  v4.1.4 - Fixed array syntax: [n] -> (n) for MODBUSLOCADDR type *)
(*  v4.1.3 - Removed VAR block from Prog2.stf (CCW uses Controller *)
(*           Variables table, not inline VAR). Added 5 missing v4.0 *)
(*           variables to PrjLibrary.accdb via add_v4_variables.py  *)
(*  v4.1.2 - Cleared InitialValue in CCW database (PrjLibrary.accdb *)
(*           Symbols table) -- Micro820 rejects all initial values  *)
(*  v4.1.1 - Removed VAR initializers from .st reference file       *)
(*  v4.1.0 - Self-contained attempt (VAR block -- does not work)    *)
(*  v4.0.0 - Complete rewrite with all commissioning fixes          *)
(*           - Fixed state machine deadlock (IDLE had no fault path) *)
(*           - Fixed GS10 register addresses (0x2000/0x2001 cmds)   *)
(*           - Fixed GS10 command bit-field values (18/20/1)        *)
(*           - Added VFD fault reset MSG block (reg 0x2002)         *)
(*           - VFD comm watchdog: 5s comm loss sets fault_alarm     *)
(*           - Correct RS-485 channel = 2 on all MSG blocks         *)
(*           - Frequency setpoint = Hz x 10, default 30.0 Hz       *)
(*  v3.3.0 - Fixed GS10 register map (wrong addresses from GS1)    *)
(*  v3.2.0 - Fixed CCW compile errors, non-ASCII chars             *)
(*  v3.1.0 - Added O-03 PBRunLED output                            *)
(*  v3.0.0 - Initial Micro820 program                              *)
(*                                                                  *)
(*  NOTE: All variables declared in CCW Controller Variables table  *)
(*        (PrjLibrary.accdb). Do NOT add a VAR block here.          *)
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
(*    Status read start: 0x2103 (8451) -- output freq, curr, etc.   *)
(*    FWD+RUN=18  REV+RUN=20  STOP=1                               *)
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
  (*   v4.0: State 0 now transitions to State 4 on any fault          *)
  (*         condition, preventing the deadlock where fault_alarm      *)
  (*         could never be cleared from IDLE.                        *)
  (* ================================================================ *)
  CASE conv_state OF

    0: (* IDLE -- waiting for RUN command *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      motor_speed := 0;
      vfd_cmd_word := 1;  (* GS10 stop = 0x0001 *)

      (* v4.0 FIX: catch faults in IDLE -- prevents deadlock *)
      IF fault_alarm OR e_stop_active OR dir_fault THEN
        conv_state := 4;
      ELSIF button_rising AND (dir_fwd OR dir_rev) THEN
        conv_state := 1;
      END_IF;

    1: (* STARTING -- motor ramping up *)
      motor_running := TRUE;

      (* Set VFD command based on selector direction *)
      IF dir_fwd THEN
        vfd_cmd_word := 18;  (* GS10 FWD+RUN = 0x0012 *)
      ELSIF dir_rev THEN
        vfd_cmd_word := 20;  (* GS10 REV+RUN = 0x0014 *)
      END_IF;

      IF e_stop_active OR fault_alarm OR dir_fault THEN
        vfd_cmd_word := 1;  (* GS10 stop *)
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

      (* Speed setpoint from external command *)
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

    4: (* FAULT -- latched, requires operator reset *)
      motor_running := FALSE;
      conveyor_running := FALSE;
      vfd_cmd_word := 1;  (* GS10 stop *)
      motor_speed := 0;

      (* Identify fault source for diagnostics *)
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
        vfd_fault_reset_pending := TRUE;  (* send reset to VFD over RS-485 *)
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
  (*   O-03 (PBRunLED)   = RUN pushbutton LED (running)               *)
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
  (* SECTION 6 -- VFD MODBUS RTU COMMUNICATION                       *)
  (*   Channel 2 = embedded RS-485 serial port on 2080-LC20-20QBB    *)
  (*   GS10 DURApulse at slave address 1, 9600 baud, 8N2             *)
  (*   Four MSG blocks cycle: read -> write_cmd -> write_freq         *)
  (*   Step 4 (fault_reset) only fires when pending                   *)
  (*                                                                  *)
  (*   GS10 Register Map:                                             *)
  (*     0x2000 (8192) = Control Command (W) -- bit field             *)
  (*     0x2001 (8193) = Frequency Setpoint (W) -- Hz x 10            *)
  (*     0x2002 (8194) = Fault Reset (W) -- write 2 to reset          *)
  (*     0x2103 (8451) = Output Frequency (R) -- Hz x 10              *)
  (*     0x2104 (8452) = Output Current (R) -- A x 10                 *)
  (*     0x2105 (8453) = DC Bus Voltage (R) -- V                      *)
  (*     0x2106 (8454) = Output Voltage (R) -- V                      *)
  (* ================================================================ *)

  (* --- Configure Modbus READ parameters --- *)
  read_local_cfg.Channel := 2;
  read_local_cfg.TriggerType := 0;
  read_local_cfg.Cmd := 3;        (* FC03 = read holding registers *)
  read_local_cfg.ElementCnt := 6; (* read 6 regs: freq,curr,dcbus,volts,torque,rpm *)
  read_target_cfg.Addr := 8451;   (* 0x2103 = GS10 output frequency *)
  read_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE COMMAND parameters --- *)
  write_cmd_local_cfg.Channel := 2;
  write_cmd_local_cfg.TriggerType := 0;
  write_cmd_local_cfg.Cmd := 6;        (* FC06 = write single register *)
  write_cmd_local_cfg.ElementCnt := 1;
  write_cmd_target_cfg.Addr := 8192;   (* 0x2000 = GS10 control command *)
  write_cmd_target_cfg.Node := 1;

  (* --- Configure Modbus WRITE FREQUENCY parameters --- *)
  write_freq_local_cfg.Channel := 2;
  write_freq_local_cfg.TriggerType := 0;
  write_freq_local_cfg.Cmd := 6;        (* FC06 = write single register *)
  write_freq_local_cfg.ElementCnt := 1;
  write_freq_target_cfg.Addr := 8193;   (* 0x2001 = GS10 frequency setpoint *)
  write_freq_target_cfg.Node := 1;

  (* --- Configure Modbus FAULT RESET parameters --- *)
  fault_reset_local_cfg.Channel := 2;
  fault_reset_local_cfg.TriggerType := 0;
  fault_reset_local_cfg.Cmd := 6;        (* FC06 = write single register *)
  fault_reset_local_cfg.ElementCnt := 1;
  fault_reset_target_cfg.Addr := 8194;   (* 0x2002 = GS10 fault reset *)
  fault_reset_target_cfg.Node := 1;

  (* --- Compute VFD frequency setpoint --- *)
  (* GS10 register 0x2001 takes Hz x 10 (e.g. 300 = 30.0 Hz) *)
  vfd_freq_setpoint := conveyor_speed_cmd * 10;
  IF vfd_freq_setpoint = 0 AND motor_running THEN
    vfd_freq_setpoint := 300;  (* default 30.0 Hz *)
  END_IF;

  (* --- Load write data buffers via COP --- *)
  (* MODBUSLOCADDR arrays cannot be assigned with (n) := on LHS *)
  fault_reset_cmd := 2;
  COP(vfd_cmd_word, write_cmd_data, 1);
  COP(vfd_freq_setpoint, write_freq_data, 1);
  COP(fault_reset_cmd, fault_reset_data, 1);

  (* --- Poll timer: 500ms between each MSG step --- *)
  vfd_poll_timer(IN := NOT vfd_poll_active, PT := T#500ms);

  IF vfd_poll_timer.Q AND NOT vfd_poll_active THEN
    vfd_poll_active := TRUE;
    vfd_msg_done := FALSE;
    vfd_poll_step := vfd_poll_step + 1;
    IF vfd_poll_step > 4 THEN
      vfd_poll_step := 1;
    END_IF;
    (* Skip fault reset step unless a reset is pending *)
    IF vfd_poll_step = 4 AND NOT vfd_fault_reset_pending THEN
      vfd_poll_step := 1;
    END_IF;
  END_IF;

  (* --- Call all four MSG blocks once per scan --- *)
  (* Only one fires at a time based on vfd_poll_step *)
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

  (* --- Check MSG results --- *)
  IF vfd_poll_active AND NOT vfd_msg_done THEN
    CASE vfd_poll_step OF
      1: (* READ status results *)
        IF mb_read_status.Q THEN
          vfd_frequency := read_data(1);  (* Hz x 10 *)
          vfd_current := read_data(2);    (* A x 10 *)
          vfd_dc_bus := read_data(3);     (* V *)
          vfd_voltage := read_data(4);    (* V *)
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

      2: (* WRITE COMMAND results *)
        IF mb_write_cmd.Q OR mb_write_cmd.Error THEN
          IF mb_write_cmd.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      3: (* WRITE FREQUENCY results *)
        IF mb_write_freq.Q OR mb_write_freq.Error THEN
          IF mb_write_freq.Error THEN
            vfd_comm_err := TRUE;
          END_IF;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

      4: (* FAULT RESET results *)
        IF mb_fault_reset.Q OR mb_fault_reset.Error THEN
          vfd_fault_reset_pending := FALSE;
          vfd_msg_done := TRUE;
          vfd_poll_active := FALSE;
        END_IF;

    ELSE
      vfd_poll_step := 1;
      vfd_poll_active := FALSE;
    END_CASE;
  END_IF;

  (* --- VFD comm watchdog --- *)
  (* If comm errors persist for 5 seconds, latch fault_alarm *)
  vfd_err_timer(IN := vfd_comm_err, PT := T#5000ms);
  IF vfd_err_timer.Q THEN
    fault_alarm := TRUE;
    error_code := 9;  (* VFD COMM fault *)
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
