"""Tests for shared.visual.equipment.resolve_equipment — the safety-critical
per-signal independent resolution + cross-signal conflict detection algorithm.

Pure, hermetic, no DB, no LLM, no network — resolve_equipment is a pure
function of its inputs plus the on-disk pack corpus (durapulse_gs10,
powerflex_40, powerflex_525; verified via list_packs()/load_pack() below,
same as shared/tests/test_service_pack_resolver.py does for the resolver it
wraps).

Fixture match strings were verified against the REAL shipped packs by reading
each pack.json's family.aliases / nameplate.match_keywords directly (not
guessed):
  - durapulse_gs10: aliases/keywords include "GS10", "DURApulse"/"DURAPULSE",
    "GS-10", "GS11N", "GS13N".
  - powerflex_40:   aliases/keywords include "powerflex 40", "pf40", "pf 40",
    "powerflex 22b", "22b", "22b-um001".
  - powerflex_525:  aliases/keywords include "powerflex 525", "pf525",
    "pf 525", "powerflex 520-series", "520-series", "520-um001", "25b".

Note on fixture (8) "multiple candidates": the spec's suggested bare
"PowerFlex" is NOT actually ambiguous against the real match strings above —
neither pack lists the bare word "PowerFlex" as an alias/keyword (both
require "40"/"525" or an equivalent qualifier), so a nameplate model of
literally "PowerFlex" resolves to NONE, not AMBIGUOUS (see
test_bare_powerflex_is_honestly_none_not_ambiguous below, which proves this
rather than asserting it silently). Per the spec's own escape hatch ("pick a
different genuinely-ambiguous signal, or document why case (8) uses a crafted
keyword"), the AMBIGUOUS fixture instead uses a crafted compound string
naming BOTH real PowerFlex models in one field — mirroring the exact pattern
the existing resolver test suite already uses for its own ambiguity case
(test_manufacturer_only_ambiguous_is_a_real_case_not_synthetic in
test_service_pack_resolver.py: "which is it, GS10 or PowerFlex 525?").
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import list_packs, load_pack  # noqa: E402
from shared.visual.equipment import (  # noqa: E402
    EquipmentResolution,
    PackCandidate,
    resolve_equipment,
)

# ── verify the fixture match strings against the real shipped packs ────────


def test_shipped_packs_are_exactly_the_three_expected():
    assert list_packs() == ["durapulse_gs10", "powerflex_40", "powerflex_525"]


def test_gs10_pack_aliases_include_gs11n_the_fixture_relies_on():
    pack = load_pack("durapulse_gs10")
    aliases_upper = {a.upper() for a in pack.family.aliases}
    assert "GS11N" in aliases_upper


def test_bare_powerflex_is_honestly_none_not_ambiguous():
    """Documents (rather than assumes) why fixture (8) below uses a crafted
    compound string instead of the bare word 'PowerFlex'."""
    resolution = resolve_equipment(nameplate={"model": "PowerFlex"})
    assert resolution.status == "NONE"


# ── (1) GS10/GS11 nameplate -> RESOLVED durapulse_gs10 ──────────────────────


def test_gs11_nameplate_resolves_durapulse_gs10():
    resolution = resolve_equipment(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"}
    )
    assert resolution.status == "RESOLVED"
    assert resolution.pack_id == "durapulse_gs10"
    assert resolution.needs_context is None
    assert len(resolution.candidates) == 1
    assert resolution.candidates[0].pack_id == "durapulse_gs10"
    assert resolution.candidates[0].confidence in ("high", "medium")


# ── (2) PowerFlex 40 -> RESOLVED powerflex_40 ───────────────────────────────


def test_powerflex_40_nameplate_resolves_powerflex_40():
    resolution = resolve_equipment(
        nameplate={"manufacturer": "Rockwell Automation", "model": "PowerFlex 40"}
    )
    assert resolution.status == "RESOLVED"
    assert resolution.pack_id == "powerflex_40"


# ── (3) PowerFlex 525 (model only) -> RESOLVED powerflex_525 ───────────────


def test_powerflex_525_model_only_resolves_powerflex_525():
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 525"})
    assert resolution.status == "RESOLVED"
    assert resolution.pack_id == "powerflex_525"


# ── (4) incomplete {model:"GS"} -> NONE/NEEDS_CONTEXT ───────────────────────


def test_incomplete_model_fragment_yields_none_with_model_specific_message():
    resolution = resolve_equipment(nameplate={"model": "GS"})
    assert resolution.status == "NONE"
    assert resolution.pack_id is None
    assert resolution.candidates == []
    assert resolution.needs_context == "model 'GS' isn't a supported drive yet"


# ── (5) conflicting drive_name="GS10" + nameplate model="PowerFlex 525" ────


def test_conflicting_signals_refuse_never_silently_pick_one():
    """The safety-critical crux: a technician-typed drive_name disagrees with
    the photographed nameplate. Must NEVER silently resolve to either."""
    resolution = resolve_equipment(
        drive_name="GS10",
        nameplate={"model": "PowerFlex 525"},
    )
    assert resolution.status == "CONFLICTING"
    assert resolution.pack_id is None
    candidate_ids = {c.pack_id for c in resolution.candidates}
    assert candidate_ids == {"durapulse_gs10", "powerflex_525"}
    assert "disagree" in resolution.needs_context
    assert (
        "durapulse_gs10" in resolution.needs_context
        or "'durapulse_gs10'" in resolution.needs_context
    )
    assert "powerflex_525" in resolution.needs_context
    assert "glare-free photo" in resolution.needs_context


def test_conflicting_candidates_are_sorted_by_pack_id():
    resolution = resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
    ids = [c.pack_id for c in resolution.candidates]
    assert ids == sorted(ids)


# ── (6) unreadable / parse_error is a session_service-level concern ────────
# (see test_visual_equipment_session.py — resolve_equipment itself never
# receives a parse_error dict from the real ingest path, but is still robust
# to one; covered by test_parse_error_shaped_nameplate_degrades_to_none below.)


def test_parse_error_shaped_nameplate_degrades_to_none_never_raises():
    resolution = resolve_equipment(nameplate={"parse_error": "unparseable", "raw_text": "garbage"})
    assert resolution.status == "NONE"
    assert resolution.pack_id is None


# ── (7) unsupported manufacturer/model -> NONE ──────────────────────────────


def test_unsupported_manufacturer_yields_none():
    resolution = resolve_equipment(nameplate={"manufacturer": "Siemens", "model": "S120"})
    assert resolution.status == "NONE"
    assert resolution.pack_id is None
    assert resolution.candidates == []


# ── (8) multiple candidates -> AMBIGUOUS (powerflex_40 + powerflex_525) ────


def test_ambiguous_between_the_two_powerflex_packs():
    """Crafted compound model string (see module docstring) — a real
    technician would not type this verbatim, but it proves resolve_equipment
    surfaces BOTH real candidates rather than picking one, exactly the
    behavior the safety-critical rule requires when a signal is genuinely
    ambiguous."""
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"})
    assert resolution.status == "AMBIGUOUS"
    assert resolution.pack_id is None
    candidate_ids = {c.pack_id for c in resolution.candidates}
    assert candidate_ids == {"powerflex_40", "powerflex_525"}
    assert resolution.needs_context == "multiple drives match — send the full catalog/part number"


def test_ambiguous_candidates_are_sorted_by_pack_id():
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"})
    ids = [c.pack_id for c in resolution.candidates]
    assert ids == sorted(ids)


def test_resolved_core_plus_genuinely_different_ambiguous_extra_is_ambiguous_not_resolved():
    """A subtler conflict shape: drive_name cleanly resolves to ONE pack, but
    the nameplate signal is itself ambiguous and includes a DIFFERENT pack
    among its candidates. Must not silently trust the clean drive_name hit —
    surface the disagreement as AMBIGUOUS instead."""
    resolution = resolve_equipment(
        drive_name="GS10",
        nameplate={"model": "GS10 or PowerFlex 40"},
    )
    assert resolution.status == "AMBIGUOUS"
    assert resolution.pack_id is None
    candidate_ids = {c.pack_id for c in resolution.candidates}
    assert candidate_ids == {"durapulse_gs10", "powerflex_40"}


# ── (nothing at all) -> NONE with the fully generic message ────────────────


def test_no_signals_at_all_yields_generic_none():
    resolution = resolve_equipment()
    assert resolution.status == "NONE"
    assert resolution.pack_id is None
    assert resolution.needs_context == (
        "couldn't read the drive identity — send a clear photo of the nameplate "
        "manufacturer + model"
    )


def test_empty_nameplate_dict_yields_generic_none():
    resolution = resolve_equipment(nameplate={})
    assert resolution.status == "NONE"


# ── determinism (test area 4) ───────────────────────────────────────────────


def test_resolve_equipment_is_deterministic_resolved_case():
    first = resolve_equipment(nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"})
    second = resolve_equipment(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"}
    )
    assert first == second


def test_resolve_equipment_is_deterministic_conflicting_case():
    first = resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
    second = resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
    assert first == second
    assert [c.pack_id for c in first.candidates] == [c.pack_id for c in second.candidates]


def test_resolve_equipment_is_deterministic_ambiguous_case():
    first = resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"})
    second = resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"})
    assert first == second


def test_resolve_equipment_repeated_ten_times_always_same_order():
    results = [
        resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
        for _ in range(10)
    ]
    ids_lists = [[c.pack_id for c in r.candidates] for r in results]
    assert all(ids == ids_lists[0] for ids in ids_lists)


# ── never RESOLVED on conflict/incomplete (test area 5, cross-check) ───────


def test_never_resolved_status_carries_a_pack_id_unless_resolved():
    """Structural invariant: pack_id is populated iff status == RESOLVED."""
    cases = [
        resolve_equipment(nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"}),
        resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"}),
        resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"}),
        resolve_equipment(nameplate={"model": "GS"}),
        resolve_equipment(),
    ]
    for resolution in cases:
        if resolution.status == "RESOLVED":
            assert resolution.pack_id is not None
        else:
            assert resolution.pack_id is None


def test_extra_asset_make_model_signal_agrees_and_still_resolves():
    """A fourth, independent, CORROBORATING signal (asset_make_model) must not
    push a clean single-pack resolution into ambiguity."""
    resolution = resolve_equipment(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"},
        asset_make_model="AutomationDirect GS10",
    )
    assert resolution.status == "RESOLVED"
    assert resolution.pack_id == "durapulse_gs10"


def test_dataclasses_are_frozen():
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 525"})
    assert isinstance(resolution, EquipmentResolution)
    candidate = resolution.candidates[0]
    assert isinstance(candidate, PackCandidate)
    try:
        candidate.pack_id = "tampered"  # type: ignore[misc]
        raised = False
    except Exception:  # noqa: BLE001 - dataclasses.FrozenInstanceError
        raised = True
    assert raised, "PackCandidate must be frozen"
    try:
        resolution.status = "TAMPERED"  # type: ignore[misc]
        raised = False
    except Exception:  # noqa: BLE001
        raised = True
    assert raised, "EquipmentResolution must be frozen"


# ── to_dict / from_dict round-trip (used by ask_equipment persistence) ─────


def test_to_dict_from_dict_round_trips_resolved():
    original = resolve_equipment(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"}
    )
    round_tripped = EquipmentResolution.from_dict(original.to_dict())
    assert round_tripped == original


def test_to_dict_from_dict_round_trips_conflicting():
    original = resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
    round_tripped = EquipmentResolution.from_dict(original.to_dict())
    assert round_tripped == original


def test_from_dict_on_malformed_metadata_degrades_to_none_never_raises():
    assert EquipmentResolution.from_dict(None).status == "NONE"
    assert EquipmentResolution.from_dict({}).status == "NONE"
    assert EquipmentResolution.from_dict({"candidates": "not-a-list"}).status == "NONE"
