"""Unit tests — Nemotron/NIM fallback must be LOUD (#2257).

A silent reranker/embed outage is the worst failure mode for a grounding-first
product: retrieval still returns results, just un-reranked (worse) ones, with
nothing an ops dashboard or canary can alert on. These tests pin the contract:

  1. When a NIM call fails, the method still returns its graceful fallback
     (original order / None) — behavior is preserved.
  2. It ALSO emits a distinct ERROR-level marker ``NEMOTRON_<OP>_FALLBACK``
     carrying the HTTP status, so a 404-on-every-call outage is alertable.
  3. When the client is disabled (no key), there is no network call and no
     fallback marker — only real outages are loud.

All mocked — no NVIDIA_API_KEY, network, or NeonDB required.

Run:
    pytest mira-bots/tests/test_nemotron_fallback.py -v
"""

import logging
import pathlib
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from shared.nemotron import NemotronClient


def _raise_404(*_args, **_kwargs):
    req = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/ranking")
    resp = httpx.Response(404, request=req)
    raise httpx.HTTPStatusError("404 Not Found", request=req, response=resp)


def _fake_client_raising():
    """An ``async with httpx.AsyncClient() as c`` stand-in whose .post 404s."""
    client = MagicMock()
    client.post = AsyncMock(side_effect=_raise_404)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _fallback_records(caplog):
    return [r for r in caplog.records if "_FALLBACK" in r.getMessage()]


@pytest.mark.asyncio
async def test_rerank_fallback_preserves_order_and_is_loud(caplog, monkeypatch):
    # Hop explicitly enabled — the loud-on-failure contract applies to a LIVE
    # rerank hop; the default is OFF (hosted NIM ranking EOL, #2257).
    monkeypatch.setenv("NEMOTRON_RERANK_ENABLED", "1")
    client = NemotronClient(api_key="test-key")
    with patch("shared.nemotron.httpx.AsyncClient", return_value=_fake_client_raising()):
        with caplog.at_level(logging.ERROR, logger="mira-gsd"):
            out = await client.rerank("why fault", ["p0", "p1", "p2"], top_n=2)

    # (1) graceful fallback preserved: original order, top_n honored, texts intact
    assert [r["index"] for r in out] == [0, 1]
    assert [r["text"] for r in out] == ["p0", "p1"]

    # (2) loud + alertable: distinct ERROR marker carrying the 404 status
    recs = [r for r in _fallback_records(caplog) if "NEMOTRON_RERANK_FALLBACK" in r.getMessage()]
    assert recs, "expected a NEMOTRON_RERANK_FALLBACK marker"
    assert recs[0].levelno == logging.ERROR
    msg = recs[0].getMessage()
    assert '"status": 404' in msg
    assert '"passages_in": 3' in msg


@pytest.mark.asyncio
async def test_embed_fallback_returns_none_and_is_loud(caplog):
    client = NemotronClient(api_key="test-key")
    with patch("shared.nemotron.httpx.AsyncClient", return_value=_fake_client_raising()):
        with caplog.at_level(logging.ERROR, logger="mira-gsd"):
            out = await client.embed("some text")

    assert out is None
    recs = [r for r in _fallback_records(caplog) if "NEMOTRON_EMBED_FALLBACK" in r.getMessage()]
    assert recs and recs[0].levelno == logging.ERROR
    assert '"status": 404' in recs[0].getMessage()


@pytest.mark.asyncio
async def test_disabled_client_makes_no_noise(caplog):
    # No API key → disabled → no network call, no fallback marker. Only real
    # outages (enabled + failing) are loud, so this can't spam CI/offline logs.
    client = NemotronClient(api_key="")
    with caplog.at_level(logging.ERROR, logger="mira-gsd"):
        out = await client.rerank("q", ["p0", "p1"])

    assert [r["index"] for r in out] == [0, 1]
    assert not _fallback_records(caplog)


@pytest.mark.asyncio
async def test_rerank_default_off_no_network_no_noise(caplog):
    # Default (NEMOTRON_RERANK_ENABLED unset): the hosted NIM ranking API is
    # EOL (#2257 — /v1/ranking 404s, successor NIM 410 Gone since 2026-05-18),
    # so the hop must not fire: original order back, ZERO HTTP calls, and no
    # NEMOTRON_RERANK_FALLBACK alert spamming ops on every retrieval.
    client = NemotronClient(api_key="test-key")
    assert client.enabled and not client.rerank_enabled

    with patch("shared.nemotron.httpx.AsyncClient") as mock_client:
        with caplog.at_level(logging.ERROR, logger="mira-gsd"):
            out = await client.rerank("why fault", ["p0", "p1", "p2"], top_n=2)

    assert [r["index"] for r in out] == [0, 1]
    assert [r["text"] for r in out] == ["p0", "p1"]
    mock_client.assert_not_called()
    assert not _fallback_records(caplog)
