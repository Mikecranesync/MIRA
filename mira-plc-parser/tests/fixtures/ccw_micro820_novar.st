(* CCW Micro820 export style: NO VAR block -- variables live in the CCW Controller Variables
   table (a separate CSV), so the .st carries logic only. Models the real plc/Micro820_*.st. *)
PROGRAM Prog2
  (* E-stop supervision *)
  IF (_IO_EM_DI_02 XOR _IO_EM_DI_03) THEN
    e_stop_active := NOT _IO_EM_DI_02 AND _IO_EM_DI_03;
    estop_wiring_fault := FALSE;
  ELSE
    e_stop_active := TRUE;
    fault_alarm := TRUE;
    estop_wiring_fault := TRUE;
  END_IF;
  e_stop_ok := NOT e_stop_active AND NOT estop_wiring_fault;
  _IO_EM_DO_02 := e_stop_ok;

  (* Conveyor state machine *)
  CASE conv_state OF
    0:
      motor_running := FALSE;
      conveyor_running := FALSE;
      vfd_cmd_word := 1;
      IF fault_alarm OR e_stop_active THEN conv_state := 4; END_IF;
    2:
      motor_running := TRUE;
      conveyor_running := TRUE;
      vfd_cmd_word := 18;
    4:
      motor_running := FALSE;
      vfd_cmd_word := 1;
      error_code := 9;
  END_CASE;

  (* VFD Modbus monitor results *)
  vfd_frequency := read_data(1);
  vfd_current := read_data(2);
  vfd_dc_bus := read_data(3);
  vfd_status_word := read_status_word_data(1);
  vfd_drive_fault := (vfd_status_word AND 16#2000) <> 0;
  IF vfd_drive_fault THEN
    vfd_comm_err := TRUE;
  ELSE
    vfd_comm_err := FALSE;
  END_IF;
  vfd_comm_ok := NOT vfd_comm_err;
END_PROGRAM
