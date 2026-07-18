"""Source-pinned truth pins for the audited drive packs (issue #2777).

Every pack of record carries a ``provenance.verification`` block naming its
hash-pinned primary manual; these pins hold the audited identifiers/meanings
so a regenerated pack can never silently shift them (the G120 #2621 failure
class: fault meanings shifted, nonexistent codes invented). GS10's
``bench_verified`` items are bench-tier provenance and intentionally NOT
pinned to a manual.
"""
import json
from pathlib import Path

PACKS = Path(__file__).resolve().parents[1] / "shared" / "drive_packs" / "packs"


def _load(pack_id: str) -> dict:
    return json.loads((PACKS / pack_id / "pack.json").read_text())


def test_gs10_fault_record_ids_match_ch6():
    fc = _load("durapulse_gs10")["live_decode"]["fault_codes"]
    # ch6.pdf (sha256 df9cfc7b…) fault-record table — id adjacent to mnemonic
    assert fc["4"].startswith("GFF")
    assert fc["12"].startswith("Lvd")
    assert fc["21"].startswith("oL")
    assert fc["58"].startswith("CE10")
    assert fc["0"] == "no active fault"  # synthetic zero-state, documented


def test_gs10_fabricated_ids_never_reappear():
    fc = _load("durapulse_gs10")["live_decode"]["fault_codes"]
    # ids the pack never carried and the audit found no support for
    for bogus in ("1", "99", "30006"):
        assert bogus not in fc


def test_gs10_parameters_match_ch4():
    params = {p["parameter_id"]: p["name"] for p in _load("durapulse_gs10")["parameters"]}
    assert params["P01.00"] == "Maximum operation frequency"
    assert params["P09.03"] == "COM1 Time-out Detection"
    assert len(params) == 8


def test_powerflex_fault_pins():
    fc525 = _load("powerflex_525")["live_decode"]["fault_codes"]
    assert fc525["4"] == "UnderVoltage"
    assert fc525["5"] == "OverVoltage"
    assert fc525["7"] == "Motor Overload"
    fc40 = _load("powerflex_40")["live_decode"]["fault_codes"]
    assert fc40["4"] == "UnderVoltage"
    assert fc40["12"] == "HW OverCurrent"


def test_all_audited_packs_carry_hash_pinned_verification():
    expected = {
        "powerflex_525": "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6",
        "powerflex_40": "15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9",
    }
    for pid, sha in expected.items():
        v = _load(pid)["provenance"]["verification"]
        assert v["manual_sha256"] == sha, pid
        assert v["verified"] == "2026-07-17"
    gs10 = _load("durapulse_gs10")["provenance"]["verification"]
    assert gs10["manual_sha256"]["ch6"].startswith("df9cfc7b")
    assert gs10["manual_sha256"]["ch4"].startswith("d68a0a4d")
