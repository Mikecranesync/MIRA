"""Render electrical print SHEETS from the structured model (YAML source of truth).

Implements E-001 (cover/legend/schedule), E-003 (VFD power), E-005 (PLC inputs),
E-006 (PLC outputs), E-007 (RS-485/Modbus) and SET (merged print set).

Contract (V3):
- The model in ./model/*.yaml is authoritative. The renderer LAYS OUT model
  content; it never originates engineering content (sheet text lives in
  sheets.yaml `annotations:` blocks, wiring in wires.yaml / e007_rs485.yaml).
- A conductor renders SOLID only if its wire's status == 'verified'; otherwise
  it renders as a DASHED group of real line segments (PyMuPDF drops
  stroke-dasharray, so dashes are constructed, never styled).
- Every conductor segment carries data-wire/data-status for the validator.

Usage:  python render_sheet.py E-001|E-003|E-005|E-006|E-007|SET
Outputs: sheets/<basename>.svg / .pdf  (+ a QA .png)
"""

from __future__ import annotations

import math
import pathlib
import sys
import textwrap

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


def _load(name):
    return yaml.safe_load((MODEL / f"{name}.yaml").read_text(encoding="utf-8"))


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def humanize_snake_case(s):
    """Device-type display text: trailing _no/_nc → " (NO)"/" (NC)"; other underscores → spaces."""
    if not s:
        return s
    if s.endswith("_no"):
        return s[:-3].replace("_", " ") + " (NO)"
    if s.endswith("_nc"):
        return s[:-3].replace("_", " ") + " (NC)"
    return s.replace("_", " ")


def _wrap(text, width_px, fs, mono=False):
    """Wrap text to a pixel width for the given font size (approx metrics).

    per_char matches validate_model.py's bbox estimator (0.55×fs non-mono), so a
    line wrapped to width_px is guaranteed to fit a width_px box under check L.
    """
    per_char = fs * (0.60 if mono else 0.55)
    return textwrap.wrap(str(text), max(10, int(width_px / per_char))) or [""]


class SVG:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = []

    def line(
        self, x1, y1, x2, y2, color=BLK, w=1.6, dash=False, cap="butt", wire=None, wire_status=None
    ):
        attrs = f' data-wire="{wire}" data-status="{wire_status}"' if wire is not None else ""
        if not dash:
            self.p.append(
                f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                f'stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}"{attrs}/>'
            )
            return
        # Dashed = REAL segments in a group (PyMuPDF drops stroke-dasharray).
        # Short runs compress the period so every dashed group has >=3 segments.
        length = math.hypot(x2 - x1, y2 - y1)
        if length <= 0:
            return
        on, off = 7.0, 4.0
        if length < 3 * on + 2 * off:
            on, off = length * 7.0 / 29.0, length * 4.0 / 29.0
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        segs = []
        pos = 0.0
        while pos < length - 0.01:
            end = min(pos + on, length)
            segs.append(
                f'<line x1="{x1 + ux * pos:.2f}" y1="{y1 + uy * pos:.2f}" '
                f'x2="{x1 + ux * end:.2f}" y2="{y1 + uy * end:.2f}" '
                f'stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}"/>'
            )
            pos = end + off
        self.p.append(f'<g data-dashed="true"{attrs}>' + "".join(segs) + "</g>")

    def rect(self, x, y, w, h, color=BLK, sw=1.4, fill="none", data_flag=None):
        d = f' data-flag="{data_flag}"' if data_flag is not None else ""
        self.p.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'fill="{fill}" stroke="{color}" stroke-width="{sw}"{d}/>'
        )

    def circle(self, cx, cy, r, color=BLK, sw=1.4, fill="none"):
        self.p.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" '
            f'stroke="{color}" stroke-width="{sw}"/>'
        )

    def path(self, d, color=BLK, sw=1.4):
        self.p.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}"/>')

    def text(
        self,
        x,
        y,
        s,
        size=10,
        anchor="start",
        color=BLK,
        weight="normal",
        mono=False,
        cls=None,
        data_flag=None,
    ):
        fam = "Consolas, 'Courier New', monospace" if mono else "Arial, Helvetica, sans-serif"
        c = f' class="{cls}"' if cls else ""
        d = f' data-flag="{data_flag}"' if data_flag is not None else ""
        self.p.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-family="{fam}" '
            f'text-anchor="{anchor}" font-weight="{weight}" fill="{color}"{c}{d}>{esc(s)}</text>'
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
def wire_tag(s, x, y, num, verified, orient="h"):
    """A small opaque wire-number flag on a conductor.

    orient="h": box sits just above the (horizontal) run at (x, y).
    orient="v": box offset 26px LEFT of the (vertical) run + a leader tick.
    orient="vr": box offset 26px RIGHT of the (vertical) run + a leader tick.
    """
    color = BLK if verified else RED
    if orient == "v":
        cxx = x - 26
        s.line(x - 10, y, x, y, color=color, w=0.8)
        s.rect(cxx - 16, y - 7, 32, 13, color=color, sw=0.9, fill=BG, data_flag="1")
        s.text(cxx, y + 3, num, size=8.5, anchor="middle", color=color, mono=True, data_flag="1")
    elif orient == "vr":
        cxx = x + 26
        s.line(x, y, x + 10, y, color=color, w=0.8)
        s.rect(cxx - 16, y - 7, 32, 13, color=color, sw=0.9, fill=BG, data_flag="1")
        s.text(cxx, y + 3, num, size=8.5, anchor="middle", color=color, mono=True, data_flag="1")
    else:
        s.rect(x - 16, y - 20, 32, 13, color=color, sw=0.9, fill=BG, data_flag="1")
        s.text(x, y - 10, num, size=8.5, anchor="middle", color=color, mono=True, data_flag="1")


