"""Tests for the Telegram nameplate -> official-manual lookup fast path.

Live defect (prod, 2026-08-17): a technician sent a Danfoss VLT AQUA Drive
plate captioned *"Here's the model number can you please find the PDF user
manual for me?"* and MIRA answered that it cannot fetch external files — while
``shared/manual_search`` (search + HEAD-validate + queue) had shipped in
PR #3245 and was simply never called from this surface.

Two layers under test, both with the search seam stubbed — no network, no
inference, no Serper key (``.claude/rules/zero-token-architecture.md``):

1. ``shared.manual_lookup`` — which identifier is searched, what counts as a
   hit, and that every failure mode is a miss rather than an exception.
2. The Telegram wiring — a hit names the document and never says "can't pull
   the manual"; a miss is honest and offers the upload path; an exception
   falls through to the pre-existing behaviour with the turn still answered.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env vars needed for shared module imports (mirrors test_telegram_nameplate_ask.py).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest  # noqa: E402

from shared.manual_lookup import (  # noqa: E402
    ManualHit,
    find_official_manual,
    format_manual_found,
    lookup_identifier,
)

from bot import _try_nameplate_drive_pack_reply, engine  # noqa: E402

_MANUAL_CAPTION = "Here's the model number can you please find the PDF user manual for me?"

# The real Danfoss plate behind the defect — no approved service pack exists
# for it, which is exactly the state in which the manual lookup must fire.
_DANFOSS_FIELDS = {
    "manufacturer": "Danfoss",
    "model": "VLT AQUA Drive",
    "catalog": "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
    "part_number": "131H4017",
    "serial": "02334H073",
}

_VALIDATED_CANDIDATE = {
    "url": "https://files.danfoss.com/download/Drives/MG20N622.pdf",
    "title": "VLT AQUA Drive FC 202 Operating Instructions",
    "host": "files.danfoss.com",
    "score": 12,
    "doc_type": "operating_manual",
    "is_direct_pdf": True,
    "validated": True,
}

_QUEUE_OK = {
    "manual_cache_written": True,
    "manual_queue_json_appended": True,
    "manual_queue_path": "/tmp/manual_queue.json",
}


def _mock_photo_update_context():
    update = MagicMock()
    update.effective_chat.id = 12345
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.bot.send_chat_action = AsyncMock()
    return update, context


def _mock_nameplate_extract(fields: dict):
    return patch.object(engine.nameplate, "extract", AsyncMock(return_value=fields))


def _mock_plate_ocr(text: str = ""):
    """Stub the Tesseract floor — no binary, no image decode, no network."""
    return patch("bot.plate_ocr_text", return_value=text)


def _last_reply(update) -> str:
    return update.message.reply_text.call_args[0][0]


def _all_replies(update) -> str:
    return "\n".join(call[0][0] for call in update.message.reply_text.call_args_list)


# --------------------------------------------------------------------------- #
# shared.manual_lookup
# --------------------------------------------------------------------------- #


def test_identifier_prefers_the_model_an_oem_titles_its_manual_after():
    assert lookup_identifier(_DANFOSS_FIELDS) == "VLT AQUA Drive"


def test_identifier_falls_back_to_catalog_then_part_number():
    assert lookup_identifier({"catalog": "FC-202", "part_number": "131H4017"}) == "FC-202"
    assert lookup_identifier({"part_number": "131H4017"}) == "131H4017"


def test_identifier_is_none_when_the_plate_read_no_identifier():
    assert lookup_identifier({"manufacturer": "Danfoss"}) is None
    assert lookup_identifier({"model": "   "}) is None
    assert lookup_identifier(None) is None


@pytest.mark.asyncio
async def test_validated_candidate_becomes_a_hit_and_is_queued_for_ingest():
    search = AsyncMock(return_value=dict(_VALIDATED_CANDIDATE))
    record = AsyncMock(return_value=dict(_QUEUE_OK))
    with (
        patch("shared.manual_search.search_manual", search),
        patch("shared.manual_search.record_manual_discovery", record),
    ):
        hit = await find_official_manual("Danfoss", "VLT AQUA Drive")

    assert hit is not None
    assert hit.url == _VALIDATED_CANDIDATE["url"]
    assert hit.host == "files.danfoss.com"
    assert hit.queued is True
    # Reuses the existing search + ingest seams; never reimplements them.
    search.assert_awaited_once_with("Danfoss", "VLT AQUA Drive")
    assert record.await_args.kwargs["manual_url"] == _VALIDATED_CANDIDATE["url"]


@pytest.mark.asyncio
async def test_unvalidated_candidate_is_never_reported_as_a_manual():
    """A top scorer that didn't HEAD-validate is a lead, not a document."""
    unvalidated = dict(_VALIDATED_CANDIDATE, validated=False)
    record = AsyncMock()
    with (
        patch("shared.manual_search.search_manual", AsyncMock(return_value=unvalidated)),
        patch("shared.manual_search.record_manual_discovery", record),
    ):
        hit = await find_official_manual("Danfoss", "VLT AQUA Drive")

    assert hit is None
    record.assert_not_awaited()


@pytest.mark.asyncio
async def test_search_failure_is_a_miss_not_an_exception():
    with patch("shared.manual_search.search_manual", AsyncMock(side_effect=RuntimeError("boom"))):
        assert await find_official_manual("Danfoss", "VLT AQUA Drive") is None


