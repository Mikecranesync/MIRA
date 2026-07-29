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
(*   2. vfd_freq_cmd = the commanded Hz written to drive 0x2001 (= vfd_freq_sp)*)
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
   read_sel        : UINT;   (* read rotation 0..2 (counter -> numeric type) *)
   lp_toggle       : BOOL;   (* alternates load/power in read slot 2       *)
   vfd_warn_code   : WORD;   (* 0x2100 high byte (CCW type = WORD, like     *)
   vfd_freq_cmd    : WORD;   (*   vfd_status_word; raw 16-bit register      *)
   vfd_torque      : WORD;   (*   values -- no arithmetic done on them)     *)
   vfd_motor_rpm   : WORD;   (* 0x210C, rpm                                *)
   vfd_power       : WORD;   (* 0x210F, 0.001 kW                           *)
   vfd_last_fault  : WORD;   (* latched last nonzero fault code            *)
   last_fault_clear: BOOL;   (* operator clear (Modbus coil 24)            *)
   (* mb_read_status, read_local_cfg, read_target_cfg, read_data,         *)
   (* poll_timer, poll_phase, vfd_fault_code, vfd_status_word, vfd_*       *)
   (* already exist from V1.8 and are REUSED.                              *)
--------------------------------------------------------------------- *)


(* --- 500 ms self-retriggering tick; alternate read/write on the shared Ch2 --- *)
poll_timer(IN := NOT poll_timer.Q, PT := T#500ms);

IF poll_timer.Q THEN
    vfd_poll_count := vfd_poll_count + 1;
    poll_phase := NOT poll_phase;          (* read tick <-> write tick *)
    IF poll_phase THEN
        lp_toggle := NOT lp_toggle;        (* on READ ticks: alternate the two blocks *)
    END_IF;
END_IF;


(* --- V1.9: read the GS10 status in TWO half-blocks, alternating each read tick. ---
   The flashed V1.8 read ONLY the 0x2100..0x2106 monitor block, so torque/rpm/power
   (0x210B/0x210C/0x210F) were never read -- they sat at 0 while the keypad showed
   real values (torque 73.7%, 880 rpm at 30 Hz). Both half-blocks fit the EXISTING
   read_data[1..10] buffer (no resize, no new vars), and it stays ONE Modbus message
   per tick. Same fire/unpack pattern as V1.8 (proven), just two configs:
     lp_toggle = FALSE -> monitor 0x2100..0x2106 (7 regs)
     lp_toggle = TRUE  -> load/power 0x210B..0x210F (5 regs)
   Each read completes well within the 500 ms tick, so the unpack always matches the
   block that was just read. read_sel is now unused. *)
read_local_cfg.Channel     := 2;            (* embedded RS-485 -- NOT 0 *)
read_local_cfg.TriggerType := 0;
read_local_cfg.Cmd         := 3;            (* FC03 read holding *)
read_target_cfg.Node       := 1;

IF lp_toggle THEN
    read_local_cfg.ElementCnt := 5;         (* 0x210B..0x210F *)
    read_target_cfg.Addr      := 16#210C;   (* Addr=wire+1 -> wire 0x210B *)
ELSE
    read_local_cfg.ElementCnt := 7;         (* 0x2100..0x2106 *)
    read_target_cfg.Addr      := 16#2101;   (* Addr=wire+1 -> wire 0x2100 *)
END_IF;

mb_read_status(IN        := poll_timer.Q AND poll_phase,
              LocalCfg  := read_local_cfg,
              TargetCfg := read_target_cfg,
              LocalAddr := read_data);

IF mb_read_status.Q AND NOT mb_read_status.Error THEN
    IF lp_toggle THEN
        vfd_torque    := read_data[1];      (* 0x210B torque % x10 *)
        vfd_motor_rpm := read_data[2];      (* 0x210C motor rpm    *)
        vfd_power     := read_data[5];      (* 0x210F power kW x1000 *)
    ELSE
        vfd_fault_code  := read_data[1];    (* 0x2100 fault       *)
        vfd_status_word := read_data[2];    (* 0x2101 status      *)
        (* read_data[3] = 0x2102 keypad "F" echo: unused (vfd_freq_cmd <- vfd_freq_sp) *)
        vfd_frequency   := read_data[4];    (* 0x2103 Hz x100     *)
        vfd_current     := read_data[5];    (* 0x2104 A x100      *)
        vfd_dc_bus      := read_data[6];    (* 0x2105 V x10       *)
        vfd_voltage     := read_data[7];    (* 0x2106 V x10       *)
        IF vfd_fault_code > 0 THEN
            vfd_last_fault := vfd_fault_code; (* latch trip cause *)
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
(* 0x2101 status   vfd_status_word/117  0x2001cmd freqcmd vfd_freq_cmd/120  *)
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

(* Frequency command (HR120) = the value the PLC writes to drive 0x2001.
   Re-pointed off the 0x2102 keypad echo (read 0 in comms mode). Always fresh
   -- independent of the RS-485 read link -- and is the true commanded Hz, so
   the historian's rpm-vs-command slip guard works. vfd_freq_sp is x100 (3000 =
   30.00 Hz), same scale as HR120. NOTE: if Build flags a type mismatch here,
   vfd_freq_sp is not WORD -- declare a same-type intermediate or match it. *)
vfd_freq_cmd := vfd_freq_sp;

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
