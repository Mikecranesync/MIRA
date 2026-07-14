"""Generate the SYNTHETIC Magnetek-shaped sample PDF for the magnetek_dialect test suite.

Reproducible: ``python _make_magnetek_sample_pdf.py`` (no network). Uses reportlab.

This is NOT a real manual and is never mistaken for one — every page carries a
"SYNTHETIC TEST FIXTURE" footer. None of the text is copied from any licensed manual;
it is original, plausible-sounding text written for this fixture only.

The fixture reproduces the REAL Magnetek IMPULSE G+ Mini manual's geometry:
- Fault pages (pp.135-140): 3-column table with header "Fault | Fault or Indicator
  Name/Description | Corrective Action" (repeating on every page), full-width
  horizontal rules between rows, left-aligned cell text, mnemonics (not numeric codes),
  casing-semantic identifiers.
- Parameter pages (pp.144-173): 6-column listing "Parameter | Parameter Name | Default
  | Range | Units | Page", dotted parameter ids (e.g. H01.18, U01.10), en-dash ranges
  (0.00–150.00), hex enums (00–1F), starred defaults (0.00*).
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "fixtures" / "magnetek_sample.pdf"

SYNTHETIC_FOOTER = "SYNTHETIC TEST FIXTURE — not a licensed manual. drive-pack-extract."

FONT = ("Helvetica", 9)
BOLD = ("Helvetica-Bold", 9)
TITLE_FONT = ("Helvetica-Bold", 12)


def _draw(c: canvas.Canvas, x: float, y: float, text: str, *, font: tuple = FONT) -> None:
    """Draw text at explicit (x, y) coordinate."""
    name, size = font
    c.setFont(name, size)
    c.drawString(x, y, text)


def _draw_horiz_rule(c: canvas.Canvas, x0: float, x1: float, y: float) -> None:
    """Draw a horizontal rule (full-width separator between fault rows)."""
    # Use rect (fill=1, height ~1) so pdfplumber sees it as a rect in page.rects
    c.setLineWidth(0)
    c.rect(x0, y - 0.5, x1 - x0, 1, fill=1)


# ===========================================================================
# Page 1 — Magnetek fault table (3 columns: Fault | Name/Description | Action)
# Header repeats; full-width horizontal rules between rows.
# ===========================================================================
# Column x-positions (reportlab coords, x measured from left margin):
X_FAULT, X_DESC, X_ACTION = 57, 146, 344


def _fault_page_1(c: canvas.Canvas) -> None:
    """First fault page with header, multiple fault rows, and negative test case."""
    _draw(c, 100, 762, "Fault Page (Sample)", font=TITLE_FONT)

    # Header line (centered headers).
    y = 740
    _draw(c, 88, y, "Fault", font=BOLD)
    _draw(c, 167, y, "Fault", font=BOLD)  # First "Fault" of multi-word header
    _draw(c, 200, y, "or", font=BOLD)
    _draw(c, 230, y, "Indicator", font=BOLD)
    # "Name/Description" as ONE word (no space) so extract_words yields it as one token
    _draw(c, 280, y, "Name/Description", font=BOLD)
    _draw(c, 413, y, "Corrective", font=BOLD)
    _draw(c, 483, y, "Action", font=BOLD)

    # Horizontal rule below header.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 1: oC (flashing) with secondary label "Over Current".
    y -= 20
    _draw(c, X_FAULT, y, "oC")
    _draw(c, X_DESC, y, "Over Current Indicator. Indicates excessive motor current.")
    _draw(c, X_ACTION, y, "1. Check motor for locked rotor or binding.")
    y -= 13
    _draw(c, X_FAULT, y, "(flashing)")
    y -= 13
    _draw(c, X_FAULT, y, "Over Current")

    # Horizontal rule below row 1.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 2: LC dn (two tokens, one space) with secondary label "LC Done".
    y -= 20
    _draw(c, X_FAULT, y, "LC dn")  # Two tokens, one space (valid mnemonic)
    _draw(c, X_DESC, y, "Load Chute Door Indicator. Indicates door open state.")
    _draw(c, X_ACTION, y, "1. Close the door.")
    y -= 13
    _draw(c, X_FAULT, y, "LC Done")  # Secondary label, not a code

    # Horizontal rule below row 2.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 3 & 4: Multi-code cells (CPF18 and CPF19 share description/action).
    y -= 20
    _draw(c, X_FAULT, y, "CPF18 and")  # First code line with conjunction
    _draw(c, X_DESC, y, "Capacitor Fault. Excessive capacitor voltage ripple.")
    _draw(c, X_ACTION, y, "1. Reduce input line ripple.")
    y -= 13
    _draw(c, X_FAULT, y, "CPF19")  # Second code line (same row span)
    _draw(c, X_ACTION, y, "2. Replace capacitor if fault persists.")

    # Horizontal rule below rows 3-4.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 5 & 6: Multi-code split across rule (CPF20 and | rule | CPF21).
    y -= 20
    _draw(c, X_FAULT, y, "CPF20 and")  # First code line with conjunction
    _draw(c, X_DESC, y, "Control Power Fault. Inadequate control supply.")
    _draw(c, X_ACTION, y, "1. Check voltage at H01.01.")

    # Horizontal rule below CPF20.
    _draw_horiz_rule(c, 54, 558, y - 3)

    y -= 20
    _draw(c, X_FAULT, y, "CPF21")  # Second code line (PAST the rule)
    # Description/action are shared with CPF20 (carried from above)

    # Horizontal rule below CPF21.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 7 & 8: Two codes sharing ONE ruled span (no rule between them).
    y -= 20
    _draw(c, X_FAULT, y, "oPE02")  # First code
    _draw(c, X_DESC, y, "Output Phase Error. Phase loss on output.")
    _draw(c, X_ACTION, y, "1. Check motor connections at U01.10.")
    y -= 13
    _draw(c, X_FAULT, y, "Uv1")  # Second code (no rule above)
    _draw(c, X_DESC, y, "DC Bus Undervolt Fault. Bus voltage too low.")
    _draw(c, X_ACTION, y, "1. Verify input AC voltage.")

    # Horizontal rule below row 8.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Row 9: lowercase bb (edge case for confusables).
    y -= 20
    _draw(c, X_FAULT, y, "bb")  # Lowercase double-letter
    _draw(c, X_DESC, y, "Base Block Indicator.")
    _draw(c, X_ACTION, y, "1. Reset system.")

    # Horizontal rule below row 9.
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Footer.
    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 1b — VARIABLE action-column x on one page (LL1/LL2 regression).
# A wide-wrapping-name row whose action steps sit far right (x≈400), plus a
# short row whose action sits far left (x≈228). A PAGE-GLOBAL min(step) would
# put the action edge at 228 and slice the wide row's name tail into the action
# band (the real-manual LL1/LL2 garble). The per-row action edge keeps them clean.
# ===========================================================================
X_ACTION_LEFT, X_ACTION_RIGHT = 228, 400


def _fault_page_variable_action(c: canvas.Canvas) -> None:
    _draw(c, 100, 762, "Fault Page (Variable Action Column)", font=TITLE_FONT)
    y = 740
    _draw(c, 88, y, "Fault", font=BOLD)
    _draw(c, 167, y, "Fault", font=BOLD)
    _draw(c, 200, y, "or", font=BOLD)
    _draw(c, 230, y, "Indicator", font=BOLD)
    _draw(c, 280, y, "Name/Description", font=BOLD)
    _draw(c, 413, y, "Corrective", font=BOLD)
    _draw(c, 483, y, "Action", font=BOLD)
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Wide row: name wraps well past X_ACTION_LEFT; its own action is far right.
    y -= 20
    _draw(c, X_FAULT, y, "WL1")
    _draw(c, X_DESC, y, "Wide Overtravel Limit One Indicator. The wide")
    _draw(c, X_ACTION_RIGHT, y, "1. May not require corrective action.")
    y -= 13
    _draw(c, X_DESC, y, "overtravel limit one condition is active.")
    _draw_horiz_rule(c, 54, 558, y - 3)

    # Short row: action far LEFT — this is what a page-global min would latch onto.
    y -= 20
    _draw(c, X_FAULT, y, "SH2")
    _draw(c, X_DESC, y, "Short fault.")
    _draw(c, X_ACTION_LEFT, y, "1. Reset.")
    _draw_horiz_rule(c, 54, 558, y - 3)

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 2 — Negative fault page (NOT a Magnetek fault table).
# Symptom/Corrective Action table WITHOUT "Name/Description" header word.
# Also contains a monitor/trace table with "Monitor | Name | Function | Units".
# ===========================================================================
def _negative_fault_page(c: canvas.Canvas) -> None:
    """Page that looks fault-like but lacks the gate header 'Name/Description'."""
    _draw(c, 100, 762, "Negative Test Page (Symptom Table)", font=TITLE_FONT)

    y = 740
    # Header WITHOUT "Name/Description" — should not match Magnetek gate.
    _draw(c, 100, y, "Symptom", font=BOLD)
    _draw(c, 260, y, "Corrective Action")

    y -= 20
    _draw(c, 100, y, "Motor runs in reverse")
    _draw(c, 260, y, "Check phase wiring at output terminals.")

    # Also a monitor table header to test against false positives.
    y -= 40
    _draw(c, 100, y, "Monitor Table", font=BOLD)
    y -= 20
    _draw(c, 100, y, "Monitor", font=BOLD)
    _draw(c, 180, y, "Name")
    _draw(c, 280, y, "Function")
    _draw(c, 380, y, "Units")

    y -= 20
    _draw(c, 100, y, "U02.01")
    _draw(c, 180, y, "Bus Voltage")
    _draw(c, 280, y, "Real-time monitor")
    _draw(c, 380, y, "V")

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 3 — Magnetek parameter listing (6 columns).
# ===========================================================================
# Header x-positions (centered):
X_PARAM_HDR, X_PNAME_HDR, X_DEFAULT_HDR = 77, 192, 328
# Column x-positions (left-aligned):
X_PARAM, X_PNAME, X_DEFAULT, X_RANGE, X_UNIT, X_PAGE = 57, 146, 332, 390, 462, 514


def _param_page(c: canvas.Canvas) -> None:
    """Parameter listing page with 6 columns and various value formats."""
    _draw(c, 100, 762, "Parameter Listing", font=TITLE_FONT)

    y = 740
    # Header line (6 columns).
    _draw(c, X_PARAM_HDR, y, "Parameter", font=BOLD)
    _draw(c, X_PNAME_HDR, y, "Parameter", font=BOLD)
    _draw(c, X_PNAME_HDR + 55, y, "Name", font=BOLD)
    _draw(c, X_DEFAULT_HDR, y, "Default", font=BOLD)
    _draw(c, 401, y, "Range", font=BOLD)
    _draw(c, 462, y, "Units", font=BOLD)
    _draw(c, 514, y, "Page", font=BOLD)

    # Row 1: H01.01 with en-dash range.
    y -= 20
    _draw(c, X_PARAM, y, "H01.01")
    _draw(c, X_PNAME, y, "Bus Voltage Setup")
    _draw(c, X_DEFAULT, y, "0.00*")  # Starred default
    _draw(c, X_RANGE, y, "0.00–150.00")  # En-dash range
    _draw(c, X_UNIT, y, "V")
    _draw(c, X_PAGE, y, "45")

    # Row 2: B01.18 with tilde range.
    y -= 20
    _draw(c, X_PARAM, y, "B01.18")
    _draw(c, X_PNAME, y, "Baud Rate")
    _draw(c, X_DEFAULT, y, "9600")
    _draw(c, X_RANGE, y, "0000~0001")  # Tilde range
    _draw(c, X_UNIT, y, "bps")
    _draw(c, X_PAGE, y, "67")

    # Row 3: L02.05 with hex range and enum values.
    y -= 20
    _draw(c, X_PARAM, y, "L02.05")
    _draw(c, X_PNAME, y, "Logic Type")
    _draw(c, X_DEFAULT, y, "–")  # Dash default
    _draw(c, X_RANGE, y, "00–1F")  # Hex range
    _draw(c, X_UNIT, y, "-")  # Dash unit (-> None)
    _draw(c, X_PAGE, y, "78")

    # Enum sub-lines for L02.05.
    y -= 13
    _draw(c, X_PNAME, y, "00: Logic AND")
    y -= 13
    _draw(c, X_PNAME, y, "01: Logic OR")
    y -= 13
    _draw(c, X_PNAME, y, "0F: Not Used")

    # Row 4: U01.10 with wrapped name (second line).
    y -= 20
    _draw(c, X_PARAM, y, "U01.10")
    _draw(c, X_PNAME, y, "Undervolt")
    _draw(c, X_DEFAULT, y, "200.0")
    _draw(c, X_RANGE, y, "100.0–400.0")
    _draw(c, X_UNIT, y, "V")
    _draw(c, X_PAGE, y, "89")

    # Wrapped name continuation (only name column filled).
    y -= 13
    _draw(c, X_PNAME, y, "Threshold Setup")

    # Row 5: T05.12 with negative range.
    y -= 20
    _draw(c, X_PARAM, y, "T05.12")
    _draw(c, X_PNAME, y, "Temperature Offset")
    _draw(c, X_DEFAULT, y, "0.0*")
    _draw(c, X_RANGE, y, "–200.0–0.0")  # Negative range
    _draw(c, X_UNIT, y, "°C")
    _draw(c, X_PAGE, y, "102")

    # Footer.
    _draw(c, 100, 40, SYNTHETIC_FOOTER)


# ===========================================================================
# Page 4 — Negative parameter page (prose, NOT a listing header).
# ===========================================================================
def _negative_param_page(c: canvas.Canvas) -> None:
    """Page with parameter mentions in prose, NOT a listing table header."""
    _draw(c, 100, 762, "Negative Test Page (Prose)", font=TITLE_FONT)

    y = 740
    _draw(c, 100, y, "To configure the system, set H01.01 to 5 and verify U01.10.")
    y -= 20
    _draw(c, 100, y, "Then check the following parameters: B01.18, L02.05, T05.12.")
    y -= 20
    _draw(c, 100, y, "These are just parameter references in running text.")

    _draw(c, 100, 40, SYNTHETIC_FOOTER)


def main() -> None:
    """Generate the synthetic Magnetek PDF."""
    c = canvas.Canvas(str(OUT), pagesize=letter)
    c.setTitle("Magnetek IMPULSE Sample PDF — Synthetic Test Fixture")

    _fault_page_1(c)
    c.showPage()

    _negative_fault_page(c)
    c.showPage()

    _param_page(c)
    c.showPage()

    _negative_param_page(c)
    c.showPage()

    # Appended LAST so existing page indices (negative pages at [1] and [3])
    # stay stable for the tests that address pages by index.
    _fault_page_variable_action(c)
    c.showPage()

    c.save()
    print(f"Generated {OUT}")


if __name__ == "__main__":
    main()
