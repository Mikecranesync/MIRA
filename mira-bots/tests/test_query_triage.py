"""Tests for QueryTriageWorker — confidence, fail-open, gap detection."""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from shared.workers.query_triage import QueryTriageWorker


def _mock_router(response: str):
    r = AsyncMock()
    r.enabled = True
    r.complete = AsyncMock(return_value=(response, {}))
    return r


def _resp(conf, understood, gaps=None, general=False):
    return json.dumps({
        "confidence": conf,
        "understood_query": understood,
        "gaps": gaps or [],
        "inferred_context": {},
        "is_answerable_from_general_knowledge": general,
        "reasoning": "test",
    })


@pytest.mark.asyncio
async def test_high_specific():
    t = QueryTriageWorker(router=_mock_router(_resp("high", "GS20 OC fault")))
    r = await t.process("GS20 shows OC", [], "")
    assert r.confidence == "high" and r.gaps == []


@pytest.mark.asyncio
async def test_high_general_knowledge():
    t = QueryTriageWorker(router=_mock_router(_resp("high", "pump cavitation causes", general=True)))
    r = await t.process("what causes cavitation", [], "")
    assert r.confidence == "high" and r.is_answerable_from_general_knowledge


@pytest.mark.asyncio
async def test_medium_partial():
    t = QueryTriageWorker(router=_mock_router(_resp("medium", "VFD faulting", ["model_number", "fault_code"])))
    r = await t.process("my vfd is faulting", [], "")
    assert r.confidence == "medium" and "model_number" in r.gaps


@pytest.mark.asyncio
async def test_low_vague():
    t = QueryTriageWorker(router=_mock_router(_resp("low", "equipment broken", ["equipment_type"])))
    r = await t.process("its broken again", [], "")
    assert r.confidence == "low"


@pytest.mark.asyncio
async def test_fail_open_timeout():
    r = AsyncMock()
    r.enabled = True
    r.complete = AsyncMock(side_effect=asyncio.TimeoutError())
    t = QueryTriageWorker(router=r)
    result = await t.process("query", [], "")
    assert result.confidence == "high" and "timeout" in result.reasoning


@pytest.mark.asyncio
async def test_fail_open_disabled():
    t = QueryTriageWorker(router=None)
    r = await t.process("query", [], "")
    assert r.confidence == "high" and "disabled" in r.reasoning


@pytest.mark.asyncio
async def test_fail_open_bad_json():
    t = QueryTriageWorker(router=_mock_router("not json at all"))
    r = await t.process("query", [], "")
    assert r.confidence == "high"
