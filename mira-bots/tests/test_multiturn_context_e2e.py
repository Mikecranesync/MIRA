"""E2E: the enriched query actually flows through _call_with_correction (#2209).

Proves the helper is WIRED into the engine (not dead code): we drive the real
Supervisor._call_with_correction, spy on the query passed to self.rag.process, and
assert equipment context is prepended for active text turns, is absent for
IDLE / low-confidence / photo turns, and reaches the Nemotron self-critique
rewrite on retry — with no duplicated prefixes. The response-processing tail
(_parse_response / _is_grounded / context builders) is stubbed so the test
isolates query construction.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared.engine import Supervisor  # noqa: E402


def _make_supervisor():
    return Supervisor(
        db_path=":memory:",
        openwebui_url="http://localhost:8080",
        api_key="test_key",
        collection_id="test_collection",
        vision_model="test_model",
        tenant_id="tenant-test",
    )


def _active_state(
    manufacturer="Rockwell", model="PowerFlex 525", fault_code="F004", confidence=0.9
):
    uns = {"manufacturer": manufacturer, "confidence": confidence}
    if model:
        uns["model"] = model
    if fault_code:
        uns["fault_code"] = fault_code
    return {"state": "DIAGNOSIS", "context": {"uns_context": uns}}


def _patched(sup, *, grounded=True):
    """Patch everything after rag.process so _call_with_correction returns quickly.
    grounded=False forces the Nemotron retry path."""
    sup.rag.process = AsyncMock(return_value="{}")
    sup._parse_response = MagicMock(return_value={"reply": "ok"})
    sup._is_grounded = MagicMock(return_value=grounded)
    return patch.multiple(
        sup,
        _build_kg_context=AsyncMock(return_value=""),
        _build_live_data_context=AsyncMock(return_value=""),
        _build_ctx_signals_context=AsyncMock(return_value=""),
        _build_interlock_context=AsyncMock(return_value=""),
        _build_wo_evidence_context=AsyncMock(return_value=""),
    )


async def _query_sent(sup, message, state, photo_b64=None):
    with _patched(sup):
        await sup._call_with_correction(message, state, photo_b64=photo_b64, tenant_id="t")
    return sup.rag.process.call_args.args[0]


class TestMultiturnContextE2E:
    @pytest.mark.asyncio
    async def test_active_text_turn_prepends_mfr_model_fault(self):
        sup = _make_supervisor()
        q = await _query_sent(sup, "haven't meggered it yet", _active_state())
        for token in ("Rockwell", "PowerFlex 525", "F004", "haven't meggered it yet"):
            assert token in q, f"{token!r} missing from {q!r}"

    @pytest.mark.asyncio
    async def test_each_equipment_token_appears_once(self):
        sup = _make_supervisor()
        q = await _query_sent(sup, "next step?", _active_state())
        assert q.count("Rockwell") == 1
        assert q.count("PowerFlex 525") == 1
        assert q.count("F004") == 1

    @pytest.mark.asyncio
    async def test_idle_turn_sends_raw_message(self):
        sup = _make_supervisor()
        state = _active_state()
        state["state"] = "IDLE"
        q = await _query_sent(sup, "hello there", state)
        assert q == "hello there"

    @pytest.mark.asyncio
    async def test_low_confidence_sends_raw_message(self):
        sup = _make_supervisor()
        q = await _query_sent(sup, "any ideas?", _active_state(confidence=0.5))
        assert q == "any ideas?"

    @pytest.mark.asyncio
    async def test_photo_turn_not_engine_prepended(self):
        sup = _make_supervisor()
        # Photo path enriches in the worker; the engine must NOT prepend (no double).
        q = await _query_sent(sup, "what does this say?", _active_state(), photo_b64="ZmFrZQ==")
        assert q == "what does this say?"

    @pytest.mark.asyncio
    async def test_nemotron_retry_receives_enriched_query(self):
        sup = _make_supervisor()
        sup.nemotron = MagicMock()
        sup.nemotron.enabled = True
        sup.nemotron.rewrite_query = AsyncMock(return_value="rewritten")
        with _patched(sup, grounded=False):  # never grounded -> triggers the retry
            await sup._call_with_correction(
                "haven't meggered it yet", _active_state(), photo_b64=None, tenant_id="t"
            )
        # The rewrite must receive the ENRICHED query, not the bare message.
        call = sup.nemotron.rewrite_query.call_args
        rewrite_query_arg = call.kwargs.get("query") or (call.args[0] if call.args else "")
        for token in ("Rockwell", "PowerFlex 525", "F004"):
            assert token in rewrite_query_arg, (
                f"{token!r} missing from rewrite input {rewrite_query_arg!r}"
            )
        # And no duplicated prefix in the query first sent to rag.process.
        first_query = sup.rag.process.call_args_list[0].args[0]
        assert first_query.count("Rockwell") == 1
