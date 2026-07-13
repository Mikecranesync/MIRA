"""Tests for the deterministic Telegram renderers (no LLM, no network).

``format_graph_for_telegram`` is the DEFAULT reply — plain-English brief FIRST, in
the 6-part order, readable without decoding IEC tags; it falls back to the map when
a graph has no brief. ``format_map_for_telegram`` is the on-request EXACT list
(tags, terminals, wires, source→destination, confidence, unresolved).
"""

import pytest

pytest.importorskip("pydantic")

from printsense import render  # noqa: E402
from printsense.models import PrintSynthGraph  # noqa: E402


def _graph_no_brief() -> PrintSynthGraph:
    """A read with no brief — exercises the map format + the graceful fallback."""
    return PrintSynthGraph.model_validate(
        {
            "package": {"cabinet": "SCU2", "drawing_no": "AP31971", "sheet": "-3"},
            "devices": [
                {"tag": "-3/F1", "type": "circuit breaker", "detail": "B10A/2pol", "evidence": "F1"},
            ],
            "cables": [{"tag": "-W5471", "evidence": "W5471"}],
            "unresolved": [{"item": "S11 top terminal labels", "status": "unresolved"}],
        }
    )


def _graph_with_brief() -> PrintSynthGraph:
    """A read WITH the typed technician brief (SCU2 sheet 16 shape)."""
    return PrintSynthGraph.model_validate(
        {
            "package": {"cabinet": "SCU2", "drawing_no": "AP31971", "sheet": "16"},
            "devices": [{"tag": "-13/A1", "type": "sensor-monitoring module", "confidence": 0.9}],
            "terminals": [{"tag": "-X4:2"}, {"tag": "-X4:4"}, {"tag": "-X4:6"}],
            "cables": [{"tag": "-W5483", "confidence": 0.8}],
            "brief": {
                "sheet_title": "The signal-output terminal strip of the sensor-monitoring panel (module -13/A1), sheet 16",
                "purpose": "It reports sensor faults and zone occupancy to the DA5 controller.",
                "key_signals": [
                    {"signal": "Sensor Unit 5 broken", "tag": "LOK1", "terminal": "-X4:2", "destination": "DA5 controller (sheet 10.0)", "confidence": 0.9},
                    {"signal": "Sensor Unit 7 broken", "tag": "LOK3", "terminal": "-X4:4", "destination": "DA5 controller (sheet 10.2)", "confidence": 0.9},
                    {"signal": "Zone occupied downstream", "tag": "BEL", "terminal": "-X4:6", "destination": "DA5 controller (sheet 10.5)"},
                ],
                "key_devices": [{"device": "sensor-monitoring / marshalling module", "tag": "-13/A1"}],
                "troubleshooting_example": (
                    "A 'Sensor 7 broken' alarm leaves on terminal -X4:4 and continues to sheet 10.2; "
                    "meter -X4:4 against ground — if open while the sensor is healthy it's a wiring "
                    "fault, not the sensor. The drawing does not show the PLC's reaction."
                ),
                "safety_context": (
                    "This drawing does not establish the terminal-strip voltage; for continuity checks "
                    "de-energize, lock out, and verify absence of voltage first."
                ),
                "unresolved_items": ["Right-side DA5.x destination suffixes are blurred"],
                "detailed_map_available": True,
            },
        }
    )


# ── default reply: plain-English brief first ─────────────────────────────────


def test_default_leads_with_plain_english_not_tags():
    text = render.format_graph_for_telegram(_graph_with_brief())
    first = text.splitlines()[0]
    assert "signal-output terminal strip" in first
    assert not first.startswith("📐")


def test_default_follows_six_part_order():
    text = render.format_graph_for_telegram(_graph_with_brief())
    order = [
        text.index("signal-output terminal strip"),   # 1 title
        text.index("reports sensor faults"),           # 2 purpose
        text.index("🔑 Signals"),                       # 3 signals
        text.index("chasing a fault"),                 # 4 troubleshooting
        text.index("procedure for the measurement"),   # 5 safety/closing
        text.index('Reply "map"'),                     # 6 map hint
    ]
    assert order == sorted(order)


def test_default_lists_ALL_signals_in_plain_english():
    text = render.format_graph_for_telegram(_graph_with_brief())
    for plain in ("Sensor Unit 5 broken", "Sensor Unit 7 broken", "Zone occupied downstream"):
        assert plain in text                     # complete, not a sample


