"""Unit tests — shared/manual_search (ManualSense Phase 1 port).

Pins the contract for the module ported from
``mira-scan-monday/backend/manual_search.py`` + ``crawler_bridge.py`` per
``docs/plans/2026-07-31-visual-intake-asset-identity-manualsense-audit.md``.
This package has no runtime callers yet — these tests exercise it in
isolation so the port is provably behavior-preserving before Phase 2 wires
it into ``equipment.default_manual_retriever()``.

Invariants under test (the ones the audit's acceptance-test section names):
  - Denylisted / SEO-spam hosts never score positive (never promoted).
  - A URL is only ever promoted (``validated=True``) after HEAD/magic-byte
    confirmation — an unvalidated top scorer comes back flagged, never
    silently trusted.
  - OEM-domain hits always outrank generic "trusted domain" hits for the
    SAME manufacturer (cross-OEM contamination guard).
  - No network/DB calls happen in this suite — httpx and psycopg2 are
    mocked at the boundary.

Run:
    pytest mira-bots/tests/test_manual_search.py -v
"""

from __future__ import annotations

import json
import pathlib
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import shared.manual_search.crawler_bridge as crawler_bridge
import shared.manual_search.search as search_mod

# ---------------------------------------------------------------------------
# Pure scoring / classification helpers — no mocking needed
# ---------------------------------------------------------------------------


def test_oem_domain_outranks_generic_trusted_domain():
    oem_score = search_mod._score(
        "https://literature.rockwellautomation.com/idc/groups/literature/documents/um/750-um001.pdf",
        "PowerFlex 750 User Manual",
        "Rockwell Automation",
        "750",
    )
    generic_score = search_mod._score(
        "https://docs.rs-online.com/some/powerflex-750-manual.pdf",
        "PowerFlex 750 manual",
        "Rockwell Automation",
        "750",
    )
    assert oem_score > generic_score


def test_denied_host_never_scores_positive():
    score = search_mod._score(
        "https://pdfcoffee.com/powerflex-750-manual.pdf",
        "PowerFlex 750 Manual",
        "Rockwell Automation",
        "750",
    )
    assert score == -1


def test_cross_oem_contamination_guard():
    """A Siemens host should not earn Rockwell's OEM bonus."""
    siemens_for_rockwell_query = search_mod._score(
        "https://support.industry.siemens.com/whatever.pdf",
        "PowerFlex 750 manual",  # SEO-spam title mentioning the wrong OEM's product
        "Rockwell Automation",
        "750",
    )
    rockwell_for_rockwell_query = search_mod._score(
        "https://literature.rockwellautomation.com/whatever.pdf",
        "PowerFlex 750 manual",
        "Rockwell Automation",
        "750",
    )
    # Siemens is still a globally trusted domain (100) but never gets the
    # OEM-host bonus (120) for a Rockwell query — Rockwell's own domain wins.
    assert rockwell_for_rockwell_query > siemens_for_rockwell_query


def test_model_family_prefix_token_matches():
    tokens = search_mod._model_tokens("EK1100")
    assert "ek1100" in tokens
    assert "ek110" in tokens  # family-prefix wildcard


def test_is_direct_pdf():
    assert search_mod._is_direct_pdf("https://example.com/manual.pdf") is True
    assert search_mod._is_direct_pdf("https://support.industry.siemens.com/x?format=pdf") is True
    assert search_mod._is_direct_pdf("https://example.com/manual.html") is False
    assert search_mod._is_direct_pdf("") is False


def test_clean_title_strips_pdf_marker_and_separators():
    assert search_mod._clean_title("[PDF] PowerFlex 750 - Manual |") == "PowerFlex 750 - Manual"


def test_guess_doc_type():
    assert search_mod._guess_doc_type("Technical Data Sheet", "x.pdf") == "technical_data"
    assert search_mod._guess_doc_type("Installation Guide", "x.pdf") == "installation_manual"
    assert search_mod._guess_doc_type("User Manual", "x.pdf") == "user_manual"
    assert search_mod._guess_doc_type("Quick Start Guide", "x.pdf") == "quick_start"
    assert search_mod._guess_doc_type("Something else", "x.pdf") == "installation_manual"


# ---------------------------------------------------------------------------
# search() — multi-pass fallback + validation gating
# ---------------------------------------------------------------------------


