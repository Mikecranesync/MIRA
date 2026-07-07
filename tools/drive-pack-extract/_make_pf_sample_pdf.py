"""Generate the SYNTHETIC PowerFlex-shaped sample PDF used by the
drive-pack-extract test suite.

Reproducible: ``python _make_pf_sample_pdf.py`` (no network). Reuses the same
PDF-generation library as ``tests/beta/fixtures/_make_gs10_pdf.py`` (reportlab).

This is NOT a real manual and is never mistaken for one — every page carries a
"SYNTHETIC TEST FIXTURE" footer. None of the fault descriptions/actions/parameter
text below is copied from any licensed manual; they are original,
plausible-sounding text written for this fixture only.

The fixture reproduces the REAL manuals' measured messiness by drawing each
logical column as its OWN text object at an EXPLICIT (x, y) coordinate, so
``pdfplumber.extract_words()`` sees the same kind of independently-flowing,
position-only column separation the real PowerFlex fault/parameter tables have.
It covers BOTH manual dialects the extractor supports:

**PowerFlex 520/525 shape (pages 1-3)** — Fault-Type as a trailing "1"/"2"/"—"
text token; grid + labeled-block parameter layouts:
- a fault row's Code/Name/Fault-Type line rendering on a DIFFERENT physical line
  than its own Description (the real 520 F004 row)
- a footnote-parenthesized code (``F015(3)``) / Fault-Type value (``F013 … 1(2)``)
- an em-dash Fault-Type/action for the "no fault" row (``F000``)
- a SHARED multi-code group whose Fault-Type renders BETWEEN member lines
  (``F038``/``F039`` close on a bare "2", ``F040`` still follows)
- a fault→parameter cross-reference whose action renders ABOVE its code line
- a grid parameter whose Min/Max wraps across FOUR lines, code+name mid-span
- a footnote-DEFINITION line gluing a bracket ref to another id (``"A535[Motor"``)
- a labeled-block enum: quoted options, one per line, inline ``"(Default)"``

**PowerFlex 40 shape (pages 4-5)** — Fault-Type as a ZapfDingbats circled-digit
glyph in its own column; single-digit fault codes; labeled-block only:
- single-digit fault codes (``F2``/``F3`` …) with a circled-digit ➀/➁ Fault-Type
  glyph rendered ~3pt ABOVE its own code row, in a dedicated column
- a shared group whose Fault-Type glyph sits on the FIRST member only, the rest
  blank (emitted as unknown "—", never a fabricated type)
- a genuinely untyped fault (no glyph at all → emitted as "—", NOT dropped)
- a wrapped fault name ("Heatsink" / "OverTemp")
- a single-digit-code fault with a "Modify using A2xx [...]" cross-reference
- a labeled param using the PF40 label dialect: ``Values Default: 5.0 Secs`` +
  ``Min/Max: 0.1/60.0 Secs`` (unit-suffixed, "Values" on Default not Min/Max)
- a labeled enum whose FIRST option line is prefixed with the label word
  (``Options 0 "Fault" (Default) …``)
- a plain-Helvetica GRAPH CALLOUT that matches the header shape but is NOT a
  real parameter (``A299 [Phantom Freq]``) and MUST be rejected by the bold-header
  gate — the real PF40 p.71 "A034 [Minimum Freq]" typo, generalized

Real parameter-definition headers are drawn BOLD (as they are in the real
manuals — Helvetica-Narrow-Bold); graph callouts and body text are not. The
extractor's bold-header gate depends on this distinction.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "fixtures" / "pf_sample.pdf"

SYNTHETIC_FOOTER = "SYNTHETIC TEST FIXTURE — not a licensed manual. drive-pack-extract."

FONT = ("Helvetica", 9)
BOLD = ("Helvetica-Bold", 9)  # real param-definition headers are bold
TITLE_FONT = ("Helvetica-Bold", 12)

# The PF40 Fault-Type column is a ZapfDingbats circled digit (➀ U+2780 = type 1,
# ➁ U+2781 = type 2). reportlab's built-in ZapfDingbats does not round-trip those
# codepoints through pdfplumber, so we embed a real symbol TTF that has them
# (Segoe UI Symbol on Windows, DejaVu/Noto on Linux) — the glyph subset is
# embedded in the committed PDF, so tests never need the font, only regeneration
# does. The extractor keys on the Unicode codepoint, so the fixture emits the
# SAME signal the real manual does.
_SYMBOL_FONT_CANDIDATES = (
    "C:/Windows/Fonts/seguisym.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Apple Symbols.ttf",
)
_SYMBOL_FONT_NAME = "SymbolTTF"

DINGBAT_ONE = "➀"  # ➀
DINGBAT_TWO = "➁"  # ➁


def _register_symbol_font() -> None:
    for path in _SYMBOL_FONT_CANDIDATES:
        if Path(path).is_file():
            pdfmetrics.registerFont(TTFont(_SYMBOL_FONT_NAME, path))
            return
    raise RuntimeError(
        "No symbol TTF with circled-digit glyphs (U+2780/U+2781) found. Install "
        "one of: " + ", ".join(_SYMBOL_FONT_CANDIDATES) + " — needed only to "
        "REGENERATE the fixture; the committed pf_sample.pdf already embeds the "
        "glyph subset."
    )


def _draw(c: canvas.Canvas, x: float, y: float, text: str, *, font: tuple = FONT) -> None:
    name, size = font
    c.setFont(name, size)
    c.drawString(x, y, text)


def _draw_dingbat(c: canvas.Canvas, x: float, y: float, glyph: str) -> None:
    # ~3pt ABOVE the row baseline (larger y = higher on page), matching the real
    # PF40 layout where the Fault-Type glyph never clusters onto its own row.
    c.setFont(_SYMBOL_FONT_NAME, 9)
    c.drawString(x, y + 3, glyph)


# ===========================================================================
# Page 1 — 520/525 fault table (trailing text Fault-Type token).
# ===========================================================================
X_CODE, X_DESC, X_ACTION = 100, 260, 420


def _fault_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "Fault Descriptions", font=TITLE_FONT)
    y = 740
    _draw(c, X_CODE, y, "No.")
    _draw(c, X_CODE + 40, y, "Fault")
    _draw(c, X_DESC, y, "Description")
    _draw(c, X_ACTION, y, "Action")

    # F004 — Description's OWN first line renders ABOVE the code+name+type line.
    y -= 20
    _draw(c, X_DESC, y, "DC bus voltage fell below the min")
    _draw(c, X_ACTION, y, "Monitor the incoming AC line for low")
    y -= 13
    _draw(c, X_CODE, y, "F004 UnderVoltage 1")
    _draw(c, X_DESC, y, "value.")
    _draw(c, X_ACTION, y, "voltage or line power interruption.")

    # F015 — footnote paren glued directly onto the CODE.
    y -= 27
    _draw(c, X_CODE, y, "F015(3) Load Loss 2")
    _draw(c, X_DESC, y, "The output torque current is below the threshold.")
    _draw(c, X_ACTION, y, "Verify connections between motor and load.")

    # F013 — footnote paren glued onto the FAULT-TYPE value instead.
    y -= 20
    _draw(c, X_CODE, y, "F013 Ground Fault 1(2)")
    _draw(c, X_DESC, y, "A current path to earth ground has been detected.")
    _draw(c, X_ACTION, y, "Check the motor and external wiring.")

    # F000 — em-dash Fault-Type/Action for the "no fault" row.
    y -= 20
    _draw(c, X_CODE, y, "F000 No Fault —")
    _draw(c, X_DESC, y, "No fault present.")
    _draw(c, X_ACTION, y, "—")

    # F038/F039/F040 — shared group whose Fault-Type ("2") renders BETWEEN
    # member lines, not after the last one.
    y -= 25
    _draw(c, X_CODE, y, "F038 Phase U to Gnd")
    _draw(c, X_ACTION, y, "Check the wiring between the drive")
    y -= 13
    _draw(c, X_CODE, y, "F039 Phase V to Gnd")
    _draw(c, X_DESC, y, "A phase to ground fault has been")
    _draw(c, X_ACTION, y, "and motor for grounded phase.")
    y -= 13
    _draw(c, X_CODE + 120, y, "2")  # bare Fault-Type, own line, mid-group
    _draw(c, X_DESC, y, "detected between the drive and")
    y -= 13
    _draw(c, X_CODE, y, "F040 Phase W to Gnd")
    _draw(c, X_DESC, y, "motor in this phase.")
    _draw(c, X_ACTION, y, "Replace drive if fault cannot be cleared.")

    # F081 — explicit fault -> parameter cross-reference, action rendering
    # ABOVE its own code line (mirrors the real F081/C125 inversion).
    y -= 27
    _draw(c, X_ACTION, y, "Modify using C125 [Comm Loss")
    y -= 13
    _draw(c, X_CODE, y, "F081 DSI Comm Loss 2")
    _draw(c, X_ACTION, y, "Action].")
    y -= 13
    _draw(
        c,
        X_DESC,
        y,
        "Communications between the drive and Modbus master have been interrupted.",
    )

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 2 — parameter GRID layout (520/525).
# ===========================================================================
X_PCODE, X_PNAME, X_MINMAX, X_DISPLAY, X_DEFAULT = 100, 150, 280, 380, 470


def _grid_param_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "Basic Program Group Parameters", font=TITLE_FONT)
    y = 740
    _draw(c, X_PCODE, y, "No.")
    _draw(c, X_PNAME, y, "Parameter")
    _draw(c, X_MINMAX, y, "Min/Max")
    _draw(c, X_DISPLAY, y, "Display/Options")
    _draw(c, X_DEFAULT, y, "Default")

    # P042 — simple single-line row + a purpose line (the easy case).
    y -= 20
    _draw(c, X_PCODE, y, "P042")
    _draw(c, X_PNAME, y, "[Decel Time 1]")
    _draw(c, X_MINMAX, y, "0.00/600.00 s")
    _draw(c, X_DISPLAY, y, "0.01 s")
    _draw(c, X_DEFAULT, y, "10.00 s")
    y -= 13
    _draw(c, X_PNAME, y, "Sets the time for the drive to decel from 0 Hz.")

    # A footnote-DEFINITION line between two real rows, gluing a bracket
    # reference to another id with no space — must not swallow P031 below.
    y -= 20
    _draw(
        c,
        X_PNAME,
        y,
        "(1) When P042 [Decel Time 1] A535[Motor Fdbk Type] is used, this is scaled.",
    )

    # P031 — compound Min/Max wrapping across FOUR lines, code+name mid-span.
    y -= 20
    _draw(c, X_MINMAX, y, "10V (for 200V Drives), 20V")
    y -= 13
    _draw(c, X_PCODE, y, "P031")
    _draw(c, X_PNAME, y, "[Motor NP Volts]")
    _draw(c, X_MINMAX, y, "(for 400V Drives), 25V (for")
    y -= 13
    _draw(c, X_MINMAX, y, "600V Drives)/Drive Rated")
    _draw(c, X_DISPLAY, y, "1V")
    _draw(c, X_DEFAULT, y, "Based on Drive Rating")
    y -= 13
    _draw(c, X_MINMAX, y, "Volts")
    y -= 13
    _draw(c, X_PNAME, y, "Sets the motor nameplate rated volts.")

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 3 — parameter LABELED-BLOCK layout (520/525). Headers are BOLD (real
# param-definition headers are); the C125 -> P045 param<->param cross-reference
# and the quoted-option-with-inline-"(Default)" enum shape are exercised here.
# ===========================================================================
# (kind, text): "title" = bold 12; "header" = bold 9 (a real param header);
# "body" = plain 9.
LABELED_PARAM_PAGE = [
    ("title", "Communications Group"),
    ("header", "C124 [RS485 Node Addr]"),
    ("body", "Sets the Modbus drive node number (address) for the RS-485 port."),
    ("body", "Default: 100"),
    ("body", "Values Min/Max: 1/247"),
    ("body", "Display: 1"),
    ("body", ""),
    ("header", "C125 [Comm Loss Action] Related Parameters: P045"),
    (
        "body",
        "Sets the drive's response to a loss of connection or excessive "
        "communication errors on the RS-485 port.",
    ),
    ("body", '0 "Fault" (Default)'),
    ("body", '1 "Coast Stop" Stops drive using "Coast to stop".'),
    ("body", "Options"),
    ("body", '2 "Stop" Stops drive using P045 [Stop Mode] setting.'),
    ("body", '3 "Continu Last" Drive continues at the last commanded speed.'),
]


def _labeled_param_page(c: canvas.Canvas) -> None:
    y = 740
    for kind, text in LABELED_PARAM_PAGE:
        font = {"title": TITLE_FONT, "header": BOLD, "body": FONT}[kind]
        _draw(c, 100, y, text, font=font)
        y -= 17 if kind == "title" else 13
    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 4 — PowerFlex 40 fault table (circled-digit Fault-Type column).
# Column x-positions echo the real PF40 geometry (Code / Name / dingbat Type
# column / Description / Action). Single-digit codes; the ➀/➁ glyph sits ~3pt
# ABOVE its own code row.
# ===========================================================================
X40_CODE, X40_NAME, X40_DING, X40_DESC, X40_ACTION = 100, 140, 225, 258, 420


def _pf40_fault_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "PF40 Fault Descriptions", font=TITLE_FONT)
    y = 740
    _draw(c, X40_CODE, y, "No.")
    _draw(c, X40_NAME, y, "Fault")
    _draw(c, X40_DESC, y, "Description")
    _draw(c, X40_ACTION, y, "Action")

    # F2 — single-digit code, own dingbat type ➀ (type 1).
    y -= 30
    _draw(c, X40_CODE, y, "F2")
    _draw(c, X40_NAME, y, "Input Fault")
    _draw_dingbat(c, X40_DING, y, DINGBAT_ONE)
    _draw(c, X40_DESC, y, "The remote input interlock is open.")
    _draw(c, X40_ACTION, y, "Check remote wiring.")

    # F3 — single-digit code, own dingbat type ➁ (type 2).
    y -= 30
    _draw(c, X40_CODE, y, "F3")
    _draw(c, X40_NAME, y, "Bus Warning")
    _draw_dingbat(c, X40_DING, y, DINGBAT_TWO)
    _draw(c, X40_DESC, y, "Excessive DC bus voltage ripple.")
    _draw(c, X40_ACTION, y, "Check the input line for imbalance.")

    # F5 / F6 — shared group: the ➁ glyph sits on the FIRST member only; F6 is
    # blank (emitted as unknown "—", the type never fabricated).
    y -= 30
    _draw(c, X40_CODE, y, "F5")
    _draw(c, X40_NAME, y, "Phase A Short")
    _draw_dingbat(c, X40_DING, y, DINGBAT_TWO)
    _draw(c, X40_DESC, y, "A short has been detected between")
    _draw(c, X40_ACTION, y, "Check the motor and drive output")
    y -= 15
    _draw(c, X40_CODE, y, "F6")
    _draw(c, X40_NAME, y, "Phase B Short")
    _draw(c, X40_DESC, y, "two output phases.")
    _draw(c, X40_ACTION, y, "wiring for a short.")

    # F7 — genuinely untyped: no dingbat at all -> emitted as "—", NOT dropped.
    y -= 30
    _draw(c, X40_CODE, y, "F7")
    _draw(c, X40_NAME, y, "Config Reset")
    _draw(c, X40_DESC, y, "Parameters were reset to defaults.")
    _draw(c, X40_ACTION, y, "Clear the fault or cycle power.")

    # F8 — wrapped name ("Heatsink" / "OverTemp"), own dingbat ➀.
    y -= 30
    _draw(c, X40_CODE, y, "F8")
    _draw(c, X40_NAME, y, "Heatsink")
    _draw_dingbat(c, X40_DING, y, DINGBAT_ONE)
    _draw(c, X40_DESC, y, "Heatsink temperature exceeds a")
    _draw(c, X40_ACTION, y, "Check for blocked or dirty fins.")
    y -= 13
    _draw(c, X40_NAME, y, "OverTemp")
    _draw(c, X40_DESC, y, "predefined value.")

    # F9 — single-digit code with a fault -> parameter cross-reference in a
    # multi-line numbered action list ("… Turn off using A205 [Comm Loss …]").
    y -= 30
    _draw(c, X40_CODE, y, "F9")
    _draw(c, X40_NAME, y, "Net Fault")
    _draw_dingbat(c, X40_DING, y, DINGBAT_TWO)
    _draw(c, X40_DESC, y, "The network connection was lost.")
    _draw(c, X40_ACTION, y, "1. Check the network wiring.")
    y -= 13
    _draw(c, X40_ACTION, y, "2. Turn off using A205 [Comm Loss")
    y -= 13
    _draw(c, X40_ACTION, y, "Action].")

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 5 — PowerFlex 40 labeled parameters. PF40 label dialect ("Values
# Default:" + bare "Min/Max:", unit-suffixed), an "Options"-prefixed enum, and
# a plain-Helvetica GRAPH CALLOUT that must be rejected by the bold-header gate.
# ===========================================================================
def _pf40_labeled_param_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "PF40 Advanced Program Group", font=TITLE_FONT)
    y = 730

    # A200 — enum whose FIRST option line is prefixed with the label word
    # "Options"; the default comes from the inline "(Default)" marker.
    _draw(c, 100, y, "A200 [Comm Loss Action] Related Parameters: A201", font=BOLD)
    y -= 13
    _draw(c, 100, y, "Selects the drive's response to a loss of the connection.")
    y -= 13
    _draw(c, 100, y, 'Options 0 "Fault" (Default) Drive will fault and coast to stop.')
    y -= 13
    _draw(c, 100, y, '1 "Coast Stop" Stops drive via coast to stop.')
    y -= 13
    _draw(c, 100, y, '2 "Stop" Stops drive using A201 setting.')

    # A201 — numeric param in the PF40 label dialect: "Values Default: 5.0 Secs"
    # (Values on Default) + bare "Min/Max: 0.1/60.0 Secs", unit-suffixed.
    y -= 20
    _draw(c, 100, y, "A201 [Comm Loss Time] Related Parameters: A200", font=BOLD)
    y -= 13
    _draw(c, 100, y, "Sets the time the drive remains in communication loss.")
    y -= 13
    _draw(c, 100, y, "Values Default: 5.0 Secs")
    y -= 13
    _draw(c, 100, y, "Min/Max: 0.1/60.0 Secs")
    y -= 13
    _draw(c, 100, y, "Display: 0.1 Secs")

    # A299 — a GRAPH CALLOUT drawn in PLAIN Helvetica (NOT bold). Its line
    # matches the header shape and IS on the page (so it would pass
    # cite-integrity), but it is not a real parameter — the bold-header gate must
    # reject it. Generalizes the real PF40 p.71 "A034 [Minimum Freq]" typo.
    y -= 30
    _draw(c, 130, y, "A299 [Phantom Freq]")  # plain Helvetica, indented like a curve label
    y -= 13
    _draw(c, 130, y, "Frequency reference curve callout — not a real parameter.")

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


def main() -> None:
    _register_symbol_font()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=letter)
    for page_fn in (
        _fault_page,
        _grid_param_page,
        _labeled_param_page,
        _pf40_fault_page,
        _pf40_labeled_param_page,
    ):
        page_fn(c)
        c.showPage()
    c.save()
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
