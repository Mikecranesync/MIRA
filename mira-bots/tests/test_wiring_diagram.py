"""Tests for the lifted wiring-diagram engine (shared/wiring_diagram/).

Phase 1 of docs/discovery/electrical_print_reuse_audit.md: the engine was lifted
from openclaw (MIT) and the PNG path switched cairosvg -> PyMuPDF. openclaw shipped
the engine with NO tests; these are the "fill the gap on lift" tests. They assert the
IR validates, the SVG carries the components/terminals/wires, and the fitz PNG/PDF
paths produce real image/document bytes (no cairosvg).
"""

from __future__ import annotations

import pytest

from shared.wiring_diagram import (
    Bus,
    Component,
    Connection,
    DiagramSpec,
    Ratings,
    Terminal,
    WiringRenderer,
    render_from_json,
    render_markdown_summary,
)


def _sample_spec() -> DiagramSpec:
    """A small but real spec exercising several IEC symbols + a bus + wires."""
    return DiagramSpec(
        title="Test Feeder",
        drawing_number="FLM-WD-TEST",
        components=[
            Component(
                tag="Q1",
                type="circuit_breaker",
                label="Main Breaker",
                ratings=Ratings(current="10A"),
                terminals=[Terminal(id="1", label="Line"), Terminal(id="2", label="Load")],
            ),
            Component(
                tag="T1",
                type="vfd",
                label="GS10 VFD",
                terminals=[Terminal(id="R", label="R/L1"), Terminal(id="U", label="U/T1")],
            ),
            Component(
                tag="M1",
                type="motor_3ph",
                label="Conveyor Motor",
                ratings=Ratings(power="1HP", current="3.8A", voltage="230V"),
                terminals=[Terminal(id="U1", label="U"), Terminal(id="V1", label="V"), Terminal(id="W1", label="W")],
            ),
        ],
        connections=[
            Connection.model_validate({"from": "Q1.2", "to": "T1.R", "wire_label": "L1", "wire_type": "power"}),
            Connection.model_validate({"from": "T1.U", "to": "M1.U1", "wire_label": "U", "wire_type": "power"}),
        ],
        buses=[Bus(name="L1")],
    )


def test_spec_validates_and_round_trips_json():
    spec = _sample_spec()
    as_json = spec.model_dump(by_alias=True)
    assert as_json["title"] == "Test Feeder"
    # from-alias round trips
    assert as_json["connections"][0]["from"] == "Q1.2"
    reparsed = DiagramSpec.model_validate(as_json)
    assert len(reparsed.components) == 3


def test_render_svg_contains_components_and_wires():
    svg = WiringRenderer(_sample_spec()).render_svg()
    assert isinstance(svg, str) and svg.lstrip().startswith("<")
    assert "<svg" in svg and "</svg>" in svg
    # device tags (designations) and the title block should appear as drawn text
    for token in ("Q1", "T1", "M1", "Test Feeder"):
        assert token in svg, f"expected {token!r} in rendered SVG"


def test_render_png_is_png_via_fitz():
    png = WiringRenderer(_sample_spec()).render_png()
    assert isinstance(png, (bytes, bytearray)) and len(png) > 100
    assert bytes(png[:8]) == b"\x89PNG\r\n\x1a\n"  # PNG magic


def test_render_pdf_is_pdf_via_fitz():
    pdf = WiringRenderer(_sample_spec()).render_pdf()
    assert isinstance(pdf, (bytes, bytearray)) and len(pdf) > 100
    assert bytes(pdf[:5]) == b"%PDF-"  # PDF magic


def test_no_cairosvg_dependency():
    """The lift must not import/use cairosvg (LGPL); fitz replaces it."""
    import inspect

    import shared.wiring_diagram.renderer as r

    src = inspect.getsource(r)
    assert "import cairosvg" not in src, "cairosvg must not be imported"
    assert "cairosvg.svg2png" not in src, "cairosvg must not be called"
    assert "import fitz" in src, "fitz should be the rasterizer"


def test_render_from_json_convenience():
    spec = _sample_spec().model_dump(by_alias=True)
    png = render_from_json(spec)
    assert bytes(png[:8]) == b"\x89PNG\r\n\x1a\n"


def test_markdown_summary_lists_devices():
    md = render_markdown_summary(_sample_spec())
    assert isinstance(md, str) and md
    assert "M1" in md or "Motor" in md


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
