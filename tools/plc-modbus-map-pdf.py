#!/usr/bin/env python3
"""Generate the Micro820 v4.1.9 Modbus mapping reference PDF.

The Modbus server map (`plc/MbSrvConf_v3.xml`) doesn't auto-deploy with the
ladder program — it has to be entered separately in Connected Components
Workbench (CCW). This tool prints the exact rows you type, in CCW order,
so you can match it against a paper trail.

Output:
    docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf

Usage:
    python3 tools/plc-modbus-map-pdf.py
    python3 tools/plc-modbus-map-pdf.py --output some/path.pdf
"""
from __future__ import annotations

import argparse
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

COILS = [
    # (Modbus address, CCW variable name, function / wired to, source-of-truth)
    ("000001", "motor_running",      "Motor M-101 commanded ON",               "ladder"),
    ("000002", "conveyor_running",   "Conveyor CV-101 running flag",           "ladder"),
    ("000003", "fault_alarm",        "Composite fault latched",                "ladder"),
    ("000004", "vfd_comm_ok",        "Modbus poll to GS10 healthy",            "ladder"),
    ("000005", "system_ready",       "All preconditions met",                  "ladder"),
    ("000006", "e_stop_active",      "E-stop circuit open",                    "ladder"),
    ("000007", "dir_fwd",            "Selector in FWD position",               "input I-00"),
    ("000008", "dir_rev",            "Selector in REV position",               "input I-01"),
    ("000009", "heartbeat",          "1 Hz blink to prove scan",               "ladder"),
    ("000010", "estop_wiring_fault", "Dual-channel E-stop XOR violation",      "ladder"),
    ("000011", "dir_fault",          "Both FWD and REV closed",                "ladder"),
    ("000012", "_IO_EM_DI_00",       "SelectorFWD (NO, knob LEFT)",            "input I-00"),
    ("000013", "_IO_EM_DI_01",       "SelectorREV (NO, knob RIGHT)",           "input I-01"),
    ("000014", "_IO_EM_DI_02",       "EStopNC (opens when pressed)",           "input I-02"),
    ("000015", "_IO_EM_DI_03",       "EStopNO (closes when pressed)",          "input I-03"),
    ("000016", "_IO_EM_DI_04",       "PBRun (illuminated momentary)",          "input I-04"),
    ("000017", "_IO_EM_DO_00",       "LightGreen (running indicator)",         "output O-00"),
    ("000018", "_IO_EM_DO_01",       "LightRed (fault / E-stop indicator)",    "output O-01"),
    ("000019", "_IO_EM_DO_02",       "ContactorQ1 (safety power)",             "output O-02"),
    ("000020", "_IO_EM_DO_03",       "PBRunLED (run pushbutton lamp)",         "output O-03"),
    ("000021", "vfd_poll_active",    "Modbus message in progress to VFD",      "ladder"),
    ("000022", "vfd_fault_reset_pending", "Fault reset queued for next poll",  "ladder"),
]

HOLDING_REGISTERS = [
    # (Modbus address, CCW variable, type, units / scale, notes)
    ("400101", "motor_speed",      "Int", "RPM",            "Calculated from VFD freq"),
    ("400102", "motor_current",    "Int", "A x 10",         "0..200 = 0..20.0 A"),
    ("400103", "temperature",      "Int", "deg C",          "VFD drive heatsink"),
    ("400104", "pressure",         "Int", "PSI",            "Spare — reserved"),
    ("400105", "conveyor_speed",   "Int", "0..4095",        "Raw scaled VFD setpoint"),
    ("400106", "error_code",       "Int", "enum",           "0=none 6=E-STOP 7=WIRING 8=DIR 9=VFD COMM"),
    ("400107", "vfd_freq",         "Int", "Hz x 10",        "300 = 30.0 Hz"),
    ("400108", "vfd_current",      "Int", "A x 10",         "GS10 actual"),
    ("400109", "vfd_voltage",      "Int", "V x 10",         "GS10 output voltage"),
    ("400110", "vfd_dc_bus",       "Int", "V x 10",         "GS10 DC bus voltage"),
    ("400111", "item_count",       "Int", "count",          "Products that traversed entry sensor"),
    ("400112", "uptime",           "Int", "seconds",        "Scan since power-on"),
    ("400113", "conveyor_speed_cmd", "Int", "0..4095",      "VFD speed setpoint (HMI / Modbus writes here)"),
    ("400114", "conv_state",       "Int", "enum",           "0=IDLE 1=STARTING 2=RUNNING 3=STOPPING 4=FAULT"),
    ("400115", "vfd_cmd_word",     "Int", "enum",           "1=STOP 18=FWD+RUN 20=REV+RUN 7=RESET"),
    ("400116", "vfd_freq_setpoint", "Int", "Hz x 10",       "Written from HMI / Modbus, sent to VFD reg 0x2001"),
    ("400117", "vfd_poll_step",    "Int", "1..4",           "1=read 2=cmd 3=freq 4=fault_reset"),
]

