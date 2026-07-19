import importlib
import pytest


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    import shared.chat.drive_context as dc

    importlib.reload(dc)  # rebind DB path read at import-safe boundaries
    return dc


def test_set_then_get_roundtrip(ctx):
    ctx.set_drive_context("slack", "slack:C1:T1", "gs10")
    assert ctx.get_drive_context("slack", "slack:C1:T1") == "gs10"


def test_ttl_expiry_returns_none(ctx):
    ctx.set_drive_context("slack", "slack:C1:T1", "gs10")
    assert ctx.get_drive_context("slack", "slack:C1:T1", max_age_s=0) is None


def test_source_isolation(ctx):
    ctx.set_drive_context("slack", "k", "gs10")
    assert ctx.get_drive_context("telegram", "k") is None


def test_missing_returns_none(ctx):
    assert ctx.get_drive_context("slack", "nope") is None


def test_set_overwrites_and_refreshes(ctx):
    ctx.set_drive_context("slack", "k", "gs10")
    ctx.set_drive_context("slack", "k", "pf525")
    assert ctx.get_drive_context("slack", "k") == "pf525"
