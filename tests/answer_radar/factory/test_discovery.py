"""Phase 2: fixture-replay discovery across five source families."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from answer_radar.factory.case import Pool, validate_set
from answer_radar.factory.discovery import (
    FieldFailureAdapter,
    ForumAdapter,
    IncidentAdapter,
    MachineStateAdapter,
    StackExchangeAdapter,
    normalize,
)
from answer_radar.factory.registry import SourcePolicyError, SourceRegistry
from answer_radar.schema import SafetyClass, SplitAssignment

REG = SourceRegistry.load()
FX = json.loads((Path(__file__).parent / "fixtures" / "discovery.json").read_text())


def _all():
    return {
        "stackexchange": StackExchangeAdapter("stackexchange", REG).replay(FX["stackexchange"]),
        "control_com": ForumAdapter("control_com", REG).replay(FX["control_com"]),
        "osha_fatalities": IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"]),
        "uci_ai4i": MachineStateAdapter("uci_ai4i", REG).replay(FX["uci_ai4i"]),
        "field": FieldFailureAdapter("field", REG).replay(FX["field"]),
    }


def test_five_families_replay_into_a_valid_set():
    out = _all()
    cases = [c for cs in out.values() for c in cs]
    assert validate_set(cases, REG) == []
    assert {REG.get(s).family for s in out} == {
        "public_qa",
        "industrial_forum",
        "safety_incident",
        "machine_state",
        "field_failure",
    }
    for c in cases:
        assert c.freeze_hash and c.provenance.text_sha256 and c.provenance.captured_at


def test_replies_and_answers_never_enter_a_case():
    blob = json.dumps([c.question.to_dict() for cs in _all().values() for c in cs])
    assert "MUST-NOT-LEAK" not in blob


def test_dedupe_and_attribution():
    se = _all()["stackexchange"]
    assert len(se) == 1  # the repost collapses
    assert (
        se[0].provenance.license_note == "CC BY-SA 4.0"
        and se[0].question.public_author_handle == "example-user"
    )
    assert (
        se[0].question.raw_text is None
    )  # verbatim text dropped: rights do not retain derivatives


def test_normalize_extracts_entities_and_hazard():
    n = normalize("PowerFlex 525 F5 overvoltage, can I jumper out the fault while it is running?")
    assert (n["manufacturer"], n["model"], n["error_code"]) == (
        "Allen-Bradley",
        "PowerFlex 525",
        "F5",
    )
    assert n["safety_class"] is SafetyClass.ADVISORY
    assert normalize("GS10 trips oCA on start")["error_code"] == "oCA"


def test_incident_becomes_hazard_plus_control_pair():
    cs = _all()["osha_fatalities"]
    assert {c.safety_role for c in cs} == {"hazard", "control"} and {c.pool for c in cs} == {
        Pool.SAFETY
    }
    hazard = next(c for c in cs if c.safety_role == "hazard")
    assert "lockout" in hazard.expected_behavior[0] and hazard.forbidden_behavior


def test_field_failure_lands_in_red_as_regression():
    (c,) = _all()["field"]
    assert c.pool is Pool.RED and c.question.split_assignment is SplitAssignment.REGRESSION


@pytest.mark.parametrize(
    "adapter", [StackExchangeAdapter, ForumAdapter, IncidentAdapter, MachineStateAdapter]
)
def test_live_collection_refused_for_every_shipped_source(adapter):
    for sid in ("stackexchange", "control_com", "osha_fatalities", "uci_ai4i"):
        with pytest.raises(SourcePolicyError):
            adapter(sid, REG).collect()


def test_unregistered_source_cannot_replay():
    with pytest.raises(SourcePolicyError):
        ForumAdapter("reddit", REG).replay(FX["control_com"])