WIRING = [
    # (Terminal, CCW tag, Function, Common)
    ("I-00",  "_IO_EM_DI_00", "SelectorFWD (NO, knob LEFT)",   "COM0"),
    ("I-01",  "_IO_EM_DI_01", "SelectorREV (NO, knob RIGHT)",  "COM0"),
    ("I-02",  "_IO_EM_DI_02", "EStopNC (opens when pressed)",  "COM0"),
    ("I-03",  "_IO_EM_DI_03", "EStopNO (closes when pressed)", "COM0"),
    ("I-04",  "_IO_EM_DI_04", "PBRun (illuminated momentary)", "COM0"),
    ("I-05",  "_IO_EM_DI_05", "Entry sensor (spare PE-101)",   "COM0"),
    ("I-06",  "_IO_EM_DI_06", "Exit sensor (spare PE-102)",    "COM0"),
    ("I-07",  "—",            "(spare)",                       "COM0"),
    ("O-00",  "_IO_EM_DO_00", "LightGreen (running)",          "+CM0/-CM0"),
    ("O-01",  "_IO_EM_DO_01", "LightRed (fault/E-stop)",       "+CM0/-CM0"),
    ("O-02",  "_IO_EM_DO_02", "ContactorQ1 (safety power)",    "+CM0/-CM0"),
    ("O-03",  "_IO_EM_DO_03", "PBRunLED (run pushbutton)",     "+CM0/-CM0"),
]

VFD_CMDS = [
    # (cmd_word value, Action, GS10 reg 0x2000 meaning)
    ("1",  "STOP",        "Decel to zero"),
    ("7",  "FAULT RESET", "Clear latched VFD fault"),
    ("18", "FWD + RUN",   "Forward direction + run"),
    ("20", "REV + RUN",   "Reverse direction + run"),
]


# ---------------------------------------------------------------------------
# PDF assembly
# ---------------------------------------------------------------------------

PAGE_W, PAGE_H = letter
MARGIN = 0.5 * inch
USABLE_W = PAGE_W - 2 * MARGIN


