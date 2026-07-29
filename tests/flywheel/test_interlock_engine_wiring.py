"""Integration: approved interlock edges surface in the engine's context block.

Proves the CONSUME-side wiring of the interlock flywheel — the wire that was
missing: `engine._build_interlock_context` recalls VERIFIED kg_relationships
interlock edges and injects them (with plc_rung evidence, and a live "why it
won't move" explanation when a tag snapshot is present) into the prompt context.

DB is faked (`fetch_interlocks` patched) — the propose→approve→recall round-trip
is covered by the DATABASE_URL-gated recall test; this proves the ENGINE wiring.
All offline: no LLM, no DB, no network.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest.mock
from pathlib import Path

os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_interlock_wiring_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant")
os.environ["MIRA_INTERLOCK_CONTEXT_ENABLED"] = "1"

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots"))
sys.path.insert(0, str(_REPO / "mira-bots" / "shared"))

for _mod in ("PIL", "PIL.Image", "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors"):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

import shared.engine as engine_mod  # noqa: E402
from interlock_context import RecalledEdge, evaluate_permissive  # noqa: E402
from shared.engine import Supervisor  # noqa: E402


def _approved_chain() -> list[RecalledEdge]:
    """Interlock edges as they'd come back from recall_interlocks after approval."""
    rung = [{"type": "plc_rung", "location": "Prog_init_ConvSimple_v2.1.st:214",
             "excerpt": "vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;"}]
    rung2 = [{"type": "plc_rung", "location": "Prog_init_ConvSimple_v2.1.st:236",
              "excerpt": "motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);"}]
    return [
        RecalledEdge("_IO_EM_DO_02", "vfd_run_permit", "USED_IN_LOGIC", evidence=rung),
        RecalledEdge("vfd_run_permit", "motor_running", "USED_IN_LOGIC", evidence=rung2),
        RecalledEdge("pe_latched", "vfd_run_permit", "CAUSES", evidence=rung,
                     evidence_summary="NOT-ed permissive operand: TRUE inhibits run"),
    ]


class _UNS:
    def __init__(self, p):
        self.uns_path = p


def _sup() -> Supervisor:
    return Supervisor.__new__(Supervisor)


def _state(tag_state: dict | None = None) -> dict:
    st = {"asset_identified": "conveyor_b16", "context": {"session_context": {}}}
    if tag_state is not None:
        st["context"]["session_context"]["tag_state"] = tag_state
    return st


def _patch(monkeypatch, *, enabled=True, edges=None):
    monkeypatch.setattr(engine_mod, "_INTERLOCK_CONTEXT_ENABLED", enabled)
    monkeypatch.setattr(engine_mod, "fetch_interlocks", lambda tid, sub: edges if edges is not None else [])
    monkeypatch.setattr(engine_mod, "resolve_uns_path",
                        lambda a: _UNS("enterprise.site.area.line.conveyor_b16"))


def test_approved_interlock_edges_surface_in_engine_context(monkeypatch):
    _patch(monkeypatch, edges=_approved_chain())
    out = asyncio.run(_sup()._build_interlock_context(_state(), "t1"))
    assert "APPROVED INTERLOCK LOGIC" in out
    assert "vfd_run_permit -[USED_IN_LOGIC]-> motor_running" in out
    # the plc_rung evidence citation surfaces (previously invisible to the answer path)
    assert "Prog_init_ConvSimple" in out


def test_with_live_state_explains_why_blocked(monkeypatch):
    _patch(monkeypatch, edges=_approved_chain())
    live = evaluate_permissive(photoeye_blocked=True)  # beam blocked -> not running
    out = asyncio.run(_sup()._build_interlock_context(_state(live), "t1"))
    assert "Why not moving" in out
    assert "vfd_run_permit" in out
    assert "Suggested checks" in out


def test_no_verified_edges_yields_no_block(monkeypatch):
    _patch(monkeypatch, edges=[])
    out = asyncio.run(_sup()._build_interlock_context(_state(), "t1"))
    assert out == ""


def test_flag_off_yields_no_block(monkeypatch):
    _patch(monkeypatch, enabled=False, edges=_approved_chain())
    out = asyncio.run(_sup()._build_interlock_context(_state(), "t1"))
    assert out == ""


def test_no_tenant_yields_no_block(monkeypatch):
    _patch(monkeypatch, edges=_approved_chain())
    out = asyncio.run(_sup()._build_interlock_context(_state(), None))
    assert out == ""
