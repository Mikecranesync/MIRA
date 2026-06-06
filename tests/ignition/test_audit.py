"""Tests for mira-pipeline/ignition_audit.py — PII sanitization + guards.

The DB write/read paths require NeonDB and aren't exercised here; they're
covered by the end-to-end test in tests/e2e/ (D10, GitHub #1626).
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure mira-pipeline/ is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mira-pipeline"))

import ignition_audit as A  # noqa: E402


class TestSanitize:
    def test_ipv4_scrubbed(self):
        assert A._sanitize("PLC at 192.168.1.100 is down") == "PLC at [IP] is down"

    def test_mac_scrubbed(self):
        assert A._sanitize("MAC aa:bb:cc:dd:ee:ff failure") == "MAC [MAC] failure"
        assert A._sanitize("MAC AA-BB-CC-DD-EE-FF failure") == "MAC [MAC] failure"

    def test_serial_scrubbed(self):
        assert A._sanitize("S/N: ABC1234567") == "[SN]"
        assert A._sanitize("SN ABC1234567") == "[SN]"

    def test_compound(self):
        out = A._sanitize("ip 192.168.1.1 + MAC aa:bb:cc:dd:ee:ff + SN ABC1234567 + plain")
        assert "[IP]" in out
        assert "[MAC]" in out
        assert "[SN]" in out
        assert "192.168.1.1" not in out
        assert "ABC1234567" not in out

    def test_empty(self):
        assert A._sanitize("") == ""

    def test_non_string_passthrough(self):
        # Non-string returns unchanged — write_audit_row sends only strings,
        # but the helper is defensively typed.
        assert A._sanitize(42) == 42  # type: ignore[arg-type]

    def test_plain_text_unchanged(self):
        assert A._sanitize("conveyor B16 stopped at 14:23") == "conveyor B16 stopped at 14:23"


class TestWriteGuards:
    def test_no_neon_url_returns_false(self, monkeypatch):
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        assert A.write_audit_row(tenant_id="t1", prompt="x") is False

    def test_no_tenant_returns_false(self, monkeypatch):
        monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake")
        assert A.write_audit_row(tenant_id="", prompt="x") is False


class TestQueryGuards:
    def test_no_neon_url_returns_empty(self, monkeypatch):
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        assert A.query_audit_rows(tenant_id="t1") == []

    def test_no_tenant_returns_empty(self):
        # No tenant_id — never query.
        assert A.query_audit_rows(tenant_id="") == []
