"""Tests for the migration-drift detector (pure core — no DB)."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path

_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "migration_drift.py"
_spec = importlib.util.spec_from_file_location("migration_drift", _MOD_PATH)
drift = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(drift)


# --- find_drift (pure) ------------------------------------------------------


def test_no_drift_when_all_applied():
    repo = ["001_a.sql", "002_b.sql"]
    assert drift.find_drift(repo, {"001_a.sql", "002_b.sql"}) == []


def test_reports_missing_sorted():
    repo = ["003_c.sql", "001_a.sql", "002_b.sql"]
    applied = {"001_a.sql"}
    assert drift.find_drift(repo, applied) == ["002_b.sql", "003_c.sql"]


def test_empty_ledger_is_maximal_drift():
    repo = ["001_a.sql", "002_b.sql"]
    assert drift.find_drift(repo, set()) == ["001_a.sql", "002_b.sql"]


def test_extra_ledger_rows_are_not_drift():
    # A ledger row with no repo file (deleted migration) is not repo->ledger drift.
    repo = ["001_a.sql"]
    assert drift.find_drift(repo, {"001_a.sql", "999_ghost.sql"}) == []


# --- repo_migrations (reads the filesystem) ---------------------------------


def test_repo_migrations_scans_both_dirs(tmp_path):
    (tmp_path / "mira-hub" / "db" / "migrations").mkdir(parents=True)
    (tmp_path / "mira-core" / "mira-ingest" / "db" / "migrations").mkdir(parents=True)
    (tmp_path / "mira-hub" / "db" / "migrations" / "001_hub.sql").write_text("")
    (tmp_path / "mira-core" / "mira-ingest" / "db" / "migrations" / "013_ingest.sql").write_text("")
    (tmp_path / "mira-hub" / "db" / "migrations" / "notes.md").write_text("")  # ignored
    names = drift.repo_migrations(root=tmp_path)
    assert names == ["001_hub.sql", "013_ingest.sql"]  # both dirs, sorted, .sql only


def test_repo_migrations_includes_the_real_ingest_013():
    # Guards the actual regression: mig 013 must be discoverable as a repo migration.
    names = drift.repo_migrations()
    assert "013_conversation_eval_meta.sql" in names


# --- render -----------------------------------------------------------------


def test_render_lists_missing():
    out = drift.render(["001_a.sql", "002_b.sql"], {"001_a.sql"}, ["002_b.sql"])
    assert "DRIFT (in repo, not applied): 1" in out
    assert "- 002_b.sql" in out


def test_render_clean():
    out = drift.render(["001_a.sql"], {"001_a.sql"}, [])
    assert "No drift" in out


# --- asyncpg DB glue -------------------------------------------------------


@dataclass
class _FakeConnection:
    ledger_exists: object = 1
    rows: tuple[dict[str, str], ...] = (
        {"migration_name": "002_b.sql"},
        {"migration_name": "001_a.sql"},
    )
    closed: bool = False

    async def fetchval(self, sql: str) -> object:
        assert sql == drift._LEDGER_EXISTS_SQL
        return self.ledger_exists

    async def fetch(self, sql: str) -> tuple[dict[str, str], ...]:
        assert sql == drift._LEDGER_SQL
        return self.rows

    async def close(self) -> None:
        self.closed = True


class _FakeAsyncpg:
    def __init__(self, connection: _FakeConnection):
        self.connection = connection
        self.urls: list[str] = []

    async def connect(self, url: str) -> _FakeConnection:
        self.urls.append(url)
        return self.connection


def test_asyncpg_glue_reads_the_ledger_and_closes(monkeypatch):
    """Catches a sync-driver regression or a connection leaked after the SELECTs."""
    connection = _FakeConnection()
    driver = _FakeAsyncpg(connection)
    monkeypatch.setitem(sys.modules, "asyncpg", driver)

    applied = asyncio.run(drift._read_applied_migrations("postgres://db.example/mira"))

    assert applied == {"001_a.sql", "002_b.sql"}
    assert driver.urls == ["postgres://db.example/mira"]
    assert connection.closed is True


def test_asyncpg_glue_treats_a_missing_ledger_as_empty(monkeypatch):
    """Catches querying a table after the existence probe proves it is absent."""
    connection = _FakeConnection(ledger_exists=None)

    async def unexpected_fetch(_sql: str):
        raise AssertionError("missing ledger must not be queried")

    monkeypatch.setattr(connection, "fetch", unexpected_fetch)
    monkeypatch.setitem(sys.modules, "asyncpg", _FakeAsyncpg(connection))

    assert asyncio.run(drift._read_applied_migrations("postgres://db.example/mira")) == set()
    assert connection.closed is True


def test_production_glue_references_no_psycopg_driver():
    """Catches reintroducing the prohibited LGPL dependency behind the async helper."""
    source = _MOD_PATH.read_text(encoding="utf-8")
    assert "psycopg" not in source
    assert "import asyncpg" in source
