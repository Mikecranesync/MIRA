"""Drive-pack asset binding (#2527 UNS follow-up).

An Ignition panel bound to a GS10 should get the deterministic drive-pack answer
WITHOUT the technician typing "gs10". `ignition_chat` resolves the connected
asset's manufacturer/model and folds an "Asset: <make> <model>" line into the
engine message so the engine's drive-pack fast-path (shared/engine.py, #2526)
resolves the pack.

No DB: we unit-test the pure `_drive_info_from_conn(conn, ...)` seam with a fake
connection (mirroring `test_ignition_chat_resolver.py`). The live
`_lookup_drive_info` just wraps this seam with engine setup, so testing the seam
tests the resolution; we also assert its best-effort no-DB / empty-token guards.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mira-bots"))

import ignition_chat  # noqa: E402


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    """Records the (sql_text, params) of each execute and returns a canned row."""

    def __init__(self, row=None):
        self._row = row
        self.calls: list[tuple[str, dict]] = []

    def execute(self, sql, params):
        self.calls.append((str(sql), params))
        return _FakeResult(self._row)


# ── the resolution seam ──


def test_drive_info_joins_manufacturer_and_model():
    conn = _FakeConn(row=("AutomationDirect", "GS10"))
    descriptor = ignition_chat._drive_info_from_conn(conn, "mike", "GS10-VFD")
    assert descriptor == "AutomationDirect GS10"


def test_drive_info_binds_raw_token_and_slug_as_params():
    conn = _FakeConn(row=("AutomationDirect", "GS10"))
    ignition_chat._drive_info_from_conn(conn, "mike", "GS10-VFD")
    _sql, params = conn.calls[0]
    assert params["tid"] == "mike"
    assert params["token"] == "GS10-VFD"
    # slug is the uns-grammar normalization of the token (equipment_number match)
    assert params["slug"] == "gs10_vfd"


def test_drive_info_manufacturer_only():
    conn = _FakeConn(row=("Rockwell Automation", None))
    assert ignition_chat._drive_info_from_conn(conn, "mike", "pf") == "Rockwell Automation"


def test_drive_info_model_only():
    conn = _FakeConn(row=(None, "PowerFlex 525"))
    assert ignition_chat._drive_info_from_conn(conn, "mike", "pf") == "PowerFlex 525"


def test_drive_info_no_row_returns_none():
    conn = _FakeConn(row=None)
    assert ignition_chat._drive_info_from_conn(conn, "mike", "unknown") is None


def test_drive_info_blank_make_and_model_returns_none():
    conn = _FakeConn(row=("", "   "))
    assert ignition_chat._drive_info_from_conn(conn, "mike", "x") is None


# ── the best-effort wrapper guards (no engine setup) ──


def test_lookup_drive_info_no_db_returns_none(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert ignition_chat._lookup_drive_info("mike", "GS10-VFD") is None


def test_lookup_drive_info_empty_token_returns_none(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://x")
    assert ignition_chat._lookup_drive_info("mike", "") is None
