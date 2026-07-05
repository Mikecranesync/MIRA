"""Tests for the drive-pack schema + pure Python loader (Task 1, ADR-0025).

Anti-drift guard: the GS10 pack's ``live_decode`` tables must equal the
current ``live_snapshot.py`` module dicts exactly. Task 1 does NOT refactor
``live_snapshot.py`` to read from the pack (that is Task 2) — until then both
copies must independently agree, and this test is what catches drift.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from shared.drive_packs import DrivePack, list_packs, load_pack, resolve_pack
from shared.drive_packs import loader as drive_packs_loader
from shared.drive_packs.schema import Envelope, Family, Knowledge, LiveDecode, Nameplate, Provenance
from shared.live_snapshot import _CMD_WORD, _FAULT_CODES, _STATUS_BITS

PACK_ID = "durapulse_gs10"


def _minimal_pack(pack_id: str, *, aliases: list[str], match_keywords: list[str]) -> DrivePack:
    """Bare-bones synthetic pack for resolve_pack precedence tests — no disk I/O."""
    return DrivePack(
        pack_id=pack_id,
        schema_version=1,
        family=Family(manufacturer="Test", series="Test Series", aliases=aliases),
        nameplate=Nameplate(match_keywords=match_keywords),
        live_decode=LiveDecode(status_bits={}, cmd_word={}, fault_codes={}),
        envelope=Envelope(),
        knowledge=Knowledge(),
        provenance=Provenance(),
    )


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


def test_resolve_pack_family_alias_beats_other_packs_nameplate_keyword_regardless_of_order(
    monkeypatch,
):
    """Cross-pack "family-first" precedence (ADR-0025 §1a), independent of pack order.

    pack_a has NO family alias for "widget" but DOES have it as a nameplate
    keyword; pack_b has "widget" as a family alias. A pack-by-pack loop (the
    pre-fix behavior) would return pack_a whenever it's listed before pack_b,
    because pack_a's nameplate-keyword check would match before pack_b is even
    considered. The two-pass loader must always return pack_b — the
    family-alias match — no matter which pack list_packs() returns first.
    """
    pack_a = _minimal_pack("pack_a", aliases=[], match_keywords=["widget"])
    pack_b = _minimal_pack("pack_b", aliases=["widget"], match_keywords=[])
    packs_by_id = {"pack_a": pack_a, "pack_b": pack_b}

    # Order 1: the nameplate-only pack is listed FIRST.
    monkeypatch.setattr(drive_packs_loader, "list_packs", lambda: ["pack_a", "pack_b"])
    monkeypatch.setattr(drive_packs_loader, "load_pack", lambda pack_id: packs_by_id[pack_id])
    resolved = drive_packs_loader.resolve_pack("the widget drive is faulted")
    assert resolved is not None
    assert resolved.pack_id == "pack_b"

    # Order 2: reversed — the family-alias pack is listed FIRST too, proving
    # the win isn't an accident of iteration order either way.
    monkeypatch.setattr(drive_packs_loader, "list_packs", lambda: ["pack_b", "pack_a"])
    resolved = drive_packs_loader.resolve_pack("the widget drive is faulted")
    assert resolved is not None
    assert resolved.pack_id == "pack_b"


def test_load_pack_non_numeric_live_decode_key_raises_actionable_pack_scoped_error(
    tmp_path, monkeypatch
):
    pack_id = "bogus_pack"
    pack_dir = tmp_path / pack_id
    pack_dir.mkdir()
    pack_json = {
        "pack_id": pack_id,
        "schema_version": 1,
        "family": {"manufacturer": "Test", "series": "Test Series", "aliases": []},
        "nameplate": {"match_keywords": []},
        "live_decode": {
            "status_bits": {"not_a_number": "RUNNING"},
            "cmd_word": {},
            "fault_codes": {},
        },
        "envelope": {},
        "knowledge": {},
        "provenance": {"items": {}, "sources": []},
    }
    (pack_dir / "pack.json").write_text(json.dumps(pack_json), encoding="utf-8")

    monkeypatch.setattr(drive_packs_loader, "_packs_dir", lambda: tmp_path)

    with pytest.raises(ValueError, match=r"pack 'bogus_pack'.*not_a_number.*status_bits"):
        drive_packs_loader.load_pack(pack_id)
