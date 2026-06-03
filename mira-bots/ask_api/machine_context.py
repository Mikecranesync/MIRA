"""Always-on machine-context block injected into every /ask call.

This module holds ONE constant, ``MACHINE_CONTEXT`` — a condensed distillation
of ``MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md`` (the single source of truth about
THIS garage conveyor). It grounds MIRA in the real Micro820 + GS10 machine so it
answers from the actual iron, not generic VFD trivia.

It lives in its own module so the facts can be edited independently of the
/ask handler logic in ``app.py``. Keep it dense and factual (~400-600 tokens):
it is prepended to every question, so brevity directly costs tokens on each call.
When the machine card changes, update this block (and the decode dicts in app.py).
"""

MACHINE_CONTEXT = """[MACHINE: GARAGE CONVEYOR]
Garage conveyor belt. PLC: Allen-Bradley Micro820 2080-LC20-20QBB @192.168.1.100
(EtherNet/IP :44818; Modbus TCP slave :502 unit 1). VFD: AutomationDirect GS10
(DURApulse) spinning the belt motor. PLC↔VFD: RS-485 Modbus RTU, PLC=master, GS10=slave 1,
9600 8N1. PLC reads buttons/sensors+GS10 status, decides if belt may run, writes
run/stop/direction to GS10. Dashboard reads unpacked values from the PLC's Modbus TCP slave.

RUN PERMIT = contactor DO_02 in AND e-stop healthy AND photo-eye not latched. Direction:
DI_00=FWD, DI_01=REV, neither=OFF; both = direction fault→STOP. Start=DI_04 (re-arms
photo-eye latch with beam clear, resumes drive).

VFD COMMAND WORD (reg 0x2000, FC06): 1=STOP, 18=FWD+RUN, 20=REV+RUN (REV may be 34 on some
configs—verify on bench). Freq setpoint reg 0x2001=Hz×10. Fault reset=write 2 to 0x2002.
GS10 only accepts Modbus when P00.21=2 (run src RS-485) AND P00.20=1 (freq src RS-485).

E-STOP (dual-channel, must disagree when healthy): DI_02=NC healthy=TRUE; DI_03=NO
healthy=FALSE. Pressed→DI_02 FALSE/DI_03 TRUE→e-stop active, drive STOP. Both channels SAME
state (both TRUE or both FALSE)=wiring fault (broken/shorted)—unsafe, drive not permitted.

PHOTO-EYE DI_05 (TRUE=beam blocked) = LATCHING soft-stop. Beam break latches pe_latched
TRUE→run permit FALSE, VFD STOP—but main contactor DO_02 STAYS ENERGIZED (power present,
motor stopped). Clearing beam alone does NOT restart; operator must press Start (DI_04) with
beam clear to clear pe_latched and resume.

GS10 FAULT CODES (vfd_fault_code, 0=none): 4=GFF ground fault; 12=Lvd undervoltage on decel;
21=oL overload (load/jam); 49=EF external fault; 54=CE1 comm illegal cmd (bad function code);
55=CE2 comm illegal addr; 56=CE3 comm illegal data; 57=CE4 slave error (power-cycle);
58=CE10 modbus timeout (check 9600 8N1/wiring). Clear via keypad STOP/RESET or write 2 to
0x2002; if stuck, power-cycle.

GS10 STATUS WORD (reg 0x2101) low 2 bits: 00=stopped, 01=decel, 10=standby, 11=running.

KEY TAGS+scaling: vfd_comm_ok=MASTER TRUST GATE (FALSE→all VFD values below are stale).
vfd_frequency=output Hz×100 (6000=60.00Hz). vfd_freq_sp=setpoint Hz×100. vfd_current=A×100.
vfd_dc_bus=V×10 (~3270=327V idle). vfd_cmd_word=command echo (1/18/20). vfd_status_word=see
above. vfd_fault_code=see table. vfd_run_permit=DO_02 AND e_stop_ok AND NOT pe_latched.
pe_latched=photo-eye jam latch. DI_02=e-stop ch A (healthy TRUE). DI_05=photo-eye
(TRUE=blocked). DO_02=main contactor (TRUE=power enabled, stays in during soft-stop)."""
