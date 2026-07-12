"""Tests for the deterministic Telegram renderer (no LLM, no network).

``format_graph_for_telegram`` turns a validated ``PrintSynthGraph`` into the
phone-screen reply. It must surface identity, devices, how-it-works, the
unreadable items (never hide them), and ALWAYS the proposed-not-verified caveat.
"""

import pytest

pytest.importorskip("pydantic")

from printsense import render  # noqa: E402
from printsense.models import PrintSynthGraph  # noqa: E402


def _graph() -> PrintSynthGraph:
    return PrintSynthGraph.model_validate(
        {
            "package": {"cabinet": "SCU2", "drawing_no": "AP31971", "sheet": "-3"},
            "devices": [
                {"tag": "-3/F1", "type": "circuit breaker", "detail": "B10A/2pol", "evidence": "F1"},
                {"tag": "-3/E1", "type": "heater", "detail": "250W-115V", "evidence": "Heizung"},
            ],
            "cables": [{"tag": "-W5471", "evidence": "W5471"}],
            "pe_bonds": [{"tag": "-3/PE:1", "type": "pe_bond_terminal"}],
            "functional_paths": [
                {"name": "115VAC heater", "sequence": ["F2", "S10", "S11", "X1", "E1"]}
            ],
            "unresolved": [{"item": "S11 top terminal labels", "status": "unresolved"}],
        }
    )


def test_header_has_package_identity():
    text = render.format_graph_for_telegram(_graph())
    assert "SCU2" in text and "AP31971" in text and "sheet -3" in text


def test_devices_rendered_with_detail():
    text = render.format_graph_for_telegram(_graph())
    assert "-3/F1" in text and "circuit breaker" in text and "B10A/2pol" in text
    assert "-3/E1" in text and "250W-115V" in text


def test_functional_path_shown():
    text = render.format_graph_for_telegram(_graph())
    assert "F2 → S10 → S11 → X1 → E1" in text


def test_unresolved_surfaced_not_hidden():
    text = render.format_graph_for_telegram(_graph())
    assert "Couldn't read" in text
    assert "S11 top terminal labels" in text


def test_trust_caveat_always_present():
    text = render.format_graph_for_telegram(_graph())
    assert "Proposed interpretation" in text and "not yet field-verified" in text


def test_empty_graph_is_safe():
    text = render.format_graph_for_telegram(PrintSynthGraph())
    assert "Electrical print" in text and "Proposed interpretation" in text


def test_stays_under_telegram_limit():
    big = PrintSynthGraph.model_validate(
        {"devices": [{"tag": f"-3/D{i}", "type": "device", "detail": "x" * 50} for i in range(200)]}
    )
    text = render.format_graph_for_telegram(big)
    assert len(text) <= 3600  # _TG_LIMIT + the short truncation marker