def contact_no(s, xl, xr, y, label, term, dashed=False):
    """Normally-open contact glyph between xl and xr on line y."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y, dash=dashed)
    s.line(cx + 12, y, xr, y, dash=dashed)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)  # open diagonal arm (device shape: solid)
    s.text(cx, y - 20, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def contact_nc(s, xl, xr, y, label, term, dashed=False):
    """Normally-closed contact glyph."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y, dash=dashed)
    s.line(cx + 12, y, xr, y, dash=dashed)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 10, y - 12)  # arm
    s.line(cx + 6, y - 14, cx + 6, y + 3)  # NC bar
    s.text(cx, y - 20, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def selector(s, xl, xr, y, label, term, dashed=False):
    """Selector-switch contact (contact + small selector actuator tick)."""
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y, dash=dashed)
    s.line(cx + 12, y, xr, y, dash=dashed)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)
    s.line(cx - 2, y - 9, cx - 2, y - 18)  # actuator stem
    s.text(cx - 2, y - 22, "∓", size=9, anchor="middle", color=GRY)
    s.text(cx, y - 34, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def pushbutton(s, xl, xr, y, label, term, dashed=False):
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 12, y, dash=dashed)
    s.line(cx + 12, y, xr, y, dash=dashed)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.line(cx - 12, y, cx + 8, y - 13)
    s.line(cx, y - 9, cx, y - 20)  # plunger
    s.line(cx - 6, y - 20, cx + 6, y - 20)
    s.text(cx, y - 26, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 16, term, size=8, anchor="middle", color=GRY, mono=True)


def photoeye(s, xl, xr, y, label, term, dashed=False):
    cx = (xl + xr) / 2
    s.line(xl, y, cx - 20, y, dash=dashed)
    s.line(cx + 20, y, xr, y, dash=dashed)
    s.circle(xl, y, 2.2, fill=BLK)
    s.circle(xr, y, 2.2, fill=BLK)
    s.rect(cx - 20, y - 12, 40, 24)
    s.text(cx, y + 4, "▷→", size=10, anchor="middle", color=GRY)  # emit arrow
    s.text(cx, y - 18, label, size=9.5, anchor="middle", weight="bold")
    s.text(cx, y + 22, term, size=8, anchor="middle", color=GRY, mono=True)


def _pole_label(s, x, y, label, side):
    """Pole phase label at mid-height, beside the glyph: clear of the conductor
    centerline, the wire-tag flags above/below, AND the left neighbor's contact
    arm (which juts +10px right — the rightmost pole labels on its right)."""
    if side == "right":
        s.text(x + 24, y + 2, label, size=8, anchor="start", weight="bold")
    else:
        s.text(x - 24, y + 2, label, size=8, anchor="end", weight="bold")


def breaker_pole(s, x, y, label, side="left"):
    """IEC-style circuit-breaker pole on a VERTICAL run: conductor break with a
    quarter-arc operating mechanism + small X at the fixed contact."""
    s.circle(x, y - 14, 2.2, fill=BLK)
    s.circle(x, y + 14, 2.2, fill=BLK)
    s.line(x, y - 14, x, y - 8)  # top stub (device shape: solid)
    s.line(x, y + 14, x, y + 6)  # bottom stub
    # small X at the top (fixed) contact — breaker marker
    s.line(x - 4, y - 8, x + 4, y - 1)
    s.line(x - 4, y - 1, x + 4, y - 8)
    # quarter-arc mechanism from the bottom contact
    s.path(f"M {x:.1f},{y + 6:.1f} A 14 14 0 0 0 {x - 12:.1f},{y - 6:.1f}", sw=1.2)
    _pole_label(s, x, y, label, side)


def coil(s, cx, cy, label, t1, t2, dashed=False):
    """Relay/contactor coil: circle with terminal stubs left/right."""
    r = 14
    s.circle(cx, cy, r, sw=1.2)
    s.text(cx, cy + 2, "⌒", size=16, anchor="middle", color=GRY)  # coil symbol
    s.text(cx, cy - 28, label, size=10, anchor="middle", weight="bold")
    s.line(cx - r - 12, cy, cx - r, cy, w=1.2, dash=dashed)
    s.line(cx + r, cy, cx + r + 12, cy, w=1.2, dash=dashed)
    s.text(cx - r - 12, cy + 10, t1, size=8.5, anchor="middle", weight="bold", mono=True)
    s.text(cx + r + 12, cy + 10, t2, size=8.5, anchor="middle", weight="bold", mono=True)
    s.circle(cx - r - 12, cy, 2.0, fill=BLK)
    s.circle(cx + r + 12, cy, 2.0, fill=BLK)


def pilot(s, cx, cy, label, term, dashed=False):
    """Pilot light: circle with X cross per IEC 60617; horizontal X1/X2 stubs."""
    r = 12
    s.circle(cx, cy, r, sw=1.2)
    s.line(cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3, w=1.0)  # X (device shape)
    s.line(cx - r + 3, cy + r - 3, cx + r - 3, cy - r + 3, w=1.0)
    s.text(cx, cy - 24, label, size=10, anchor="middle", weight="bold")
    s.text(cx, cy + 30, term, size=8, anchor="middle", color=GRY, mono=True)
    s.line(cx - r - 8, cy, cx - r, cy, w=1.2, dash=dashed)
    s.line(cx + r, cy, cx + r + 8, cy, w=1.2, dash=dashed)
    s.circle(cx - r - 8, cy, 2.0, fill=BLK)
    s.circle(cx + r + 8, cy, 2.0, fill=BLK)
    s.text(cx - r - 8, cy + 14, "X1", size=6.8, anchor="middle", color=GRY, mono=True)
    s.text(cx + r + 8, cy + 14, "X2", size=6.8, anchor="middle", color=GRY, mono=True)


