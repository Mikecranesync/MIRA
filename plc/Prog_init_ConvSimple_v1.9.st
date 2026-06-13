PROGRAM Prog_init
(* ===================================================================== *)
(* Conv_Simple Prog_VFD -- V1.9: full GS10 monitoring (Trends V2)         *)
(* ===================================================================== *)
(* Extends the REAL deployed comms POU (Conv_Simple_1.8 `Prog_init`, V1.8, *)
(* Channel 2). NOT the stale repo files plc/Prog2.stf /                    *)
(* plc/Micro820_v4.1.9_Program.st (pre-1.8 lineage, Channel 0).            *)
(*                                                                       *)
(* DESIGN: single read FB, reconfigured per poll (round-robin).           *)
(* V1.9 reuses the existing mb_read_status FB + read_local_cfg /          *)
(* read_target_cfg / read_data buffer and just changes .Addr / .ElementCnt *)
(* before each fire -- the same reconfigure-every-scan style the write     *)
(* path already uses. This adds NO new function-block instances, structs,  *)
(* or arrays; the only NEW globals are 9 simple scalars (see bottom).      *)
(* It also keeps the bus to one Modbus message per 500 ms tick.            *)
(*                                                                       *)
(* OPTION C tiered polling (industry standard -- flowfuse modbus-polling-  *)
(* best-practices + dpstele prioritized polling). poll_phase still         *)
(* alternates read/write each tick, so the motor WRITE is UNCHANGED        *)
(* (~1 Hz, drive response identical to V1.8). On READ ticks read_sel runs  *)
(* 0->1->2:                                                                *)
(*     read_sel 0 -> monitor block (0x2100..0x2106, 7 regs)                *)
(*     read_sel 1 -> monitor block (0x2100..0x2106, 7 regs)                *)
(*     read_sel 2 -> load (0x210B..0x210C) OR power (0x210F), alternating  *)
(* So the monitor block (faults + freq/current/DC-bus) refreshes on 2 of   *)
(* every 3 read ticks (~1.5 s -- fast/normal tier); torque/rpm and power   *)
(* each refresh ~every 6 read ticks (~6 s -- trend tier). To favour the    *)
(* monitor even more, drop read_sel to 0..1; to favour load, widen         *)
(* lp_toggle. Ratio is the only tuning knob.                               *)
(*                                                                       *)
(* WHAT V1.9 ADDS over V1.8:                                              *)
(*   1. Byte-split of 0x2100: low byte -> vfd_fault_code (active fault),   *)
(*      high byte -> vfd_warn_code. V1.8 took the whole word as            *)
(*      vfd_fault_code, so a high-byte warning falsely read as a fault.    *)
(*   2. Captures the 0x2102 freq-command echo (read_data[3]) -> vfd_freq_cmd*)
(*      (V1.8 discarded it).                                               *)
(*   3. vfd_last_fault latch: holds the last nonzero fault; survives the   *)
(*      drive's own reset; cleared ONLY by operator coil last_fault_clear  *)
(*      (Modbus coil 000024).                                             *)
(*   4. Reads torque %x10 (0x210B), motor rpm (0x210C), power kWx1000      *)
(*      (0x210F) via the reconfigured read FB.                            *)
(*                                                                       *)
(* UNCHANGED FROM V1.8 (do not "fix"):                                    *)
(*   * Channel := 2 (embedded RS-485 -- NOT 0; bench-proven via           *)
(*     serial_sniff.py 2026-05-26; the old "Channel 0" memory was wrong).  *)
(*   * AB MSG_MODBUS firmware subtracts 1 from TargetCfg.Addr before TX,   *)
(*     so to read wire 0xNNNN you set Addr := 16#(NNNN+1). Proven: code    *)
(*     Addr 16#2101 -> wire 0x2100. The new reads follow the same +1 rule  *)
(*     (load Addr 16#210C -> wire 0x210B; power Addr 16#2110 -> 0x210F).   *)
(*   * The whole Phase B write path, and Prog1's ladder.                   *)
(*                                                                       *)
(* PRECONDITIONS (bench-verified 2026-05-26, unchanged):                  *)
(*   GS10  P09.00=1  P09.01=96(9600)  P09.04=12(8N1 RTU)                   *)
(*         P09.09=10.0 ms  <-- CRITICAL (default 2.0 ms => ErrorID-55).    *)
(*   PLC Serial Port 2: 9600/8/None/1, Modbus RTU Master, RS485.          *)
(* ===================================================================== *)
(* --- NEW GLOBAL VARIABLES for V1.9 (9 scalars; full list + the deploy   *)
(*     procedure are in CCW_VARIABLES_ConvSimple_v1.9_DELTA.md):
   read_sel        : UINT;   (* read rotation 0..2                        *)
   lp_toggle       : BOOL;   (* alternates load/power in read slot 2       *)
   vfd_warn_code   : UINT;   (* 0x2100 high byte                          *)
   vfd_freq_cmd    : UINT;   (* 0x2102 echo, 0.01 Hz                      *)
   vfd_torque      : UINT;   (* 0x210B, 0.1 %                             *)
   vfd_motor_rpm   : UINT;   (* 0x210C, rpm                               *)
   vfd_power       : UINT;   (* 0x210F, 0.001 kW                          *)
   vfd_last_fault  : UINT;   (* latched last nonzero fault code           *)
   last_fault_clear: BOOL;   (* operator clear (Modbus coil 24)           *)
   (* mb_read_status, read_local_cfg, read_target_cfg, read_data,         *)
   (* poll_timer, poll_phase, vfd_fault_code, vfd_status_word, vfd_*       *)
   (* already exist from V1.8 and are REUSED.                              *)
--------------------------------------------------------------------- *)


(* --- 500 ms self-retriggering tick; advance read_sel on READ ticks --- *)
poll_timer(IN := NOT poll_timer.Q, PT := T#500ms);

IF poll_timer.Q THEN
    vfd_poll_count := vfd_poll_count + 1;
    poll_phase := NOT poll_phase;          (* alternate read/write (Ch2 share) *)
    IF poll_phase THEN
        read_sel := read_sel + 1;
        IF read_sel > 2 THEN
            read_sel := 0;
            lp_toggle := NOT lp_toggle;     (* swap load<->power each full cycle *)
        END_IF;
    END_IF;
END_IF;


(* --- Reconfigure the ONE read FB for this tick's register group --- *)
read_local_cfg.Channel     := 2;            (* embedded RS-485 -- NOT 0 *)
read_local_cfg.TriggerType := 0;
read_local_cfg.Cmd         := 3;            (* FC03 read holding *)
read_target_cfg.Node := 1;

IF read_sel = 2 AND lp_toggle THEN
    read_local_cfg.ElementCnt := 2;         (* load: torque + motor rpm *)
    read_target_cfg.Addr      := 16#210C;   (* -> wire 0x210B, 0x210C *)
ELSIF read_sel = 2 THEN
    read_local_cfg.ElementCnt := 1;         (* power *)
    read_target_cfg.Addr      := 16#2110;   (* -> wire 0x210F *)
ELSE
    read_local_cfg.ElementCnt := 7;         (* monitor block *)
    read_target_cfg.Addr      := 16#2101;   (* -> wire 0x2100..0x2106 *)
END_IF;

(* --- Fire the read FB on read ticks (write takes the other ticks) --- *)
mb_read_status(IN        := poll_timer.Q AND poll_phase,
              LocalCfg  := read_local_cfg,
              TargetCfg := read_target_cfg,
              LocalAddr := read_data);


(* --- Unpack per the group that was just read --- *)
IF mb_read_status.Q AND NOT mb_read_status.Error THEN
    IF read_sel = 2 AND lp_toggle THEN
        vfd_torque    := read_data[1];      (* 0x210B torque 0.1 % *)
        vfd_motor_rpm := read_data[2];      (* 0x210C motor rpm    *)
    ELSIF read_sel = 2 THEN
        vfd_power     := read_data[1];      (* 0x210F power kW x1000 *)
    ELSE
        vfd_fault_code  := read_data[1] AND 16#00FF;        (* 0x2100 low byte  *)
        vfd_warn_code   := SHR(read_data[1], 8) AND 16#00FF;(* 0x2100 high byte *)
        vfd_status_word := read_data[2];                    (* 0x2101 status    *)
        vfd_freq_cmd    := read_data[3];                    (* 0x2102 freq cmd  *)
        vfd_frequency   := read_data[4];                    (* 0x2103 Hz x100   *)
        vfd_current     := read_data[5];                    (* 0x2104 A x100    *)
        vfd_dc_bus      := read_data[6];                    (* 0x2105 V x10     *)
        vfd_voltage     := read_data[7];                    (* 0x2106 V x10     *)
        IF vfd_fault_code > 0 THEN
            vfd_last_fault := vfd_fault_code;               (* latch trip cause *)
        END_IF;
    END_IF;
    vfd_comm_ok := TRUE;
END_IF;
IF mb_read_status.Error THEN
    vfd_comm_ok   := FALSE;
    vfd_err_count := vfd_err_count + 1;
END_IF;

(* --- Operator clear for the last-fault latch (Modbus coil 000024) --- *)
IF last_fault_clear THEN
    vfd_last_fault   := 0;
    last_fault_clear := FALSE;
END_IF;


(* ===================================================================== *)
(* REGISTER MAP (V1.9)   HR off = historian pymodbus offset = CCW-400001  *)
(* 0x2100lo fault  vfd_fault_code/118   0x2100hi warn vfd_warn_code/119    *)
(* 0x2101 status   vfd_status_word/117  0x2102 freqcmd vfd_freq_cmd/120    *)
(* 0x2103 freq     vfd_frequency/106    0x2104 amps   vfd_current/107      *)
(* 0x2105 dcbus    vfd_dc_bus/109       0x2106 outV   vfd_voltage/108      *)
(* 0x210B torque   vfd_torque/121       0x210C rpm    vfd_motor_rpm/122    *)
(* 0x210F power    vfd_power/123        (PLC) latch   vfd_last_fault/124   *)
(* ===================================================================== *)


(* ===================================================================== *)
(* PHASE B -- VFD CONTROL (write path)   [UNCHANGED from V1.8]           *)
(* Writes alternate with reads on Channel 2 via poll_phase. Drive obeys   *)
(* only if P00.20=1 / P00.21=2. vfd_ctrl_enable=FALSE => read-only.       *)
(* ===================================================================== *)

dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
dir_rev := _IO_EM_DI_01 AND NOT _IO_EM_DI_00;

IF _IO_EM_DI_05 THEN
    pe_latched := TRUE;
ELSIF _IO_EM_DI_04 THEN
    pe_latched := FALSE;
END_IF;

vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;

IF vfd_ctrl_enable AND vfd_run_permit AND dir_fwd THEN
    vfd_cmd_word := 18;        (* FWD + RUN *)
ELSIF vfd_ctrl_enable AND vfd_run_permit AND dir_rev THEN
    vfd_cmd_word := 34;        (* REV + RUN *)
ELSE
    vfd_cmd_word := 1;         (* STOP *)
END_IF;

IF vfd_freq_sp = 0 THEN
    vfd_freq_sp := 3000;       (* 30.00 Hz default *)
END_IF;

motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);

write_local_cfg.Channel     := 2;
write_local_cfg.TriggerType := 0;
write_local_cfg.Cmd         := 16;         (* FC16 write multiple *)
write_local_cfg.ElementCnt  := 2;
write_target_cfg.Node := 1;
write_target_cfg.Addr := 16#2001;          (* -> wire 0x2000 *)
write_cmd_data[1] := vfd_cmd_word;
write_cmd_data[2] := vfd_freq_sp;

mb_write_cmd(IN        := poll_timer.Q AND NOT poll_phase AND vfd_ctrl_enable,
             LocalCfg  := write_local_cfg,
             TargetCfg := write_target_cfg,
             LocalAddr := write_cmd_data);

IF mb_write_cmd.Error THEN
    vfd_err_count := vfd_err_count + 1;
END_IF;

END_PROGRAM
