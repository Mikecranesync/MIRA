PROGRAM Prog_init
(* ===================================================================== *)
(* Conv_Simple Prog_VFD -- V1.9: full GS10 monitoring (Trends V2)         *)
(* ===================================================================== *)
(* This is the REAL deployed comms POU (Conv_Simple_1.8 `Prog_init`,      *)
(* internal version V1.8) extended in place. It is NOT the stale repo     *)
(* files plc/Prog2.stf / plc/Micro820_v4.1.9_Program.st -- those are a    *)
(* pre-1.8 single-"Prog2" ST lineage that never ran on this PLC and use   *)
(* the WRONG channel (0). The live machine runs Prog1 (ladder I/O) +      *)
(* this Prog_init (ST comms) on Channel 2. See                           *)
(* plc/CCW_VARIABLES_ConvSimple_v1.9_DELTA.md for the naming history.     *)
(*                                                                       *)
(* WHAT V1.9 ADDS over the bench-proven V1.8 read/write poll:            *)
(*   1. Byte-split of the 0x2100 monitor word: low byte -> vfd_fault_code *)
(*      (active fault, 0 = none), high byte -> vfd_warn_code (active      *)
(*      warning). V1.8 took the whole word as vfd_fault_code, so a        *)
(*      warning in the high byte would falsely read as a fault.           *)
(*   2. Captures the 0x2102 frequency-command echo (read_data[3]) that    *)
(*      V1.8 discarded -> vfd_freq_cmd (for cmd-vs-actual tracking).      *)
(*   3. vfd_last_fault latch: holds the last nonzero fault code; survives *)
(*      the drive's own fault reset, cleared ONLY by the operator coil    *)
(*      last_fault_clear (Modbus coil 000024). The drive zeroes its       *)
(*      0x2100 low byte on reset, so without this latch the trip cause    *)
(*      vanishes the moment you reset -- exactly when you walk up to look. *)
(*   4. Two new READ groups, interleaved per "Option C" (monitor stays    *)
(*      the priority; the new trend data refreshes slower):               *)
(*        - load:  0x210B..0x210C (torque % x10, motor speed rpm)         *)
(*        - power: 0x210F        (output power kW x1000)                  *)
(*                                                                       *)
(* OPTION C READ ROTATION (industry-standard tiered polling; ref          *)
(* flowfuse.com modbus-polling-best-practices + dpstele prioritized       *)
(* polling). The RS-485 bus is single-master and shares Channel 2, so     *)
(* exactly ONE Modbus message may fire per 500 ms tick. poll_phase still  *)
(* alternates read/write each tick (writes UNCHANGED -- still ~1 Hz, so   *)
(* motor response is unaffected). On READ ticks a 3-state selector        *)
(* read_sel runs 0->1->2:                                                 *)
(*     read_sel 0 -> monitor block (0x2100..0x2106)                       *)
(*     read_sel 1 -> monitor block (0x2100..0x2106)                       *)
(*     read_sel 2 -> load OR power (alternating via lp_toggle)            *)
(* So the monitor block (faults + live freq/current/DC-bus) gets 2 of     *)
(* every 3 read ticks (~1.5 s refresh -- fast/normal tier), while torque/ *)
(* rpm and power each refresh ~every 6 read ticks (~6 s -- trend tier,    *)
(* well inside the FlowFuse "normal 1-5 s / slow" guidance and the 5 s    *)
(* comm watchdog). To make the monitor block even fresher, narrow the     *)
(* selector to 0..1 (monitor / load-power); to favour torque, widen the   *)
(* lp_toggle. The ratio is the only tuning knob.                          *)
(*                                                                       *)
(* UNCHANGED FROM V1.8 (do not "fix"):                                    *)
(*   * Channel := 2 (embedded RS-485 -- NOT 0; bench-proven, the old      *)
(*     "Channel 0" memory was overturned -- serial_sniff.py 2026-05-26).  *)
(*   * AB MSG_MODBUS firmware subtracts 1 from TargetCfg.Addr before TX.  *)
(*     To read wire 0xNNNN you set Addr := 16#(NNNN+1). Proven: code      *)
(*     Addr 16#2101 -> wire bytes "21 00" -> reg 0x2100. The new reads    *)
(*     follow the same +1 rule (load Addr 16#210C -> wire 0x210B; power   *)
(*     Addr 16#2110 -> wire 0x210F).                                      *)
(*   * Write path (Phase B) and all of Prog1's ladder logic.              *)
(*                                                                       *)
(* PRECONDITIONS VERIFIED ON BENCH 2026-05-26 (unchanged):               *)
(*   GS10:  P09.00=1  P09.01=96 (9600)  P09.04=12 (8N1 RTU)               *)
(*          P09.09=10.0 ms  <-- CRITICAL; default 2.0 ms is too fast for  *)
(*                              the Micro820 transceiver TX->RX switch    *)
(*                              (ErrorID 55 cycling). Set via GSoft2.      *)
(*   PLC Serial Port 2: 9600 / 8 / None / 1 / Modbus RTU Master, RS485    *)
(*                      Cold power-cycle required after any SP2 change.    *)
(* ===================================================================== *)
(* --- NEW GLOBAL VARIABLES for V1.9 (declare in CCW Global Vars; the     *)
(*     full list incl. types is in CCW_VARIABLES_ConvSimple_v1.9_DELTA.md):
   read_sel        : INT;            (* read rotation selector 0..2       *)
   lp_toggle       : BOOL;          (* alternates load/power in slot 2    *)
   mb_read_load    : MSG_MODBUS;
   read_load_cfg   : MODBUSLOCPARA;
   read_load_tgt   : MODBUSTARPARA;
   read_load_data  : ARRAY[1..10] OF UDINT;
   mb_read_power   : MSG_MODBUS;
   read_power_cfg  : MODBUSLOCPARA;
   read_power_tgt  : MODBUSTARPARA;
   read_power_data : ARRAY[1..10] OF UDINT;
   vfd_warn_code   : UINT;          (* 0x2100 high byte                   *)
   vfd_freq_cmd    : UINT;          (* 0x2102 echo, 0.01 Hz               *)
   vfd_torque      : UINT;          (* 0x210B, 0.1 %                      *)
   vfd_motor_rpm   : UINT;          (* 0x210C, rpm                        *)
   vfd_power       : UINT;          (* 0x210F, 0.001 kW                   *)
   vfd_last_fault  : UINT;          (* latched last nonzero fault code    *)
   last_fault_clear: BOOL;          (* operator clear (Modbus coil 24)    *)
   (* vfd_fault_code, vfd_status_word already exist from V1.x -- reused.  *)
--------------------------------------------------------------------- *)


(* --- 500 ms self-retriggering tick --- *)
poll_timer(IN := NOT poll_timer.Q, PT := T#500ms);

IF poll_timer.Q THEN
    vfd_poll_count := vfd_poll_count + 1;
    poll_phase := NOT poll_phase;          (* alternate read/write (Ch2 share) *)
    IF poll_phase THEN                      (* this tick is a READ tick *)
        read_sel := read_sel + 1;
        IF read_sel > 2 THEN
            read_sel := 0;
            lp_toggle := NOT lp_toggle;     (* swap load<->power each full cycle *)
        END_IF;
    END_IF;
END_IF;


(* --- MONITOR read cfg: FC03, 7 regs, wire 0x2100..0x2106 (Addr=wire+1) --- *)
read_local_cfg.Channel     := 2;
read_local_cfg.TriggerType := 0;
read_local_cfg.Cmd         := 3;
read_local_cfg.ElementCnt  := 7;
read_target_cfg.Node := 1;
read_target_cfg.Addr := 16#2101;            (* -> wire 0x2100 *)

(* --- LOAD read cfg: FC03, 2 regs, wire 0x210B..0x210C (Addr=wire+1) --- *)
read_load_cfg.Channel     := 2;
read_load_cfg.TriggerType := 0;
read_load_cfg.Cmd         := 3;
read_load_cfg.ElementCnt  := 2;
read_load_tgt.Node := 1;
read_load_tgt.Addr := 16#210C;              (* -> wire 0x210B torque, 0x210C rpm *)

(* --- POWER read cfg: FC03, 1 reg, wire 0x210F (Addr=wire+1) --- *)
read_power_cfg.Channel     := 2;
read_power_cfg.TriggerType := 0;
read_power_cfg.Cmd         := 3;
read_power_cfg.ElementCnt  := 1;
read_power_tgt.Node := 1;
read_power_tgt.Addr := 16#2110;             (* -> wire 0x210F power *)


(* --- Fire ONE read per read-tick per the Option C selector --- *)
mb_read_status(IN        := poll_timer.Q AND poll_phase AND (read_sel < 2),
              LocalCfg  := read_local_cfg,
              TargetCfg := read_target_cfg,
              LocalAddr := read_data);

mb_read_load(IN        := poll_timer.Q AND poll_phase AND (read_sel = 2) AND lp_toggle,
             LocalCfg  := read_load_cfg,
             TargetCfg := read_load_tgt,
             LocalAddr := read_load_data);

mb_read_power(IN        := poll_timer.Q AND poll_phase AND (read_sel = 2) AND NOT lp_toggle,
              LocalCfg  := read_power_cfg,
              TargetCfg := read_power_tgt,
              LocalAddr := read_power_data);


(* --- Monitor unpack (raw INT through; scaling in the historian/Ignition) --- *)
IF mb_read_status.Q AND NOT mb_read_status.Error THEN
    vfd_fault_code  := read_data[1] AND 16#00FF;        (* 0x2100 low byte = fault   *)
    vfd_warn_code   := SHR(read_data[1], 8) AND 16#00FF;(* 0x2100 high byte = warning *)
    vfd_status_word := read_data[2];                    (* 0x2101 status bits        *)
    vfd_freq_cmd    := read_data[3];                    (* 0x2102 freq cmd echo      *)
    vfd_frequency   := read_data[4];                    (* 0x2103 output freq Hz x100 *)
    vfd_current     := read_data[5];                    (* 0x2104 amps  A x100       *)
    vfd_dc_bus      := read_data[6];                    (* 0x2105 DC bus V x10       *)
    vfd_voltage     := read_data[7];                    (* 0x2106 out V  V x10       *)
    vfd_comm_ok     := TRUE;
    (* Latch the trip cause: holds until the operator clears it. *)
    IF vfd_fault_code > 0 THEN
        vfd_last_fault := vfd_fault_code;
    END_IF;
END_IF;
IF mb_read_status.Error THEN
    vfd_comm_ok   := FALSE;
    vfd_err_count := vfd_err_count + 1;
END_IF;

(* --- Load unpack (torque, motor speed) --- *)
IF mb_read_load.Q AND NOT mb_read_load.Error THEN
    vfd_torque    := read_load_data[1];                 (* 0x210B torque % x10 *)
    vfd_motor_rpm := read_load_data[2];                 (* 0x210C motor rpm    *)
    vfd_comm_ok   := TRUE;
END_IF;
IF mb_read_load.Error THEN
    vfd_comm_ok   := FALSE;
    vfd_err_count := vfd_err_count + 1;
END_IF;

(* --- Power unpack --- *)
IF mb_read_power.Q AND NOT mb_read_power.Error THEN
    vfd_power   := read_power_data[1];                  (* 0x210F power kW x1000 *)
    vfd_comm_ok := TRUE;
END_IF;
IF mb_read_power.Error THEN
    vfd_comm_ok   := FALSE;
    vfd_err_count := vfd_err_count + 1;
END_IF;

(* --- Operator clear for the last-fault latch (Modbus coil 000024) --- *)
IF last_fault_clear THEN
    vfd_last_fault   := 0;
    last_fault_clear := FALSE;
END_IF;


(* ===================================================================== *)
(* REGISTER MAP REFERENCE (V1.9)                                         *)
(* ===================================================================== *)
(* Wire reg  Description                Raw units    PLC global / HR off  *)
(* --------  -------------------------  -----------  -------------------- *)
(* 0x2100lo  Fault / error code         code (0=ok)  vfd_fault_code / 118 *)
(* 0x2100hi  Warning code               code (0=ok)  vfd_warn_code  / 119 *)
(* 0x2101    Status word (bit-encoded)  bits         vfd_status_word/ 117 *)
(* 0x2102    Frequency command echo     0.01 Hz      vfd_freq_cmd   / 120 *)
(* 0x2103    Output frequency           0.01 Hz      vfd_frequency  / 106 *)
(* 0x2104    Output current             0.01 A       vfd_current    / 107 *)
(* 0x2105    DC bus voltage             0.1 V        vfd_dc_bus     / 109 *)
(* 0x2106    Output voltage             0.1 V        vfd_voltage    / 108 *)
(* 0x210B    Output torque              0.1 %        vfd_torque     / 121 *)
(* 0x210C    Motor speed                rpm          vfd_motor_rpm  / 122 *)
(* 0x210F    Output power               0.001 kW     vfd_power      / 123 *)
(*  (PLC)    Latched last fault         code         vfd_last_fault / 124 *)
(* HR off = pymodbus offset the historian reads (CCW addr - 400001).     *)
(* ===================================================================== *)


(* ===================================================================== *)
(* PHASE B -- VFD CONTROL (write path)   [UNCHANGED from V1.8]           *)
(* ===================================================================== *)
(* Writes alternate with reads on Channel 2 via poll_phase, so only one  *)
(* MSG_MODBUS hits the bus per 500 ms tick. PRECONDITIONS for the drive  *)
(* to OBEY (set via GSoft2): P00.20=1 (freq src=485), P00.21=2 (oper     *)
(* src=485). vfd_ctrl_enable=FALSE reverts to read-only.                 *)
(* ===================================================================== *)

(* --- Direction decode from the 3-position selector --- *)
dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
dir_rev := _IO_EM_DI_01 AND NOT _IO_EM_DI_00;

(* --- Photo-eye LATCHING soft stop --- *)
IF _IO_EM_DI_05 THEN
    pe_latched := TRUE;
ELSIF _IO_EM_DI_04 THEN
    pe_latched := FALSE;
END_IF;

(* --- Run permit: contactor on, E-stop healthy, photo-eye NOT latched --- *)
vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;

(* --- Build the GS10 command word (wire 0x2000) --- *)
IF vfd_ctrl_enable AND vfd_run_permit AND dir_fwd THEN
    vfd_cmd_word := 18;        (* FWD + RUN *)
ELSIF vfd_ctrl_enable AND vfd_run_permit AND dir_rev THEN
    vfd_cmd_word := 34;        (* REV + RUN *)
ELSE
    vfd_cmd_word := 1;         (* STOP *)
END_IF;

(* --- Speed setpoint (0.01 Hz). Safe 30 Hz default; dashboard may set. --- *)
IF vfd_freq_sp = 0 THEN
    vfd_freq_sp := 3000;       (* 30.00 Hz *)
END_IF;

motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);

(* --- Write cfg: FC16, 2 regs [cmd, freq] to wire 0x2000-0x2001 --- *)
write_local_cfg.Channel     := 2;
write_local_cfg.TriggerType := 0;
write_local_cfg.Cmd         := 16;
write_local_cfg.ElementCnt  := 2;
write_target_cfg.Node := 1;
write_target_cfg.Addr := 16#2001;          (* -> wire 0x2000 *)
write_cmd_data[1] := vfd_cmd_word;
write_cmd_data[2] := vfd_freq_sp;

(* --- Fire the write FB on phase=FALSE ticks (reads take phase=TRUE) --- *)
mb_write_cmd(IN        := poll_timer.Q AND NOT poll_phase AND vfd_ctrl_enable,
             LocalCfg  := write_local_cfg,
             TargetCfg := write_target_cfg,
             LocalAddr := write_cmd_data);

IF mb_write_cmd.Error THEN
    vfd_err_count := vfd_err_count + 1;
END_IF;

END_PROGRAM
