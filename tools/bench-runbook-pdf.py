#!/usr/bin/env python3
"""Generate the Conv_Simple bench anomaly RUNBOOK PDF - the easiest faults to
inject and prove right now, post-Conv_Simple_2.1.

Distinct from docs/instructions/Conv_Simple_Anomaly_Catalog.pdf (the full 52-row
catalog): this is the short, do-it-now runbook of the handful that need NO reflash,
NO load, NO extra setup - plus A2 (drive-fault decode), newly unblocked by the V2.1
flash + the live_check reader wiring (2026-06-14).

Output: docs/instructions/Conv_Simple_Bench_Runbook_Easiest_2026-06-14.pdf
Usage:  python tools/bench-runbook-pdf.py
"""
from __future__ import annotations

import argparse
from pathlib import Path

from fpdf import FPDF

NAVY = (28, 45, 79)
RED = (180, 40, 40)
ORANGE = (200, 110, 30)
AMBER = (190, 150, 30)
GRAY = (110, 110, 110)
LIGHT = (238, 240, 244)
GREEN = (40, 130, 70)

SEV_COLOR = {"CRITICAL": RED, "HIGH": ORANGE, "MEDIUM": AMBER, "INFO": GRAY, "LOW": GRAY}


class RB(FPDF):
    def header(self):
        pass

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(0, 6, f"Conv_Simple bench runbook  ·  2026-06-14  ·  page {self.page_no()}",
                  align="C")

    # --- helpers ---
    def h1(self, txt):
        self.set_fill_color(*NAVY)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 13)
        self.cell(0, 9, f"  {txt}", new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)
        self.set_text_color(0, 0, 0)

    def h2(self, txt):
        self.ln(1)
        self.set_text_color(*NAVY)
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 7, txt, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)

    def body(self, txt, size=9.5):
        self.set_font("Helvetica", "", size)
        self.set_text_color(20, 20, 20)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, 5, txt)
        self.ln(0.5)

    def mono(self, txt):
        self.set_font("Courier", "", 8.5)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(20, 20, 20)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, 4.6, txt, fill=True)
        self.ln(1)

    def chip(self, sev):
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(*SEV_COLOR.get(sev, GRAY))
        self.set_text_color(255, 255, 255)
        self.cell(self.get_string_width(sev) + 6, 5.5, sev, align="C", fill=True)
        self.set_text_color(0, 0, 0)

    def box(self, title, lines, color=LIGHT):
        self.ln(1)
        self.set_fill_color(*color)
        self.set_font("Helvetica", "B", 9.5)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, 5, title, fill=True)
        self.set_font("Helvetica", "", 9)
        for ln in lines:
            self.set_x(self.l_margin)
            self.multi_cell(self.epw, 4.6, ln, fill=True)
        self.ln(2)


def test_card(pdf: RB, num, rule_ids, title, sev, inject, fires, mira, note=None):
    if pdf.get_y() > 230:
        pdf.add_page()
    pdf.ln(1)
    # header row: number + rule ids + severity chip
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*NAVY)
    label = f"Test {num} - {title}   [{rule_ids}]"
    pdf.cell(150, 7, label, new_x="RIGHT", new_y="TOP")
    pdf.chip(sev)
    pdf.ln(8)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 5, f"**Inject:** {inject}", markdown=True)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 5, f"**Fires:** {fires}", markdown=True)
    pdf.set_text_color(40, 40, 40)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 4.8, f'**Ask MIRA:** "{mira}"', markdown=True)
    pdf.set_text_color(0, 0, 0)
    if note:
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*ORANGE)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, 4.6, f"Note: {note}")
        pdf.set_text_color(0, 0, 0)
    pdf.ln(1)
    pdf.set_draw_color(210, 210, 210)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())


