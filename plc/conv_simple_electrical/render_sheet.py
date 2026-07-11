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
RED = "#C0392B"  # reserved for the "FIELD VERIFY" / unverified marker ONLY
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

    def line(
        self, x1, y1, x2, y2, color=BLK, w=1.6, dash=False, cap="butt", wire=None, wire_status=None
    ):
        d = f' stroke-dasharray="{DASH}"' if dash else ""
        attrs = f' data-wire="{wire}" data-status="{wire_status}"' if wire is not None else ""
        self.p.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}"{d}{attrs}/>'
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
        return (
            head
            + f'<rect width="{self.w}" height="{self.h}" fill="{BG}"/>'
            + "\n".join(self.p)
            + "</svg>"
        )


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
    s.line(cx - 12, y, cx + 8, y - 13)  # open diagonal arm
    s.text(cx, y - 20, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def contact_nc(s, xl, xr, y, label, term):
    """Normally-closed contact glyph."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y)
    s.line(cx + 12, y, xr, y)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 10, y - 12)  # arm
    s.line(cx + 6, y - 14, cx + 6, y + 3)  # NC bar
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
    s.line(cx - 2, y - 9, cx - 2, y - 18)  # actuator stem
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
    s.line(cx, y - 9, cx, y - 20)  # plunger
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


def breaker_pole(s, x, y, label, w=40, h=30):
    """Circuit breaker pole glyph: line break with dashed chevron in a dashed box."""
    s.rect(x - w / 2, y - h / 2, w, h, sw=0.9, dash=True)
    s.line(x - w / 2 + 4, y, x - 8, y, w=1.4)
    s.line(x + 8, y, x + w / 2 - 4, y, w=1.4)
    # chevron (break indicator)
    s.line(x - 6, y - 6, x, y, w=1.2)
    s.line(x, y, x + 6, y - 6, w=1.2)
    s.text(x, y - 18, label, size=9, anchor="middle", weight="bold")


def contactor_pole(s, x, y, label, w=40, h=30):
    """Contactor (MC) NO contact pole glyph: similar to breaker but solid."""
    s.rect(x - w / 2, y - h / 2, w, h, sw=0.9)
    s.line(x - w / 2 + 4, y, x - 8, y, w=1.4)
    s.line(x + 8, y, x + w / 2 - 4, y, w=1.4)
    # contact indicator
    s.line(x - 6, y - 6, x, y, w=1.2)
    s.line(x, y, x + 6, y - 6, w=1.2)
    s.text(x, y - 18, label, size=9, anchor="middle", weight="bold")


def coil(s, cx, cy, label, t1, t2):
    """Relay/contactor coil: circle with A1/A2 terminal stubs."""
    r = 14
    s.circle(cx, cy, r, sw=1.2)
    s.text(cx, cy + 2, "⌒", size=16, anchor="middle", color=GRY)  # coil symbol
    s.text(cx, cy - 28, label, size=10, anchor="middle", weight="bold")
    # terminals
    s.line(cx - r - 12, cy, cx - r, cy, w=1.2)
    s.line(cx + r, cy, cx + r + 12, cy, w=1.2)
    s.text(cx - r - 12, cy + 10, t1, size=8.5, anchor="middle", weight="bold", mono=True)
    s.text(cx + r + 12, cy + 10, t2, size=8.5, anchor="middle", weight="bold", mono=True)
    s.circle(cx - r - 12, cy, 2.0, fill=BLK)
    s.circle(cx + r + 12, cy, 2.0, fill=BLK)


def pilot(s, cx, cy, label, term):
    """Pilot light: circle with X cross per IEC 60617; horizontal X1/X2 stubs."""
    r = 12
    s.circle(cx, cy, r, sw=1.2)
    s.line(cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3, w=1.0)  # X
    s.line(cx - r + 3, cy + r - 3, cx + r - 3, cy - r + 3, w=1.0)
    s.text(cx, cy - 24, label, size=10, anchor="middle", weight="bold")
    s.text(cx, cy + 30, term, size=8, anchor="middle", color=GRY, mono=True)
    # left (X1) / right (X2) stubs for horizontal rungs
    s.line(cx - r - 8, cy, cx - r, cy, w=1.2)
    s.line(cx + r, cy, cx + r + 8, cy, w=1.2)
    s.circle(cx - r - 8, cy, 2.0, fill=BLK)
    s.circle(cx + r + 8, cy, 2.0, fill=BLK)
    s.text(cx - r - 8, cy + 14, "X1", size=6.8, anchor="middle", color=GRY, mono=True)
    s.text(cx + r + 8, cy + 14, "X2", size=6.8, anchor="middle", color=GRY, mono=True)


def motor_sym(s, cx, cy):
    """3-phase motor: circle with "M" + "3~"."""
    r = 16
    s.circle(cx, cy, r, sw=1.4)
    s.text(cx, cy + 1, "M", size=12, anchor="middle", weight="bold", color=GRY)
    s.text(cx, cy + 11, "3~", size=7.5, anchor="middle", color=GRY)


GLYPH = {
    "selector": selector,
    "estop_nc": contact_nc,
    "estop_no": contact_no,
    "pb": pushbutton,
    "photoeye": photoeye,
}


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


def draw_table(s, x0, y0, colw, headers, rows, evidence_col=None, rh=22, fs=8.0):
    total = sum(colw)
    # header
    s.rect(x0, y0, total, rh, fill="#EEEEEE", sw=1.0)
    cx = x0
    for w, h in zip(colw, headers):
        s.text(cx + 5, y0 + rh - 7, h, size=fs + 0.3, weight="bold")
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
            s.text(cx + 5, y + rh - 7, cell, size=fs, color=color, mono=mono)
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
        doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(
            str(SHEETS / f"{basename}.png")
        )
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
        s,
        W,
        H,
        "E-007  RS-485 / MODBUS RTU COMMUNICATION",
        f"{m['project']} / {m['asset']}  —  Micro820 (master) ↔ GS10 (node 1)  ·  Modbus RTU only",
    )

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
    s.text(
        tx - 12, (ty["485+"] + ty["485-"]) / 2 + 14, "(drive end)", size=7, anchor="end", color=GRY
    )

    # cable bracket
    s.text(
        (plx + pw + vfx) / 2,
        175,
        "Belden 3105A — shielded twisted pair (485+/485-) + 1 conductor (SGND) + drain",
        size=9,
        anchor="middle",
        color=GRY,
    )

    # readback note
    s.text(
        vfx + vw / 2,
        by + bh + 18,
        "link up ⇒ vfd_comm_ok = TRUE ; read 0x2103 (FC03) for nonzero freq",
        size=8.5,
        anchor="middle",
        color=GRY,
    )

    # ---- connection table ----
    ty0 = 500
    s.text(70, ty0 - 8, "CONNECTION TABLE", size=11, weight="bold")
    colw = [70, 130, 70, 150, 175, 60, 105, 320]
    headers = [
        "Src dev",
        "Src terminal",
        "Dst dev",
        "Dst terminal/pin",
        "Cable / conductor",
        "Wire",
        "Evidence",
        "Notes",
    ]
    rows = []
    for L in e["links"]:
        rows.append(
            [
                L["src_device"],
                L["src_terminal"],
                L["dst_device"],
                L["dst_terminal"],
                f"{L['cable']} · {L['conductor']}",
                L["wire_label"],
                L["evidence"],
                L.get("notes", ""),
            ]
        )
    tbl_bottom = draw_table(s, 70, ty0, colw, headers, rows, evidence_col=6)

    # ---- serial config strip ----
    sc = e["serial_config"]
    y = tbl_bottom + 26
    s.text(70, y, "CCW SERIAL PORT:", size=9, weight="bold")
    s.text(
        190,
        y,
        f"{sc['driver']} · {sc['baud']} · {sc['format']} · Channel {sc['channel']} · Node {sc['node']}",
        size=9,
        mono=True,
    )
    s.text(70, y + 14, sc["note"], size=7.6, color=GRY)

    # ---- correction callout ----
    y += 40
    s.rect(70, y - 12, 1180, 20, color=RED, sw=1.0)
    s.text(
        78,
        y + 2,
        "CORRECTED from May-16 draft:  Channel 0 → 2   ·   SGND pin 1/8 → pin 3   ·   "
        "8N2 → 8N1.  Do not copy the old values.",
        size=8.6,
        color=RED,
    )

    # ---- troubleshooting ----
    y += 34
    s.text(70, y, "TROUBLESHOOTING (this circuit)", size=10, weight="bold")
    for i, t in enumerate(e["troubleshooting"]):
        s.text(78, y + 16 + i * 14, f"• {t}", size=8.4)

    # ---- legend ----
    ly = y + 16 + len(e["troubleshooting"]) * 14 + 16
    s.line(80, ly, 130, ly, color=BLK, w=1.8)
    s.text(
        140,
        ly + 4,
        "VERIFIED (recovered CommsToVFD + Beginner_Verify p48 + Prog_init v2.1)",
        size=8.5,
    )
    s.line(80, ly + 18, 130, ly + 18, color=BLK, w=1.8, dash=True)
    s.text(
        140,
        ly + 22,
        "FIELD VERIFY (exact PLC chassis ground point; cable P/N if not Belden 3105A)",
        size=8.5,
    )

    # ---- sources ----
    sy = ly + 44
    s.text(70, sy, "SOURCES:", size=8.5, weight="bold")
    for i, src in enumerate(e["sources"]):
        s.text(130, sy + i * 12, src, size=7.6, color=GRY)

    title_block(
        s,
        fx1,
        fy1,
        m,
        "E-007",
        "RS-485 / MODBUS RTU",
        "7 of 9",
        lineage="recovers MIRA-WI-001 / Conv_Simple_CommsToVFD §2",
    )
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
            s.text(
                x + ((fx1 - fx0 - 20) / cols) / 2,
                fy0 + 8,
                str(i + 1),
                size=8,
                anchor="middle",
                color=GRY,
            )
            s.text(
                x + ((fx1 - fx0 - 20) / cols) / 2,
                fy1 - 3,
                str(i + 1),
                size=8,
                anchor="middle",
                color=GRY,
            )
    rows = "ABCD"
    for j, ch in enumerate(rows):
        yy = fy0 + 10 + (j + 0.5) * ((fy1 - fy0 - 20) / len(rows))
        s.text(fx0 + 5, yy, ch, size=8, anchor="middle", color=GRY)
        s.text(fx1 - 5, yy, ch, size=8, anchor="middle", color=GRY)

    # ---- header ----
    s.text(70, 78, "E-005  PLC DIGITAL INPUTS", size=22, weight="bold")
    s.text(
        70,
        100,
        f"{meta['project']} / {meta['asset']}  —  Micro820 2080-LC20-20QBB embedded DI (24 VDC)",
        size=12,
        color=GRY,
    )
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
        verified_wire = w and w.get("status") == "verified"
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
        s.text(
            bx + bw - 8,
            y + 2,
            f"healthy: {info['healthy_state']}",
            size=7.5,
            anchor="end",
            color=GRY,
        )

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
    s.text(
        140,
        ly + 20,
        "VERIFIED — PLC terminal + function traced to the running program / Ignition OPC docs",
        size=9,
    )
    s.line(80, ly + 34, 130, ly + 34, color=BLK, w=1.8, dash=True)
    s.text(
        140,
        ly + 38,
        "FIELD VERIFY — physical wiring not documented; meter it (see E-009 open items)",
        size=9,
    )
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
        s.text(
            70, ny + i * 15, n, size=8.6, color=BLK if i not in (2, 3) else RED if i == 2 else BLK
        )

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


def render_e003():
    devices = _load("devices")
    wires = _load("wires")
    meta = devices["meta"]

    e3 = [w for w in wires["wires"] if w.get("sheet") == "E-003"]
    wire_by = {w["proposed_number"]: w for w in e3}

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-003  VFD POWER",
        f"{meta['project']} / {meta['asset']}  —  supply → CB1 → Q1 (MC) → VFD1 (GS10) → M1  ·  every conductor FIELD VERIFY",
    )

    def seg(num, x1, y1, x2, y2, w_=1.8):
        """One orthogonal conductor segment of wire `num` (dashed = field_verify)."""
        s.line(
            x1, y1, x2, y2, color=BLK, w=w_, dash=True, wire=num, wire_status=wire_by[num]["status"]
        )

    xL, xC, xR = 340, 400, 460  # the three power-column conductors

    # ---- SUPPLY node (top) ----
    s.rect(320, 150, 160, 40, sw=1.4, dash=True)
    s.text(400, 168, "SUPPLY", size=12, anchor="middle", weight="bold")
    s.text(400, 183, "voltage/phase FIELD VERIFY", size=7.5, anchor="middle", color=RED)

    # ---- SUPPLY -> CB1 (W300/W301/W302) ----
    for num, x in (("W300", xL), ("W301", xC), ("W302", xR)):
        seg(num, x, 190, x, 236, w_=2.0)
        wire_tag(s, x, 216, num, verified=False)

    # ---- CB1: one breaker pole per conductor ----
    for lbl, x in (("L1", xL), ("L2", xC), ("L3 (3φ)", xR)):
        breaker_pole(s, x, 250, lbl, w=35, h=28)
    s.text(310, 242, "CB1", size=10, anchor="end", weight="bold")
    s.text(
        310,
        256,
        "REQUIRED per GS10_UM L1758-1759 · type/rating: OI-15",
        size=7.2,
        anchor="end",
        color=GRY,
    )

    # ---- CB1 -> Q1 (W303/W304/W305) ----
    for num, x in (("W303", xL), ("W304", xC), ("W305", xR)):
        seg(num, x, 264, x, 346, w_=2.0)
        wire_tag(s, x, 310, num, verified=False)

    # ---- Q1: three contactor poles ----
    for lbl, x in (("L1", xL), ("L2", xC), ("L3 (3φ)", xR)):
        contactor_pole(s, x, 360, lbl, w=35, h=28)
    s.text(310, 338, "Q1 — SAFETY POWER CONTACTOR (MC)", size=9, anchor="end", weight="bold")
    q1_notes = [
        "coil ← O-02 (E-006)",
        "R-C absorber both ends recommended",
        "NOT for routine run/stop",
    ]
    for i, note in enumerate(q1_notes):
        s.text(310, 352 + i * 12, note, size=7.2, anchor="end", color=GRY)

    # ---- Q1 -> VFD1 (W306/W307/W308) ----
    for num, x in (("W306", xL), ("W307", xC), ("W308", xR)):
        seg(num, x, 374, x, 430)
        wire_tag(s, x, 406, num, verified=False)

    # ---- VFD1 block ----
    vx, vy, vw, vh = 280, 430, 240, 220
    s.rect(vx, vy, vw, vh, sw=1.6)
    for lbl, x in (("R/L1", xL), ("S/L2", xC), ("T/L3", xR)):
        s.circle(x, vy, 2.8, fill=BLK)
        s.text(x, vy + 16, lbl, size=8, anchor="middle", weight="bold", mono=True)
    s.text(400, 478, "VFD1", size=14, anchor="middle", weight="bold")
    s.text(400, 494, "GS10 DURApulse", size=8.5, anchor="middle", color=GRY)

    # side stubs: +1/+2 (factory jumper, small solid bracket), B1/B2 OPEN, DC+/DC- OPEN
    s.line(vx + vw, 514, vx + vw + 24, 514, w=1.2)
    s.line(vx + vw, 526, vx + vw + 24, 526, w=1.2)
    s.line(vx + vw + 24, 514, vx + vw + 30, 514, w=1.8)
    s.line(vx + vw + 30, 514, vx + vw + 30, 526, w=1.8)
    s.line(vx + vw + 30, 526, vx + vw + 24, 526, w=1.8)
    s.text(vx + vw + 36, 523, "+1/+2 — factory jumper", size=7.5, anchor="start")
    s.line(vx + vw, 555, vx + vw + 28, 555, w=1.2)
    s.text(vx + vw + 36, 558, "B1/B2 — OPEN", size=7.5, anchor="start")
    s.line(vx + vw, 590, vx + vw + 28, 590, w=1.2)
    s.text(vx + vw + 36, 588, "DC+/DC- — OPEN", size=7.5, anchor="start")
    s.text(vx + vw + 36, 599, "(absent on 120VAC models)", size=6.8, anchor="start", color=GRY)

    # output terminals (bottom edge) + GND lug
    for lbl, x in (("U/T1", xL), ("V/T2", xC), ("W/T3", xR)):
        s.circle(x, vy + vh, 2.8, fill=BLK)
        s.text(x, vy + vh - 8, lbl, size=8, anchor="middle", weight="bold", mono=True)
    s.circle(510, vy + vh, 2.8, fill=BLK)
    s.text(510, vy + vh - 8, "GND", size=7.5, anchor="middle", mono=True)

    # ---- VFD1 -> M1 (W310/W311/W312); motor terminal row at y=790 ----
    seg("W310", xL, 650, xL, 790, w_=1.4)
    wire_tag(s, xL, 722, "W310", verified=False)
    seg("W311", xC, 650, xC, 714, w_=1.4)  # interrupted by the motor glyph
    seg("W311", xC, 746, xC, 790, w_=1.4)
    wire_tag(s, xC, 684, "W311", verified=False)
    seg("W312", xR, 650, xR, 790, w_=1.4)
    wire_tag(s, xR, 722, "W312", verified=False)

    # ---- Motor M1 (circle ~730, terminal dot row ~790) ----
    motor_sym(s, 400, 730)
    s.text(372, 726, "M1", size=10, anchor="end", weight="bold")
    for lbl, x in (("T1", xL), ("T2", xC), ("T3", xR), ("PE", 520)):
        s.circle(x, 790, 2.4, fill=BLK)
        s.text(x, 803, lbl, size=8, anchor="middle", mono=True)
    s.text(540, 764, "swap any two leads to reverse — L1773-1776", size=6.8, color=GRY)

    # ---- PE bus (vertical at x=700) ----
    s.text(700, 190, "to source PE (E-002)", size=7.5, anchor="middle", color=GRY)
    s.line(696, 206, 700, 198, w=1.2)
    s.line(704, 206, 700, 198, w=1.2)
    seg("W317", 700, 198, 700, 690, w_=2.2)
    wire_tag(s, 700, 450, "W317", verified=False)
    s.line(700, 690, 700, 795, color=BLK, w=2.2, dash=True)  # bus collector (node)
    s.circle(700, 690, 2.2, fill=BLK)
    s.circle(700, 790, 2.2, fill=BLK)
    earth_symbol(s, 700, 795)
    s.text(722, 810, "PE", size=10, anchor="start", weight="bold")

    # W315: VFD1.GND drops down, then runs horizontally to the bus
    seg("W315", 510, 650, 510, 690, w_=1.4)
    seg("W315", 510, 690, 700, 690, w_=1.4)
    wire_tag(s, 605, 690, "W315", verified=False)

    # W316: M1.PE runs horizontally to the bus
    seg("W316", 520, 790, 700, 790, w_=1.4)
    wire_tag(s, 610, 790, "W316", verified=False)

    # ---- connection table (right half) ----
    s.text(830, 172, "CONNECTION TABLE", size=11, weight="bold")
    headers = ["Wire", "From", "To", "Signal", "Type", "Status", "Notes"]

    def short(endpoint):
        # table-only truncation; wires.yaml keeps the full node name
        return "SUPPLY (E-002)" if endpoint == "SUPPLY (source — see E-002)" else endpoint

    rows = []
    for w in e3:
        note = w.get("note", "")
        if note.startswith("route power"):
            note = "power ⊥ control — L1787"  # table-only abbreviation of the yaml note
        rows.append(
            [
                w["proposed_number"],
                short(w["from"]),
                short(w["to"]),
                w["signal"],
                w["type"],
                w["status"],
                note,
            ]
        )
    draw_table(s, 830, 180, [48, 165, 120, 150, 78, 78, 90], headers, rows, evidence_col=5, fs=7.2)

    # ---- red caveat box (bottom-left) ----
    s.rect(70, 820, 612, 34, color=RED, sw=1.0, fill="#FFF5F5")
    s.text(
        78,
        834,
        "Bench supply voltage & phase count, GS10 exact model/frame, breaker rating, wire gauge: NOT DOCUMENTED —",
        size=7.2,
        color=RED,
    )
    s.text(
        78,
        847,
        "every conductor FIELD VERIFY. P00.01 = 1.60 A (2026-05-20 export) is the only sizing clue. If 1φ model, input = R/L1, S/L2 only (GS10_UM L1971).",
        size=7.2,
        color=RED,
    )

    # ---- safety notes ----
    s.text(70, 872, "SAFETY NOTES", size=10, weight="bold")
    safety_notes = [
        (
            "• Never start/stop via input power (L1811-1813); the MC (Q1) is emergency/safety switching only (L1754-1757).",
            BLK,
        ),
        ("• LOTO + wait ≥5 min for DC-bus discharge before touching (WI p.2 §2).", BLK),
        (
            "• Monitored e-stop is NOT a safety stop — hardwire S0 to remove drive power per NFPA 79 / EN 60204-1.",
            RED,
        ),
        (
            "• PE resistance ≤0.1Ω (L1760-61); shield/conduit bonded both ends (L1792-95); RFI jumper in/out FIELD VERIFY (L1693-1718, OI-17).",
            BLK,
        ),
    ]
    for i, (note, color) in enumerate(safety_notes):
        s.text(78, 886 + i * 12, note, size=7.5, color=color)

    # ---- legend (solid / dashed) ----
    s.line(80, 942, 126, 942, color=BLK, w=1.8)
    s.text(
        134,
        946,
        "VERIFIED — solid (no E-003 conductor qualifies yet; terminal names verified via table sources)",
        size=8,
    )
    s.line(80, 956, 126, 956, color=BLK, w=1.8, dash=True)
    s.text(
        134,
        960,
        "FIELD VERIFY — dashed + red wire flag (all E-003 conductors; wire numbers PROPOSED — OI-19)",
        size=8,
    )

    # ---- sources ----
    s.text(70, 978, "SOURCES:", size=8.5, weight="bold")
    s.text(
        130,
        978,
        "plc/GS10_UM.txt (terminals L1971-1986; topology L1750-1813) · plc/GS10_Integration_Guide.md (Q1 phase-5 test)",
        size=7,
        color=GRY,
    )
    s.text(
        130,
        990,
        "plc/Prog_init_ConvSimple_v2.1.st (vfd_run_permit) · plc/MIRA_PLC_WorkInstruction_v3.pdf (LOTO §2)",
        size=7,
        color=GRY,
    )

    # ---- title block ----
    title_block(
        s,
        fx1,
        fy1,
        meta,
        "E-003",
        "VFD POWER",
        "3 of 9",
        lineage="terminals per GS10 UM 1st Ed Rev B;",
    )
    s.text(
        1132,
        986,
        "MC placement per manual recommendation; as-built UNVERIFIED",
        size=6.8,
        color=GRY,
    )

    _emit(s, "E-003_vfd_power")


def render_e006():
    devices = _load("devices")
    terms = _load("terminals")
    wires = _load("wires")
    meta = devices["meta"]

    e6 = [w for w in wires["wires"] if w.get("sheet") == "E-006"]
    wire_by = {w["proposed_number"]: w for w in e6}

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-006  PLC OUTPUTS",
        f"{meta['project']} / {meta['asset']}  —  O-00..O-06 · pilots, contactor coil, button lamp · GS10 control = Modbus (E-007), NO GS10 DI wiring",
    )

    def seg(num, x1, y1, x2, y2, w_=1.6):
        """One orthogonal conductor segment of wire `num` (dashed = field_verify)."""
        s.line(
            x1, y1, x2, y2, color=BLK, w=w_, dash=True, wire=num, wire_status=wire_by[num]["status"]
        )

    # ---- PLC1 output block (left, x 150-430) ----
    bx0, bx1 = 150, 430
    s.rect(bx0, 170, bx1 - bx0, 580, sw=1.8)
    s.text((bx0 + bx1) / 2, 192, "PLC1", size=14, anchor="middle", weight="bold")
    s.text((bx0 + bx1) / 2, 208, "Micro820 2080-LC20-20QBB", size=8.5, anchor="middle", color=GRY)
    s.text((bx0 + bx1) / 2, 222, "embedded digital outputs", size=8, anchor="middle", color=GRY)

    out_y = {
        "O-00": 250,
        "O-01": 320,
        "O-02": 390,
        "O-03": 460,
        "O-04": 505,
        "O-05": 545,
        "O-06": 585,
    }
    com_y = {"+CM0": 630, "-CM0": 660, "+CM1": 690, "-CM1": 720}
    outs = {t["id"]: t for t in terms["PLC1"]["outputs"]}
    coms = {t["id"]: t for t in terms["PLC1"]["output_commons"]}

    # wired output terminals (text inside the block, wires leave the right edge)
    for oid in ("O-00", "O-01", "O-02", "O-03"):
        y = out_y[oid]
        s.circle(bx1, y, 3.2, fill=BLK)
        s.text(bx1 - 8, y - 4, oid, size=10, anchor="end", weight="bold", mono=True)
        s.text(bx1 - 8, y + 8, outs[oid]["opc"], size=6.8, anchor="end", color=GRY, mono=True)
        s.text(bx1 - 8, y + 19, outs[oid]["function"], size=7.5, anchor="end")
    # spares: NO wires
    for oid in ("O-04", "O-05", "O-06"):
        y = out_y[oid]
        s.circle(bx1, y, 3.0, fill="#FFFFFF")
        s.text(bx1 - 8, y + 3, oid, size=9, anchor="end", color=GRY, mono=True)
        s.text(
            bx1 - 8,
            y + 14,
            "spare (confirm no field wire — OI-12)",
            size=7,
            anchor="end",
            color=RED,
        )
    # output commons on the block edge
    for cid, y in com_y.items():
        s.circle(bx1, y, 3.2, fill=BLK)
        s.text(bx1 - 8, y - 3, cid, size=9.5, anchor="end", weight="bold", mono=True)
        fn = coms[cid]["function"]
        if cid in ("+CM1", "-CM1"):
            fn += " · spare bank — unused"
        s.text(bx1 - 8, y + 9, fn, size=6.8, anchor="end", color=GRY)

    # ---- W600: PS1 +24V feed into +CM0 (dashed vertical + horizontal from top) ----
    s.text(470, 178, "PS1 +24V (E-004)", size=8.5, anchor="middle", weight="bold")
    seg("W600", 470, 186, 470, 630)
    seg("W600", 470, 630, 430, 630)
    wire_tag(s, 470, 432, "W600", verified=False)

    # ---- loads (right column at x~950, each at its rung's y) ----
    lx = 950
    pilot(s, lx, out_y["O-00"], "PL1 GREEN", "RUN LIGHT")
    pilot(s, lx, out_y["O-01"], "PL2 RED", "FAULT/E-STOP")
    coil(s, lx, out_y["O-02"], "Q1 COIL", "A1", "A2")
    # cross-ref sits under the coil (above collides with PL2's sub-label)
    s.text(lx, 417, "poles on E-003", size=7, anchor="middle", color=GRY)
    pilot(s, lx, out_y["O-03"], "S2 LAMP", "RUN BTN")

    # ---- output rungs W601..W604 (one straight horizontal each, into the left stub) ----
    seg("W601", bx1, out_y["O-00"], 930, out_y["O-00"], w_=1.4)
    wire_tag(s, 680, out_y["O-00"], "W601", verified=False)
    seg("W602", bx1, out_y["O-01"], 930, out_y["O-01"], w_=1.4)
    wire_tag(s, 680, out_y["O-01"], "W602", verified=False)
    seg("W603", bx1, out_y["O-02"], 924, out_y["O-02"], w_=1.4)
    wire_tag(s, 680, out_y["O-02"], "W603", verified=False)
    seg("W604", bx1, out_y["O-03"], 930, out_y["O-03"], w_=1.4)
    wire_tag(s, 680, out_y["O-03"], "W604", verified=False)

    # ---- return rail (dashed vertical at x=1150) + short return horizontals W605..W608 ----
    rail_x = 1150
    s.line(rail_x, 250, rail_x, 880, color=BLK, w=2.0, dash=True)
    s.p.append(
        '<text x="1164" y="565" font-size="8" '
        "font-family=\"Consolas, 'Courier New', monospace\" "
        f'fill="{GRY}" text-anchor="middle" '
        'transform="rotate(-90 1164 565)">output return rail (E-006)</text>'
    )
    seg("W605", 970, out_y["O-00"], rail_x, out_y["O-00"], w_=1.2)
    wire_tag(s, 1062, out_y["O-00"], "W605", verified=False)
    seg("W606", 970, out_y["O-01"], rail_x, out_y["O-01"], w_=1.2)
    wire_tag(s, 1062, out_y["O-01"], "W606", verified=False)
    seg("W607", 976, out_y["O-02"], rail_x, out_y["O-02"], w_=1.2)
    wire_tag(s, 1062, out_y["O-02"], "W607", verified=False)
    seg("W608", 970, out_y["O-03"], rail_x, out_y["O-03"], w_=1.2)
    wire_tag(s, 1062, out_y["O-03"], "W608", verified=False)
    for y in (out_y["O-00"], out_y["O-01"], out_y["O-02"], out_y["O-03"]):
        s.circle(rail_x, y, 2.2, fill=BLK)

    # ---- W609: rail bottom -> -CM0 -> off to PS1.0V (all orthogonal; clears the table) ----
    seg("W609", rail_x, 880, 1000, 880, w_=1.4)
    seg("W609", 1000, 880, 1000, 660, w_=1.4)
    seg("W609", 1000, 660, bx1, 660, w_=1.4)
    wire_tag(s, 715, 660, "W609", verified=False)
    s.text(446, 676, "→ PS1.0V (E-004)", size=7, anchor="start", color=GRY)

    # ---- notes column (right, x 1230-1545) ----
    nx = 1230
    s.rect(nx, 200, 315, 92, color=RED, sw=1.0, fill="#FFF5F5")
    fb_lines = [
        "Hardwired fallback documented in MIRA-WI-001 v3 §3",
        "Fig 1 (DO_03..DO_07 → GS10 DI1..DI5 + DCM) — NOT",
        "ACTIVE and NOT drawn: P02.0x at factory default per",
        "the 2026-05-20 parameter export; DO_07 does not exist",
        "on the 2080-LC20-20QBB (O-00..O-06); DO_03 collides",
        "with PBRunLED in the live I/O map. Bench presence of",
        "any such wiring = FIELD VERIFY (OI-18).",
    ]
    for i, ln in enumerate(fb_lines):
        s.text(nx + 8, 215 + i * 11, ln, size=7.2, color=RED)

    s.text(nx, 314, "MODBUS CROSS-REF (run/dir/freq):", size=8.5, weight="bold")
    mb_lines = [
        "Run/dir/freq commands reach VFD1 over RS-485",
        "(E-007): 0x2000 cmd (STOP=1, FWD+RUN=18,",
        "REV+RUN=34), 0x2001 freq. P00.20=1, P00.21=2",
        "(RS-485) verified by 2026-05-20 parameter export.",
    ]
    for i, ln in enumerate(mb_lines):
        s.text(nx, 327 + i * 11, ln, size=7.2, color=GRY)

    s.text(nx, 384, "SAFETY NOTE:", size=8.5, weight="bold")
    s.text(nx, 397, "Monitored outputs are NOT a safety function.", size=7.2)
    s.text(nx, 408, "E-stop must remove power per NFPA 79.", size=7.2)
    s.text(nx, 419, "Q1 drop path is the power-removal; verify it works.", size=7.2, color=RED)

    s.line(nx, 443, nx + 46, 443, color=BLK, w=1.8, dash=True)
    s.text(nx + 54, 440, "FIELD VERIFY — dashed (no as-built;", size=7.2)
    s.text(nx + 54, 451, "O-00/O-01/O-03 from CCW v4.0; O-02 corroborated)", size=7.2)

    s.text(nx, 478, "SOURCES:", size=8.5, weight="bold")
    sources = [
        "CCW_VARIABLES_v4.0.txt",
        "Prog_init_ConvSimple_v2.1.st",
        "MIRA_PLC_WorkInstruction_v3.pdf",
        "GS10_actual_parameters_5.20.26.xlsx",
        "GS10_UM.txt",
    ]
    for i, src in enumerate(sources):
        s.text(nx + 8, 491 + i * 11, src, size=7, color=GRY)

    # ---- connection table (bottom-left) ----
    s.text(70, 756, "CONNECTION TABLE", size=9, weight="bold")
    headers = ["Wire", "From", "To", "Signal", "Type", "Status", "Notes"]
    rows = [
        [
            w["proposed_number"],
            w["from"],
            w["to"],
            w["signal"],
            w["type"],
            w["status"],
            w.get("note", ""),
        ]
        for w in e6
    ]
    draw_table(
        s, 70, 760, [70, 130, 130, 215, 110, 80, 120], headers, rows, evidence_col=5, rh=18, fs=7.2
    )

    # ---- title block ----
    title_block(
        s,
        fx1,
        fy1,
        meta,
        "E-006",
        "PLC OUTPUTS",
        "6 of 9",
        lineage="output map CCW v4.0 + live Prog_init; O-02 do-not-reuse",
    )

    _emit(s, "E-006_plc_outputs")


def render_set():
    """Merge drafted sheets into a single PDF."""
    sheets = _load("sheets")
    import fitz

    # Collect drafted sheets in order
    drafted = [sh for sh in sheets["sheets"] if sh.get("status") == "drafted"]

    basenames = {
        "E-003": "E-003_vfd_power",
        "E-005": "E-005_plc_inputs",
        "E-006": "E-006_plc_outputs",
        "E-007": "E-007_rs485_modbus",
    }

    # Ensure all sheets exist
    pdfs = []
    for sheet in drafted:
        sheet_id = sheet["id"]
        basename = basenames.get(sheet_id)
        if basename:
            pdf_path = SHEETS / f"{basename}.pdf"
            if pdf_path.exists():
                pdfs.append(pdf_path)

    if not pdfs:
        print("No drafted sheets found or PDFs missing")
        return

    # Merge into CV-101_print_set.pdf
    doc = fitz.open(pdfs[0])
    for pdf_path in pdfs[1:]:
        src = fitz.open(pdf_path)
        doc.insert_pdf(src)
        src.close()

    out_pdf = SHEETS / "CV-101_print_set.pdf"
    doc.save(out_pdf)
    doc.close()
    print(f"wrote {out_pdf}")


RENDERERS = {
    "E-003": render_e003,
    "E-005": render_e005,
    "E-006": render_e006,
    "E-007": render_e007,
    "SET": render_set,
}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "E-005"
    if which not in RENDERERS:
        raise SystemExit(f"Implemented: {', '.join(RENDERERS)} (got {which})")
    RENDERERS[which]()