def motor_sym(s, cx, cy, phase_color=GRY):
    """3-phase motor: circle with "M" + "3~" (phase marker takes the status color)."""
    r = 16
    s.circle(cx, cy, r, sw=1.4)
    s.text(cx, cy + 1, "M", size=12, anchor="middle", weight="bold", color=GRY)
    s.text(cx, cy + 13, "3~", size=7.5, anchor="middle", color=phase_color)


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
            # fs 7, centered in the 10px margin band (an fs-8 bbox crosses the inner frame edge)
            s.text(x + step / 2, fy0 + 6.4, str(i + 1), size=7, anchor="middle", color=GRY)
            s.text(x + step / 2, fy1 - 3.6, str(i + 1), size=7, anchor="middle", color=GRY)
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
    s.text(tx + 12, ty + 64, "Drawn: MIRA / FactoryLM", size=9)
    if lineage:  # the Drawn line above is always present; never duplicate it as a fallback
        # wrap inside the left cell so long lineage never crosses into the REV/date column
        for k, ln in enumerate(_wrap(lineage, 240, 7.5)):
            s.text(tx + 12, ty + 78 + k * 9, ln, size=7.5, color=GRY)
    s.text(tx + tb_w - 142, ty + 20, "SHEET", size=8, color=GRY)
    s.text(tx + tb_w - 142, ty + 38, sheet_id, size=16, weight="bold")
    s.text(tx + tb_w - 142, ty + 62, f"REV {meta['revision']}", size=10)
    s.text(tx + tb_w - 142, ty + 80, f"{meta['date']}", size=9, color=GRY)
    s.text(tx + tb_w - 12, ty + 62, sheet_no, size=10, anchor="end", color=GRY)


def draw_table(
    s,
    x0,
    y0,
    colw,
    headers,
    rows,
    evidence_col=None,
    rh=22,
    fs=8.0,
    mono_cols=(1, 3, 5),
    first_col_class=None,
):
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
            mono = i in mono_cols
            if evidence_col is not None and i == evidence_col:
                color = BLK if str(cell).startswith("verified") else RED
            cls = first_col_class if (i == 0 and first_col_class) else None
            s.text(cx + 5, y + rh - 7, cell, size=fs, color=color, mono=mono, cls=cls)
            cx += w
        y += rh
    # column separators
    cx = x0
    for w in colw[:-1]:
        cx += w
        s.line(cx, y0, cx, y, color=GRY, w=0.6)
    return y


def draw_annotations(s, x, y, w, ann, fs=7.5):
    """Model-sourced annotation blocks, in order: caveat (red box), safety, notes, sources.

    The renderer lays out; sheets.yaml annotations hold the engineering text.
    Returns the y after the last block.
    """
    ann = ann or {}
    lh = fs + 3.5
    caveats = ann.get("caveat") or []
    if caveats:
        lines = []
        for c in caveats:
            lines.extend(_wrap(c, w - 16, fs))
        box_h = len(lines) * lh + 10
        s.rect(x, y, w, box_h, color=RED, sw=1.0, fill="#FFF5F5")
        ty = y + lh + 1
        for ln in lines:
            s.text(x + 8, ty, ln, size=fs, color=RED)
            ty += lh
        y += box_h + 10
    safety = ann.get("safety") or []
    if safety:
        s.text(x, y + 4, "SAFETY", size=fs + 2, weight="bold")
        y += lh + 4
        for item in safety:
            color = RED if ("NOT" in item or "never" in item.lower()) else BLK
            for ln in _wrap("• " + item, w, fs):
                s.text(x + 6, y, ln, size=fs, color=color)
                y += lh
        y += 6
    notes = ann.get("notes") or []
    if notes:
        s.text(x, y + 4, "NOTES", size=fs + 2, weight="bold")
        y += lh + 4
        for item in notes:
            for ln in _wrap("• " + item, w, fs):
                s.text(x + 6, y, ln, size=fs)
                y += lh
        y += 6
    sources = ann.get("sources") or []
    if sources:
        s.text(x, y + 4, "SOURCES:", size=fs + 1, weight="bold")
        y += lh + 3
        for item in sources:
            for ln in _wrap(item, w, fs - 0.5):
                s.text(x + 6, y, ln, size=fs - 0.5, color=GRY)
                y += lh - 1
    return y


def draw_legend(s, x, y):
    """Generic line-style key (engineering meaning of each style lives in the model notes)."""
    s.text(x, y, "LEGEND", size=9, weight="bold")
    s.line(x + 10, y + 12, x + 56, y + 12, color=BLK, w=1.8)
    s.text(x + 64, y + 15, "VERIFIED (solid)", size=8)
    s.line(x + 10, y + 26, x + 56, y + 26, color=BLK, w=1.8, dash=True)
    s.text(x + 64, y + 29, "FIELD VERIFY (dashed)", size=8)
    wire_tag(s, x + 33, y + 52, "Wxxx", verified=False)
    s.text(x + 64, y + 46, "proposed wire number (red = unverified)", size=8)
    return y + 58


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


def _sheet_row(sheet_id):
    sheets = _load("sheets")
    return next(x for x in sheets["sheets"] if x["id"] == sheet_id)


def _annotations_for(sheet_id):
    return _sheet_row(sheet_id).get("annotations") or {}