def _organic(url: str, title: str) -> dict:
    return {"link": url, "title": title}


@pytest.mark.asyncio
async def test_search_returns_none_when_serper_key_unset(monkeypatch):
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "")
    with patch.object(search_mod, "_serper_search", AsyncMock(side_effect=RuntimeError)):
        result = await search_mod.search_manual("Rockwell Automation", "750")
    # All three passes raise (no key) -> no candidates -> None
    assert result is None


@pytest.mark.asyncio
async def test_search_prefers_head_validated_candidate():
    oem_hit = _organic(
        "https://literature.rockwellautomation.com/750-um001.pdf",
        "PowerFlex 750 User Manual",
    )

    async def fake_serper(query: str, num: int = 10):
        if "site:" in query:
            return [oem_hit]
        return []

    async def fake_validate(url: str) -> bool:
        return "rockwellautomation" in url

    with (
        patch.object(search_mod, "_serper_search", fake_serper),
        patch.object(search_mod, "validate_pdf", fake_validate),
    ):
        result = await search_mod.search_manual("Rockwell Automation", "750")

    assert result is not None
    assert result["validated"] is True
    assert result["is_direct_pdf"] is True
    assert "rockwellautomation" in result["url"]


@pytest.mark.asyncio
async def test_search_never_promotes_unvalidated_candidate_silently():
    """Nothing HEAD-validates -> caller gets validated=False, never True."""
    spam_hit = _organic("https://example.com/750-manual.pdf", "PowerFlex 750 Manual")

    async def fake_serper(query: str, num: int = 10):
        return [spam_hit]

    async def fake_validate_always_false(url: str) -> bool:
        return False

    with (
        patch.object(search_mod, "_serper_search", fake_serper),
        patch.object(search_mod, "validate_pdf", fake_validate_always_false),
    ):
        result = await search_mod.search_manual("Rockwell Automation", "750")

    assert result is not None
    assert result["validated"] is False


@pytest.mark.asyncio
async def test_search_returns_none_on_empty_query():
    result = await search_mod.search_manual("", "")
    assert result is None


@pytest.mark.asyncio
async def test_search_deduplicates_and_ranks_by_score():
    low = _organic("https://docs.rs-online.com/750.pdf", "PowerFlex 750 manual")
    high = _organic("https://literature.rockwellautomation.com/750.pdf", "PowerFlex 750 manual")
    dup = _organic("https://literature.rockwellautomation.com/750.pdf", "PowerFlex 750 manual")

    async def fake_serper(query: str, num: int = 10):
        if "site:" in query:
            return [low, high, dup]
        return []

    async def fake_validate(url: str) -> bool:
        return True

    with (
        patch.object(search_mod, "_serper_search", fake_serper),
        patch.object(search_mod, "validate_pdf", fake_validate),
    ):
        result = await search_mod.search_manual("Rockwell Automation", "750")

    assert result is not None
    assert "literature.rockwellautomation.com" in result["url"]


# ---------------------------------------------------------------------------
# validate_pdf() — HEAD then Range-GET fallback, fail-closed on error
# ---------------------------------------------------------------------------


def _fake_async_client(head_response=None, get_response=None, head_raises=None):
    client = MagicMock()
    if head_raises is not None:
        client.head = AsyncMock(side_effect=head_raises)
    else:
        client.head = AsyncMock(return_value=head_response)
    client.get = AsyncMock(return_value=get_response)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _resp(status_code: int, content_type: str = "", content: bytes = b""):
    r = MagicMock()
    r.status_code = status_code
    r.headers = {"content-type": content_type}
    r.content = content
    return r


@pytest.mark.asyncio
async def test_validate_pdf_true_on_head_content_type():
    ctx = _fake_async_client(head_response=_resp(200, "application/pdf"))
    with patch.object(search_mod.httpx, "AsyncClient", return_value=ctx):
        assert await search_mod.validate_pdf("https://example.com/x.pdf") is True


@pytest.mark.asyncio
async def test_validate_pdf_falls_back_to_magic_bytes_when_head_lacks_content_type():
    ctx = _fake_async_client(
        head_response=_resp(200, ""),  # no content-type on HEAD
        get_response=_resp(206, "", b"%PDF-1.4"),
    )
    with patch.object(search_mod.httpx, "AsyncClient", return_value=ctx):
        assert await search_mod.validate_pdf("https://example.com/x") is True


