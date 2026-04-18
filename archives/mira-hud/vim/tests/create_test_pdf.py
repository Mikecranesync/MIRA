"""Generate synthetic test PDFs for tm_parser testing.

Creates sample_tm.pdf with known content:
- Page 1: Title page with TM number and distribution statement
- Page 2: Text content with section headings
- Page 3: WARNING and CAUTION blocks
- Page 4: PMCS table
- Page 5: Callout/parts table with NSNs

Also creates text_only_tm.pdf (no images, no tables) for edge-case testing.

Usage:
    uv run --with fpdf2 python -m vim.tests.create_test_pdf
"""

from __future__ import annotations

from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _create_sample_tm(output_path: Path) -> None:
    """Generate a 5-page synthetic TM PDF."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    # --- Page 1: Title page ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 24)
    pdf.cell(0, 20, "TECHNICAL MANUAL", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 15, "TM 55-1520-240-23", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 14)
    pdf.cell(
        0,
        10,
        "AVIATION UNIT AND INTERMEDIATE MAINTENANCE MANUAL",
        new_x="LMARGIN",
        new_y="NEXT",
        align="C",
    )
    pdf.cell(0, 10, "ARMY MODEL CH-47D HELICOPTER", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(20)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0,
        8,
        "DISTRIBUTION STATEMENT A: Approved for public release; distribution is unlimited.",
        new_x="LMARGIN",
        new_y="NEXT",
        align="C",
    )
    pdf.ln(10)
    pdf.cell(0, 8, "HEADQUARTERS, DEPARTMENT OF THE ARMY", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.cell(0, 8, "15 MARCH 2020", new_x="LMARGIN", new_y="NEXT", align="C")

    # --- Page 2: Text content with sections ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "CHAPTER 2 - AIRFRAME", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "2.1 General Description", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "The airframe consists of the fuselage, sponsons, pylons, and "
        "empennage. The fuselage is a conventional semi-monocoque structure "
        "with aluminum alloy skin, frames, stringers, and longerons. The "
        "lower fuselage section provides structural support for the landing "
        "gear, cargo hook, and cabin floor. The upper fuselage supports the "
        "forward and aft transmission mounting structures. All major structural "
        "components are connected by high-strength fasteners and are designed "
        "for field-level replacement. Corrosion protection is provided by "
        "chromate primers and polyurethane topcoat in accordance with "
        "MIL-PRF-85285.",
    )
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "2.2 Fuel System", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "The fuel system consists of fuel cells, fuel boost pumps, fuel "
        "transfer pumps, fuel quantity indicating system, and associated "
        "plumbing. The system has a total usable capacity of 1,030 gallons "
        "distributed across forward and aft cell groups. Each cell group "
        "contains a sump with a boost pump that supplies fuel to the "
        "engines through a common manifold. A crossfeed valve allows "
        "either engine to draw from both cell groups. The fuel quantity "
        "indicating system provides continuous level monitoring through "
        "capacitance-type probes in each cell. Fuel temperature is monitored "
        "at the engine inlet to detect potential icing conditions.",
    )

    # --- Page 3: WARNING and CAUTION blocks ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "2.3 Safety Precautions", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    # WARNING block
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(255, 0, 0)
    pdf.cell(0, 8, "WARNING", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "Ensure main rotor brake is engaged and rotor head is secured "
        "before performing any maintenance on the rotor system. Failure "
        "to do so may result in serious injury or death from unexpected "
        "rotor movement.",
    )
    pdf.ln(5)

    # CAUTION block
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(255, 165, 0)
    pdf.cell(0, 8, "CAUTION", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "Do not apply more than 150 ft-lbs torque to main rotor head "
        "retention bolts. Over-torquing may cause bolt failure during "
        "flight operations.",
    )
    pdf.ln(5)

    # NOTE block
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "NOTE", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "Refer to TM 55-1520-240-23P for part numbers and national "
        "stock numbers referenced in this chapter.",
    )
    pdf.ln(5)

    # Another WARNING
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(255, 0, 0)
    pdf.cell(0, 8, "WARNING", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "Hydraulic fluid (MIL-PRF-83282) is flammable. Do not use near "
        "open flame or heat sources. Ensure fire extinguisher is available "
        "when servicing the hydraulic system.",
    )

    # --- Page 4: PMCS table ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "TABLE 2-1. PMCS FOR AIRFRAME", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 9)

    # Table header
    col_widths = [15, 25, 80, 55]
    headers = ["Item", "Interval", "Procedure", "Not Fully Mission Capable If"]
    for i, header in enumerate(headers):
        pdf.cell(col_widths[i], 8, header, border=1)
    pdf.ln()

    # Table rows
    pdf.set_font("Helvetica", "", 8)
    pmcs_rows = [
        ["1", "Before", "Check engine oil level on sight gauge.", "Oil below ADD mark"],
        ["2", "Before", "Inspect fuel cells for leaks, damage, or staining.", "Any leak detected"],
        [
            "3",
            "During",
            "Monitor engine instruments for abnormal readings.",
            "Any parameter in caution range",
        ],
        [
            "4",
            "After",
            "Inspect airframe for battle damage or bird strike.",
            "Structural damage found",
        ],
        [
            "5",
            "Weekly",
            "Check corrosion protection on all exposed surfaces.",
            "Corrosion exceeding limits",
        ],
    ]
    for row in pmcs_rows:
        max_h = 8
        for i, cell_text in enumerate(row):
            pdf.cell(col_widths[i], max_h, cell_text[:40], border=1)
        pdf.ln()

    # --- Page 5: Callout / parts table ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "TABLE 2-2. PARTS LIST - FUEL SYSTEM", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 9)

    col_widths_parts = [15, 50, 40, 45]
    part_headers = ["Item", "Nomenclature", "Part Number", "NSN"]
    for i, header in enumerate(part_headers):
        pdf.cell(col_widths_parts[i], 8, header, border=1)
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    parts_rows = [
        ["1", "Bolt, hex head", "MS90725-62", "5306-00-225-8755"],
        ["2", "Washer, flat", "AN960-816L", "5310-00-167-0275"],
        ["3", "Fuel boost pump", "206-062-536-003", "2915-01-100-8754"],
        ["4", "O-ring seal", "MS29513-236", "5331-00-282-0563"],
        ["5", "Fuel cell assembly", "145K1200-47", "1560-01-234-5678"],
    ]
    for row in parts_rows:
        for i, cell_text in enumerate(row):
            pdf.cell(col_widths_parts[i], 8, cell_text, border=1)
        pdf.ln()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))


def _create_text_only_tm(output_path: Path) -> None:
    """Generate a text-only TM PDF (no images, no tables)."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    # Title page
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 15, "TM 9-2320-280-10", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 10, "OPERATOR MANUAL FOR HMMWV", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0,
        8,
        "DISTRIBUTION STATEMENT A: Approved for public release.",
        new_x="LMARGIN",
        new_y="NEXT",
        align="C",
    )

    # Content page
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "CHAPTER 1 - INTRODUCTION", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5,
        "This manual provides operating instructions for the High Mobility "
        "Multipurpose Wheeled Vehicle (HMMWV) series. The HMMWV is a "
        "1-1/4 ton, 4x4, diesel-powered tactical vehicle designed for "
        "combat, combat support, and combat service support roles. The "
        "vehicle features a full-time four-wheel drive system with "
        "independent suspension and a centralized tire inflation system. "
        "The powertrain consists of a 6.5L turbocharged diesel engine "
        "mated to a 4-speed automatic transmission with a 2-speed "
        "transfer case providing high and low ranges.",
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))


def main() -> None:
    sample_path = FIXTURES_DIR / "sample_tm.pdf"
    _create_sample_tm(sample_path)
    print(f"Created: {sample_path}")

    text_only_path = FIXTURES_DIR / "text_only_tm.pdf"
    _create_text_only_tm(text_only_path)
    print(f"Created: {text_only_path}")


if __name__ == "__main__":
    main()
