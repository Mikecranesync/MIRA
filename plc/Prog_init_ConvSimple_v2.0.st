PROGRAM Prog_init
(* ===================================================================== *)
(* Conv_Simple Prog_VFD -- V2.0: reads torque / rpm / power (GS10)        *)
(* ===================================================================== *)
(* WHY V2.0 EXISTS (the real story, 2026-06-13):                          *)
(*   vfd_torque / vfd_motor_rpm / vfd_power read 0 NOT because of wiring,  *)
(*   the drive, or a round-robin bug -- the GS10 keypad proves the drive   *)
(*   computes them (torque 73.7 %, 880 rpm @ 30 Hz). They read 0 because   *)
(*   the program actually COMPILED+DOWNLOADED to the PLC is still V1.8,     *)
(*   which only reads the 0x2100..0x2106 monitor block and NEVER asks for  *)
(*   0x210B / 0x210C / 0x210F. The V1.9 read code was edited into the      *)
(*   .stf on disk but was never Built into the project, so the running     *)
(*   firmware never changed. V2.0 is that read code, made unambiguous and  *)
(*   build-clean, so a single Build -> Download finally flashes it.        *)
(*                                                                       *)
(* THE ONLY THING THAT MATTERS TO FIX THE ZEROS: this POU must be          *)
(* Built -> Downloaded. The variables and the Modbus slave map are ALREADY *)
(* in Conv_Simple_1.9 (deployed + historian-verified good-quality on       *)
(* CCW 400118..400125). V2.0 adds NO new variables and NO map changes --   *)
(* see DELIVER_ConvSimple_v2.0.md.                                         *)
(*                                                                       *)
(* DESIGN: one read FB, reconfigured per read tick (two half-blocks).      *)
(*   The single existing mb_read_status FB + read_data buffer is pointed   *)
(*   at one of two blocks, alternating each read tick (lp_toggle). Same    *)
(*   reconfigure-every-scan style the write path already uses. Both blocks *)
(*   fit the existing read_data[1..10] (no resize), and it stays ONE       *)
(*   Modbus message per 500 ms tick. The motor WRITE is UNCHANGED from     *)
(*   V1.8 (~1 Hz; identical drive behaviour).                              *)
(*     lp_toggle = FALSE -> monitor    0x2100..0x2106 (7 regs)             *)
(*     lp_toggle = TRUE  -> load/power  0x210B..0x210F (5 regs)            *)
(*   So fault + freq/current/DC-bus refresh every other read tick (~2 s),  *)
(*   and torque/rpm/power refresh on the alternate read tick (~2 s).       *)
(*                                                                       *)
(* WHAT V2.0 ADDS over the flashed V1.8:                                  *)
(*   1. Reads torque (0x210B, % x10), motor rpm (0x210C), power            *)
(*      (0x210F, kW x1000) via the second half-block.                      *)
(*   2. vfd_freq_cmd := vfd_freq_sp -- the commanded Hz the PLC writes to  *)
(*      drive 0x2001 (x100; 3000 = 30.00 Hz). 0x2102 is the GS10 keypad    *)
(*      "F" register and reads 0 in comms mode, so it is NOT trended;      *)
(*      vfd_freq_sp is the true commanded value and tracks output 0x2103   *)
(*      1:1 (the acceptance check).                                        *)
(*   3. vfd_last_fault latch: holds the last nonzero fault; survives the   *)
(*      drive's own reset; cleared ONLY by operator coil last_fault_clear  *)
(*      (Modbus coil 000024).                                              *)
(*                                                                       *)
(* UNCHANGED FROM V1.8 (proven -- do not "fix"):                          *)
(*   * Channel := 2 (embedded RS-485 -- NOT 0; bench-proven 2026-05-26).   *)
(*   * AB MSG_MODBUS firmware subtracts 1 from TargetCfg.Addr before TX,   *)
(*     so to read wire 0xNNNN set Addr := 16#(NNNN+1). The new reads obey  *)
(*     the same +1 rule (load Addr 16#210C -> wire 0x210B; power inside    *)
(*     the same block at 0x210F).                                          *)
(*   * The entire write path and Prog1's ladder.                           *)
(*                                                                       *)
(* DRIVE PRECONDITIONS for the new registers to read NON-ZERO (GS10 UM     *)
(* p.4-21 / GS10_Integration_Guide.md). If these are unset the registers   *)
(* read 0 even with V2.0 flashed -- that is a DRIVE-PARAM issue, not code:  *)
(*   0x210C rpm    : needs P05.03 (rated rpm) + P05.04 (poles)             *)
(*   0x210B torque : needs P00.11 = 2 (IM/PM SVC) + an auto-tune (P05.00)  *)
(*   0x210F power  : computes from V x I once the motor is running         *)
(*   (Mike's keypad already shows torque/rpm, so these ARE set on the      *)
(*    bench drive -> a clean V2.0 flash will show real numbers.)           *)
(*                                                                       *)
(* COMMS PRECONDITIONS (bench-verified 2026-05-26, unchanged):            *)
(*   GS10  P09.00=1  P09.01=96 (9600)  P09.04=12 (8N1 RTU)                 *)
(*         P09.09=10.0 ms  <-- CRITICAL (default 2.0 ms => ErrorID-55).    *)
(*   PLC Serial Port 2: 9600/8/None/1, Modbus RTU Master, RS485.          *)
(* ===================================================================== *)
(* --- VARIABLES (ALL already declared in Conv_Simple_1.9 -- V2.0 adds none) -
   Reused from the V1.x base (do NOT re-declare):
     poll_timer       : TON                          poll_phase      : BOOL
     mb_read_status   : MSG_MODBUS                    read_local_cfg  : MODBUSLOCPARA
     read_target_cfg  : MODBUSTARPARA                 read_data       : ARRAY[1..10] OF UDINT
     mb_write_cmd     : MSG_MODBUS                    write_local_cfg : MODBUSLOCPARA
     write_target_cfg : MODBUSTARPARA                 write_cmd_data  : ARRAY[1..125] OF WORD
     vfd_fault_code   : WORD   vfd_status_word : WORD   vfd_frequency : WORD
     vfd_current      : WORD   vfd_dc_bus      : WORD   vfd_voltage   : WORD
     vfd_cmd_word     : WORD   vfd_freq_sp     : (16-bit, x100 Hz)
     vfd_ctrl_enable  : BOOL   vfd_run_permit  : BOOL   motor_running : BOOL
     dir_fwd/dir_rev/pe_latched/e_stop_ok      : BOOL
     vfd_comm_ok      : BOOL   vfd_poll_count  : UDINT  vfd_err_count : UDINT
     _IO_EM_DI_* / _IO_EM_DO_*                 : BOOL (physical I/O)
   Added by the Conv_Simple_1.9 deploy (already declared + Modbus-mapped):
     vfd_warn_code    : WORD   (400120, reserved -- see note 0x2100)
     vfd_freq_cmd     : WORD   (400121)   vfd_torque    : WORD (400122)
     vfd_motor_rpm    : WORD   (400123)   vfd_power     : WORD (400124)
     vfd_last_fault   : WORD   (400125)
     lp_toggle        : BOOL               last_fault_clear : BOOL (coil 000024)
   Register vars are WORD (CCW RefDefType 16); read_data[n] assigns straight in.
   read_sel (UINT) from the 1.9 var-inject is UNUSED by V2.0 -- harmless; leave
   it or delete it. Every register var's Dimension MUST be blank (scalars), or
   CCW makes them ARRAY[..] OF WORD = AnyArray and Build fails.
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


(* --- Read the GS10 status in TWO half-blocks, alternating each read tick. ---
   lp_toggle = FALSE -> monitor    0x2100..0x2106 (7 regs)
   lp_toggle = TRUE  -> load/power  0x210B..0x210F (5 regs: torque,rpm,-,-,power)
   Each read completes well within the 500 ms tick, so the unpack always matches
   the block that was just requested. *)
read_local_cfg.Channel     := 2;            (* embedded RS-485 -- NOT 0 *)
read_local_cfg.TriggerType := 0;            (* edge-triggered on IN     *)
read_local_cfg.Cmd         := 3;            (* FC03 = read holding      *)
read_target_cfg.Node       := 1;

IF lp_toggle THEN
    read_local_cfg.ElementCnt := 5;         (* 0x210B..0x210F           *)
    read_target_cfg.Addr      := 16#210C;   (* AB subtracts 1 -> wire 0x210B *)
ELSE
    read_local_cfg.ElementCnt := 7;         (* 0x2100..0x2106           *)
    read_target_cfg.Addr      := 16#2101;   (* AB subtracts 1 -> wire 0x2100 *)
END_IF;

mb_read_status(IN        := poll_timer.Q AND poll_phase,
              LocalCfg  := read_local_cfg,
              TargetCfg := read_target_cfg,
              LocalAddr := read_data);

(* --- On success: unpack the block that was just read (raw values; scaling
       happens downstream in the historian: Hz x100, V x10, torque % x10,
       power kW x1000). --- *)
IF mb_read_status.Q AND NOT mb_read_status.Error THEN
    IF lp_toggle THEN
        vfd_torque    := read_data[1];      (* 0x210B  torque   % x10   *)
        vfd_motor_rpm := read_data[2];      (* 0x210C  motor rpm        *)
        vfd_power     := read_data[5];      (* 0x210F  power    kW x1000 *)
    ELSE
        vfd_fault_code  := read_data[1];    (* 0x2100  fault code (0=ok). NOTE:
                                               this is the whole word. Low byte =
                                               fault, high byte = warning. The
                                               byte-split was dropped (Micro800 ST
                                               AND/SHR need bit-string operands and
                                               read_data is UDINT). vfd_warn_code
                                               stays reserved (0) -- not decoded. *)
        vfd_status_word := read_data[2];    (* 0x2101  status word (bits) *)
        (* read_data[3] = 0x2102 keypad "F" echo: skipped (reads 0 in comms mode) *)
        vfd_frequency   := read_data[4];    (* 0x2103  output freq Hz x100 *)
        vfd_current     := read_data[5];    (* 0x2104  output amps A x100  *)
        vfd_dc_bus      := read_data[6];    (* 0x2105  DC bus      V x10   *)
        vfd_voltage     := read_data[7];    (* 0x2106  output volts V x10  *)
        IF vfd_fault_code > 0 THEN
            vfd_last_fault := vfd_fault_code; (* latch the trip cause *)
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
(* REGISTER MAP (V2.0)   HR addr = CCW 4000xx as mapped in the .ccwmod    *)
(* 0x2100 fault   vfd_fault_code/400119   0x2100hi warn vfd_warn_code/400120 *)
(* 0x2101 status  vfd_status_word/400118  (cmd)    freqcmd vfd_freq_cmd/400121 *)
(* 0x2103 freq    vfd_frequency/400107    0x2104 amps   vfd_current/400108   *)
(* 0x2105 dcbus   vfd_dc_bus/400110       0x2106 outV   vfd_voltage/400109   *)
(* 0x210B torque  vfd_torque/400122       0x210C rpm    vfd_motor_rpm/400123 *)
(* 0x210F power   vfd_power/400124        (PLC) latch   vfd_last_fault/400125 *)
(* ===================================================================== *)


(* ===================================================================== *)
(* PHASE B -- VFD CONTROL (write path)   [UNCHANGED from V1.8]           *)
(* Writes alternate with reads on Channel 2 via poll_phase. The drive     *)
(* obeys only if P00.20=1 / P00.21=2. vfd_ctrl_enable=FALSE => read-only. *)
(* ===================================================================== *)

dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
dir_rev := _IO_EM_DI_01 AND NOT _IO_EM_DI_00;

IF _IO_EM_DI_05 THEN
    pe_latched := TRUE;        (* beam blocked -> latch the soft stop      *)
ELSIF _IO_EM_DI_04 THEN
    pe_latched := FALSE;       (* Start pressed (beam clear) -> rearm      *)
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

(* Frequency command (HR 400121) = the value the PLC writes to drive 0x2001.
   Always fresh, independent of the RS-485 read link, and is the true commanded
   Hz -- so the historian's freq-command-vs-output 1:1 check works. vfd_freq_sp
   is x100 (3000 = 30.00 Hz), same scale as vfd_freq_cmd. If Build flags a type
   mismatch here, vfd_freq_sp is not WORD -- declare a same-type intermediate or
   match the type; do NOT add ANY_TO_* (err 0124). *)
vfd_freq_cmd := vfd_freq_sp;

motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);

write_local_cfg.Channel     := 2;
write_local_cfg.TriggerType := 0;
write_local_cfg.Cmd         := 16;         (* FC16 = write multiple    *)
write_local_cfg.ElementCnt  := 2;          (* cmd word + freq setpoint *)
write_target_cfg.Node := 1;
write_target_cfg.Addr := 16#2001;          (* AB subtracts 1 -> wire 0x2000 *)
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
