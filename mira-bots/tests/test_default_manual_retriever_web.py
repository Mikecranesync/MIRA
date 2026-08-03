"""Tests — ManualSense Phase 2: equipment.default_manual_retriever()'s web rungs.

Per ``docs/plans/2026-07-31-visual-intake-asset-identity-manualsense-audit.md``
§6 Phase 2: wires the ported ``shared.manual_search`` module into
``default_manual_retriever()`` as rungs 4-6 of the lookup ladder, gated behind
``MIRA_MANUAL_SENSE_WEB_ENABLED`` (default off).

Hermetic: no network, no DB. ``_local_manual_citations`` (rungs 1-2) and
``shared.manual_search.search_manual`` / ``record_manual_discovery`` are
monkeypatched at their call-site boundary.

Invariants under test:
  - Flag OFF (default) -> the web rung never runs, even on a local-KB miss
    with manufacturer+model known.
  - Local KB already has a citation -> web rung never runs (recall-first;
    rung 4 only fires on a genuine miss, per audit §4.4).
  - No model known (e.g. the existing 3-positional-arg answer_equipment call
    site) -> web rung never runs.
  - Flag ON + KB miss + manufacturer/model known + a validated candidate ->
    search_manual() is called with (manufacturer, model), and a validated hit
    is queued via record_manual_discovery() with the candidate's url/title/
    doc_type.
  - An UNVALIDATED candidate (rung 6 discipline: "candidate, never promoted")
    is never queued.
  - default_manual_retriever's return value is ALWAYS just the local-KB
    citations -- the web rung never fabricates a citation/excerpt for a
    document nothing has extracted text from yet.
  - search_manual raising, or the manual_search import failing, degrades to
    the local-KB citations -- never raises, never crashes the caller.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import shared.manual_search as manual_search_pkg  # noqa: E402
import shared.visual.equipment as equipment  # noqa: E402


VALIDATED_CANDIDATE = {
    "url": "https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf",
    "title": "PowerFlex 520-Series Adjustable Frequency AC Drive User Manual",
    "host": "literature.rockwellautomation.com",
    "score": 175,
    "doc_type": "user_manual",
    "is_direct_pdf": True,
    "validated": True,
}

UNVALIDATED_CANDIDATE = {**VALIDATED_CANDIDATE, "validated": False}


@pytest.fixture(autouse=True)
def _no_web_rung_by_default(monkeypatch):
    """Every test starts with the flag explicitly unset (default off)."""
    monkeypatch.delenv("MIRA_MANUAL_SENSE_WEB_ENABLED", raising=False)


def _patch_local_citations(monkeypatch, citations: list[dict]):
    fake = AsyncMock(return_value=citations)
    monkeypatch.setattr(equipment, "_local_manual_citations", fake)
    return fake


@pytest.mark.asyncio
async def test_flag_off_never_calls_web_search_even_on_miss(monkeypatch):
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=VALIDATED_CANDIDATE)
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)

    result = await equipment.default_manual_retriever(
        "what fault codes does this have?", "tenant-1", "Rockwell", "PowerFlex 525"
    )

    assert result == []
    search_fake.assert_not_called()


@pytest.mark.asyncio
async def test_local_kb_hit_short_circuits_web_rung(monkeypatch):
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    local_citation = {"doc": "PowerFlex 525 manual", "page": 12, "excerpt": "F007 = Motor Overload"}
    _patch_local_citations(monkeypatch, [local_citation])
    search_fake = AsyncMock(return_value=VALIDATED_CANDIDATE)
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)

    result = await equipment.default_manual_retriever(
        "what does F007 mean?", "tenant-1", "Rockwell", "PowerFlex 525"
    )

    assert result == [local_citation]
    search_fake.assert_not_called()


@pytest.mark.asyncio
async def test_no_model_known_never_calls_web_search(monkeypatch):
    """The existing answer_equipment call site passes only 3 positional args
    -- model defaults to None -- and must be unaffected by this change."""
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=VALIDATED_CANDIDATE)
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)

    result = await equipment.default_manual_retriever("a question", "tenant-1", "Rockwell")

    assert result == []
    search_fake.assert_not_called()


@pytest.mark.asyncio
async def test_flag_on_miss_and_validated_hit_queues_discovery(monkeypatch):
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=VALIDATED_CANDIDATE)
    record_fake = AsyncMock(
        return_value={"manual_cache_written": True, "manual_queue_json_appended": True}
    )
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)
    monkeypatch.setattr(manual_search_pkg, "record_manual_discovery", record_fake)

    result = await equipment.default_manual_retriever(
        "what fault codes does this have?", "tenant-1", "Rockwell", "PowerFlex 520"
    )

    # No fabricated citation this turn -- the document hasn't been ingested yet.
    assert result == []
    search_fake.assert_awaited_once_with("Rockwell", "PowerFlex 520")
    record_fake.assert_awaited_once_with(
        "Rockwell",
        "PowerFlex 520",
        manual_url=VALIDATED_CANDIDATE["url"],
        manual_title=VALIDATED_CANDIDATE["title"],
        manual_type=VALIDATED_CANDIDATE["doc_type"],
    )


@pytest.mark.asyncio
async def test_unvalidated_candidate_is_never_queued(monkeypatch):
    """Rung 6 discipline: a candidate the HEAD/magic-byte check couldn't
    confirm is a PDF is held for human review, never auto-queued for the
    ingestion cron."""
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=UNVALIDATED_CANDIDATE)
    record_fake = AsyncMock()
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)
    monkeypatch.setattr(manual_search_pkg, "record_manual_discovery", record_fake)

    result = await equipment.default_manual_retriever(
        "a question", "tenant-1", "Rockwell", "PowerFlex 520"
    )

    assert result == []
    record_fake.assert_not_called()


@pytest.mark.asyncio
async def test_no_candidate_found_is_a_quiet_noop(monkeypatch):
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=None)
    record_fake = AsyncMock()
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)
    monkeypatch.setattr(manual_search_pkg, "record_manual_discovery", record_fake)

    result = await equipment.default_manual_retriever(
        "a question", "tenant-1", "Rockwell", "PowerFlex 520"
    )

    assert result == []
    record_fake.assert_not_called()


@pytest.mark.asyncio
async def test_search_manual_raising_degrades_to_local_citations_never_raises(monkeypatch):
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(side_effect=RuntimeError("serper is down"))
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)

    result = await equipment.default_manual_retriever(
        "a question", "tenant-1", "Rockwell", "PowerFlex 520"
    )

    assert result == []


@pytest.mark.asyncio
async def test_record_manual_discovery_raising_never_propagates(monkeypatch):
    monkeypatch.setenv("MIRA_MANUAL_SENSE_WEB_ENABLED", "1")
    _patch_local_citations(monkeypatch, [])
    search_fake = AsyncMock(return_value=VALIDATED_CANDIDATE)
    record_fake = AsyncMock(side_effect=RuntimeError("neon is down"))
    monkeypatch.setattr(manual_search_pkg, "search_manual", search_fake)
    monkeypatch.setattr(manual_search_pkg, "record_manual_discovery", record_fake)

    result = await equipment.default_manual_retriever(
        "a question", "tenant-1", "Rockwell", "PowerFlex 520"
    )

    assert result == []


@pytest.mark.asyncio
async def test_local_citations_bypass_still_runs_when_flag_off(monkeypatch):
    """Sanity: the local-KB rungs are completely unaffected by this feature
    -- with the flag off, default_manual_retriever behaves exactly as before
    Phase 2 for a normal local-KB hit."""
    local_citation = {"doc": "GS10 pack", "page": "fault_codes", "excerpt": "CE10: modbus timeout"}
    _patch_local_citations(monkeypatch, [local_citation])

    result = await equipment.default_manual_retriever(
        "what does CE10 mean?", "tenant-1", "AutomationDirect", "GS10"
    )

    assert result == [local_citation]
