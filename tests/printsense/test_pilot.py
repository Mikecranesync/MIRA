"""Pilot package record (commercial PR-5)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense.pilot import POSITIONING, PilotPackage, ProcessingScope  # noqa: E402


def _pilot():
    return PilotPackage(customer="Example Co", machine="conveyor line",
                        processing_scope=ProcessingScope(
                            pages_estimate=120, review_hours_estimate=4))


def test_positioning_fixed_and_reconstruction_unsupported():
    p = _pilot()
    assert p.positioning == POSITIONING
    assert any("reconstruction" in u for u in p.unsupported_capabilities)
    assert "does not replace engineering review" in p.summary()


def test_scope_and_pricing_fields():
    p = _pilot()
    assert p.processing_scope.pages_estimate == 120
    assert p.pricing.intro_price_usd is None  # set per deal, never implied
    with pytest.raises(Exception):
        ProcessingScope(pages_estimate=0, review_hours_estimate=1)


def test_extra_fields_forbidden():
    with pytest.raises(Exception):
        PilotPackage(customer="x", machine="y",
                     processing_scope=ProcessingScope(
                         pages_estimate=1, review_hours_estimate=1),
                     secret_upsell=True)