# ---------------------------------------------------------------- E-001 cover
def render_e001():
    devices = _load("devices")
    sheets = _load("sheets")
    wires = _load("wires")
    meta = devices["meta"]
    ann = _annotations_for("E-001")

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-001  COVER / LEGEND / DEVICE SCHEDULE",
        f"{meta['project']} / {meta['asset']}  —  device schedule · sheet index · wire-numbering key · line-style legend",
    )

    # ---- device schedule (from devices.yaml) ----
    s.text(70, 172, "DEVICE SCHEDULE", size=11, weight="bold")
    rows = []
    for d in devices["devices"]:
        role = d.get("role", "")
        if len(role) > 80:
            role = role[:77] + "..."
        model = d.get("model", "")
        if len(model) > 50:
            model = model[:47] + "..."
        rows.append(
            [
                d["tag"],
                humanize_snake_case(d.get("type", "")),
                model,
                role,
                d.get("evidence", ""),
            ]
        )
    draw_table(
        s,
        70,
        180,
        [52, 92, 250, 330, 74],
        ["Tag", "Type", "Model", "Role", "Evidence"],
        rows,
        evidence_col=4,
        rh=20,
        fs=7.2,
        mono_cols=(0, 2),
        first_col_class="schedule-tag",
    )

    # ---- sheet index (from sheets.yaml) ----
    idx_y = 180 + (len(rows) + 1) * 20 + 36
    s.text(70, idx_y - 8, "SHEET INDEX", size=11, weight="bold")
    idx_rows = [[sh["id"], sh.get("title", ""), sh.get("status", "")] for sh in sheets["sheets"]]
    draw_table(
        s,
        70,
        idx_y,
        [70, 470, 90],
        ["Id", "Title", "Status"],
        idx_rows,
        rh=20,
        fs=7.5,
        mono_cols=(0,),
        first_col_class="index-id",
    )

    # ---- wire-numbering key (wires.yaml `convention`, verbatim) ----
    nx = 920
    s.text(nx, 172, "WIRE-NUMBERING KEY", size=11, weight="bold")
    conv_lines = _wrap(wires.get("convention", ""), 560, 7.5)
    box_h = len(conv_lines) * 11 + 12
    s.rect(nx, 180, 580, box_h, sw=1.0)
    for i, ln in enumerate(conv_lines):
        s.text(nx + 8, 194 + i * 11, ln, size=7.5)

    # ---- line-style legend ----
    leg_y = 180 + box_h + 34
    s.text(nx, leg_y - 8, "LINE-STYLE LEGEND", size=11, weight="bold")
    leg_end = draw_legend(s, nx, leg_y + 4)

    # ---- package safety banner (model annotations) ----
    draw_annotations(s, nx, leg_end + 26, 580, ann, fs=7.5)

    title_block(
        s,
        fx1,
        fy1,
        meta,
        "E-001",
        "COVER / LEGEND / DEVICE SCHEDULE",
        "1 of 9",
        lineage="cover generated from model/*.yaml",
    )
    _emit(s, "E-001_cover")


# ---------------------------------------------------------------- E-007 comms
def render_e007():
    devices = _load("devices")
    m = devices["meta"]
    e = _load("e007_rs485")
    ann = _annotations_for("E-007")
    plc, vfd = e["endpoints"]["plc"], e["endpoints"]["vfd"]
    sc = e["serial_config"]
    cw = e["command_words"]

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-007  RS-485 / MODBUS RTU COMMUNICATION",
        f"{m['project']} / {m['asset']}  —  {plc['device']} (master) ↔ {vfd['device']} (node {sc['node'].split()[0]})  ·  Modbus RTU only",
    )

    # device blocks (names/ports from the model)
    plx, pw = 250, 250
    vfx, vw = 1090, 250
    by, bh = 200, 258
    s.rect(plx, by, pw, bh, sw=1.8)
    s.text(plx + pw / 2, by + 24, plc["tag"], size=15, anchor="middle", weight="bold")
    s.text(plx + pw / 2, by + 42, plc["device"], size=8.5, anchor="middle", color=GRY)
    s.text(plx + pw / 2, by + 56, plc["channel"], size=8.5, anchor="middle", color=BLK)
    s.rect(vfx, by, vw, bh, sw=1.8)
    s.text(vfx + vw / 2, by + 24, vfd["tag"], size=15, anchor="middle", weight="bold")
    s.text(vfx + vw / 2, by + 42, vfd["device"], size=8.5, anchor="middle", color=GRY)
    s.text(vfx + vw / 2, by + 56, vfd["port"], size=8.5, anchor="middle", color=BLK)

    # links (drawn wire + terminal labels + conductor captions, all from the model)
    link_y = {"485+": 288, "485-": 338, "SGND": 388, "SH": 443}
    links = {ln["wire_label"]: ln for ln in e["links"]}
    for lbl in ("485+", "485-", "SGND"):
        ln = links[lbl]
        y = link_y[lbl]
        verified = ln["evidence"] == "verified"
        s.circle(plx + pw, y, 3.2, fill=BLK)
        s.text(plx + pw - 8, y - 4, ln["src_terminal"], size=9, anchor="end", mono=True)
        s.circle(vfx, y, 3.2, fill=BLK)
        s.text(vfx + 8, y - 4, ln["dst_terminal"], size=9, anchor="start", mono=True)
        s.line(
            plx + pw,
            y,
            vfx,
            y,
            color=BLK,
            w=1.8,
            dash=not verified,
            wire=lbl,
            wire_status=ln["evidence"],
        )
        mid = (plx + pw + vfx) / 2
        wire_tag(s, mid, y, lbl, verified=verified)
        s.text(mid, y + 16, ln["conductor"], size=8, anchor="middle", color=GRY)

    # shield: land PLC end only, float GS10 end (from the SH link row)
    sh = links["SH"]
    shy = link_y["SH"]
    s.circle(plx + pw, shy, 3.2, fill=BLK)
    s.text(plx + pw - 8, shy - 4, sh["src_terminal"], size=9, anchor="end", mono=True)
    verified_sh = sh["evidence"] == "verified"
    s.line(
        plx + pw,
        shy,
        plx + pw + 90,
        shy,
        color=BLK,
        w=1.6,
        dash=not verified_sh,
        wire="SH",
        wire_status=sh["evidence"],
    )
    earth_symbol(s, plx + pw + 90, shy)
    wire_tag(s, plx + pw + 45, shy, "SH", verified=verified_sh)
    s.text(plx + pw + 108, shy + 2, sh["notes"], size=8, color=RED)
    s.text(vfx - 8, shy - 4, sh["dst_terminal"], size=8, anchor="end", color=GRY)

    # termination across SG+/SG- at drive end (endpoints.vfd.termination)
    tx = vfx - 34
    s.line(tx, link_y["485+"], tx, link_y["485-"], color=BLK, w=1.2)
    s.line(vfx, link_y["485+"], tx, link_y["485+"], color=BLK, w=1.2)
    s.line(vfx, link_y["485-"], tx, link_y["485-"], color=BLK, w=1.2)
    s.rect(tx - 6, (link_y["485+"] + link_y["485-"]) / 2 - 12, 12, 24, sw=1.1)
    for i, ln in enumerate(_wrap(vfd["termination"], 150, 7.5)):
        s.text(
            tx - 12,
            (link_y["485+"] + link_y["485-"]) / 2 + 2 + i * 9,
            ln,
            size=7.5,
            anchor="end",
            color=GRY,
        )

    # readback notes (model)
    for i, rb in enumerate(e.get("readback", [])):
        s.text(vfx + vw / 2, by + bh + 16 + i * 12, rb, size=7.6, anchor="middle", color=GRY)

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
    for ln in e["links"]:
        rows.append(
            [
                ln["src_device"],
                ln["src_terminal"],
                ln["dst_device"],
                ln["dst_terminal"],
                f"{ln['cable']} · {ln['conductor']}",
                ln["wire_label"],
                ln["evidence"],
                ln.get("notes", ""),
            ]
        )
    tbl_bottom = draw_table(s, 70, ty0, colw, headers, rows, evidence_col=6)

    # ---- serial config strip (model, incl. the OI-20 adjudication note) ----
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
    s.text(70, y + 27, sc["oi20_note"], size=7.6, color=RED)

    # ---- command words strip (model command_words) ----
    y += 48
    s.text(70, y, f"COMMAND WORDS ({cw['register']}):", size=9, weight="bold")
    vals = " · ".join(
        [f"{k.replace('_', '+').upper()} = {cw[k]}" for k in ("stop", "fwd_run", "rev_run")]
        + [f"freq register {cw['freq_register']}"]
    )
    s.text(230, y, vals, size=9, mono=True)
    sup_lines = _wrap(cw["rev_run_supersession"], 620, 7.6)
    for i, ln in enumerate(sup_lines):
        s.text(70, y + 13 + i * 11, ln, size=7.6, color=RED)
    y += 13 + len(sup_lines) * 11
    s.text(70, y + 2, cw["source"], size=6.8, color=GRY)
    y += 18

    # ---- annotations (caveat + notes from sheets.yaml; width clears the right column) ----
    y = draw_annotations(s, 70, y, 620, ann, fs=7.5)

    # ---- doc references (e007_rs485 model; labeled distinctly from the
    #      annotations SOURCES block above so V5's added photo-evidence
    #      source line doesn't produce two adjacent identical headings) ----
    sy = y + 12
    s.text(70, sy, "DOC REFS:", size=8.5, weight="bold")
    for i, src in enumerate(e["sources"]):
        s.text(130, sy + i * 12, src, size=7.6, color=GRY)

    # ---- troubleshooting + legend (right column) ----
    s.text(830, 648, "TROUBLESHOOTING (this circuit)", size=10, weight="bold")
    for i, t in enumerate(e["troubleshooting"]):
        s.text(838, 664 + i * 13, f"• {t}", size=8.4)
    draw_legend(s, 830, 664 + len(e["troubleshooting"]) * 13 + 16)

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


