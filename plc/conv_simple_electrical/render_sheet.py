"""Render an electrical print SHEET from the structured model (YAML source of truth).

Currently implements the E-005 "PLC Digital Inputs" sheet. The model in ./model/*.yaml
is authoritative: a conductor is drawn SOLID only if its wire's status == 'verified',
otherwise DASHED + "FIELD VERIFY". PLC terminal<->function come from terminals.yaml
(status verified from the real Micro820 program + Ignition OPC docs).

Usage:  python render_sheet.py E-005
Outputs: sheets/E-005_plc_inputs.svg / .pdf  (+ a QA .png)
"""
from __future__ import annotations

import pathlib
import sys

import yaml

HERE = pathlib.Path(__file__).parent
MODEL = HERE / "model"
SHEETS = HERE / "sheets"
SHEETS.mkdir(exist_ok=True)

# ---- palette (color is NOT meaning; black print + red only for FIELD VERIFY tags) ----
BLK = "#111111"
GRY = "#666666"
LGRY = "#BBBBBB"
RED = "#C0392B"       # reserved for the "FIELD VERIFY" / unverified marker ONLY
BG = "#FFFFFF"
DASH = "7,4"


def _load(name):
    return yaml.safe_load((MODEL / f"{name}.yaml").read_text(encoding="utf-8"))


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class SVG:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = []

    def line(self, x1, y1, x2, y2, color=BLK, w=1.6, dash=False, cap="butt"):
        d = f' stroke-dasharray="{DASH}"' if dash else ""
        self.p.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}"{d}/>'
        )

    def rect(self, x, y, w, h, color=BLK, sw=1.4, fill="none", dash=False):
        d = f' stroke-dasharray="{DASH}"' if dash else ""
        self.p.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'fill="{fill}" stroke="{color}" stroke-width="{sw}"{d}/>'
        )

    def circle(self, cx, cy, r, color=BLK, sw=1.4, fill="none"):
        self.p.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" '
            f'stroke="{color}" stroke-width="{sw}"/>'
        )

    def text(self, x, y, s, size=10, anchor="start", color=BLK, weight="normal", mono=False):
        fam = "Consolas, 'Courier New', monospace" if mono else "Arial, Helvetica, sans-serif"
        self.p.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-family="{fam}" '
            f'text-anchor="{anchor}" font-weight="{weight}" fill="{color}">{esc(s)}</text>'
        )

    def dump(self):
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}">'
        )
        return head + f'<rect width="{self.w}" height="{self.h}" fill="{BG}"/>' + "\n".join(self.p) + "</svg>"


# ---------------------------------------------------------------- symbol templates
def wire_tag(s, x, y, num, verified):
    """A small wire-number flag on a conductor."""
    color = BLK if verified else RED
    s.rect(x - 16, y - 20, 32, 13, color=color, sw=0.9)
    s.text(x, y - 10, num, size=8.5, anchor="middle", color=color, mono=True)


