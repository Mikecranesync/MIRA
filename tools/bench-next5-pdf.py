#!/usr/bin/env python3
"""Generate the 'Next 5 Tests - Step by Step' bench runbook PDF.

A granular, do-this-then-that procedure for the 5 easiest anomaly tests after the
healthy baseline: A0, A1+B5, A3 (w/ S1 warm-up), A4, A2. Each test is numbered
steps with the exact command to type, the physical action, and the expected result.

Output: docs/instructions/Conv_Simple_Next5_Tests_StepByStep_2026-06-14.pdf
Usage:  python tools/bench-next5-pdf.py
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
GREEN = (30, 120, 60)
SEV_COLOR = {"CRITICAL": RED, "HIGH": ORANGE, "MEDIUM": AMBER, "INFO": GRAY}

# Each test: (num, title, rule_ids, sev, goal, steps)
# steps: list of (kind, text) ; kind in {"do","cmd","expect","note"}
TESTS = [
    (1, "PLC / bridge offline", "A0", "CRITICAL",
     "Prove MIRA notices when the PLC stops talking to the historian.",
     [("do", "Terminal A - start a labeled capture:"),
      ("cmd", "python plc/conv_simple_anomaly/live_logger.py --label a0_offline"),
      ("do", "Unplug the PLC Ethernet cable (from the laptop or the PLC)."),
      ("do", "Wait ~35 seconds - A0 needs >= 30 s of no fresh data."),
      ("do", "Terminal B - confirm the detector sees it:"),
      ("cmd", "curl http://127.0.0.1:8766/health"),
      ("expect", '"connection":"offline"  (no fresh data = the A0 condition). live_check '
                 "can't run with the link down - that absence IS the fault."),
      ("do", "Plug Ethernet back in; wait ~5 s."),
      ("cmd", "curl http://127.0.0.1:8766/health"),
      ("expect", '"connection":"ok"  - recovered.'),
      ("do", "Terminal A - stop the logger (Ctrl-C). Log saved under logs/."),
      ("do", 'Ask MIRA: "Is the conveyor PLC online? It went quiet."'),
      ("expect", '"Lost contact with the PLC - no fresh data for N s. Check the Ethernet link '
                 'to 192.168.1.100 and that the bridge/historian is running."')]),

    (2, "GS10 RS-485 link down", "A1 + B5", "CRITICAL",
     "Prove MIRA flags STALE drive data when the GS10 serial link drops (Ethernet stays up).",
     [("do", "Terminal A - capture:"),
      ("cmd", "python plc/conv_simple_anomaly/live_logger.py --label a1_rs485_down"),
      ("do", "Unplug the RS-485 lead between the PLC and the GS10. Leave Ethernet connected."),
      ("do", "Wait ~6 s."),
      ("do", "Terminal B - confirm the rule fires:"),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 6"),
      ("expect", "[CRITICAL] A1_COMM_STALE ...  and in the snapshot  vfd/vfd101/comm_ok = False."),
      ("note", "B5: the VFD registers still show their LAST values (frozen, not fresh) - the "
               "trust-gate marks them stale so MIRA won't reason on dead numbers."),
      ("do", "Reconnect the RS-485 lead; wait ~5 s."),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 6"),
      ("expect", "A1 clears (comm_ok = True)."),
      ("note", "If the GS10 faulted on the comm loss, this is also Test 5 (A2 / CE10) - expected; "
               "reset the drive after."),
      ("do", "Terminal A - Ctrl-C. "
             'Ask MIRA: "Is the GS10 talking? Why are its values frozen?"'),
      ("expect", '"GS10 isn\'t answering on RS-485 - values are stale. Likely a loose/reseated '
                 'conductor or termination; check the A/B pair, confirm 9600 8N1 slave 1."')]),

    (3, "E-stop: normal press, then wiring fault", "S1 + A3", "HIGH",
     "Prove MIRA tells a normal e-stop press apart from a dangerous wiring fault.",
     [("do", "Terminal A - capture:"),
      ("cmd", "python plc/conv_simple_anomaly/live_logger.py --label estop"),
      ("do", "WARM-UP (S1, safe): press the E-stop mushroom."),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 4"),
      ("expect", "snapshot shows  safety/estop = True  and NO anomaly - a healthy intentional stop."),
      ("do", "Release the E-stop and re-arm (Start)."),
      ("do", "FAULT (A3): with the motor DE-ENERGIZED, pull ONE e-stop channel wire (NC or NO) "
             "so the two channels disagree."),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 6"),
      ("expect", "[HIGH] A3_ESTOP_WIRING ...  with  di02_estop_nc == di03_estop_no  (both read same)."),
      ("do", "Restore the wire; re-check that A3 clears:"),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 4"),
      ("do", "Terminal A - Ctrl-C. "
             'Ask MIRA: "Is there an e-stop wiring fault?"'),
      ("expect", '"E-stop channels disagree (NC vs NO) - one contact or wire has failed; this can '
                 'defeat the stop. Verify both channels switch together; check the suspect leg."'),
      ("note", "Safety: this touches a safety circuit. De-energize first; restore the wire before "
               "returning the rig to service. Press (warm-up) freely; pull a wire only de-energized.")]),

    (4, "Direction conflict (both selected)", "A4", "MEDIUM",
     "Prove MIRA explains why the belt won't move when both directions are commanded.",
     [("do", "Terminal A - capture:"),
      ("cmd", "python plc/conv_simple_anomaly/live_logger.py --label a4_direction"),
      ("do", "Throw BOTH direction switches (FWD and REV) at once."),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 6"),
      ("expect", "[MEDIUM] A4_DIRECTION_FAULT ...  with  di00_fwd & di01_rev both True, cmd_word = 1 (STOP)."),
      ("do", "Return to a single direction (or neutral)."),
      ("do", "Terminal A - Ctrl-C. "
             'Ask MIRA: "Why won\'t the belt pick a direction?"'),
      ("expect", '"Both FWD and REV are selected - the PLC won\'t choose, so it commands STOP. '
                 'Check the selector/wiring; only one should be made at a time."')]),

    (5, "GS10 drive fault decode (the showcase)", "A2", "HIGH",
     "Prove MIRA decodes a real GS10 fault CODE into a plain-language cause + fix. "
     "(Newly unblocked by today's V2.1 flash.)",
     [("do", "Terminal A - capture:"),
      ("cmd", "python plc/conv_simple_anomaly/live_logger.py --label a2_ce10"),
      ("do", "Unplug the RS-485 for > 5 s (past the GS10 P09.03 comm timeout). The drive should "
             "trip CE10 if P09.02 is set to fault-on-comm-loss."),
      ("do", "Reconnect the RS-485; wait ~5 s for the PLC to re-poll the drive."),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 6"),
      ("expect", "[HIGH] A2_VFD_FAULT: GS10 reports fault code 58: CE10 (Modbus timeout) ...  "
                 "with  vfd/vfd101/fault_code = 58."),
      ("note", "If fault_code stays 0, the drive rode through (P09.02 not set to fault) - no trip to "
               "decode. Alternative hard fault: oL (overload) - but that needs a real belt load "
               "(the unloaded bench draws ~0.5 A, well under the oL threshold)."),
      ("do", "Reset the GS10 fault (keypad STOP/RESET, or power-cycle the drive). Re-check it clears:"),
      ("cmd", "python plc/conv_simple_anomaly/live_check.py --secs 4"),
      ("do", "Terminal A - Ctrl-C. "
             'Ask MIRA: "What fault is the GS10 showing?"'),
      ("expect", '"GS10 tripped: CE10 (Modbus timeout) - lost the RS-485 link long enough to fault. '
                 'Restore comms, clear the cause, reset the drive; check P09.02 if you don\'t want a '
                 'hard trip on brief comm loss."')]),
]


class RB(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(0, 6, f"Conv_Simple - Next 5 Tests, step by step  -  2026-06-14  -  page {self.page_no()}",
                  align="C")

    def w_cell(self, h, txt, size=9.5, style="", color=(20, 20, 20), mono=False, fill=None):
        self.set_font("Courier" if mono else "Helvetica", style, size)
        self.set_text_color(*color)
        if fill:
            self.set_fill_color(*fill)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, h, txt, markdown=not mono, fill=bool(fill))


def render_test(pdf: RB, num, title, ids, sev, goal, steps):
    if pdf.get_y() > 225:
        pdf.add_page()
    pdf.ln(2)
    # title bar
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11.5)
    pdf.set_x(pdf.l_margin)
    pdf.cell(pdf.epw - 30, 8, f"  Test {num} - {title}", fill=True, new_x="RIGHT", new_y="TOP")
    pdf.set_fill_color(*SEV_COLOR.get(sev, GRAY))
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(30, 8, f"{ids}  {sev}", align="C", fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.set_text_color(60, 60, 60)
    pdf.w_cell(4.8, f"Goal: {goal}", size=9, style="I", color=(60, 60, 60))
    pdf.ln(1)
    n = 0
    for kind, text in steps:
        if kind == "cmd":
            pdf.ln(0.5)
            pdf.w_cell(4.6, "    " + text, size=8.3, mono=True, fill=(244, 244, 244))
            pdf.ln(0.5)
        elif kind == "expect":
            pdf.w_cell(4.6, f"      -> expect: {text}", size=8.7, color=GREEN)
        elif kind == "note":
            pdf.w_cell(4.6, f"      note: {text}", size=8.3, color=ORANGE)
        else:  # do
            n += 1
            pdf.w_cell(4.8, f"**{n}.**  {text}", size=9.2, color=(15, 15, 15))
    pdf.ln(1)
    pdf.set_draw_color(205, 205, 205)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())


def build(out: Path):
    pdf = RB(format="letter")
    pdf.set_auto_page_break(True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 10, "Conv_Simple - Next 5 Tests (step by step)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10.5)
    pdf.set_text_color(60, 60, 60)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 5.5, "You've flashed Conv_Simple_2.1 and captured the healthy 30 Hz run. "
                   "These 5 fault tests come next - each fully spelled out. Work two terminals: "
                   "A = the logger (capture), B = live_check / curl (confirm).")
    pdf.ln(1)

    # Before you start
    pdf.set_fill_color(238, 240, 244)
    pdf.set_text_color(*NAVY)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 5.5, "Before you start (once)", fill=True)
    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "", 9)
    for ln in ["CCW: DISCONNECT from the controller; PLC in RUN (so the Modbus server answers).",
               "Historian up + connected:  curl http://127.0.0.1:8766/health  ->  \"connection\":\"ok\".",
               "Two terminals open in the repo root. (Optional) grab baseline_idle with the logger for reference.",
               "Read-only: the logger + live_check only READ Modbus - nothing writes to the PLC or GS10.",
               "Keep a hand near the e-stop; only manipulate e-stop wiring with the rig DE-ENERGIZED."]:
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, 4.7, f"- {ln}", fill=True)
    pdf.ln(1)

    for t in TESTS:
        render_test(pdf, *t)

    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*NAVY)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 5.5, "After the 5")
    pdf.set_text_color(40, 40, 40)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(pdf.epw, 4.7,
        "You'll have 5 labeled logs under logs/ - the ground truth for each fault. Those become the "
        "replay fixtures + golden cases in Phase 1 of the proving plan "
        "(docs/plans/2026-06-14-proving-test-case-plan.md). Tell me when they're captured and I'll "
        "turn them into the regression suite. Deferred for later: load-dependent faults (A8 overcurrent, "
        "A7 freq-tracking) need a belt load; the photo-eye family (A12, E1-E7) needs the di05 reflash.")

    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"wrote {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path,
                    default=Path("docs/instructions/Conv_Simple_Next5_Tests_StepByStep_2026-06-14.pdf"))
    args = ap.parse_args()
    build(args.output)
