#!/usr/bin/env python3
"""Unit tests for plc/discover.py — the read-only fieldbus discovery tool.

Run: cd plc && python3 -m pytest test_discover.py  (or python3 test_discover.py)

These cover the pure logic (no network/serial): profile loading, the CIP List
Identity parser, fingerprint identification, the RS-485 sweep ordering, and the
UNS-hint builder. Hardware-in-the-loop validation is the smoke test in the spec §11.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import discover as d  # noqa: E402

PROFILES_DIR = Path(__file__).parent.parent / "device-profiles"


def _profiles():
    return d.load_profiles(PROFILES_DIR)


def _synth_enip_identity(product: str, vendor_id: int = 1) -> bytes:
    """Build a CIP List Identity reply byte-for-byte (for parser round-trip)."""
    name = product.encode("ascii")
    body = struct.pack("<H", 1)  # encap protocol version
    body += b"\x00" * 16  # socket address
    body += struct.pack("<HHH", vendor_id, 14, 181)  # vendor, device_type, product_code
    body += struct.pack("<H", 0x0301)  # revision
    body += struct.pack("<H", 0)  # status
    body += struct.pack("<I", 0xABCD1234)  # serial
    body += struct.pack("<B", len(name)) + name
    body += b"\x01"  # state
    cpf = struct.pack("<H", 1)  # item count
    cpf += struct.pack("<HH", 0x000C, len(body)) + body
    return b"\x00" * 24 + cpf  # 24-byte encap header + CPF


def test_profiles_load():
    ids = {p.id for p in _profiles()}
    assert {"gs10", "micro820"} <= ids, ids


def test_cip_parser_extracts_identity():
    ident = d._parse_list_identity(_synth_enip_identity("2080-LC20-20QBB"))
    assert ident is not None
    assert ident["vendor_id"] == 1
    assert ident["product"] == "2080-LC20-20QBB"
    assert ident["serial"] == "ABCD1234"


def test_cip_parser_rejects_garbage():
    assert d._parse_list_identity(b"\x00" * 10) is None


def test_enip_identifies_micro820():
    ident = d._parse_list_identity(_synth_enip_identity("1769 2080-LC20-20QBB/A"))
    prof = d._enip_match(ident, _profiles())
    assert prof is not None and prof.id == "micro820"


def test_enip_wrong_vendor_no_match():
    ident = d._parse_list_identity(_synth_enip_identity("2080-LC20-20QBB", vendor_id=999))
    assert d._enip_match(ident, _profiles()) is None


def test_serial_sweep_tries_gs10_defaults_first():
    combos = d._ordered_combos(_profiles(), d.DEFAULT_BAUDS, d.DEFAULT_FRAMES)
    assert combos[0] == (9600, "8N2"), "GS10 known-good framing must lead the sweep"


def test_expect_clauses():
    assert d._expect_ok({"nonzero": True}, 320)
    assert not d._expect_ok({"nonzero": True}, 0)
    assert d._expect_ok({"in": [0, 1, 2, 3, 4]}, 2)
    assert not d._expect_ok({"in": [0, 1, 2, 3, 4]}, 9)
    assert d._expect_ok({"equals": 7}, 7)
    assert d._expect_ok({"mask": 0x01, "eq": 0x01}, 0b101)


def test_uns_hint_from_profile():
    gs10 = next(p for p in _profiles() if p.id == "gs10")
    assert d._uns_hint(gs10) == "enterprise.knowledge_base.automationdirect.gs10"
    assert d._uns_hint(None) is None


def test_frame_parts():
    assert d._frame_parts("8N2") == (8, "N", 2)
    assert d._frame_parts("8E1") == (8, "E", 1)


def test_serial_sweep_refused_without_bus_idle_ack():
    """RS-485 is single-master: --serial must REFUSE without --serial-bus-idle,
    and must NOT open the port (a sweep on a live bus can fault-stop a motor)."""
    import subprocess

    script = Path(__file__).parent / "discover.py"
    out = subprocess.run(
        # --host 127.0.0.1 --ports 1 keeps the network scan trivial so we reach the
        # serial-gate decision fast; the point is the refusal, not the scan.
        [sys.executable, str(script), "--host", "127.0.0.1", "--ports", "1",
         "--serial", "/dev/ttyDOESNOTEXIST", "--json", "/tmp/_g.json"],
        capture_output=True, text=True, cwd=str(script.parent.parent), timeout=30,
    )
    assert out.returncode == 0
    assert "REFUSING serial sweep" in out.stdout
    assert "single-master" in out.stdout


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failed += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if failed else 0)