def test_default_signals_list_is_plain_and_never_says_external():
    text = render.format_graph_for_telegram(_graph_with_brief())
    # The SIGNALS list shows plain meaning only — exact terminals live in the map.
    sig_section = text.split("🔑 Signals")[1].split("🩺")[0]
    assert "-X4:2" not in sig_section and "-X4:4" not in sig_section
    assert "• Sensor Unit 7 broken" in sig_section
    # (the troubleshooting example MAY name a terminal — it must identify the source.)
    assert "external" not in text.lower()  # real destinations, no vague 'external'


def test_default_surfaces_unresolved_uncertainty_not_only_in_map():
    text = render.format_graph_for_telegram(_graph_with_brief())
    assert "Couldn't confirm" in text  # uncertainty visible in the DEFAULT, not hidden in the map
    assert "DA5.x destination suffixes are blurred" in text


def test_default_safety_is_measurement_specific_and_has_closing():
    text = render.format_graph_for_telegram(_graph_with_brief())
    assert "does not establish the terminal-strip voltage" in text  # no invented voltage
    assert "de-energize, lock out, and verify absence of voltage" in text
    assert render._CLOSING in text
    assert 'Reply "map"' in text


def test_long_brief_truncates_body_but_never_the_safety_footer():
    """A brief too long for one Telegram message must trim the BODY, never the
    footer: the safety note, measurement closing, uncertainty, and map hint always
    survive. (This is the failure the corpus harness caught on the 9-signal sheet —
    the closing was being dropped when the body overflowed 3500 chars.)"""
    g = _graph_with_brief()
    # Blow the body well past the 3500-char budget with many long signal lines.
    g.brief.key_signals = [
        type(g.brief.key_signals[0])(
            signal=f"Sensor Unit {i} reports a broken feedback loop to the downstream marshalling controller",
            tag=f"LOK{i}",
            terminal=f"-X4:{i}",
            destination=f"DA5 controller (sheet 10.{i})",
        )
        for i in range(60)
    ]
    text = render.format_graph_for_telegram(g)

    assert len(text) <= 3600                                    # still within the Telegram limit
    assert 'reply "map")' in text.lower()                       # the BODY was actually truncated
    # …yet every footer element survived intact:
    assert "de-energize, lock out, and verify absence of voltage" in text  # measurement-specific safety
    assert render._CLOSING in text                              # the closing line
    assert 'Reply "map"' in text                                # the map affordance
    assert "Couldn't confirm" in text                           # uncertainty never dropped
    assert "DA5.x destination suffixes are blurred" in text


# ── on-request map: exact designations, uncertainty kept ─────────────────────


def test_map_has_exact_tag_terminal_destination_confidence():
    text = render.format_map_for_telegram(_graph_with_brief())
    assert "LOK3" in text and "-X4:4" in text          # exact tag + terminal
    assert "DA5 controller (sheet 10.2)" in text        # real destination preserved
    assert "conf 0.90" in text                          # confidence shown
    assert "-W5483" in text                             # wire id
    assert "AP31971" in text and "sheet 16" in text     # grid/sheet ref


def test_map_surfaces_unresolved_never_hidden():
    text = render.format_map_for_telegram(_graph_with_brief())
    assert "Couldn't read" in text
    assert "DA5.x destination suffixes are blurred" in text


def test_no_brief_falls_back_to_map():
    g = _graph_no_brief()
    assert render.format_graph_for_telegram(g) == render.format_map_for_telegram(g)


def test_map_fallback_surfaces_package_devices_unresolved_caveat():
    text = render.format_map_for_telegram(_graph_no_brief())
    assert "SCU2" in text and "AP31971" in text and "sheet -3" in text
    assert "-3/F1" in text and "circuit breaker" in text and "B10A/2pol" in text
    assert "-W5471" in text
    assert "Couldn't read" in text and "S11 top terminal labels" in text
    assert "not yet field-verified" in text


def test_empty_graph_is_safe():
    text = render.format_graph_for_telegram(PrintSynthGraph())
    assert "Electrical print" in text and "not yet field-verified" in text


def test_stays_under_telegram_limit():
    big = PrintSynthGraph.model_validate(
        {"devices": [{"tag": f"-3/D{i}", "type": "device", "detail": "x" * 50} for i in range(200)]}
    )
    assert len(render.format_graph_for_telegram(big)) <= 3600


def test_brief_round_trips_with_typed_signals():
    g = _graph_with_brief()
    assert g.brief is not None and len(g.brief.key_signals) == 3
    dumped = g.model_dump()
    assert dumped["brief"]["key_signals"][1]["signal"] == "Sensor Unit 7 broken"
    assert dumped["brief"]["key_signals"][1]["terminal"] == "-X4:4"
    rt = PrintSynthGraph.model_validate(dumped)
    assert rt.brief.troubleshooting_example.startswith("A 'Sensor 7 broken'")
    assert rt.brief.detailed_map_available is True
