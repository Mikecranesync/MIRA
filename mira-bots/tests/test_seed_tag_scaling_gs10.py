"""Seed↔reader contract lock for the GS10 DC-bus activation seed.

`tools/seeds/tag_scaling_gs10.sql` writes `tag_entities.scaling` (+ units) for
the bench GS10 DC-bus tag so `ignition_chat.py` renders the analog assessment
card on a live CV-101 turn (Drive Commander scaling contract, PR #2487). The
card only fires if the JSON the seed writes is EXACTLY what the reader
(`shared.wire_scaling.from_jsonb` → `shared.live_snapshot.assess_analog_from_paths`)
expects. This test parses the real values out of the seed SQL and drives them
through the reader, so a drift between the seed shape and the reader is caught
in CI — not discovered inert on the bench.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

from shared.live_snapshot import (  # noqa: E402
    _ANALOG_ENVELOPE_DATAPOINTS,
    assess_analog_from_paths,
)
from shared.wire_scaling import from_jsonb  # noqa: E402

_SEED = Path(__file__).resolve().parents[2] / "tools" / "seeds" / "tag_scaling_gs10.sql"
_SEED_SQL = _SEED.read_text(encoding="utf-8")


def _seed_value(pattern: str) -> str:
    m = re.search(pattern, _SEED_SQL)
    assert m, f"seed SQL missing expected literal: {pattern}"
    return m.group(1)


# Values pulled straight from the seed file — the test asserts on what ships.
SCALING_JSON = _seed_value(r"scaling\s*=\s*'(\{[^']*\})'::jsonb")
UNITS = _seed_value(r"units\s*=\s*'([^']+)'")
SOURCE_ADDRESS = _seed_value(r"source_address\s*=\s*'(\[default\][^']+)'")


def test_seed_scaling_json_is_the_reader_contract():
    """The seed's scaling literal parses into an explicit raw_register contract."""
    scaling = from_jsonb(json.loads(SCALING_JSON), unit=UNITS)
    assert scaling.mode == "raw_register"
    assert scaling.scale == 0.1
    assert scaling.unit == "V"


def test_seed_targets_an_assessable_analog_leaf():
    """The seeded tag's leaf must be an envelope-covered datapoint, or no card
    can ever render regardless of scaling."""
    leaf = SOURCE_ADDRESS.rsplit("/", 1)[-1]
    assert leaf == "vfd_dc_bus"
    assert leaf in _ANALOG_ENVELOPE_DATAPOINTS


def test_seeded_row_renders_live_dc_bus_card():
    """End-to-end: the exact seed values + a live raw reading of 3200 (÷10 =
    320 V) render the in-band DC-bus card the bench turn is meant to show."""
    scaling = from_jsonb(json.loads(SCALING_JSON), unit=UNITS)
    out = assess_analog_from_paths(
        {SOURCE_ADDRESS: {"value": "3200"}},
        {SOURCE_ADDRESS: scaling},
    )
    assert out is not None
    assert "DC bus: 320 V" in out
    assert "Source value: 3200" in out
    assert "×0.1" in out
    assert "Normal band: 300–340 V" in out
    assert "Assessment: normal" in out


def test_seed_promotes_to_verified():
    """The enrichment SELECT reads only approval_state='verified' rows, so the
    seed must land the row verified or the card stays dark."""
    assert re.search(r"approval_state\s*=\s*'verified'", _SEED_SQL)
