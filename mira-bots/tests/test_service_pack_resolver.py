"""Tests for the service-pack resolver contract (``shared/drive_packs/resolver.py``).

Pure, no-LLM, no-DB, no-network — every case here is a plain function call
against the two real LIVE packs (``durapulse_gs10``, ``powerflex_525``). See
the module docstring in ``resolver.py`` for the resolution order + refusal
rules this locks in.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import PackResolution, resolve_service_pack  # noqa: E402
from shared.drive_packs.resolver import _matching_live_packs  # noqa: E402


def test_explicit_live_pack_id_resolves_high_confidence():
    result = resolve_service_pack(explicit_pack_id="durapulse_gs10")
    assert isinstance(result, PackResolution)
    assert result.pack_id == "durapulse_gs10"
    assert result.confidence == "high"
    assert result.source == "pack_id"
    assert not result.ambiguous


def test_explicit_candidate_pack_id_is_rejected_not_live():
    """A candidate/unpromoted pack id (not in list_packs()) always refuses —
    there is no runtime candidate loader."""
    result = resolve_service_pack(explicit_pack_id="powerflex_40")
    assert result.pack_id is None
    assert result.confidence == "none"
    assert result.source == "pack_id"
    assert "not an approved" in result.reason


def test_question_names_the_drive_directly():
    """A fault code in the question (CE10) must NOT itself resolve a pack —
    only the 'gs10' drive-name token does."""
    result = resolve_service_pack(question="what does CE10 mean on my gs10")
    assert result.pack_id == "durapulse_gs10"
    assert result.source == "question"
    assert result.confidence == "high"


def test_fault_code_only_question_falls_through_to_asset_signal():
    """A fault-code-only question (no drive named) has 0 matches and falls
    through to the next signal (asset_make_model) rather than derailing on
    the fault code."""
    result = resolve_service_pack(
        question="what does CE10 mean",
        asset_make_model="AutomationDirect GS10",
    )
    assert result.pack_id == "durapulse_gs10"
    assert result.source == "asset"
    assert result.confidence == "medium"


def test_manufacturer_only_asset_refuses_and_asks_for_model():
    result = resolve_service_pack(asset_make_model="AutomationDirect")
    assert result.pack_id is None
    assert result.confidence == "none"
    assert "model" in result.reason.lower() or "series" in result.reason.lower()


def test_manufacturer_only_ambiguous_is_a_real_case_not_synthetic():
    """Two live packs are both nameable in one string ('GS10' + 'PowerFlex
    525' are both real family aliases) — this proves ambiguity detection
    against the REAL two-pack corpus, no synthetic fixture needed."""
    matches = _matching_live_packs("which is it, GS10 or PowerFlex 525?")
    assert len(matches) > 1

    result = resolve_service_pack(question="which is it, GS10 or PowerFlex 525?")
    assert result.ambiguous is True
    assert result.pack_id is None
    assert result.confidence == "none"


def test_nameplate_manufacturer_and_model_resolves_medium_confidence():
    result = resolve_service_pack(nameplate={"manufacturer": "AutomationDirect", "model": "GS10"})
    assert result.pack_id == "durapulse_gs10"
    assert result.source == "nameplate"
    assert result.confidence == "medium"


def test_nameplate_unknown_drive_refuses_source_none():
    result = resolve_service_pack(nameplate={"manufacturer": "Unknown", "model": "XYZ999"})
    assert result.pack_id is None
    assert result.source == "none"


def test_no_signals_at_all_refuses_with_helpful_reason():
    result = resolve_service_pack()
    assert result.pack_id is None
    assert result.source == "none"
    assert "name the drive" in result.reason.lower() or "nameplate" in result.reason.lower()


def test_never_raises_on_malformed_nameplate():
    result = resolve_service_pack(nameplate={"manufacturer": None, "model": None})
    assert result.pack_id is None


def test_to_dict_round_trips():
    result = resolve_service_pack(explicit_pack_id="durapulse_gs10")
    d = result.to_dict()
    assert d["pack_id"] == "durapulse_gs10"
    assert d["source"] == "pack_id"
