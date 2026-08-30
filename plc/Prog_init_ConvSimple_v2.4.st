PROGRAM Prog_init
(* ===================================================================== *)
(* Conv_Simple_2.4 Prog_VFD V2.4 -- 2.0 shape + discharge acceptance      *)
(* ===================================================================== *)
(* V2.4 preserves the confirmed-good 2.0/2.1 two-POU project shape:      *)
(*   * PROG1 owns physical I/O, E-stop, contactor, and panel lamps.       *)
(*   * PROG_INIT owns the ST VFD read/write path.                         *)
(*   * DwlOrder remains PROG1 then PROG_INIT.                             *)
(*   * DO4 is now the amber pending-acceptance lamp. PROG1 writes the     *)
(*     physical output from the amber_led_flash BOOL computed here.       *)
(* SimLab request is request-only. It cannot run the conveyor until a     *)
(* local human presses the green/start PB on a clean rising edge.          *)
(* This is bench/demo logic, not production-certified machinery control.  *)
(* ===================================================================== *)
(* V1.8 = the BUILD-CLEAN write path, resolved from Rockwell docs:        *)
(*   * MSG_MODBUS LocalAddr = MODBUSLOCADDR = a 125-WORD array. Each FB    *)
(*     instance is bound to its buffer's element type: mb_read_status <->  *)
(*     read_data (UDINT), mb_write_cmd <-> write_cmd_data (WORD).          *)
(*   * Write via mb_write_cmd + write_cmd_data (ARRAY[1..125] OF WORD),    *)
(*     the V1.4 leftover pair CCW already bound for working write code.    *)
(*   * Assign the UINT control vars PLAIN -- no ANY_TO_UDINT. A UINT value *)
(*     satisfies the WORD buffer; the 32-bit cast caused err 0124.         *)
(* All control globals declared in the project's Global Variables table.  *)
(*                                                                       *)
(* Polls the GS10 VFD every 500 ms over Modbus RTU (reads the 7-register  *)
(* monitor block 0x2100..0x2106) AND, on the alternate tick, WRITES the   *)
(* command word + frequency setpoint (0x2000..0x2001) to run the drive    *)
(* from the bench panel. Read and write share Channel 2 and never collide *)
(* (poll_phase alternates them). The control engine is at the bottom of   *)
(* this POU; the read path below is unchanged from V1.5.                  *)
(* Writes are ignored by the drive until GS10 P00.20=1 (freq src=RS-485)  *)
(* and P00.21=2 (oper src=RS-485) are set. vfd_ctrl_enable=FALSE reverts  *)
(* to V1.5 read-only behavior.                                            *)
(*                                                                       *)
(* VERSION HISTORY                                                       *)
(*   V1.1..V1.4  Phase B round-robin (read + write) with documented      *)
(*               off-by-one in the read addressing (see CHANGES below).  *)
(*   V1.5        Phase A only (no writes). Corrects the off-by-one,      *)
(*               adds engineering-unit scaling, status-word bit decode,  *)
(*               and a separate vfd_err_code variable for the register   *)
(*               that V1.4 was reading but mislabeling.                  *)
(*                                                                       *)
(* CHANGES FROM V1.4 -- the off-by-one fix                               *)
(*   V1.4 set `read_target_cfg.Addr := 8449` (=0x2101) intending to      *)
(*   start at the status word. The AB MSG_MODBUS firmware subtracts 1   *)
(*   from TargetCfg.Addr before transmitting, so the actual wire start  *)
(*   was 0x2100 (error code). All variable labels in V1.4 are therefore  *)
(*   shifted by one register: V1.4's `vfd_status_word` was actually the *)
(*   error code, V1.4's `vfd_freq_cmd` was actually the status word,    *)
(*   and so on through `vfd_voltage` which was actually the DC bus.     *)
(*                                                                       *)
(*   Proof from `scripts/serial_sniff.py` capture 2026-05-26:            *)
(*     PLC code `Addr := 16#2101` -> wire bytes "21 00" -> reg 0x2100    *)
(*                                                                       *)
(*   V1.5 keeps `Addr := 16#2101` (same on-wire start = 0x2100) but      *)
(*   maps read_data[1..7] to the correct register meanings. Variable    *)
(*   names match what each variable actually contains.                  *)
(*                                                                       *)
(*   Read length increased from 6 to 7 registers so the output voltage  *)
(*   at wire 0x2106 -- previously not actually being read -- now is.    *)
(*                                                                       *)
(* PRECONDITIONS VERIFIED ON BENCH 2026-05-26                            *)
(*   GS10:  P09.00 = 1   (slave ID)                                      *)
(*          P09.01 = 96  (9600 baud)                                     *)
(*          P09.04 = 12  (8N1 RTU)                                       *)
(*          P09.09 = 10.0 ms   <-- CRITICAL. Default 2.0 ms is too fast  *)
(*                              for the Micro 820 transceiver to switch  *)
(*                              TX->RX in time. Causes ErrorID 55        *)
(*                              cycling on every poll. Set via GSoft2.   *)
(*   PLC Serial Port 2: 9600 / 8 / None / 1 / Modbus RTU Master, RS485   *)
(*                      Cold power-cycle required after any SP2 change.  *)
(*   Wiring: terminal labels match end-to-end (NOT wire colors).         *)
(* ===================================================================== *)
(* --- REQUIRED GLOBAL VARIABLES (copy this block into CCW Global Vars) ---
poll_timer       : TON;          (* if V1.4 Phase B is also loaded it    *)
poll_tick        : BOOL;         (* declares these -- reuse them.        *)
mb_read_status    : MSG_MODBUS;
read_local_cfg   : MODBUSLOCPARA;
read_target_cfg  : MODBUSTARPARA;
read_data        : ARRAY[1..10] OF UDINT;  (* 7 used; size 10 for room  *)

(* Raw 16-bit register values, exactly as on the wire *)
vfd_err_code        : UINT;  (* 0x2100 -- 0 = no fault                  *)
vfd_status_word     : UINT;  (* 0x2101 -- bit-encoded; see decode below *)
vfd_freq_cmd_raw    : UINT;  (* 0x2102 -- 0.01 Hz units                 *)
vfd_out_freq_raw    : UINT;  (* 0x2103 -- 0.01 Hz units                 *)
vfd_out_amps_raw    : UINT;  (* 0x2104 -- 0.01 A units                  *)
vfd_dc_bus_raw      : UINT;  (* 0x2105 -- 0.1 V units                   *)
vfd_out_voltage_raw : UINT;  (* 0x2106 -- 0.1 V units                   *)

(* Engineering-unit scaled values (computed each scan; safe to display) *)
vfd_freq_cmd_hz     : REAL;
vfd_out_freq_hz     : REAL;
vfd_out_amps_a      : REAL;
vfd_dc_bus_v        : REAL;
vfd_out_voltage_v   : REAL;

(* Status-word convenience BOOLs -- verify bit positions against the    *)
(* local GS10 manual section "Register 2101H -- Status Monitor"         *)
vfd_running         : BOOL;
vfd_jog_active      : BOOL;
vfd_reverse         : BOOL;
vfd_warning         : BOOL;
vfd_at_speed        : BOOL;

(* Comms health + counters                                              *)
vfd_comm_ok         : BOOL;  (* TRUE after a successful read            *)
vfd_poll_count      : UDINT;
vfd_ok_count        : UDINT;
vfd_err_count       : UDINT;
vfd_err_id_last     : UINT;  (* most recent ErrorID                     *)

(* Conv_Simple_2.4 discharge acceptance globals                         *)
simlab_discharge_request      : BOOL;
simlab_discharge_heartbeat    : BOOL;
discharge_pending_acceptance  : BOOL;
discharge_accepted            : BOOL;
discharge_running             : BOOL;
discharge_complete            : BOOL;
discharge_rejected : BOOL;
discharge_accept_timeout      : BOOL;
amber_led_flash               : BOOL;
green_start_pb                : BOOL;
photoeye_blocked              : BOOL;
photoeye_clear_30s            : BOOL;
bench_permissive_ok           : BOOL;
remote_start_allowed          : BOOL;
green_start_rising            : BOOL;
prev_green_start_pb           : BOOL;
discharge_pending_was_active  : BOOL;
amber_blink_phase             : BOOL;
discharge_accept_timer        : TON;
photoeye_clear_timer          : TON;
amber_blink_timer             : TON;

(* COMPATIBILITY NOTE                                                   *)
(* If V1.4 Phase B variables (vfd_status_word, vfd_freq_cmd, etc.) are  *)
(* already declared from prior work, V1.5 RE-USES those names but       *)
(* re-assigns them from the CORRECT register indices. The on-screen     *)
(* values change after deployment because the labels finally match the  *)
(* registers. Old V1.4 PhaseB write logic can stay -- it does not read  *)
(* any of these variables.                                              *)
---------------------------------------------------------------------- *)


(* --- 500 ms self-retriggering tick --- *)
(* NOTE: poll_tick global is declared as TON in CCW (V1.4 PhaseB leftover),  *)
(* so we can't assign poll_tick := poll_timer.Q. Inline poll_timer.Q below.  *)
poll_timer(IN := NOT poll_timer.Q, PT := T#500ms);

IF poll_timer.Q THEN
    vfd_poll_count := vfd_poll_count + 1;
    poll_phase := NOT poll_phase;   (* alternate read/write each tick (Ch2 share) *)
END_IF;


(* --- LocalCfg: Modbus on the embedded RS-485 port, FC03, 7 regs --- *)
read_local_cfg.Channel     := 2;        (* embedded RS-485 -- NOT 0 *)
read_local_cfg.TriggerType := 0;        (* edge-triggered on IN     *)
read_local_cfg.Cmd         := 3;        (* FC 03 = read holding     *)
read_local_cfg.ElementCnt  := 7;        (* 7 registers in one frame *)


(* --- TargetCfg: slave 1, starting register --- *)
(* AB subtracts 1 before TX: Addr := 16#2101 -> wire 0x2100..0x2106. *)
read_target_cfg.Node := 1;
read_target_cfg.Addr := 16#2101;


(* --- Fire the read FB on phase=TRUE ticks (write takes phase=FALSE) --- *)
mb_read_status(IN        := poll_timer.Q AND poll_phase,
              LocalCfg  := read_local_cfg,
              TargetCfg := read_target_cfg,
              LocalAddr := read_data);


(* --- On successful completion: unpack into existing declared globals --- *)
(* Raw INT values flow through; scaling done in Ignition (Hz x100, V x10).  *)
IF mb_read_status.Q AND NOT mb_read_status.Error THEN
    vfd_fault_code  := read_data[1];   (* 0x2100  fault code (0=ok)    *)
    vfd_status_word := read_data[2];   (* 0x2101  status word (bits)   *)
    (* read_data[3] 0x2102 freq cmd echo -- no global target, skipped  *)
    vfd_frequency   := read_data[4];   (* 0x2103  output freq  Hz x100 *)
    vfd_current     := read_data[5];   (* 0x2104  output amps  A  x100 *)
    vfd_dc_bus      := read_data[6];   (* 0x2105  DC bus       V  x10  *)
    vfd_voltage     := read_data[7];   (* 0x2106  output volts V  x10  *)
    vfd_comm_ok     := TRUE;
END_IF;


(* --- On failure: clear health flag, count errors --- *)
IF mb_read_status.Error THEN
    vfd_comm_ok   := FALSE;
    vfd_err_count := vfd_err_count + 1;
END_IF;


(* ===================================================================== *)
(* REGISTER MAP REFERENCE                                                *)
(* ===================================================================== *)
(* Wire reg  Description                       Raw units    Scaled var   *)
(* --------  --------------------------------  -----------  ------------ *)
(* 0x2100    Error / fault code                code (0=ok)  vfd_err_code        *)
(* 0x2101    Status word (bit-encoded)         bits         vfd_status_word     *)
(* 0x2102    Frequency command echo            0.01 Hz      vfd_freq_cmd_hz     *)
(* 0x2103    Output frequency                  0.01 Hz      vfd_out_freq_hz     *)
(* 0x2104    Output current                    0.01 A       vfd_out_amps_a      *)
(* 0x2105    DC bus voltage                    0.1 V        vfd_dc_bus_v        *)
(* 0x2106    Output voltage                    0.1 V        vfd_out_voltage_v   *)
(*                                                                       *)
(* Bench-captured snapshot 2026-05-26 (drive idle, 60 Hz setpoint):     *)
(*   read_data[1] = 0x0000   -> vfd_err_code      = 0                   *)
(*   read_data[2] = 0x2500   -> vfd_status_word   = 0x2500              *)
(*   read_data[3] = 0x1770   -> vfd_freq_cmd_hz   = 60.00 Hz            *)
(*   read_data[4] = 0x0000   -> vfd_out_freq_hz   = 0.00 Hz (stopped)   *)
(*   read_data[5] = 0x0000   -> vfd_out_amps_a    = 0.00 A              *)
(*   read_data[6] = 0x0CCD   -> vfd_dc_bus_v      = 327.7 V             *)
(*   read_data[7] = ????     -> vfd_out_voltage_v = (depends on state)  *)
(* ===================================================================== *)


(* ===================================================================== *)
(* PHASE B -- VFD CONTROL (write path)   [Conv_Simple_1.6]               *)
(* ===================================================================== *)
(* Translates the bench panel state (computed by Prog1 ladder) into GS10 *)
(* Modbus commands. Writes alternate with reads on Channel 2 via         *)
(* poll_phase so only one MSG_MODBUS hits the bus per 500 ms tick.       *)
(*                                                                       *)
(* PRECONDITIONS for the drive to OBEY these writes (set via GSoft2):    *)
(*   P00.20 = 1  (master frequency source  = RS-485 communication)       *)
(*   P00.21 = 2  (operation command source = RS-485 communication)       *)
(* vfd_ctrl_enable = FALSE makes 1.6 behave like read-only 1.5.          *)
(* ===================================================================== *)

(* --- Direction decode from the 3-position selector --- *)
dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01;
dir_rev := _IO_EM_DI_01 AND NOT _IO_EM_DI_00;

(* --- SimLab discharge request human acceptance gate [Conv_Simple_2.4] --- *)
green_start_pb := _IO_EM_DI_04;
green_start_rising := FALSE;
IF green_start_pb THEN
    IF NOT prev_green_start_pb THEN
        green_start_rising := TRUE;
    END_IF;
END_IF;
prev_green_start_pb := green_start_pb;

photoeye_blocked := _IO_EM_DI_05;
photoeye_clear_timer(IN := NOT photoeye_blocked, PT := T#30s);
photoeye_clear_30s := photoeye_clear_timer.Q;

discharge_pending_was_active := discharge_pending_acceptance;

bench_permissive_ok := FALSE;
IF _IO_EM_DO_02 THEN
    IF e_stop_ok THEN
        IF vfd_ctrl_enable THEN
            IF vfd_comm_ok THEN
                IF NOT pe_latched THEN
                    IF NOT photoeye_blocked THEN
                        IF photoeye_clear_30s THEN
                            IF dir_fwd OR dir_rev THEN
                                bench_permissive_ok := TRUE;
                            END_IF;
                        END_IF;
                    END_IF;
                END_IF;
            END_IF;
        END_IF;
    END_IF;
END_IF;

remote_start_allowed := FALSE;
IF discharge_accepted THEN
    IF bench_permissive_ok THEN
        IF simlab_discharge_request THEN
            remote_start_allowed := TRUE;
        END_IF;
    END_IF;
END_IF;

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
    discharge_rejected := FALSE;
    discharge_accept_timeout := FALSE;
END_IF;

IF simlab_discharge_request THEN
    IF NOT discharge_pending_acceptance THEN
        IF NOT discharge_accepted THEN
            IF NOT discharge_running THEN
                IF NOT discharge_complete THEN
                    IF NOT discharge_rejected THEN
                        IF NOT discharge_accept_timeout THEN
                            discharge_pending_acceptance := TRUE;
                        END_IF;
                    END_IF;
                END_IF;
            END_IF;
        END_IF;
    END_IF;
END_IF;

IF discharge_pending_acceptance THEN
    IF NOT simlab_discharge_request THEN
        discharge_pending_acceptance := FALSE;
        discharge_rejected := TRUE;
    ELSIF discharge_accept_timer.Q THEN
        discharge_pending_acceptance := FALSE;
        discharge_accept_timeout := TRUE;
        discharge_rejected := TRUE;
    ELSIF discharge_pending_was_active AND green_start_rising AND bench_permissive_ok THEN
        discharge_pending_acceptance := FALSE;
        discharge_accepted := TRUE;
    END_IF;
END_IF;

(* --- Photo-eye LATCHING soft stop ---                                  *)
(* A beam block latches a stop; it clears ONLY on a Start press with the *)
(* beam already clear. Contactor stays energized (soft stop, not e-stop).*)
IF _IO_EM_DI_05 THEN
    pe_latched := TRUE;        (* beam blocked -> latch the stop          *)
ELSIF _IO_EM_DI_04 THEN
    pe_latched := FALSE;       (* Start pressed (beam clear here) -> rearm *)
END_IF;

IF discharge_running AND photoeye_blocked THEN
    discharge_running := FALSE;
    discharge_accepted := FALSE;
    discharge_complete := TRUE;
ELSIF discharge_running THEN
    IF NOT remote_start_allowed THEN
        discharge_running := FALSE;
        discharge_accepted := FALSE;
        discharge_rejected := TRUE;
    END_IF;
END_IF;

(* --- Run permit: contactor on, E-stop healthy, photo-eye NOT latched --- *)
(* Local/manual run works as before when there is no SimLab request.        *)
(* With a SimLab request present, the drive can run only after acceptance.  *)
vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;
IF simlab_discharge_request THEN
    IF NOT remote_start_allowed THEN
        vfd_run_permit := FALSE;
    END_IF;
END_IF;

(* --- Build the GS10 command word (wire 0x2000) --- *)
IF vfd_ctrl_enable AND vfd_run_permit AND dir_fwd THEN
    vfd_cmd_word := 18;        (* FWD + RUN -- corroborated by production *)
ELSIF vfd_ctrl_enable AND vfd_run_permit AND dir_rev THEN
    vfd_cmd_word := 34;        (* REV + RUN -- VERIFY on bench (20 vs 34) *)
ELSE
    vfd_cmd_word := 1;         (* STOP (default for every other state)   *)
END_IF;

(* --- Speed setpoint (0.01 Hz). Safe 30 Hz default; dashboard may set. *)
IF vfd_freq_sp = 0 THEN
    vfd_freq_sp := 3000;       (* 30.00 Hz *)
END_IF;

motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);
IF discharge_accepted THEN
    discharge_running := motor_running;
END_IF;

(* --- Write config: FC16, 2 regs [cmd, freq] to wire 0x2000-0x2001 --- *)
(* AB subtracts 1 before TX: Addr := 16#2001 -> wire 0x2000.            *)
write_local_cfg.Channel     := 2;        (* embedded RS-485 -- NOT 0 *)
write_local_cfg.TriggerType := 0;        (* edge-triggered on IN     *)
write_local_cfg.Cmd         := 16;       (* FC 16 = write multiple   *)
write_local_cfg.ElementCnt  := 2;        (* cmd word + freq setpoint *)
write_target_cfg.Node := 1;
write_target_cfg.Addr := 16#2001;
(* MSG_MODBUS LocalAddr is a 125-WORD array (Rockwell MODBUSLOCADDR), so   *)
(* mb_write_cmd is bound to write_cmd_data : ARRAY[1..125] OF WORD. Assign  *)
(* the UINT control vars PLAIN -- a UINT value satisfies the "UINT/WORD"    *)
(* the buffer expects. NO ANY_TO_UDINT (32-bit -> err 0124).               *)
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

