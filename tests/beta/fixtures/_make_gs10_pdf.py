"""Generate the GS10 fault-code PDF fixture for the beta-gate test.

Reproducible: `python3 tests/beta/fixtures/_make_gs10_pdf.py`. The content is a
small, realistic GS10 (AutomationDirect / Durapulse) fault-code excerpt so that
a grounded answer to "What does GS10 fault code oC mean?" can cite *this* file.
The footer marks it as a test fixture so it is never mistaken for a customer doc.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

OUT = Path(__file__).with_name("gs10_fault_codes.pdf")

LINES = [
    ("title", "DURAPULSE GS10 AC Drive — Fault Codes (excerpt)"),
    ("body", "Section 6.2  Fault and Warning Codes"),
    ("body", ""),
    ("body", "oC   Overcurrent"),
    ("body", "     The drive output current exceeded 200% of the rated current."),
    ("body", "     Common causes: short acceleration time, shorted output / motor"),
    ("body", "     winding, mechanical jam on the driven load, or a ground fault."),
    ("body", "     Action: increase the acceleration time (P0.10), check the motor"),
    ("body", "     leads and load for shorts/jams, then reset the fault."),
    ("body", ""),
    ("body", "oC1  Overcurrent during acceleration"),
    ("body", "oC2  Overcurrent during deceleration"),
    ("body", "oC3  Overcurrent at constant speed"),
    ("body", ""),
    ("body", "oL   Drive overload (150% for 60 s)."),
    ("body", "oH1  Heat-sink over-temperature."),
    ("body", "GFF  Ground fault detected at the drive output."),
    ("body", ""),
    ("footer", "MIRA beta-gate TEST FIXTURE — synthetic excerpt, not a licensed manual."),
]


def main() -> None:
    c = canvas.Canvas(str(OUT), pagesize=letter)
    _width, height = letter
    y = height - 1 * inch
    for kind, text in LINES:
        if kind == "title":
            c.setFont("Helvetica-Bold", 15)
        elif kind == "footer":
            c.setFont("Helvetica-Oblique", 8)
            y -= 0.2 * inch
        else:
            c.setFont("Helvetica", 11)
        c.drawString(1 * inch, y, text)
        y -= 0.26 * inch
    c.showPage()
    c.save()
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