def build(out: Path):
    pdf = RB(format="letter")
    pdf.set_auto_page_break(True, margin=16)
    pdf.add_page()

    # Title
    pdf.set_font("Helvetica", "B", 19)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 11, "Conv_Simple - Bench Anomaly Runbook", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(60, 60, 60)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 6, "The easiest faults to inject and prove RIGHT NOW - no reflash, no load, "
                         "no extra setup. A subset of the 52-row catalog, ordered for a single bench session.")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(*GRAY)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 4.6,
        "PLC: Micro820 @ 192.168.1.100:502 (Modbus TCP)  |  Drive: GS10 DURApulse, RTU slave 1, 9600 8N1  |  "
        "Program: Conv_Simple_2.1 / Prog_VFD V2.1  |  Engine: plc/conv_simple_anomaly/ (A0-A12)  |  "
        "Generated 2026-06-14. Read-only: inject faults PHYSICALLY, never by writing registers.")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    pdf.box("What changed since the catalog (2026-06-12)",
            ["The Conv_Simple_2.1 flash exposed the GS10 status block (HR 400118-125: fault_code, "
             "status_word, freq_setpoint, ...), and live_check.py was wired to read it.",
             "=> A2 (GS10 drive-fault decode) is now LIVE without the slave-map-v2 reflash - it was "
             "the catalog's headline REFLASH row. A7 (freq-vs-setpoint) is also now readable.",
             "Still needs the reflash: the photo-eye family (A12, E1-E7) - di05 coil is unmapped."],
            color=(232, 242, 235))

    # 5-step loop
    pdf.h1("The bench loop (every test)")
    pdf.body("1. CCW: DISCONNECT from the controller; PLC in RUN (so the Modbus server answers).\n"
             "2. Confirm the historian is up + connected:  curl http://127.0.0.1:8766/health  "
             "(expect \"connection\":\"ok\").\n"
             "3. Start a labeled capture for the fault:")
    pdf.mono("python plc/conv_simple_anomaly/live_logger.py --label <fault_name>\n"
             "   (type a note + Enter mid-run to stamp the moment; Ctrl-C to stop)")
    pdf.body("4. Inject the fault physically (see each test).\n"
             "5. Confirm the rule fires (reads the real PLC, runs the rules, no broker needed):")
    pdf.mono("python plc/conv_simple_anomaly/live_check.py --secs 6")
    pdf.body("6. Ask MIRA the question -> it answers grounded in the same live tags.")

    pdf.box("Capture baselines FIRST (thresholds are relative to them)",
            ["baseline_idle      - 30 s, everything stopped",
             "baseline_run_fwd   - run forward at 30 Hz (torque ~66-77%, rpm ~878 - your golden run)",
             "baseline_run_rev   - run reverse (confirms vfd_cmd_word=34; rpm shows signed-as-unsigned "
             "~65000 in REV - known display quirk)"],
            color=(252, 247, 232))

    pdf.box("Safety (this rig has a real e-stop and a real motor)",
            ["The logger + live_check use only Modbus READ codes - side-effect-free (fieldbus-readonly).",
             "Keep vfd_ctrl_enable = FALSE / hand near the e-stop when inducing motion faults.",
             "Only manipulate e-stop wiring with the motor de-energized. The e-stop is a safety device, "
             "not a test toggle - press it (Test 3a) freely; pull a channel wire (3b) only de-energized."],
            color=(250, 238, 238))

    # The tests
    pdf.add_page()
    pdf.h1("The easy tests - in run order")

    test_card(pdf, 1, "A0", "PLC / bridge offline", "CRITICAL",
              "Unplug the PLC Ethernet (or stop the historian). You already proved this once by accident.",
              "A0_OFFLINE - no fresh PLC data for >= 30 s.",
              "I've lost contact with the conveyor PLC - no fresh data for N s. The values on screen are "
              "stale. Check the Ethernet link to 192.168.1.100 and that the bridge/historian is running.")

    test_card(pdf, 2, "A1 + B5", "GS10 RS-485 link down", "CRITICAL",
              "Unplug the RS-485 lead between the PLC and the GS10 (or power off the GS10).",
              "A1_COMM_STALE (vfd_comm_ok = False). All VFD analog values are trust-gated (frozen from the "
              "last good poll) - B5 proves the gate works (HRs look fresh but are stale).",
              "The GS10 isn't answering on RS-485 - its values are stale, treat them with suspicion. "
              "Likely a loose or reseated RS-485 conductor or termination. Check the A/B pair at both ends; "
              "confirm the GS10 is 9600 8N1, slave 1.")

    test_card(pdf, "3a", "S1", "E-stop pressed (normal stop)", "INFO",
              "Press the E-stop mushroom. (Totally safe - this is the intended use.)",
              "e_stop_active = 1; the PLC drops the run permit and the contactor opens. No fault - this is a "
              "healthy stop, logged INFO.",
              "The E-stop is pressed - the line is safely stopped on purpose. Release and re-arm (Start) when "
              "the area is clear to resume.")

    test_card(pdf, "3b", "A3", "E-stop dual-channel wiring fault", "HIGH",
              "With the motor DE-ENERGIZED, pull ONE e-stop channel wire (NC or NO) so the two channels "
              "disagree.",
              "A3_ESTOP_WIRING - di02_estop_nc == di03_estop_no (both read the same) OR the wiring-fault "
              "flag sets. The drive is not permitted.",
              "The E-stop channels disagree (NC vs NO read the same) - one contact or wire has failed. This "
              "can defeat the stop. Verify both channels switch together; check the suspect leg.",
              note="This touches a safety circuit - de-energize first, and restore the wire before returning "
                   "the rig to service.")

    test_card(pdf, 4, "A4", "Direction conflict (both selected)", "MEDIUM",
              "Throw BOTH direction switches (FWD and REV) at once.",
              "A4_DIRECTION_FAULT - di00_fwd_sw AND di01_rev_sw. The PLC refuses to pick a direction and "
              "commands STOP (cmd_word = 1).",
              "Both FWD and REV are selected at once - the PLC won't choose a direction, so it commands STOP. "
              "Check the direction selector and its wiring; only one should be made at a time.")

    test_card(pdf, 5, "A2", "GS10 drive fault decode (NEW - unblocked today)", "HIGH",
              "Unplug the RS-485 for > 5 s (past the GS10 P09.03 comm timeout), then RECONNECT. If the drive "
              "is set to fault on comm loss, it latches CE10 and the PLC reads it once comms restore.",
              "A2_VFD_FAULT decodes fault_code 58 -> \"CE10 (Modbus timeout)\". (During the unplug A1 fires; "
              "on reconnect A1 clears and A2 fires on the latched code.)",
              "The GS10 has tripped: CE10 (Modbus timeout) - it lost the RS-485 link long enough to fault. "
              "Restore comms, clear the cause, and reset the drive. If you don't want a hard trip on brief "
              "comm loss, check P09.02 (comm-fault treatment).",
              note="Only latches if P09.02 is set to fault-on-loss; otherwise the drive rides through and no "
                   "code appears. Alternative hard-fault: oL (overload) by loading the belt - but that needs "
                   "a real load (the unloaded bench draws ~0.5 A, well under the oL threshold).")

    # Coverage
    pdf.add_page()
    pdf.h1("Coverage - what's easy now vs later")
    pdf.h2("Easy RIGHT NOW (this runbook)")
    pdf.body("A0 offline, A1+B5 comm-stale, S1 e-stop press, A3 e-stop wiring, A4 direction, "
             "A2 GS10 fault decode. Plus the 3 baselines. No reflash, no load.")
    pdf.h2("Needs a real load on the belt (defer until loaded)")
    pdf.body("A8 overcurrent (current must exceed motor FLA ~5 A; unloaded draws ~0.5 A), "
             "A7 freq-not-tracking (drive must lag setpoint under drag), D1 locked-rotor/stall, "
             "D4 undercurrent. The reader now sees the signals - they just need load to move.")
    pdf.h2("Needs the slave-map-v2 reflash (di05 photo-eye coil 000023)")
    pdf.body("A12 photo-eye jam and the whole E-family (E1-E7: flaky, dead, stuck, loose-wire, jam). "
             "The committed map adds DI 5; the live PLC hasn't been reflashed - coil 23 returns "
             "ILLEGAL DATA ADDRESS and the rules degrade silently.")
    pdf.h2("Not yet coded as rules (catalog NEW rows)")
    pdf.body("B1-B4 (flaky/heartbeat/poll/restart), S4/S5, C2-C4, D2-D5, F1-F5, G1-G8. "
             "Signals are live; rules are the next batch to write (see the proving-test-case plan).")

    pdf.ln(2)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 4.4,
        "Source of truth: plc/conv_simple_anomaly/rules.py (the A0-A12 logic) + "
        "docs/instructions/Conv_Simple_Anomaly_Catalog.pdf (full 52-row catalog) + "
        "docs/plans/2026-06-14-proving-test-case-plan.md. Tools: live_logger.py (capture), "
        "live_check.py (confirm a rule fires), live_capture.py (full-tag coverage), "
        "verify_v2_telemetry.py (acceptance). Every signal is read-only Modbus TCP.")

    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"wrote {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path,
                    default=Path("docs/instructions/Conv_Simple_Bench_Runbook_Easiest_2026-06-14.pdf"))
    args = ap.parse_args()
    build(args.output)