# ---------------------------------------------------------------- E-005 inputs
def render_e005():
    devices = _load("devices")
    terms = _load("terminals")
    wires = _load("wires")
    meta = devices["meta"]
    ann = _annotations_for("E-005")
    dev_by_tag = {d["tag"]: d for d in devices["devices"]}

    # index wires by destination PLC terminal
    wl = {w["to"]: w for w in wires["wires"] if str(w["to"]).startswith("PLC1.I-")}
    w24 = next(w for w in wires["wires"] if w["proposed_number"] == "W24")
    w0v = next(w for w in wires["wires"] if w["proposed_number"] == "W0V")
    plc_in = terms["PLC1"]["inputs"]
    com0 = terms["PLC1"]["common"][0]

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
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-005  PLC DIGITAL INPUTS",
        f"{meta['project']} / {meta['asset']}  —  {dev_by_tag['PLC1']['model']} embedded DI (24 VDC)",
    )

    # ---- rails ----
    rail_x = 250
    rung_y = {"I-00": 235, "I-01": 297, "I-02": 359, "I-03": 421, "I-04": 483, "I-05": 545}
    rail_top, rail_bot = 210, 560
    s.line(
        rail_x,
        rail_top,
        rail_x,
        rail_bot,
        color=BLK,
        w=2.2,
        dash=True,
        wire="W24",
        wire_status=w24["status"],
    )
    wire_tag(s, rail_x, rail_top - 2, "W24", verified=(w24["status"] == "verified"))
    s.text(rail_x, rail_top - 29, "+24 VDC", size=11, anchor="middle", weight="bold")
    s.text(rail_x, rail_top - 43, "(PS1 / E-004)", size=8.5, anchor="middle", color=GRY)

    # ---- PLC input block ----
    bx, by, bw = 1170, 150, 300
    by2 = 884
    s.rect(bx, by, bw, by2 - by, sw=1.8)
    s.text(bx + bw / 2, by + 22, "PLC1", size=15, anchor="middle", weight="bold")
    s.text(bx + bw / 2, by + 40, dev_by_tag["PLC1"]["model"], size=9, anchor="middle", color=GRY)
    s.text(bx + bw / 2, by + 54, "embedded digital inputs", size=8.5, anchor="middle", color=GRY)

    # spare + common Y positions
    spare_ids = ["I-06", "I-07", "I-08", "I-09", "I-10", "I-11"]
    spare_y = {tid: 600 + k * 26 for k, tid in enumerate(spare_ids)}
    com_y = 600 + len(spare_ids) * 26 + 10

    # draw the six wired rungs
    for tid, y in rung_y.items():
        info = next(t for t in plc_in if t["id"] == tid)
        w = wl.get(f"PLC1.{tid}")
        verified_wire = bool(w and w.get("status") == "verified")
        wnum = w["proposed_number"] if w else "?"
        wst = w["status"] if w else "field_verify"
        kind, dev_label, field_term = plan[tid]

        dxl, dxr = rail_x, 470
        # +24V lead from the rail into the device (part of the W24 distribution)
        s.line(
            rail_x,
            y,
            dxl + 60,
            y,
            color=BLK,
            w=1.6,
            dash=not verified_wire,
            wire="W24",
            wire_status=w24["status"],
        )
        GLYPH[kind](s, dxl + 60, dxr, y, dev_label, field_term, dashed=not verified_wire)
        # signal conductor device -> PLC terminal
        s.line(dxr, y, bx, y, color=BLK, w=1.6, dash=not verified_wire, wire=wnum, wire_status=wst)
        wire_tag(s, (dxr + bx) / 2, y, wnum, verified_wire)
        # PLC terminal (VERIFIED) — solid dot + label inside block
        s.circle(bx, y, 3.2, fill=BLK)
        s.text(bx + 10, y - 3, tid, size=11, weight="bold", mono=True)
        s.text(bx + 10, y + 10, info["function"], size=8.5, color=BLK)
        s.text(bx + 10, y + 21, info["opc"], size=7.5, color=GRY, mono=True)
        s.text(
            bx + bw - 8,
            y - 2,  # above the function line — long functions (I-05) reach this column
            f"healthy: {info['healthy_state']}",
            size=7.5,
            anchor="end",
            color=GRY,
        )
        if info.get("note"):
            for k, ln in enumerate(_wrap(info["note"], 280, 7.2)):
                s.text(bx + 10, y + 32 + k * 10, ln, size=7.2, color=RED)

    # spares (function from the model; OI-08 tracks the field check)
    for tid, y in spare_y.items():
        info = next(t for t in plc_in if t["id"] == tid)
        s.circle(bx, y, 3.0, fill="#FFFFFF")
        s.text(bx + 10, y + 3, f"{tid}", size=10, mono=True, color=GRY)
        s.text(bx + 60, y + 3, f"{info['function']} (no field wire — OI-08)", size=8, color=GRY)

    # common (function from the model)
    s.circle(bx, com_y, 3.2, fill=BLK)
    s.text(bx + 10, com_y + 3, com0["id"], size=10, weight="bold", mono=True)
    s.line(
        bx,
        com_y,
        bx - 120,
        com_y,
        color=BLK,
        w=1.6,
        dash=True,
        wire="W0V",
        wire_status=w0v["status"],
    )
    wire_tag(s, bx - 60, com_y, "W0V", verified=(w0v["status"] == "verified"))
    s.text(bx - 128, com_y + 3, "0V (PS1 / E-004)", size=8.5, anchor="end", color=GRY)
    s.text(bx + 70, com_y + 3, com0["function"], size=8, color=GRY)
    s.text(bx + 70, com_y + 14, "(FIELD VERIFY — OI-02)", size=7.5, color=RED)

    # ---- legend + model annotations ----
    draw_legend(s, 70, 594)
    draw_annotations(s, 70, 668, 1000, ann, fs=7.5)

    title_block(s, fx1, fy1, meta, "E-005", "PLC DIGITAL INPUTS", "5 of 9")
    _emit(s, "E-005_plc_inputs")


