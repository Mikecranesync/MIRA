# VFD Commissioning Resume Prompt

Paste this into Claude Code to resume VFD RS-485 commissioning:

---

```
Read CLAUDE.md and plc/GS10_Integration_Guide.md for full context.

I'm commissioning RS-485 Modbus RTU between a Micro820 2080-LC20-20QBB PLC
and a GS10 DURApulse VFD. The PLC program is v5.0.0 in CCW Prog2.stf.

STATUS: The PLC program is correct (Channel=0, GS10 registers 0x2000/0x2001/
0x2002/0x2103, commands 18/20/1, COP blocks, msg_step_timer). But the serial
port Modbus RTU driver has NEVER been loaded onto the PLC hardware.

BLOCKER: CCW shows "embedded serial in the project and controller are out of
sync." Every download attempt, the TCPIPObject download fails, which interrupts
the serial port config transfer. mb_read_status.ErrorID=255 confirms the MSG
blocks have never completed a real RS-485 transaction.

Evidence:
- poll_step cycles 1→2→3 (MSG blocks execute in software)
- VFD sees NOTHING on RS-485 in either wire orientation (no CE2)
- ErrorID=255 = MSG block never completed (default/uninitialized value)
- VFD display shows F60.0 (normal, powered, no faults)
- 110Ω termination resistor installed
- VFD keypad: P09.00=1, P09.01=9.6, P09.04=12 (8N1), P00.21=2
- Ethernet set to static 169.254.32.93 in CCW project

WHAT I NEED:
1. Figure out how to get a CLEAN full download where the serial port config
   actually syncs to the PLC. The TCPIPObject keeps failing.
   - Can I try USB instead of Ethernet?
   - Is there a way to download just the serial port config separately?
   - Is there a CCW setting that's causing the TCP download to fail?

2. After serial port syncs, run: python plc/vfd_diag.py --once
   - If ErrorID changes from 255 → serial port is now active
   - If ErrorID=55 → timeout, swap D+/D- wires
   - If vfd_comm_ok=TRUE → VFD is talking!

3. First motor run: selector FWD + press RUN button

Key files:
- CCW project: C:\Users\hharp\Documents\CCW\MIRA_PLC\
- PLC program: CCW/.../Micro820/Micro820/Prog2.stf (v5.0.0)
- Diagnostic: plc/vfd_diag.py, plc/vfd_fix_attempts.py
- VFD guide: plc/GS10_Integration_Guide.md
- Modbus TCP map: CCW/.../MbSrvConf.xml

DO NOT rewrite the PLC program. v5.0.0 is correct. The problem is purely
the CCW download/sync issue.
```
