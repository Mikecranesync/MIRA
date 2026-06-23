"""Tests for the citation system — typed evidence that renders as `[Type] statement`."""
from __future__ import annotations

import sys
from pathlib import Path

_EG = Path(__file__).resolve().parents[1]
if str(_EG) not in sys.path:
    sys.path.insert(0, str(_EG))

import citations as cit  # noqa: E402


def test_tag_citation_renders():
    c = cit.tag("conveyor01.status.photoeye_blocked_value_value", "TRUE")
    assert c.etype == cit.EvidenceType.TAG
    assert c.render() == "[Tag] conveyor01.status.photoeye_blocked_value_value = TRUE"
    assert c.ref and c.source


def test_manual_citation_renders():
    c = cit.manual("Conveyor O&M Manual (synthetic)", 42, "7.3 Photoeye Sensors", "…")
    assert c.etype == cit.EvidenceType.MANUAL
    assert "p.42" in c.render()


def test_historical_citation_renders():
    c = cit.historical("photoeye_blocked",
                       {"occurrences": 3, "avg_duration_min": 11, "last_corrective_action": "Cleaned lens"})
    assert c.etype == cit.EvidenceType.HISTORICAL
    assert "3 time(s)" in c.render()
    assert "Cleaned lens" in c.render()


def test_all_evidence_types_exist():
    for t in ("TAG", "ASSET", "MANUAL", "PROCEDURE", "HISTORICAL", "SYNTHETIC_FIXTURE"):
        assert hasattr(cit.EvidenceType, t)