# ---------------------------------------------------------------- E-003 power
def render_e003():
    devices = _load("devices")
    terms = _load("terminals")
    wires = _load("wires")
    meta = devices["meta"]
    ann = _annotations_for("E-003")
    dev_by_tag = {d["tag"]: d for d in devices["devices"]}

    e3 = [w for w in wires["wires"] if w.get("sheet") == "E-003"]
    wire_by = {w["proposed_number"]: w for w in e3}

    # Chain description lives in sheets.yaml; the FIELD-VERIFY claim is COMPUTED
    # from the wire statuses (never hand-asserted — see auditor finding F3).
    chain = _sheet_row("E-003")["subtitle"]
    n_fv = sum(1 for w in e3 if w.get("status") != "verified")
    fv_note = (
        "every conductor FIELD VERIFY"
        if n_fv == len(e3)
        else f"{n_fv}/{len(e3)} conductors FIELD VERIFY"
    )

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-003  VFD POWER",
        f"{meta['project']} / {meta['asset']}  —  {chain}  ·  {fv_note}",
    )

    def seg(num, x1, y1, x2, y2, w_=1.8):
        """One orthogonal conductor segment of wire `num` (dashed = field_verify)."""
        s.line(
            x1, y1, x2, y2, color=BLK, w=w_, dash=True, wire=num, wire_status=wire_by[num]["status"]
        )

    xL, xC, xR = 340, 400, 460  # the three power-column conductors

    # ---- SUPPLY node (top) — device outline SOLID; uncertainty = red text ----
    s.rect(320, 150, 160, 40, sw=1.4)
    s.text(400, 168, "SUPPLY", size=12, anchor="middle", weight="bold")
    s.text(400, 183, "(FIELD VERIFY)", size=7.5, anchor="middle", color=RED)

    # ---- SUPPLY -> CB1 (W300/W301/W302) ----
    for num, x in (("W300", xL), ("W301", xC), ("W302", xR)):
        seg(num, x, 190, x, 236, w_=2.0)
        wire_tag(s, x, 216, num, verified=False, orient="v")

    # ---- CB1: one breaker pole per conductor (L3 labels right, outside the cluster) ----
    for lbl, x, side in (("L1", xL, "left"), ("L2", xC, "left"), ("L3 (3φ)", xR, "right")):
        breaker_pole(s, x, 250, lbl, side=side)
    s.text(290, 242, "CB1", size=10, anchor="end", weight="bold")
    s.text(290, 254, "(FIELD VERIFY)", size=7.5, anchor="end", color=RED)

    # ---- CB1 -> VFD1 line terminals, DIRECT (W303/W304/W305) — no contactor in
    #      this run. V4 photo correction: Q1/MLC is a control relay with no power
    #      poles, moved off this sheet entirely (see OI-21 and E-006). ----
    for num, x in (("W303", xL), ("W304", xC), ("W305", xR)):
        seg(num, x, 264, x, 350, w_=2.0)
        wire_tag(s, x, 307, num, verified=False, orient="v")

    # ---- VFD1 block (name + terminal ids from the model — never hand-retyped) ----
    vx, vy, vw, vh = 280, 350, 240, 220
    s.rect(vx, vy, vw, vh, sw=1.6)
    pin_ids = [t["id"] for t in terms["VFD1"]["power_input"]]
    for lbl, x in zip(pin_ids, (xL, xC, xR)):
        s.circle(x, vy, 2.8, fill=BLK)
        s.text(x, vy + 16, lbl, size=8, anchor="middle", weight="bold", mono=True)
    s.text(400, 398, "VFD1", size=14, anchor="middle", weight="bold")
    s.text(400, 414, dev_by_tag["VFD1"]["model"], size=8, anchor="middle", color=GRY)

    # side stubs — terminal ids + functions from terminals.yaml VFD1.dc_bus
    dc_terms = {t["id"]: t["function"] for t in terms["VFD1"]["dc_bus"]}
    sx = vx + vw
    stub_y = 428
    for ids, jumper in ((("+1", "+2"), True), (("B1", "B2"), False), (("DC+", "DC-"), False)):
        if jumper:
            s.line(sx, stub_y, sx + 24, stub_y, w=1.2)
            s.line(sx, stub_y + 12, sx + 24, stub_y + 12, w=1.2)
            s.line(sx + 24, stub_y, sx + 30, stub_y, w=1.8)
            s.line(sx + 30, stub_y, sx + 30, stub_y + 12, w=1.8)
            s.line(sx + 30, stub_y + 12, sx + 24, stub_y + 12, w=1.8)
        else:
            s.line(sx, stub_y + 6, sx + 28, stub_y + 6, w=1.2)
        s.text(
            sx + 36, stub_y + 3, "/".join(ids), size=7.5, anchor="start", weight="bold", mono=True
        )
        fn_lines = _wrap(dc_terms[ids[0]], 120, 7.2)
        for j, ln in enumerate(fn_lines):
            s.text(sx + 36, stub_y + 13 + j * 9, ln, size=7.2, anchor="start", color=GRY)
        stub_y += 20 + len(fn_lines) * 9 + 8

    # output terminals (bottom edge) + ground lug — ids from the model
    pout_ids = [t["id"] for t in terms["VFD1"]["power_output"]]
    for lbl, x in zip(pout_ids, (xL, xC, xR)):
        s.circle(x, vy + vh, 2.8, fill=BLK)
        s.text(x, vy + vh - 8, lbl, size=8, anchor="middle", weight="bold", mono=True)
    s.circle(510, vy + vh, 2.8, fill=BLK)
    gnd_id = terms["VFD1"]["ground"][0]["id"]
    s.text(510, vy + vh - 8, gnd_id, size=7.5, anchor="middle", mono=True)

    # ---- VFD1 -> M1 (W310/W311/W312); motor terminal row at y=710 ----
    seg("W310", xL, 570, xL, 710, w_=1.4)
    wire_tag(s, xL, 642, "W310", verified=False, orient="v")
    seg("W311", xC, 570, xC, 634, w_=1.4)  # interrupted by the motor glyph
    seg("W311", xC, 666, xC, 710, w_=1.4)
    wire_tag(s, xC, 604, "W311", verified=False, orient="v")
    seg("W312", xR, 570, xR, 710, w_=1.4)
    wire_tag(s, xR, 642, "W312", verified=False, orient="vr")

    # ---- Motor M1 (circle ~650, terminal dot row ~710); caption clears the
    #      W310 flag rect (>=4px) — left of it, right-anchored ----
    m1_fv = dev_by_tag["M1"].get("evidence") != "verified"
    motor_sym(s, 400, 650, phase_color=RED if m1_fv else GRY)
    s.text(290, 632, "M1", size=10, anchor="end", weight="bold")
    s.text(290, 644, "(FIELD VERIFY)", size=7.2, anchor="end", color=RED)
    for lbl, x in (("T1", xL), ("T2", xC), ("T3", xR), ("PE", 520)):
        s.circle(x, 710, 2.4, fill=BLK)
        s.text(x, 723, lbl, size=8, anchor="middle", mono=True)

    # ---- PE bus (vertical at x=700) ----
    s.text(700, 190, "to source PE (E-002)", size=7.5, anchor="middle", color=GRY)
    s.line(696, 206, 700, 198, w=1.2)
    s.line(704, 206, 700, 198, w=1.2)
    seg("W317", 700, 198, 700, 610, w_=2.2)
    wire_tag(s, 700, 404, "W317", verified=False, orient="v")
    s.line(700, 610, 700, 715, color=BLK, w=2.2, dash=True)  # bus collector (node)
    s.circle(700, 610, 2.2, fill=BLK)
    s.circle(700, 710, 2.2, fill=BLK)
    earth_symbol(s, 700, 715)
    s.text(722, 730, "PE", size=10, anchor="start", weight="bold")

    # W315: VFD1.GND drops down, then runs horizontally to the bus
    seg("W315", 510, 570, 510, 610, w_=1.4)
    seg("W315", 510, 610, 700, 610, w_=1.4)
    wire_tag(s, 605, 610, "W315", verified=False)

    # W316: M1.PE runs horizontally to the bus
    seg("W316", 520, 710, 700, 710, w_=1.4)
    wire_tag(s, 610, 710, "W316", verified=False)

    # ---- connection table (right half) ----
    s.text(800, 172, "CONNECTION TABLE", size=11, weight="bold")
    headers = ["Wire", "From", "To", "Signal", "Type", "Status", "Notes"]

    def short(endpoint):
        # table-only truncation; wires.yaml keeps the full node name
        return "SUPPLY (E-002)" if endpoint == "SUPPLY (source — see E-002)" else endpoint

    rows = []
    for w in e3:
        rows.append(
            [
                w["proposed_number"],
                short(w["from"]),
                short(w["to"]),
                w["signal"],
                w["type"],
                w["status"],
                w.get("note", ""),
            ]
        )
    # Notes col sized for the longest cite (W306, 48 chars) with >=3px border
    # clearance; slack taken from From/To (total width unchanged: 755)
    draw_table(s, 800, 180, [44, 128, 91, 140, 72, 75, 205], headers, rows, evidence_col=5, fs=7.2)

    # ---- model annotations (caveat + safety left; notes + sources right).
    #      Widths keep the two columns' estimated text extents apart and the
    #      right column clear of the title block (check L text-text audit). ----
    # y0=740 (was 816): the V4 caveat addition made the left column taller —
    # start higher, using the headroom freed by the E-003 recompression (diagram
    # bottom is now ~735), so the legend below still clears the frame at y=1000.
    left_ann_end = draw_annotations(
        s, 70, 740, 540, {"caveat": ann.get("caveat"), "safety": ann.get("safety")}, fs=7.5
    )
    # right column x=740: clear of the PE bus terminus + earth glyph (bars end
    # x=716) and the "PE" label; est extent stays left of title-block text
    draw_annotations(
        s, 740, 740, 340, {"notes": ann.get("notes"), "sources": ann.get("sources")}, fs=7.5
    )
    # legend position COMPUTED from the actual left-column annotation height
    # (never hand-pinned) — a fixed y drifted stale once the V4 caveat grew the block
    draw_legend(s, 70, left_ann_end + 14)

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

    _emit(s, "E-003_vfd_power")


