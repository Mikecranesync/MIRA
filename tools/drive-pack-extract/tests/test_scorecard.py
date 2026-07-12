"""Regression tests for the Drive Commander pack reliability scorecard.

Proves the trust gates hold (deterministically) — including the two rules that
matter most before selling: a pack with too few citations cannot be promoted,
and a pack cannot claim `production` without bench/live evidence.

Runnable as a plain script (`python tools/drive-pack-extract/tests/test_scorecard.py`)
or under pytest. No network, no LLM.
"""

import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
sys.path.insert(0, TOOL)
import scorecard  # noqa: E402


def _write_pack(d, pack):
    os.makedirs(d, exist_ok=True)
    io.open(os.path.join(d, "pack.json"), "w", encoding="utf-8").write(json.dumps(pack))


# ---- item 2: fault-code normalisation (F7 / F007 / 7 all match) -------------
def test_fault_num_normalises_all_formats():
    assert scorecard.fault_num("F7") == "7"
    assert scorecard.fault_num("F007") == "7"
    assert scorecard.fault_num("7") == "7"
    assert scorecard.fault_num("F81") == "81"
    assert scorecard.fault_num("0") == "0"


# ---- item 1: the real live packs all pass schema validation -----------------
def test_live_packs_pass_schema():
    report = scorecard.build()
    ids = {p["pack_id"] for p in report["packs"]}
    assert {"durapulse_gs10", "powerflex_40", "powerflex_525"} <= ids
    for p in report["packs"]:
        assert p["gates"]["schema_valid"] is True, p["pack_id"]


# ---- trust ladder is honest: beta != bench-proven != production -------------
def test_trust_ladder_is_honest():
    report = scorecard.build()
    by = {p["pack_id"]: p for p in report["packs"]}
    assert by["powerflex_40"]["trust_level"].startswith("beta")
    assert by["powerflex_525"]["trust_level"].startswith("beta")
    assert by["durapulse_gs10"]["trust_level"] == "bench-proven"
    # nothing is production yet — and any pack that WERE production must have bench data
    for p in report["packs"]:
        if p["trust_level"] == "production":
            assert p["metrics"]["has_bench_live_decode"] is True


# ---- item 5: too few citations -> NOT promotable ----------------------------
def test_low_citation_pack_is_not_promotable():
    with tempfile.TemporaryDirectory() as tmp:
        d = os.path.join(tmp, "synthetic_lowcite")
        _write_pack(
            d,
            {
                "pack_id": "synthetic_lowcite",
                "schema_version": 2,
                "family": {"manufacturer": "X", "series": "Y"},
                "live_decode": {
                    "fault_codes": {"1": "A", "2": "B"},
                    "status_bits": {},
                    "cmd_word": {},
                    "registers": {},
                },
                "envelope": {},
                "parameters": [
                    {
                        "parameter_id": "P1",
                        "name": "p1",
                        "related_faults": [],
                        "related_parameters": [],
                        "value_meanings": [],
                        "source_citation": {"doc": "m", "page": "1"},
                    },
                    {
                        "parameter_id": "P2",
                        "name": "p2",
                        "related_faults": [],
                        "related_parameters": [],
                        "value_meanings": [],
                    },
                    {
                        "parameter_id": "P3",
                        "name": "p3",
                        "related_faults": [],
                        "related_parameters": [],
                        "value_meanings": [],
                    },
                    {
                        "parameter_id": "P4",
                        "name": "p4",
                        "related_faults": [],
                        "related_parameters": [],
                        "value_meanings": [],
                    },
                ],
                "keypad_navigation": [],
                "provenance": {"items": {"parameters": "manual_cited"}},
            },
        )
        r = scorecard.score_pack(d, {})
        assert r["gates"]["param_citation_coverage>=0.9"] is False
        assert r["promotable_gates_pass"] is False


# ---- item 6: no bench evidence -> cannot be `production` --------------------
def test_manual_cited_pack_cannot_be_production_even_with_approval():
    with tempfile.TemporaryDirectory() as tmp:
        d = os.path.join(tmp, "synthetic_nobench")
        _write_pack(
            d,
            {
                "pack_id": "synthetic_nobench",
                "schema_version": 2,
                "family": {"manufacturer": "X", "series": "Y"},
                # manual-cited: no bench live_decode
                "live_decode": {
                    "fault_codes": {"1": "A"},
                    "status_bits": {},
                    "cmd_word": {},
                    "registers": {},
                },
                "envelope": {},
                "parameters": [
                    {
                        "parameter_id": "P1",
                        "name": "p1",
                        "related_faults": [],
                        "related_parameters": [],
                        "value_meanings": [],
                        "source_citation": {"doc": "m", "page": "1"},
                    }
                ],
                "keypad_navigation": [],
                "provenance": {
                    "items": {
                        "parameters": "manual_cited",
                        "live_decode.fault_codes": "manual_cited",
                    }
                },
            },
        )
        # even with a recorded human approval, no bench data => not production
        r = scorecard.score_pack(d, {"approved_by": "Mike", "approved_at": "2026-07-09"})
        assert r["metrics"]["has_bench_live_decode"] is False
        assert r["trust_level"] != "production"


# ---- keypad-code references (gs10 CE10) resolve deterministically -----------
def test_scorecard_resolves_keypad_code_refs():
    # gs10's P09.03 references fault CE10; the fault table is keyed numerically
    # ("58") with the keypad code in the name ("CE10 modbus timeout"). It resolves.
    report = scorecard.build()
    gs10 = next(p for p in report["packs"] if p["pack_id"] == "durapulse_gs10")
    assert gs10["metrics"]["fault_link_unresolved"] == [], gs10["metrics"]["fault_link_unresolved"]
    assert gs10["gates"]["fault_links_all_resolve"] is True


# ---- but a genuinely bogus fault reference is STILL caught -------------------
def test_scorecard_still_catches_bogus_fault_ref():
    with tempfile.TemporaryDirectory() as tmp:
        d = os.path.join(tmp, "syn_bogus")
        _write_pack(
            d,
            {
                "pack_id": "syn_bogus",
                "schema_version": 2,
                "family": {"manufacturer": "X", "series": "Y"},
                "live_decode": {
                    "fault_codes": {"1": "A comm ok"},
                    "status_bits": {},
                    "cmd_word": {},
                    "registers": {},
                },
                "envelope": {},
                "parameters": [
                    {
                        "parameter_id": "P1",
                        "name": "p1",
                        "related_faults": ["ZZ99"],
                        "related_parameters": [],
                        "value_meanings": [],
                        "source_citation": {"doc": "m", "page": "1"},
                    }
                ],
                "keypad_navigation": [],
                "provenance": {"items": {"parameters": "manual_cited"}},
            },
        )
        r = scorecard.score_pack(d, {})
        assert "P1->ZZ99" in r["metrics"]["fault_link_unresolved"]
        assert r["gates"]["fault_links_all_resolve"] is False


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    fails = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"FAIL  {fn.__name__}: {e}")
    print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'} ({len(fns)} tests)")
    sys.exit(1 if fails else 0)
