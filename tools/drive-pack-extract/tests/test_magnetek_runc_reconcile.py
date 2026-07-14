"""Run C reconciliation — deterministic extractor vs the REAL manual.

Locks the reconciliation findings (Run B hybrid vs merged deterministic dialect)
as executable assertions against the authoritative source. Skipped when the
sha-pinned manual isn't present (it is never committed — copyrighted). CI runs
the license-free fixture regression in test_magnetek_dialect.py instead.
"""

from __future__ import annotations

import hashlib
import pathlib
import sys

import pytest

_TOOL = pathlib.Path(__file__).resolve().parents[1]
if str(_TOOL) not in sys.path:
    sys.path.insert(0, str(_TOOL))

_MANUAL = pathlib.Path("/tmp/gplus_mini.pdf")
_SHA = "56075883958090ed9b59b5c201feb19f556f19d232dfc9138d0caf68900d00be"


def _manual_ok() -> bool:
    return _MANUAL.is_file() and hashlib.sha256(_MANUAL.read_bytes()).hexdigest() == _SHA


pytestmark = pytest.mark.skipif(not _manual_ok(), reason="sha-pinned G+ Mini manual not at /tmp/gplus_mini.pdf")


def _faults():
    import magnetek_dialect as md
    import pdfplumber

    out = []
    with pdfplumber.open(str(_MANUAL)) as pdf:
        for page in pdf.pages:
            out.extend(md.parse_magnetek_fault_page(page))
    return {f["fault_id"]: f for f in out}


def test_deterministic_resolves_all_ten_probe_tokens():
    by_id = _faults()
    for tok in ("oC", "oV", "Uv1", "oH", "oL1", "oL2", "GF", "LL1", "CE", "EF"):
        assert tok in by_id, f"{tok} not resolved by deterministic extractor"


def test_ll1_ll2_names_clean_after_fix():
    """The exact bug the hybrid Run B surfaced: LL1/LL2 names were garbled by the
    page-global action-column edge. Fixed → clean names."""
    by_id = _faults()
    assert by_id["LL1"]["name"] == "Lower Limit 1—SLOW DOWN Indicator"
    assert by_id["LL2"]["name"] == "Lower Limit 2—STOP Indicator"


def test_key_fault_names_match_source():
    by_id = _faults()
    expected = {
        "oC": "Over Current Fault", "oV": "Overvoltage Fault",
        "Uv1": "Undervoltage 1 Fault", "oH": "Overheat Pre-Alarm",
        "oL1": "Motor Overload Fault", "oL2": "VFD Overload Fault",
        "GF": "Ground Fault", "CE": "Modbus Communication Error",
    }
    for tok, name in expected.items():
        assert by_id[tok]["name"] == name, f"{tok}: {by_id[tok]['name']!r} != {name!r}"


def test_negative_probes_absent():
    """SE1 (absent) and BE2 (not a fault code) must NOT be extracted; the real
    brake series is BE0/BE4/BE5."""
    by_id = _faults()
    assert "SE1" not in by_id, "SE1 is a synthetic-probe hallucination; must not appear"
    assert "BE2" not in by_id, "BE2 is not a fault code (manual has BE0/BE4/BE5)"
    assert {"BE0", "BE4", "BE5"} <= set(by_id), "real brake series BE0/BE4/BE5 missing"


def test_mnemonics_have_no_invented_integer():
    """Run C schema invariant: mnemonic codes preserve the source string and are
    NEVER given an invented integer (code stays None)."""
    by_id = _faults()
    for tok in ("oC", "Uv1", "BE4", "LL1"):
        assert by_id[tok]["code"] is None, f"{tok} got an invented integer code"
        assert by_id[tok]["fault_id"] == tok, f"{tok} source string not preserved"