# ---------------------------------------------------------------- E-006 outputs
def render_e006():
    devices = _load("devices")
    terms = _load("terminals")
    wires = _load("wires")
    meta = devices["meta"]
    ann = _annotations_for("E-006")
    dev_by_tag = {d["tag"]: d for d in devices["devices"]}

    e6 = [w for w in wires["wires"] if w.get("sheet") == "E-006"]
    wire_by = {w["proposed_number"]: w for w in e6}

    W, H = 1600, 1040
    s = SVG(W, H)
    fx0, fy0, fx1, fy1 = draw_frame(
        s,
        W,
        H,
        "E-006  PLC OUTPUTS",
        f"{meta['project']} / {meta['asset']}  —  {_sheet_row('E-006')['subtitle']}",
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
    s.text((bx0 + bx1) / 2, 208, dev_by_tag["PLC1"]["model"], size=8, anchor="middle", color=GRY)
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
            size=7.5,
            anchor="end",
            color=RED,
        )
    # output commons on the block edge
    for cid, y in com_y.items():
        s.circle(bx1, y, 3.2, fill=BLK)
        # Color terminal label by status (red if not verified)
        term_status = coms[cid].get("status", "field_verify")
        label_color = RED if term_status != "verified" else BLK
        s.text(
            bx1 - 8, y - 3, cid, size=9.5, anchor="end", weight="bold", mono=True, color=label_color
        )
        fn = coms[cid]["function"]
        if cid in ("+CM1", "-CM1"):
            fn += " · spare bank — unused"
        s.text(bx1 - 8, y + 9, fn, size=6.8, anchor="end", color=GRY)

    # ---- W600: PS1 +24V feed into +CM0 (dashed vertical + horizontal from top) ----
    s.text(470, 178, "PS1 +24V (E-004)", size=8.5, anchor="middle", weight="bold")
    seg("W600", 470, 186, 470, 630)
    seg("W600", 470, 630, 430, 630)
    wire_tag(s, 470, 432, "W600", verified=False, orient="vr")

    # ---- loads (right column at x~950, each at its rung's y) ----
    lx = 950
    pilot(s, lx, out_y["O-00"], "PL1 GREEN", "RUN LIGHT", dashed=True)
    pilot(s, lx, out_y["O-01"], "PL2 RED", "FAULT/E-STOP", dashed=True)
    # coil label pulled from the model (tag + humanized type) — never hand-typed
    q1_label = f"{dev_by_tag['Q1']['tag']} {humanize_snake_case(dev_by_tag['Q1']['type']).upper()}"
    coil(s, lx, out_y["O-02"], q1_label, "A1", "A2", dashed=True)
    # aux-contact tally COMPUTED from terminals.yaml Q1 function text (never
    # hand-asserted — same discipline as the E-003 FIELD-VERIFY count). Sits
    # under the coil (above collides with PL2's sub-label).
    q1_terms = terms.get("Q1", [])
    n_no = len({t["function"] for t in q1_terms if "NO" in t.get("function", "")})
    n_nc = len({t["function"] for t in q1_terms if "NC" in t.get("function", "")})
    s.text(lx, 417, f"aux contacts: {n_no} NO + {n_nc} NC", size=7.5, anchor="middle", color=GRY)
    pilot(s, lx, out_y["O-03"], "S2 LAMP", "RUN BTN", dashed=True)

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
    s.text(446, 676, "→ PS1.0V (E-004)", size=7.5, anchor="start", color=GRY)

    # ---- model annotations (right column) + legend ----
    ann_end = draw_annotations(s, 1230, 200, 315, ann, fs=7.2)
    draw_legend(s, 1230, ann_end + 18)

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
        lineage="output map CCW v4.0 + live Prog_init; O-02 do-not-reuse (WI-001 p.4)",
    )

    _emit(s, "E-006_plc_outputs")


# ---------------------------------------------------------------- print set
def render_set():
    """Merge drafted sheets (sheets.yaml id order) into a single PDF."""
    sheets = _load("sheets")
    import fitz

    drafted = [sh for sh in sheets["sheets"] if sh.get("status") == "drafted"]

    basenames = {
        "E-001": "E-001_cover",
        "E-003": "E-003_vfd_power",
        "E-005": "E-005_plc_inputs",
        "E-006": "E-006_plc_outputs",
        "E-007": "E-007_rs485_modbus",
    }

    pdfs = []
    for sheet in drafted:
        basename = basenames.get(sheet["id"])
        if basename:
            pdf_path = SHEETS / f"{basename}.pdf"
            if pdf_path.exists():
                pdfs.append(pdf_path)

    if not pdfs:
        print("No drafted sheets found or PDFs missing")
        return

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
    "E-001": render_e001,
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
