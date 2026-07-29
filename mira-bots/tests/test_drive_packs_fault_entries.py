"""schema_version 3 for drive packs — string-identifier fault entries.

RUN_C PR C1 (schema/loader only). Proves:
  * a v1/v2 pack still loads unchanged, with ``fault_entries`` defaulting empty;
  * a v3 ``fault_entries`` block parses (dict seam + disk seam);
  * every ``FaultEntry`` field round-trips, ``fault_id`` is preserved verbatim,
    and entries are addressable by string id — CASE-SENSITIVELY (``oC`` != ``OC``,
    RUN_C decision #4);
  * the loader enforces validation (missing ``fault_id``, bad ``provenance_tier``,
    non-int ``wire_value``);
  * the int-keyed ``live_decode.fault_codes`` gate is UNCHANGED (a mnemonic-only
    pack keeps ``fault_codes == {}`` — no invented integer keys);
  * the REAL Run B candidate pack (77 mnemonic faults) round-trips end-to-end
    (the candidate pack.json is committed, so this runs on CI; skipif only
    guards a checkout missing the tools/ tree).

No manual parsing, no runtime consumers, no DB/network/socket.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from shared.drive_packs import (  # noqa: E402
    Citation,
    DrivePack,
    FaultEntry,
    load_pack,
)
from shared.drive_packs import loader as _loader  # noqa: E402
from shared.drive_packs.loader import _parse_pack  # noqa: E402

PACK_ID = "test_v3_drive"

# The real Run B candidate (deterministic extractor output; do NOT hand-edit).
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CANDIDATE_PACK = (
    _REPO_ROOT / "tools/drive-pack-extract/candidates/magnetek_impulse_g_plus_mini/pack.json"
)


def _v3_raw(**overrides) -> dict:
    """A minimal but complete schema_version 3 pack dict with two fault_entries.

    ``oC`` and ``OC`` are DISTINCT ids on purpose — the case-sensitivity contract.
    ``bb`` mirrors the real candidate shape (flashing, secondary_label,
    references_parameters, ambiguous_glyphs).
    """
    raw = {
        "pack_id": PACK_ID,
        "schema_version": 3,
        "family": {"manufacturer": "Magnetek", "series": "IMPULSE", "aliases": ["impulse"]},
        "nameplate": {"match_keywords": ["IMPULSE"]},
        "live_decode": {"status_bits": {}, "cmd_word": {}, "fault_codes": {}},
        "envelope": {},
        "knowledge": {},
        "provenance": {"items": {}, "sources": []},
        "fault_entries": [
            {
                "fault_id": "oC",
                "name": "Over Current Fault",
                "action": "Check for a phase-to-phase short in the motor.",
                "source_citation": {"doc": "IMPULSE Manual", "page": "138", "excerpt": "oC ..."},
                "flashing": False,
                "references_parameters": ["L08.02"],
            },
            {
                "fault_id": "OC",
                "name": "Distinct upper-case code (must not collapse into oC)",
                "action": "n/a",
                "source_citation": {"doc": "IMPULSE Manual", "page": "138", "excerpt": "OC ..."},
            },
            {
                "fault_id": "bb",
                "name": "External Base Block Indicator",
                "action": "1. Check H01.01 through H01.07. 2. Check terminal status. (U01.10)",
                "flashing": True,
                "secondary_label": "Base Block",
                "references_parameters": ["H01.01", "H01.07", "U01.10"],
                "ambiguous_glyphs": [{"glyph": "b", "confusable_with": "B", "index": 0}],
                "source_citation": {"doc": "IMPULSE Manual", "page": "135", "excerpt": "bb ..."},
            },
        ],
    }
    raw.update(overrides)
    return raw


# ── backward compatibility ────────────────────────────────────────────────────


def test_v1_pack_loads_with_empty_fault_entries():
    raw = _v3_raw(schema_version=1)
    del raw["fault_entries"]
    pack = _parse_pack(raw, PACK_ID, "<v1-memory>")
    assert pack.schema_version == 1
    assert pack.fault_entries == []


def test_v2_pack_loads_with_empty_fault_entries():
    raw = _v3_raw(schema_version=2)
    del raw["fault_entries"]
    pack = _parse_pack(raw, PACK_ID, "<v2-memory>")
    assert pack.schema_version == 2
    assert pack.fault_entries == []


def test_shipped_int_keyed_packs_unchanged():
    # The real int-keyed GS10 pack still loads with zero fault_entries and its
    # numeric wire fault table intact — the v3 addition is purely additive.
    pack = load_pack("durapulse_gs10")
    assert pack.fault_entries == []
    assert isinstance(pack.live_decode.fault_codes, dict)
    assert all(isinstance(k, int) for k in pack.live_decode.fault_codes)


# ── v3 parse ──────────────────────────────────────────────────────────────────


def test_v3_dict_parses():
    pack = _parse_pack(_v3_raw(), PACK_ID, "<memory>")
    assert isinstance(pack, DrivePack)
    assert pack.schema_version == 3
    assert len(pack.fault_entries) == 3
    assert all(isinstance(e, FaultEntry) for e in pack.fault_entries)


def test_fault_entry_fields_round_trip():
    pack = _parse_pack(_v3_raw(), PACK_ID, "<memory>")
    bb = pack.fault_entry("bb")
    assert bb is not None
    assert bb.name == "External Base Block Indicator"
    assert bb.flashing is True
    assert bb.secondary_label == "Base Block"
    assert bb.references_parameters == ["H01.01", "H01.07", "U01.10"]
    assert bb.ambiguous_glyphs == [{"glyph": "b", "confusable_with": "B", "index": 0}]
    assert isinstance(bb.source_citation, Citation)
    assert bb.source_citation.page == "135"
    assert bb.wire_value is None  # mnemonic-only — never a guessed integer
    assert bb.provenance_tier == "manual_cited"


def test_fault_id_addressable_case_sensitively():
    # oC and OC are DISTINCT codes — the accessor must not collapse them.
    pack = _parse_pack(_v3_raw(), PACK_ID, "<memory>")
    lower = pack.fault_entry("oC")
    upper = pack.fault_entry("OC")
    assert lower is not None and upper is not None
    assert lower is not upper
    assert lower.name == "Over Current Fault"
    assert upper.name.startswith("Distinct upper-case")
    # A miss is None, not a lenient collapse.
    assert pack.fault_entry("oc") is None


def test_fault_id_case_insensitive_convenience_widens_comparison_only():
    pack = _parse_pack(_v3_raw(), PACK_ID, "<memory>")
    hit = pack.fault_entry("oc", case_sensitive=False)
    assert hit is not None
    # Stored id is preserved verbatim — the comparison widened, the value did not.
    assert hit.fault_id in {"oC", "OC"}


def test_wire_value_accepts_int():
    raw = _v3_raw()
    raw["fault_entries"][0]["wire_value"] = 4
    pack = _parse_pack(raw, PACK_ID, "<memory>")
    assert pack.fault_entry("oC").wire_value == 4


def test_v3_loads_from_disk(tmp_path, monkeypatch):
    pack_dir = tmp_path / PACK_ID
    pack_dir.mkdir()
    (pack_dir / "pack.json").write_text(json.dumps(_v3_raw()), encoding="utf-8")
    monkeypatch.setattr(_loader, "_packs_dir", lambda: tmp_path)

    pack = load_pack(PACK_ID)
    assert pack.schema_version == 3
    assert pack.fault_entry("bb") is not None


# ── validation ────────────────────────────────────────────────────────────────


def test_missing_fault_id_rejected():
    raw = _v3_raw()
    del raw["fault_entries"][0]["fault_id"]
    with pytest.raises(ValueError, match="fault_id"):
        _parse_pack(raw, PACK_ID, "<memory>")


def test_bad_fault_provenance_tier_rejected():
    raw = _v3_raw()
    raw["fault_entries"][0]["provenance_tier"] = "verified"  # reserved word
    with pytest.raises(ValueError, match="provenance_tier"):
        _parse_pack(raw, PACK_ID, "<memory>")


def test_non_int_wire_value_rejected():
    raw = _v3_raw()
    raw["fault_entries"][0]["wire_value"] = "oC"  # string, not an int/null
    with pytest.raises(ValueError, match="wire_value"):
        _parse_pack(raw, PACK_ID, "<memory>")


# ── the real Run B candidate (77 mnemonic faults) ─────────────────────────────


# The candidate pack.json IS committed on main (only the copyrighted manual PDF is
# gitignored), so this normally RUNS on CI, not skips — the skipif only guards a
# checkout that lacks the tools/ tree. The exact counts below are therefore an
# intentional CI-enforced coupling to the candidate's current shape: whoever
# regenerates the pack in PR C2 (approved-record conversion) must update them.
@pytest.mark.skipif(not _CANDIDATE_PACK.is_file(), reason="candidate pack tree absent")
def test_run_b_candidate_pack_round_trips_all_77_faults():
    raw = json.loads(_CANDIDATE_PACK.read_text(encoding="utf-8"))
    pack = _parse_pack(raw, raw["pack_id"], str(_CANDIDATE_PACK))
    # All 77 source-preserved mnemonic faults load and every id is addressable.
    assert len(pack.fault_entries) == 77
    for entry in pack.fault_entries:
        hit = pack.fault_entry(entry.fault_id)
        assert hit is not None and hit.fault_id == entry.fault_id
    # The list preserves source order + duplicates (the candidate is
    # 76 unique + one intentional `oV` plain/flashing pair — eval.md); the
    # accessor returns the FIRST occurrence, and dups are NOT silently dropped.
    ids = [e.fault_id for e in pack.fault_entries]
    assert len(set(ids)) == 76
    assert ids.count("oV") == 2
    assert pack.fault_entry("oV") is pack.fault_entries[ids.index("oV")]
    # The int-key gate is untouched: no invented integer fault codes.
    assert pack.live_decode.fault_codes == {}
    # A known crane-safety code addresses correctly (verbatim, case-sensitive).
    assert pack.fault_entry("LL1") is not None
    assert pack.fault_entry("GF") is not None
