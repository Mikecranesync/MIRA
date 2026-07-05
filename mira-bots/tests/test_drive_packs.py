"""Tests for the drive-pack schema + pure Python loader (Task 1, ADR-0025).

Anti-drift guard: the GS10 pack's ``live_decode`` tables must equal the
current ``live_snapshot.py`` module dicts exactly. Task 1 does NOT refactor
``live_snapshot.py`` to read from the pack (that is Task 2) — until then both
copies must independently agree, and this test is what catches drift.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from shared.drive_packs import DrivePack, list_packs, load_pack, resolve_pack
from shared.live_snapshot import _CMD_WORD, _FAULT_CODES, _STATUS_BITS

PACK_ID = "durapulse_gs10"


def test_load_pack_gs10_succeeds():
    pack = load_pack(PACK_ID)
    assert isinstance(pack, DrivePack)
    assert pack.pack_id == PACK_ID
    assert pack.schema_version == 1


def test_gs10_pack_status_bits_match_live_snapshot_exactly():
    pack = load_pack(PACK_ID)
    assert pack.live_decode.status_bits == _STATUS_BITS


def test_gs10_pack_cmd_word_matches_live_snapshot_exactly():
    pack = load_pack(PACK_ID)
    assert pack.live_decode.cmd_word == _CMD_WORD


def test_gs10_pack_fault_codes_match_live_snapshot_exactly():
    pack = load_pack(PACK_ID)
    assert pack.live_decode.fault_codes == _FAULT_CODES


def test_gs10_pack_envelope_dc_bus_nominal_is_320():
    pack = load_pack(PACK_ID)
    assert pack.envelope.dc_bus.nominal == 320.0
    assert pack.envelope.dc_bus.min == 300.0
    assert pack.envelope.dc_bus.max == 340.0


def test_gs10_pack_unknown_numeric_fields_are_null_not_guessed():
    pack = load_pack(PACK_ID)
    # current.rated has no bench/manual source yet — must be None, not a guess.
    assert pack.envelope.current.rated is None


def test_gs10_pack_provenance_values_are_from_the_allowed_vocabulary():
    pack = load_pack(PACK_ID)
    allowed = {"bench_verified", "manual_cited"}
    assert pack.provenance.items  # non-empty
    assert set(pack.provenance.items.values()) <= allowed


def test_gs10_pack_knowledge_pointers_are_empty_seam_in_v1():
    pack = load_pack(PACK_ID)
    assert pack.knowledge.kb_document_ids == []
    assert pack.knowledge.component_template_id is None
    assert pack.knowledge.kg_entity_ids == []


def test_load_pack_missing_pack_raises_file_not_found():
    with pytest.raises(FileNotFoundError):
        load_pack("no_such_pack_xyz")


def test_list_packs_includes_gs10():
    assert PACK_ID in list_packs()


def test_resolve_pack_matches_family_alias_case_insensitive():
    pack = resolve_pack("the DURApulse GS10 drive is faulted")
    assert pack is not None
    assert pack.pack_id == PACK_ID


def test_resolve_pack_matches_nameplate_keyword():
    pack = resolve_pack("nameplate reads GS-10, 1HP")
    assert pack is not None
    assert pack.pack_id == PACK_ID


def test_resolve_pack_returns_none_for_unrelated_drive():
    assert resolve_pack("PowerFlex 525") is None


def test_resolve_pack_returns_none_for_empty_text():
    assert resolve_pack("") is None
