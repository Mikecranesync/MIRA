"""`list_active_faults` must surface BOTH fault stores sharing the SQLite file.

P1 from docs/discovery/duplicate-systems-audit.md (re-flagged in
docs/discovery/machine-pack/): the bench conveyor anomaly engine
(plc/conv_simple_anomaly/engine.py) writes `conveyor_events` into the same
physical SQLite file (MIRA_DB_PATH) that mira-mcp's `/api/faults/active`
reads — but the endpoint only ever queried the `faults` table, so conveyor
anomalies were invisible to the Telegram/MCP fault surface. Machine Pack plan
Phase 0 / PR-0.2.

Module under test: mira-mcp/server.py
"""

from __future__ import annotations

import sqlite3
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def server_module(monkeypatch, tmp_path):
    """Import server.py against a temp DB (same pattern as test_ingest_pdf_tenant)."""
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setenv("MIRA_DB_PATH", db_path)
    monkeypatch.setitem(sys.modules, "context.viking_store", MagicMock())

    import server

    monkeypatch.setattr(server, "DB_PATH", db_path)
    # Ensure the standard schema exists in the temp DB (import-time run used
    # whatever path was active then).
    server._ensure_schema()
    return server


def _seed_faults(db_path: str) -> None:
    db = sqlite3.connect(db_path)
    db.execute(
        "INSERT INTO faults (equipment_id, fault_code, description, severity, timestamp, resolved)"
        " VALUES ('vfd101', 'GFF', 'Ground fault', 'critical', '2026-07-10T12:00:00', 0)"
    )
    db.execute(
        "INSERT INTO faults (equipment_id, fault_code, description, severity, timestamp, resolved)"
        " VALUES ('vfd101', 'OC', 'Overcurrent (resolved)', 'warning', '2026-07-10T11:00:00', 1)"
    )
    db.commit()
    db.close()


def _seed_conveyor_events(db_path: str) -> None:
    """Same DDL + row shape as plc/conv_simple_anomaly/engine.py::_init_db/_persist."""
    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE IF NOT EXISTS conveyor_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL, fault TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]', affected_json TEXT NOT NULL DEFAULT '[]',
        resolved_ts TEXT)"""
    )
    db.execute(
        "INSERT INTO conveyor_events (ts, fault, confidence, evidence_json, affected_json)"
        " VALUES ('2026-07-10T13:00:00', 'A3: DC bus sag under load', 0.87,"
        " '[]', '[{\"uns_path\": \"enterprise.site.garage.line.conveyor.equipment.cv101\"}]')"
    )
    db.execute(
        "INSERT INTO conveyor_events (ts, fault, confidence, evidence_json, affected_json,"
        " resolved_ts) VALUES ('2026-07-10T10:00:00', 'A7: comm loss', 0.95, '[]', '[]',"
        " '2026-07-10T10:05:00')"
    )
    db.commit()
    db.close()


def test_active_faults_unions_both_tables(server_module):
    _seed_faults(server_module.DB_PATH)
    _seed_conveyor_events(server_module.DB_PATH)

    out = server_module.list_active_faults()
    rows = out["active_faults"]

    # 1 unresolved `faults` row + 1 unresolved `conveyor_events` row; resolved rows excluded.
    assert len(rows) == 2
    by_code = {r["fault_code"]: r for r in rows}
    assert "GFF" in by_code
    assert "A3" in by_code

    conveyor = by_code["A3"]
    assert conveyor["source"] == "conveyor_events"
    assert conveyor["description"] == "A3: DC bus sag under load"
    assert conveyor["equipment_id"] == "enterprise.site.garage.line.conveyor.equipment.cv101"
    assert conveyor["confidence"] == pytest.approx(0.87)
    assert conveyor["resolved"] == 0


def test_merged_rows_sorted_newest_first(server_module):
    _seed_faults(server_module.DB_PATH)
    _seed_conveyor_events(server_module.DB_PATH)

    rows = server_module.list_active_faults()["active_faults"]
    stamps = [r["timestamp"] for r in rows]
    assert stamps == sorted(stamps, reverse=True)
    # conveyor row (13:00) is newer than the faults row (12:00)
    assert rows[0]["fault_code"] == "A3"


def test_missing_conveyor_table_is_failsafe(server_module):
    """Most deployments never create conveyor_events (bench-only) — no crash."""
    _seed_faults(server_module.DB_PATH)

    rows = server_module.list_active_faults()["active_faults"]
    assert len(rows) == 1
    assert rows[0]["fault_code"] == "GFF"