def _table(data, col_widths, header_bg=colors.HexColor("#1e3a5f")):
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, 0), 9),
        ("FONTSIZE",   (0, 1), (-1, -1), 8),
        ("FONTNAME",   (0, 1), (-1, -1), "Helvetica"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7fb")]),
        ("GRID",       (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def build(output_path: str) -> None:
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title="Micro820 v4.1.9 Modbus Map",
        author="MIRA / FactoryLM",
    )

    base = getSampleStyleSheet()
    H1 = ParagraphStyle("h1", parent=base["Heading1"], fontSize=18,
                        textColor=colors.HexColor("#1e3a5f"), spaceAfter=4)
    H2 = ParagraphStyle("h2", parent=base["Heading2"], fontSize=12,
                        textColor=colors.HexColor("#1e3a5f"), spaceBefore=14, spaceAfter=6)
    BODY = ParagraphStyle("body", parent=base["BodyText"], fontSize=9, leading=12)
    MUTED = ParagraphStyle("muted", parent=base["BodyText"], fontSize=8,
                           leading=11, textColor=colors.HexColor("#666666"))

    story = []

    # ---- Cover block --------------------------------------------------------
    story.append(Paragraph("Micro820 v4.1.9 — Modbus Mapping Reference", H1))
    story.append(Paragraph(
        f"Connected Components Workbench data-entry sheet. "
        f"Generated {date.today().isoformat()} from "
        f"<font face='Courier'>plc/MbSrvConf_v3.xml</font> and "
        f"<font face='Courier'>plc/live_monitor.py</font>.",
        MUTED))
    story.append(Spacer(1, 12))

    story.append(Paragraph(
        "<b>Use:</b> open the Micro820 project in CCW, navigate to "
        "<i>Controller → Modbus Mapping</i>, and enter the rows below in the "
        "order shown. Coil base = <font face='Courier'>000001</font> "
        "(Modbus address 0). Holding-register base = "
        "<font face='Courier'>400101</font> (Modbus address 100). "
        "Build, download, set to RUN.",
        BODY))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Verify from CHARLIE:</b> "
        "<font face='Courier'>python3 plc/live_monitor.py --host 192.168.1.100</font>",
        BODY))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Currently observed from CHARLIE:</b> "
        "TCP 502 open, every Modbus read returns exception 1 (ILLEGAL_FUNCTION) — "
        "the Modbus server map is not deployed. Loading the table below fixes it.",
        BODY))

    # ---- Coils --------------------------------------------------------------
    story.append(Paragraph("Discrete Coils (FC1 / FC2)", H2))
    coil_data = [["Modbus addr", "CCW variable", "Function / wired to", "Source"]]
    coil_data.extend(list(c) for c in COILS)
    story.append(_table(coil_data, [0.9*inch, 1.7*inch, 3.4*inch, 1.5*inch]))

    # ---- Holding registers ---------------------------------------------------
    story.append(PageBreak())
    story.append(Paragraph("Holding Registers (FC3 / FC6 / FC16)", H2))
    hr_data = [["Modbus addr", "CCW variable", "Type", "Units / scale", "Notes"]]
    hr_data.extend(list(h) for h in HOLDING_REGISTERS)
    story.append(_table(hr_data, [0.85*inch, 1.6*inch, 0.55*inch, 1.0*inch, 3.5*inch]))

    # ---- Physical wiring -----------------------------------------------------
    story.append(Spacer(1, 14))
    story.append(Paragraph("Physical I/O Wiring (Micro820 2080-LC20-20QBB)", H2))
    wire_data = [["Terminal", "CCW tag", "Function", "Common"]]
    wire_data.extend(list(w) for w in WIRING)
    story.append(_table(wire_data, [0.7*inch, 1.5*inch, 4.3*inch, 1.0*inch]))

    # ---- VFD command word reference -----------------------------------------
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "VFD Command Word — write to HR <font face='Courier'>400115</font>", H2))
    vfd_data = [["Value", "Action", "GS10 reg 0x2000 meaning"]]
    vfd_data.extend(list(v) for v in VFD_CMDS)
    story.append(_table(vfd_data, [0.7*inch, 1.5*inch, 5.3*inch]))

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "<b>error_code (HR 400106) decoder:</b> "
        "0 = none · 6 = E-STOP · 7 = WIRING fault (E-stop XOR) · "
        "8 = DIRECTION fault (FWD and REV both closed) · 9 = VFD comm timeout.",
        BODY))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>conv_state (HR 400114) decoder:</b> "
        "0 = IDLE · 1 = STARTING · 2 = RUNNING · 3 = STOPPING · 4 = FAULT.",
        BODY))

    # ---- Footer note --------------------------------------------------------
    story.append(Spacer(1, 18))
    story.append(Paragraph(
        "<i>This sheet is generated; do not hand-edit. Source: "
        "tools/plc-modbus-map-pdf.py. If the ladder gains a new variable, "
        "add it to plc/MbSrvConf_v3.xml AND to this generator's tables, "
        "then re-run.</i>",
        MUTED))

    doc.build(story)


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate Micro820 v4.1.9 Modbus map PDF")
    ap.add_argument(
        "--output",
        default="docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf",
    )
    args = ap.parse_args()
    out = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
