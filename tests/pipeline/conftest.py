"""Offline unit-test fixtures for mira-pipeline (the live VPS chat path).

Everything runs fully offline:
  * heavy imports main.py pulls in (PIL, shared.engine, shared.telemetry) are
    replaced with light stubs BEFORE `import main` so no LLM/DB/vision dep is
    needed;
  * the Supervisor engine is an AsyncMock injected onto the module globals;
  * lifespan never runs (TestClient is used without a `with` block), so no
    background threads, schedulers, or real Supervisor are started.
"""

from __future__ import annotations

import os
import sys
import types
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PIPELINE_ROOT = REPO_ROOT / "mira-pipeline"
MIRA_BOTS = REPO_ROOT / "mira-bots"

for p in (str(PIPELINE_ROOT), str(MIRA_BOTS)):
    if p not in sys.path:
        sys.path.insert(0, p)

# ── Offline env: no bearer auth, no DB, no Neon, no provider keys ────────────
os.environ.setdefault("PIPELINE_API_KEY", "")
os.environ["MIRA_DB_PATH"] = "/tmp/mira-pipeline-tests-does-not-exist/mira.db"
os.environ.pop("NEON_DATABASE_URL", None)
os.environ.pop("ENFORCE_ASSET_AGENT_GATE", None)


def _stub_module(name: str, **attrs) -> None:
    """Insert a stub module into sys.modules unless the real one is loaded."""
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod


class _StubSupervisor:
    """Stands in for shared.engine.Supervisor at import time (lifespan-only)."""

    def __init__(self, *args, **kwargs):
        raise RuntimeError("Supervisor must not be constructed in offline tests")


class _StubTrace:
    def update(self, **kwargs):
        return None


@contextmanager
def _stub_span(trace, name, **kwargs):
    yield None


def _stub_trace(name, **kwargs):
    return _StubTrace()


def _stub_flush():
    return None


# PIL is only exercised on photo turns; a stub keeps the import light.
_stub_module("PIL", Image=MagicMock(name="PIL.Image"))
_stub_module("PIL.Image", open=MagicMock(name="PIL.Image.open"))
_stub_module("shared.engine", Supervisor=_StubSupervisor)
_stub_module("shared.telemetry", trace=_stub_trace, span=_stub_span, flush=_stub_flush)


@pytest.fixture
def mock_engine():
    """Recording Supervisor stand-in: async process/process_multi_photo + reset."""
    engine = AsyncMock()
    engine.process = AsyncMock(return_value="Grounded diagnostic reply [manual p.12]")
    engine.process_multi_photo = AsyncMock(return_value="Multi-photo reply")
    engine.reset = MagicMock()
    return engine


@pytest.fixture
def pipeline_client(mock_engine, monkeypatch):
    """TestClient for main.app with the engine mocked and lifespan skipped."""
    from fastapi.testclient import TestClient

    import main

    monkeypatch.setattr(main, "engine", mock_engine)
    monkeypatch.setattr(main, "memory", None)
    # Never let a stray cookie reach the QR bridge's NeonDB lookup.
    monkeypatch.setattr(main, "process_pending_scan", lambda cookie, chat_id: False)
    client = TestClient(main.app, raise_server_exceptions=False)
    return client