@pytest.mark.asyncio
async def test_validate_pdf_false_on_404():
    ctx = _fake_async_client(
        head_response=_resp(404, ""),
        get_response=_resp(404, ""),
    )
    with patch.object(search_mod.httpx, "AsyncClient", return_value=ctx):
        assert await search_mod.validate_pdf("https://example.com/dead.pdf") is False


@pytest.mark.asyncio
async def test_validate_pdf_false_on_exception_never_raises():
    with patch.object(search_mod.httpx, "AsyncClient", side_effect=RuntimeError("boom")):
        assert await search_mod.validate_pdf("https://example.com/x.pdf") is False


# ---------------------------------------------------------------------------
# crawler_bridge — file queue + DB upsert, both fail-open
# ---------------------------------------------------------------------------


def test_append_to_manual_queue_json_creates_entry(tmp_path, monkeypatch):
    queue_path = tmp_path / "manual_queue.json"
    queue_path.write_text("[]")
    monkeypatch.setattr(crawler_bridge, "MANUAL_QUEUE_JSON_PATH", queue_path)

    added = crawler_bridge.append_to_manual_queue_json(
        url="https://literature.rockwellautomation.com/750.pdf",
        manufacturer="Rockwell Automation",
        model="750",
    )
    assert added is True
    data = json.loads(queue_path.read_text())
    assert len(data) == 1
    assert data[0]["url"] == "https://literature.rockwellautomation.com/750.pdf"
    assert data[0]["status"] == "pending"


def test_append_to_manual_queue_json_dedupes_by_url(tmp_path, monkeypatch):
    queue_path = tmp_path / "manual_queue.json"
    queue_path.write_text("[]")
    monkeypatch.setattr(crawler_bridge, "MANUAL_QUEUE_JSON_PATH", queue_path)

    url = "https://literature.rockwellautomation.com/750.pdf"
    first = crawler_bridge.append_to_manual_queue_json(
        url=url, manufacturer="Rockwell Automation", model="750"
    )
    second = crawler_bridge.append_to_manual_queue_json(
        url=url, manufacturer="Rockwell Automation", model="750"
    )
    assert first is True
    assert second is False
    assert len(json.loads(queue_path.read_text())) == 1


def test_append_to_manual_queue_json_missing_file_is_noop(tmp_path, monkeypatch):
    monkeypatch.setattr(crawler_bridge, "MANUAL_QUEUE_JSON_PATH", tmp_path / "does_not_exist.json")
    added = crawler_bridge.append_to_manual_queue_json(
        url="https://example.com/x.pdf", manufacturer="Rockwell", model="750"
    )
    assert added is False


@pytest.mark.asyncio
async def test_upsert_manual_cache_false_when_db_url_unset(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    ok = await crawler_bridge.upsert_manual_cache(
        "Rockwell Automation",
        "750",
        "https://literature.rockwellautomation.com/750.pdf",
        manual_title="PowerFlex 750 Manual",
        manual_type="user_manual",
    )
    assert ok is False


@pytest.mark.asyncio
async def test_upsert_manual_cache_never_raises_on_db_error(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake/db")
    with patch.object(
        crawler_bridge.psycopg2, "connect", side_effect=RuntimeError("connect failed")
    ):
        ok = await crawler_bridge.upsert_manual_cache(
            "Rockwell Automation",
            "750",
            "https://literature.rockwellautomation.com/750.pdf",
            manual_title=None,
            manual_type=None,
        )
    assert ok is False


@pytest.mark.asyncio
async def test_record_manual_discovery_combines_both_bridges(tmp_path, monkeypatch):
    queue_path = tmp_path / "manual_queue.json"
    queue_path.write_text("[]")
    monkeypatch.setattr(crawler_bridge, "MANUAL_QUEUE_JSON_PATH", queue_path)
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)  # DB write no-ops

    result = await crawler_bridge.record_manual_discovery(
        "Rockwell Automation",
        "750",
        manual_url="https://literature.rockwellautomation.com/750.pdf",
        manual_title="PowerFlex 750 Manual",
    )
    assert result["manual_cache_written"] is False  # no DB configured
    assert result["manual_queue_json_appended"] is True
    assert json.loads(queue_path.read_text())[0]["manufacturer"] == "Rockwell Automation"