def contact_no(s, xl, xr, y, label, term):
    """Normally-open contact glyph between xl and xr on line y."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y)
    s.line(cx + 12, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)          # open diagonal arm
    s.text(cx, y - 20, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def contact_nc(s, xl, xr, y, label, term):
    """Normally-closed contact glyph."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y)
    s.line(cx + 12, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 10, y - 12)         # arm
    s.line(cx + 6, y - 14, cx + 6, y + 3)       # NC bar
    s.text(cx, y - 20, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def selector(s, xl, xr, y, label, term):
    """Selector-switch contact (contact + small selector actuator tick)."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y)
    s.line(cx + 12, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)
    s.line(cx - 2, y - 9, cx - 2, y - 18)       # actuator stem
    s.text(cx - 2, y - 22, "∓", size=9, anchor="middle", color=GRY)
    s.text(cx, y - 30, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def pushbutton(s, xl, xr, y, label, term):
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y)
    s.line(cx + 12, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)
    s.line(cx, y - 9, cx, y - 20)               # plunger
    s.line(cx - 6, y - 20, cx + 6, y - 20)
    s.text(cx, y - 26, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def photoeye(s, xl, xr, y, label, term):
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 20, y)
    s.line(cx + 20, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.rect(cx - 20, y - 12, 40, 24)
    s.text(cx, y + 4, "▷→", size=10, anchor="middle", color=GRY)  # emit arrow
    s.text(cx, y - 18, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 22, term, size=8, anchor="middle", color=GRY, mono=True)


GLYPH = {"selector": selector, "estop_nc": contact_nc, "estop_no": contact_no,
         "pb": pushbutton, "photoeye": photoeye}


# ---------------------------------------------------------------- shared frame/table/emit
def draw_frame(s, W, H, title, subtitle):
    fx0, fy0, fx1, fy1 = 30, 30, W - 30, H - 30
    s.rect(fx0, fy0, fx1 - fx0, fy1 - fy0, sw=1.8)
    s.rect(fx0 + 10, fy0 + 10, (fx1 - fx0) - 20, (fy1 - fy0) - 20, sw=0.8, color=GRY)
    cols = 8
    step = (fx1 - fx0 - 20) / cols
    for i in range(cols + 1):
        x = fx0 + 10 + i * step
        s.line(x, fy0, x, fy0 + 10, color=GRY, w=0.8)
        s.line(x, fy1 - 10, x, fy1, color=GRY, w=0.8)
        if i < cols:
            s.text(x + step / 2, fy0 + 8, str(i + 1), size=8, anchor="middle", color=GRY)
            s.text(x + step / 2, fy1 - 3, str(i + 1), size=8, anchor="middle", color=GRY)
    for j, ch in enumerate("ABCD"):
        yy = fy0 + 10 + (j + 0.5) * ((fy1 - fy0 - 20) / 4)
        s.text(fx0 + 5, yy, ch, size=8, anchor="middle", color=GRY)
        s.text(fx1 - 5, yy, ch, size=8, anchor="middle", color=GRY)
    s.text(70, 78, title, size=22, weight="bold")
    s.text(70, 100, subtitle, size=12, color=GRY)
    s.line(60, 112, W - 420, 112, color=LGRY, w=1)
    return fx0, fy0, fx1, fy1


def title_block(s, fx1, fy1, meta, sheet_id, title, sheet_no, lineage=""):
    tb_w, tb_h = 430, 96
    tx, ty = fx1 - 20 - tb_w, fy1 - 20 - tb_h
    s.rect(tx, ty, tb_w, tb_h, sw=1.6)
    s.line(tx, ty + 46, tx + tb_w, ty + 46, color=BLK, w=0.9)
    s.line(tx + tb_w - 150, ty, tx + tb_w - 150, ty + tb_h, color=BLK, w=0.9)
    s.text(tx + 12, ty + 22, title, size=13, weight="bold")
    s.text(tx + 12, ty + 38, f"{meta['project']} / {meta['asset']}", size=10, color=GRY)
    s.text(tx + 12, ty + 64, "MIRA / FactoryLM", size=9)
    s.text(tx + 12, ty + 82, lineage or f"Drawn: {meta['drawn_by']}", size=7.5, color=GRY)
    s.text(tx + tb_w - 142, ty + 20, "SHEET", size=8, color=GRY)
    s.text(tx + tb_w - 142, ty + 38, sheet_id, size=16, weight="bold")
    s.text(tx + tb_w - 142, ty + 62, f"REV {meta['revision']}", size=10)
    s.text(tx + tb_w - 142, ty + 80, f"{meta['date']}", size=9, color=GRY)
    s.text(tx + tb_w - 12, ty + 62, sheet_no, size=10, anchor="end", color=GRY)


def draw_table(s, x0, y0, colw, headers, rows, evidence_col=None, rh=22):
    total = sum(colw)
    # header
    s.rect(x0, y0, total, rh, fill="#EEEEEE", sw=1.0)
    cx = x0
    for w, h in zip(colw, headers):
        s.text(cx + 5, y0 + rh - 7, h, size=8.3, weight="bold")
        cx += w
    # rows
    y = y0 + rh
    for r in rows:
        s.rect(x0, y, total, rh, sw=0.7)
        cx = x0
        for i, (w, cell) in enumerate(zip(colw, r)):
            color = BLK
            mono = i in (1, 3, 5)
            if evidence_col is not None and i == evidence_col:
                color = BLK if str(cell).startswith("verified") else RED
            s.text(cx + 5, y + rh - 7, cell, size=8.0, color=color, mono=mono)
            cx += w
        y += rh
    # column separators
    cx = x0
    for w in colw[:-1]:
        cx += w
        s.line(cx, y0, cx, y, color=GRY, w=0.6)
    return y


def _emit(s, basename):
    svg = s.dump()
    (SHEETS / f"{basename}.svg").write_text(svg, encoding="utf-8")
    import fitz
    doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
    try:
        (SHEETS / f"{basename}.pdf").write_bytes(doc.convert_to_pdf())
        doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(str(SHEETS / f"{basename}.png"))
    finally:
        doc.close()
    print("wrote", SHEETS / f"{basename}.pdf")


def earth_symbol(s, x, y):
    s.line(x, y, x, y + 12)
    for i, wq in enumerate([16, 10, 5]):
        s.line(x - wq, y + 12 + i * 4, x + wq, y + 12 + i * 4)


def render_e007():
    m = _load("devices")["meta"]
    e = yaml.safe_load((MODEL / "e007_rs485.yaml").read_text(encoding="utf-8"))
    plc, vfd = e["endpoints"]["plc"], e["endpoints"]["vfd"]

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s, W, H, "E-007  RS-485 / MODBUS RTU COMMUNICATION",
        f"{m['project']} / {m['asset']}  —  Micro820 (master) ↔ GS10 (node 1)  ·  Modbus RTU only")

    # device blocks
    plx, pw = 250, 250
    vfx, vw = 1090, 250
    by, bh = 200, 258
    s.rect(plx, by, pw, bh, sw=1.8)
    s.text(plx + pw / 2, by + 24, plc["tag"], size=15, anchor="middle", weight="bold")
    s.text(plx + pw / 2, by + 42, "Micro820 2080-LC20-20QBB", size=8.5, anchor="middle", color=GRY)
    s.text(plx + pw / 2, by + 56, "embedded RS-485 (Ch 2)", size=8.5, anchor="middle", color=BLK)
    s.rect(vfx, by, vw, bh, sw=1.8)
    s.text(vfx + vw / 2, by + 24, vfd["tag"], size=15, anchor="middle", weight="bold")
    s.text(vfx + vw / 2, by + 42, "GS10 DURApulse", size=8.5, anchor="middle", color=GRY)
    s.text(vfx + vw / 2, by + 56, "RS-485 RJ45 jack", size=8.5, anchor="middle", color=BLK)

    # terminal Y positions
    ty = {"485+": 288, "485-": 338, "SGND": 388}
    plc_term = {"485+": "D+ (A)", "485-": "D- (B)", "SGND": "SG"}
    vfd_pin = {"485+": "pin 5 · SG+", "485-": "pin 4 · SG-", "SGND": "pin 3 · SGND"}
    for lbl, y in ty.items():
        s.circle(plx + pw, y, 3.2, fill=BLK)
        s.text(plx + pw - 8, y - 4, plc_term[lbl], size=9, anchor="end", mono=True)
        s.circle(vfx, y, 3.2, fill=BLK)
        s.text(vfx + 8, y - 4, vfd_pin[lbl], size=9, anchor="start", mono=True)

    # signal wires (verified -> solid) with labels + conductor color
    cond = {"485+": "white of pair", "485-": "black of pair", "SGND": "third conductor"}
    for lbl, y in ty.items():
        s.line(plx + pw, y, vfx, y, color=BLK, w=1.8)
        mid = (plx + pw + vfx) / 2
        wire_tag(s, mid, y, lbl, verified=True)
        s.text(mid, y + 16, cond[lbl], size=8, anchor="middle", color=GRY)

    # shield: land PLC end only, float GS10 end (field-verify)
    shy = 443
    s.circle(plx + pw, shy, 3.2, fill=BLK)
    s.text(plx + pw - 8, shy - 4, "shield / drain", size=9, anchor="end", mono=True)
    s.line(plx + pw, shy, plx + pw + 90, shy, color=BLK, w=1.6, dash=True)
    earth_symbol(s, plx + pw + 90, shy)
    s.text(plx + pw + 108, shy + 2, "chassis — PLC end ONLY", size=8, color=RED)
    s.text(vfx - 8, shy - 4, "(floated / taped at GS10)", size=8, anchor="end", color=GRY)

    # 120 ohm termination across SG+/SG- at drive end
    tx = vfx - 34
    s.line(tx, ty["485+"], tx, ty["485-"], color=BLK, w=1.2)
    s.line(vfx, ty["485+"], tx, ty["485+"], color=BLK, w=1.2)
    s.line(vfx, ty["485-"], tx, ty["485-"], color=BLK, w=1.2)
    s.rect(tx - 6, (ty["485+"] + ty["485-"]) / 2 - 12, 12, 24, sw=1.1)
    s.text(tx - 12, (ty["485+"] + ty["485-"]) / 2 + 2, "120Ω", size=8, anchor="end")
    s.text(tx - 12, (ty["485+"] + ty["485-"]) / 2 + 14, "(drive end)", size=7, anchor="end", color=GRY)

    # cable bracket
    s.text((plx + pw + vfx) / 2, 175, "Belden 3105A — shielded twisted pair (485+/485-) + 1 conductor (SGND) + drain",
           size=9, anchor="middle", color=GRY)

    # readback note
    s.text(vfx + vw / 2, by + bh + 18, "link up ⇒ vfd_comm_ok = TRUE ; read 0x2103 (FC03) for nonzero freq",
           size=8.5, anchor="middle", color=GRY)

    # ---- connection table ----
    ty0 = 500
    s.text(70, ty0 - 8, "CONNECTION TABLE", size=11, weight="bold")
    colw = [70, 130, 70, 150, 175, 60, 105, 320]
    headers = ["Src dev", "Src terminal", "Dst dev", "Dst terminal/pin", "Cable / conductor",
               "Wire", "Evidence", "Notes"]
    rows = []
    for L in e["links"]:
        rows.append([
            L["src_device"], L["src_terminal"], L["dst_device"], L["dst_terminal"],
            f"{L['cable']} · {L['conductor']}", L["wire_label"], L["evidence"], L.get("notes", ""),
        ])
    tbl_bottom = draw_table(s, 70, ty0, colw, headers, rows, evidence_col=6)

    # ---- serial config strip ----
    sc = e["serial_config"]
    y = tbl_bottom + 26
    s.text(70, y, "CCW SERIAL PORT:", size=9, weight="bold")
    s.text(190, y, f"{sc['driver']} · {sc['baud']} · {sc['format']} · Channel {sc['channel']} · Node {sc['node']}",
           size=9, mono=True)
    s.text(70, y + 14, sc["note"], size=7.6, color=GRY)

    # ---- correction callout ----
    y += 40
    s.rect(70, y - 12, 1180, 20, color=RED, sw=1.0)
    s.text(78, y + 2, "CORRECTED from May-16 draft:  Channel 0 → 2   ·   SGND pin 1/8 → pin 3   ·   "
                      "8N2 → 8N1.  Do not copy the old values.", size=8.6, color=RED)

    # ---- troubleshooting ----
    y += 34
    s.text(70, y, "TROUBLESHOOTING (this circuit)", size=10, weight="bold")
    for i, t in enumerate(e["troubleshooting"]):
        s.text(78, y + 16 + i * 14, f"• {t}", size=8.4)

    # ---- legend ----
    ly = y + 16 + len(e["troubleshooting"]) * 14 + 16
    s.line(80, ly, 130, ly, color=BLK, w=1.8)
    s.text(140, ly + 4, "VERIFIED (recovered CommsToVFD + Beginner_Verify p48 + Prog_init v2.1)", size=8.5)
    s.line(80, ly + 18, 130, ly + 18, color=BLK, w=1.8, dash=True)
    s.text(140, ly + 22, "FIELD VERIFY (exact PLC chassis ground point; cable P/N if not Belden 3105A)", size=8.5)

    # ---- sources ----
    sy = ly + 44
    s.text(70, sy, "SOURCES:", size=8.5, weight="bold")
    for i, src in enumerate(e["sources"]):
        s.text(130, sy + i * 12, src, size=7.6, color=GRY)

    title_block(s, fx1, fy1, m, "E-007", "RS-485 / MODBUS RTU", "7 of 9",
                lineage="recovers MIRA-WI-001 / Conv_Simple_CommsToVFD §2")
    _emit(s, "E-007_rs485_modbus")


def render_e005():
    devices = _load("devices")
    terms = _load("terminals")
    wires = _load("wires")
    sheets = _load("sheets")
    meta = devices["meta"]

    # index wires by destination PLC terminal
    wl = {w["to"]: w for w in wires["wires"] if str(w["to"]).startswith("PLC1.I-")}
    plc_in = terms["PLC1"]["inputs"]

    # which glyph + field label each used input gets
    plan = {
        "I-00": ("selector", "SS1  FWD", "FWD contact"),
        "I-01": ("selector", "SS1  REV", "REV contact"),
        "I-02": ("estop_nc", "S0  E-STOP", "S0 11-12 (NC)"),
        "I-03": ("estop_no", "S0  E-STOP", "S0 23-24 (NO)"),
        "I-04": ("pb", "S2  RUN", "S2 3-4"),
        "I-05": ("photoeye", "B1  PHOTO-EYE", "B1 BK"),
    }

    W, H = 1600, 1040
    s = SVG(W, H)

    # ---- sheet border + zone grid ----
    fx0, fy0, fx1, fy1 = 30, 30, 1570, 1010
    s.rect(fx0, fy0, fx1 - fx0, fy1 - fy0, sw=1.8)
    s.rect(fx0 + 10, fy0 + 10, (fx1 - fx0) - 20, (fy1 - fy0) - 20, sw=0.8, color=GRY)
    cols = 8
    for i in range(cols + 1):
        x = fx0 + 10 + i * ((fx1 - fx0 - 20) / cols)
        s.line(x, fy0, x, fy0 + 10, color=GRY, w=0.8)
        s.line(x, fy1 - 10, x, fy1, color=GRY, w=0.8)
        if i < cols:
            s.text(x + ((fx1 - fx0 - 20) / cols) / 2, fy0 + 8, str(i + 1), size=8, anchor="middle", color=GRY)
            s.text(x + ((fx1 - fx0 - 20) / cols) / 2, fy1 - 3, str(i + 1), size=8, anchor="middle", color=GRY)
    rows = "ABCD"
    for j, ch in enumerate(rows):
        yy = fy0 + 10 + (j + 0.5) * ((fy1 - fy0 - 20) / len(rows))
        s.text(fx0 + 5, yy, ch, size=8, anchor="middle", color=GRY)
        s.text(fx1 - 5, yy, ch, size=8, anchor="middle", color=GRY)

    # ---- header ----
    s.text(70, 78, "E-005  PLC DIGITAL INPUTS", size=22, weight="bold")
    s.text(70, 100, f"{meta['project']} / {meta['asset']}  —  Micro820 2080-LC20-20QBB embedded DI (24 VDC)",
           size=12, color=GRY)
    s.line(60, 112, 1180, 112, color=LGRY, w=1)

    # ---- rails ----
    rail_x = 250
    rung_y = {"I-00": 235, "I-01": 297, "I-02": 359, "I-03": 421, "I-04": 483, "I-05": 545}
    rail_top, rail_bot = 210, 560
    s.line(rail_x, rail_top, rail_x, rail_bot, color=BLK, w=2.2, dash=True)
    wire_tag(s, rail_x, rail_top - 2, "W24", verified=False)
    s.text(rail_x, rail_top - 26, "+24 VDC", size=11, anchor="middle", weight="bold")
    s.text(rail_x, rail_top - 40, "(PS1 / E-004)", size=8.5, anchor="middle", color=GRY)

    # ---- PLC input block ----
    bx, by, bw = 1170, 150, 300
    by2 = 900
    s.rect(bx, by, bw, by2 - by, sw=1.8)
    s.text(bx + bw / 2, by + 22, "PLC1", size=15, anchor="middle", weight="bold")
    s.text(bx + bw / 2, by + 40, "Micro820 2080-LC20-20QBB", size=9, anchor="middle", color=GRY)
    s.text(bx + bw / 2, by + 54, "embedded digital inputs", size=8.5, anchor="middle", color=GRY)

    # spare + common Y positions
    spare_ids = ["I-06", "I-07", "I-08", "I-09", "I-10", "I-11"]
    spare_y = {tid: 600 + k * 26 for k, tid in enumerate(spare_ids)}
    com_y = 600 + len(spare_ids) * 26 + 10

    # draw the six wired rungs
    for tid, y in rung_y.items():
        info = next(t for t in plc_in if t["id"] == tid)
        w = wl.get(f"PLC1.{tid}")
        verified_wire = (w and w.get("status") == "verified")
        kind, dev_label, field_term = plan[tid]

        # device glyph between rail and a mid point
        dxl, dxr = rail_x, 470
        # +24V lead into device (field-verify -> dashed)
        s.line(rail_x, y, dxl + 60, y, color=BLK, w=1.6, dash=not verified_wire)
        GLYPH[kind](s, dxl + 60, dxr, y, dev_label, field_term)
        # signal conductor device -> PLC terminal (field-verify -> dashed)
        s.line(dxr, y, bx, y, color=BLK, w=1.6, dash=not verified_wire)
        wire_tag(s, (dxr + bx) / 2, y, w["proposed_number"] if w else "?", verified_wire)
        # PLC terminal (VERIFIED) — solid dot + label inside block
        s.circle(bx, y, 3.2, fill=BLK)
        s.text(bx + 10, y - 3, tid, size=11, weight="bold", mono=True)
        s.text(bx + 10, y + 10, info["function"], size=8.5, color=BLK)
        s.text(bx + 10, y + 21, info["opc"], size=7.5, color=GRY, mono=True)
        s.text(bx + bw - 8, y + 2, f"healthy: {info['healthy_state']}", size=7.5, anchor="end", color=GRY)

    # spares
    for tid, y in spare_y.items():
        s.circle(bx, y, 3.0, fill="#FFFFFF")
        s.text(bx + 10, y + 3, f"{tid}", size=10, mono=True, color=GRY)
        s.text(bx + 60, y + 3, "spare (no field wire — confirmed unused)", size=8, color=GRY)

    # common
    s.circle(bx, com_y, 3.2, fill=BLK)
    s.text(bx + 10, com_y + 3, "COM0", size=10, weight="bold", mono=True)
    s.line(bx, com_y, bx - 120, com_y, color=BLK, w=1.6, dash=True)
    wire_tag(s, bx - 60, com_y, "W0V", verified=False)
    s.text(bx - 128, com_y + 3, "0V (PS1 / E-004)", size=8.5, anchor="end", color=GRY)
    s.text(bx + 70, com_y + 3, "input common — sink/source FIELD VERIFY", size=8, color=RED)

    # ---- legend + notes (bottom-left) ----
    ly = 590
    s.text(70, ly, "LEGEND", size=11, weight="bold")
    s.line(80, ly + 16, 130, ly + 16, color=BLK, w=1.8)
    s.text(140, ly + 20, "VERIFIED — PLC terminal + function traced to the running program / Ignition OPC docs", size=9)
    s.line(80, ly + 34, 130, ly + 34, color=BLK, w=1.8, dash=True)
    s.text(140, ly + 38, "FIELD VERIFY — physical wiring not documented; meter it (see E-009 open items)", size=9)
    s.rect(84, ly + 48, 32, 13, color=RED, sw=0.9)
    s.text(94, ly + 58, "Wxx", size=8, color=RED, mono=True)
    s.text(140, ly + 58, "wire numbers are PROPOSED (no as-built wire list in the repo)", size=9)

    ny = ly + 90
    notes = [
        "READS (acceptance): +24 VDC starts at PS1 (E-004) → device contact shown → proposed wire # → PLC terminal I-0x →",
        "   function/OPC tag → returns via COM0 → 0V (E-004). Verified vs field-verify marked per conductor.",
        "SAFETY: I-02/I-03 are MONITORED e-stop inputs only — a monitored input is NOT a safety stop. A compliant install must",
        "   hardwire S0 to remove drive power (NFPA 79 / EN 60204-1, stop cat 0/1). De-energize + LOTO before metering.",
        "SOURCES (verified): plc/Prog_init_ConvSimple_v2.1.st · plc/ignition-project/.../MIRA_IOCheck/Inputs/tags.json ·",
        "   plc/ccw/controller/Controller/LogicalValues.csv · plc/GS10_Integration_Guide.md",
    ]
    for i, n in enumerate(notes):
        s.text(70, ny + i * 15, n, size=8.6, color=BLK if i not in (2, 3) else RED if i == 2 else BLK)

    # ---- title block (bottom-right) ----
    tb_w, tb_h = 430, 96
    tx, ty = fx1 - 20 - tb_w, fy1 - 20 - tb_h
    s.rect(tx, ty, tb_w, tb_h, sw=1.6)
    s.line(tx, ty + 46, tx + tb_w, ty + 46, color=BLK, w=0.9)
    s.line(tx + tb_w - 150, ty, tx + tb_w - 150, ty + tb_h, color=BLK, w=0.9)
    s.text(tx + 12, ty + 22, "PLC DIGITAL INPUTS", size=13, weight="bold")
    s.text(tx + 12, ty + 38, f"{meta['project']} / {meta['asset']}", size=10, color=GRY)
    s.text(tx + 12, ty + 66, "MIRA / FactoryLM", size=9)
    s.text(tx + 12, ty + 82, f"Drawn: {meta['drawn_by']}", size=8, color=GRY)
    s.text(tx + tb_w - 142, ty + 20, "SHEET", size=8, color=GRY)
    s.text(tx + tb_w - 142, ty + 38, "E-005", size=16, weight="bold")
    s.text(tx + tb_w - 142, ty + 62, f"REV {meta['revision']}", size=10)
    s.text(tx + tb_w - 142, ty + 80, f"{meta['date']}", size=9, color=GRY)
    s.text(tx + tb_w - 12, ty + 62, "5 of 9", size=10, anchor="end", color=GRY)

    svg = s.dump()
    (SHEETS / "E-005_plc_inputs.svg").write_text(svg, encoding="utf-8")

    import fitz
    doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
    try:
        (SHEETS / "E-005_plc_inputs.pdf").write_bytes(doc.convert_to_pdf())
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pix.save(str(SHEETS / "E-005_plc_inputs.png"))
    finally:
        doc.close()
    print("wrote", SHEETS / "E-005_plc_inputs.pdf")
    _ = sheets  # (sheets.yaml available for multi-sheet driver later)


RENDERERS = {"E-005": render_e005, "E-007": render_e007}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "E-005"
    if which not in RENDERERS:
        raise SystemExit(f"Implemented: {', '.join(RENDERERS)} (got {which})")
    RENDERERS[which]()