@pytest.mark.asyncio
async def test_queue_failure_still_returns_the_verified_link():
    with (
        patch(
            "shared.manual_search.search_manual", AsyncMock(return_value=dict(_VALIDATED_CANDIDATE))
        ),
        patch(
            "shared.manual_search.record_manual_discovery", AsyncMock(side_effect=OSError("no db"))
        ),
    ):
        hit = await find_official_manual("Danfoss", "VLT AQUA Drive")

    assert hit is not None
    assert hit.queued is False
    assert "couldn't queue it" in format_manual_found(hit)


@pytest.mark.asyncio
async def test_lookup_is_skipped_without_a_manufacturer_or_identifier():
    search = AsyncMock()
    with patch("shared.manual_search.search_manual", search):
        assert await find_official_manual("", "VLT AQUA Drive") is None
        assert await find_official_manual("Danfoss", "  ") is None
    search.assert_not_awaited()


@pytest.mark.asyncio
async def test_rollback_lever_disables_the_lookup():
    search = AsyncMock()
    with (
        patch.dict(os.environ, {"MIRA_TELEGRAM_MANUAL_SEARCH": "0"}),
        patch("shared.manual_search.search_manual", search),
    ):
        assert await find_official_manual("Danfoss", "VLT AQUA Drive") is None
    search.assert_not_awaited()


def test_found_reply_names_the_document_its_host_and_its_url():
    text = format_manual_found(
        ManualHit(
            title="VLT AQUA Drive FC 202 Operating Instructions",
            url="https://files.danfoss.com/download/Drives/MG20N622.pdf",
            host="files.danfoss.com",
            queued=True,
        )
    )
    assert "VLT AQUA Drive FC 202 Operating Instructions" in text
    assert "files.danfoss.com" in text
    assert "https://files.danfoss.com/download/Drives/MG20N622.pdf" in text
    # Queued != indexed — never claim it is already citable.
    assert "Queued for indexing" in text


# --------------------------------------------------------------------------- #
# Telegram wiring
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_manual_request_on_a_plate_finds_and_names_the_document():
    update, context = _mock_photo_update_context()
    hit = ManualHit(
        title="VLT AQUA Drive FC 202 Operating Instructions",
        url="https://files.danfoss.com/download/Drives/MG20N622.pdf",
        host="files.danfoss.com",
        queued=True,
    )
    with (
        _mock_nameplate_extract(dict(_DANFOSS_FIELDS)),
        _mock_plate_ocr(),
        patch("bot.find_official_manual", AsyncMock(return_value=hit)) as find,
    ):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", _MANUAL_CAPTION, update, context
        )

    assert handled is True
    find.assert_awaited_once_with("Danfoss", "VLT AQUA Drive")
    # Progress first, then the result.
    assert "Looking for the official Danfoss" in update.message.reply_text.call_args_list[0][0][0]
    answer = _last_reply(update)
    assert "VLT AQUA Drive FC 202 Operating Instructions" in answer
    assert "files.danfoss.com" in answer
    assert "https://files.danfoss.com/download/Drives/MG20N622.pdf" in answer
    # The plate read still leads, and the old deflection is gone.
    assert "Read from the plate" in answer
    assert "can't pull the manual" not in _all_replies(update).lower()
    assert "cannot fetch" not in _all_replies(update).lower()


@pytest.mark.asyncio
async def test_no_validated_manual_is_said_plainly_with_the_upload_path():
    update, context = _mock_photo_update_context()
    with (
        _mock_nameplate_extract(dict(_DANFOSS_FIELDS)),
        _mock_plate_ocr(),
        patch("bot.find_official_manual", AsyncMock(return_value=None)),
    ):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", _MANUAL_CAPTION, update, context
        )

    assert handled is True
    answer = _last_reply(update)
    assert "couldn't find an official PDF" in answer
    assert "send it to me here as a PDF" in answer
    # Never invents a document, and never re-asks for what the plate already said.
    assert "http" not in answer
    assert "Read from the plate" in answer


@pytest.mark.asyncio
async def test_lookup_exception_falls_through_to_the_previous_behaviour():
    update, context = _mock_photo_update_context()
    with (
        _mock_nameplate_extract(dict(_DANFOSS_FIELDS)),
        _mock_plate_ocr(),
        patch("bot.find_official_manual", AsyncMock(side_effect=RuntimeError("serper down"))),
    ):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", _MANUAL_CAPTION, update, context
        )

    # The turn is still answered from the plate — the failure is invisible to
    # the technician beyond the pre-existing "can't pull it yet" wording.
    assert handled is True
    answer = _last_reply(update)
    assert "Read from the plate" in answer
    assert "can't pull the manual for you yet" in answer
    assert "couldn't find an official PDF" not in answer


@pytest.mark.asyncio
async def test_a_plate_with_no_documentation_request_never_searches():
    """Flow ownership is unchanged: only a paperwork caption triggers a search."""
    update, context = _mock_photo_update_context()
    find = AsyncMock()
    with (
        _mock_nameplate_extract(dict(_DANFOSS_FIELDS)),
        _mock_plate_ocr(),
        patch("bot.find_official_manual", find),
    ):
        await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "Analyze this equipment photo", update, context
        )

    find.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_resolved_service_pack_answers_from_the_pack_without_searching():
    """A live pack already has the answer — no web lookup on that path."""
    update, context = _mock_photo_update_context()
    find = AsyncMock()
    with (
        _mock_nameplate_extract({"manufacturer": "AutomationDirect", "model": "GS10"}),
        _mock_plate_ocr(),
        patch("bot.find_official_manual", find),
    ):
        handled = await _try_nameplate_drive_pack_reply(
            b"fake-jpeg-bytes", "what does the manual say about CE10?", update, context
        )

    assert handled is True
    find.assert_not_awaited()
