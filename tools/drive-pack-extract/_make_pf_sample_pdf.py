"""Generate the SYNTHETIC PowerFlex-shaped sample PDF used by the
drive-pack-extract test suite.

Reproducible: ``python _make_pf_sample_pdf.py`` (no network). Reuses the same
PDF-generation library as ``tests/beta/fixtures/_make_gs10_pdf.py`` (reportlab).

This is NOT the real PowerFlex 520-UM001 manual and is never mistaken for
one — every page carries a "SYNTHETIC TEST FIXTURE" footer. None of the
fault descriptions/actions/parameter text below is copied from any licensed
manual; they are original, plausible-sounding text written for this fixture
only.

Unlike the first version of this fixture (which drew tidy, column-collapsed
single lines), this one reproduces the REAL manual's measured messiness by
drawing each logical column as its OWN text object at an EXPLICIT (x, y)
coordinate, so ``pdfplumber.extract_words()`` sees the same kind of
independently-flowing, position-only column separation the real PowerFlex
520-UM001 fault/parameter tables have:

- a fault row's Code/Name/Fault-Type line rendering on a DIFFERENT physical
  line than its own Description (the real manual's F004 row: the
  Description's first line renders ABOVE "F004 UnderVoltage 1", not after it)
- a footnote-parenthesized code (``F015(3)``) and a footnote-parenthesized
  Fault-Type value (``F013 ... 1(2)``)
- an em-dash Fault-Type / action for the "no fault" row (``F000``)
- a SHARED multi-code group whose Fault-Type value renders BETWEEN member
  lines, not after the last one (``F038``/``F039`` close on a bare "2" line,
  but ``F040`` — sharing the same type — still follows)
- a fault whose action says "Modify using C125 [Comm Loss Action]" — with
  the action's own text physically rendering ABOVE its own code line, the
  same inversion the real F081 row has
- a grid parameter whose Min/Max column wraps across FOUR lines while its
  own code+name line renders in the MIDDLE of that span, not at the start
  or end (the real P031 "Motor NP Volts" row)
- a footnote-DEFINITION line that glues a bracket reference to another
  parameter's id with no space (``"A535[Motor"``), positioned between two
  real grid rows, to prove it doesn't swallow the next row's name
- a labeled-block parameter whose enum options render as quoted, one per
  line, with an inline ``"(Default)"`` marker rather than a synthetic
  ``"Options: ..."`` one-liner (the real C125 "Comm Loss Action" shape)
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "fixtures" / "pf_sample.pdf"

SYNTHETIC_FOOTER = "SYNTHETIC TEST FIXTURE — not a licensed manual. drive-pack-extract."

FONT = ("Helvetica", 9)
TITLE_FONT = ("Helvetica-Bold", 12)


def _draw(c: canvas.Canvas, x: float, y: float, text: str, *, bold: bool = False) -> None:
    name, size = TITLE_FONT if bold else FONT
    c.setFont(name, size)
    c.drawString(x, y, text)


# ---------------------------------------------------------------------------
# Page 1 — fault table. Column x-positions echo the real manual's measured
# geometry (Code/Name/Type band far left, Description mid, Action right).
# ---------------------------------------------------------------------------
X_CODE, X_DESC, X_ACTION = 100, 260, 420


def _fault_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "Fault Descriptions", bold=True)
    y = 740
    _draw(c, X_CODE, y, "No.")
    _draw(c, X_CODE + 40, y, "Fault")
    _draw(c, X_DESC, y, "Description")
    _draw(c, X_ACTION, y, "Action")

    # F004 — Description's OWN first line renders ABOVE the code+name+type
    # line (the real manual's actual layout for this exact fault).
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


# ---------------------------------------------------------------------------
# Page 2 — parameter GRID layout. Column x-positions echo the real manual's
# measured geometry (No./Parameter/Min-Max/Display/Default).
# ---------------------------------------------------------------------------
X_PCODE, X_PNAME, X_MINMAX, X_DISPLAY, X_DEFAULT = 100, 150, 280, 380, 470


def _grid_param_page(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "Basic Program Group Parameters", bold=True)
    y = 740
    _draw(c, X_PCODE, y, "No.")
    _draw(c, X_PNAME, y, "Parameter")
    _draw(c, X_MINMAX, y, "Min/Max")
    _draw(c, X_DISPLAY, y, "Display/Options")
    _draw(c, X_DEFAULT, y, "Default")

    # P042 — simple, single-line row + a purpose line (the easy case).
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

    # P031 — compound Min/Max wrapping across FOUR lines, with the code+name
    # line landing in the MIDDLE of that span (the real manual's actual
    # layout for this exact parameter — Min/Max starts two lines above the
    # code line and continues two lines below it).
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


# ---------------------------------------------------------------------------
# Page 3 — parameter LABELED-BLOCK layout (incl. the C125 -> P045 explicit
# param<->param cross-reference, and the real manual's quoted-option-with-
# inline-"(Default)" enum shape rather than a synthetic "Options: ..." line).
# ---------------------------------------------------------------------------
LABELED_PARAM_PAGE = [
    ("title", "Communications Group"),
    ("body", "C124 [RS485 Node Addr]"),
    ("body", "Sets the Modbus drive node number (address) for the RS-485 port."),
    ("body", "Default: 100"),
    ("body", "Values Min/Max: 1/247"),
    ("body", "Display: 1"),
    ("body", ""),
    ("body", "C125 [Comm Loss Action] Related Parameters: P045"),
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
        _draw(c, 100, y, text, bold=(kind == "title"))
        y -= 17 if kind == "title" else 13
    _draw(c, 100, 40, SYNTHETIC_FOOTER)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=letter)
    for page_fn in (_fault_page, _grid_param_page, _labeled_param_page):
        page_fn(c)
        c.showPage()
    c.save()
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
