"""Tests for shared.agentic_retrieval — Component 1 (query decomposition).

All Groq HTTP calls are mocked; offline-safe.
"""

from __future__ import annotations

import json
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.agentic_retrieval import (  # noqa: E402
    _parse_subqueries,
    decompose_query,
    is_decompose_enabled,
    merge_subquery_results,
)


def _mock_groq_response(content_obj: dict | str) -> MagicMock:
    content_str = content_obj if isinstance(content_obj, str) else json.dumps(content_obj)
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"choices": [{"message": {"content": content_str}}]})
    return resp


def _patch_async_client(post_return=None, post_side_effect=None):
    mock_client = patch("shared.agentic_retrieval.httpx.AsyncClient")
    handle = mock_client.start()
    instance = AsyncMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=None)
    if post_side_effect is not None:
        instance.post = AsyncMock(side_effect=post_side_effect)
    else:
        instance.post = AsyncMock(return_value=post_return)
    handle.return_value = instance
    return mock_client, handle


# ---------------------------------------------------------------------------
# _parse_subqueries
# ---------------------------------------------------------------------------


class TestParseSubqueries:
    def test_clean_json(self):
        raw = json.dumps({"subqueries": ["fault code F004", "PowerFlex 525 trips on startup"]})
        assert _parse_subqueries(raw) == [
            "fault code F004",
            "PowerFlex 525 trips on startup",
        ]

    def test_fenced_json(self):
        raw = '```json\n{"subqueries": ["a", "b"]}\n```'
        assert _parse_subqueries(raw) == ["a", "b"]

    def test_dedupes_case_insensitive(self):
        raw = json.dumps({"subqueries": ["Foo", "foo", "bar"]})
        assert _parse_subqueries(raw) == ["Foo", "bar"]

    def test_drops_blanks_and_non_strings(self):
        raw = json.dumps({"subqueries": ["", "ok", 42, None, "  "]})
        assert _parse_subqueries(raw) == ["ok"]

    def test_garbage_returns_empty(self):
        assert _parse_subqueries("not json") == []
        assert _parse_subqueries("") == []
        assert _parse_subqueries(json.dumps({"queries": "wrong type"})) == []

    def test_accepts_alt_key(self):
        raw = json.dumps({"queries": ["x", "y"]})
        assert _parse_subqueries(raw) == ["x", "y"]


# ---------------------------------------------------------------------------
# is_decompose_enabled / skip paths
# ---------------------------------------------------------------------------


class TestSkipPaths:
    @pytest.mark.asyncio
    async def test_flag_off_returns_original(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "0")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        with patch("shared.agentic_retrieval.httpx.AsyncClient") as mock_client:
            out = await decompose_query("why does my PowerFlex 525 trip on overcurrent at startup")
            assert out == ["why does my PowerFlex 525 trip on overcurrent at startup"]
            mock_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_short_query_skipped(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        with patch("shared.agentic_retrieval.httpx.AsyncClient") as mock_client:
            out = await decompose_query("VFD trip")
            assert out == ["VFD trip"]
            mock_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_groq_key_skipped(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "")
        with patch("shared.agentic_retrieval.httpx.AsyncClient") as mock_client:
            out = await decompose_query("why does my PowerFlex 525 trip on overcurrent at startup")
            assert out == ["why does my PowerFlex 525 trip on overcurrent at startup"]
            mock_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_question_returns_input(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        out = await decompose_query("")
        assert out == [""]

    def test_is_decompose_enabled(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "0")
        assert is_decompose_enabled() is False
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        assert is_decompose_enabled() is True


# ---------------------------------------------------------------------------
# decompose_query — happy path + failure
# ---------------------------------------------------------------------------


class TestDecomposeQuery:
    @pytest.mark.asyncio
    async def test_groq_success_returns_subqueries(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        mock_resp = _mock_groq_response(
            {
                "subqueries": [
                    "PowerFlex 525 fault code F004",
                    "PowerFlex 525 motor sizing 10HP",
                    "PowerFlex 525 acceleration time parameter",
                ]
            }
        )
        ctx, _ = _patch_async_client(post_return=mock_resp)
        try:
            q = "Why does my PowerFlex 525 trip on overcurrent at startup with a 10HP motor"
            out = await decompose_query(q)
        finally:
            ctx.stop()

        assert len(out) >= 3
        # Original question is always included for safety.
        assert q in out
        # Spec subqueries preserved verbatim.
        assert "PowerFlex 525 fault code F004" in out

    @pytest.mark.asyncio
    async def test_groq_already_includes_original(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        q = "What does fault F004 mean on a PowerFlex 525"
        mock_resp = _mock_groq_response({"subqueries": [q, "F004 overcurrent meaning"]})
        ctx, _ = _patch_async_client(post_return=mock_resp)
        try:
            out = await decompose_query(q)
        finally:
            ctx.stop()
        # Original not duplicated.
        assert out.count(q) == 1

    @pytest.mark.asyncio
    async def test_max_cap_enforced(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        monkeypatch.setenv("MIRA_DECOMPOSE_MAX_SUBQUERIES", "4")
        # Reload module to pick up env override at import-time constant.
        import importlib

        from shared import agentic_retrieval

        importlib.reload(agentic_retrieval)

        mock_resp = _mock_groq_response({"subqueries": [f"sub{i}" for i in range(8)]})
        ctx, _ = _patch_async_client(post_return=mock_resp)
        try:
            out = await agentic_retrieval.decompose_query(
                "tell me everything about VFDs and motors and faults and parameters"
            )
        finally:
            ctx.stop()
        assert len(out) <= 4

    @pytest.mark.asyncio
    async def test_groq_failure_fails_open(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        ctx, _ = _patch_async_client(post_side_effect=RuntimeError("network down"))
        try:
            q = "why does my PowerFlex 525 trip on overcurrent at startup"
            out = await decompose_query(q)
        finally:
            ctx.stop()
        assert out == [q]

    @pytest.mark.asyncio
    async def test_groq_returns_unparseable_fails_open(self, monkeypatch):
        monkeypatch.setenv("MIRA_QUERY_DECOMPOSE", "1")
        monkeypatch.setenv("GROQ_API_KEY", "k")
        mock_resp = _mock_groq_response("definitely not json {{{")
        ctx, _ = _patch_async_client(post_return=mock_resp)
        try:
            q = "why does my PowerFlex 525 trip on overcurrent at startup"
            out = await decompose_query(q)
        finally:
            ctx.stop()
        assert out == [q]


# ---------------------------------------------------------------------------
# merge_subquery_results
# ---------------------------------------------------------------------------


class TestMergeSubqueryResults:
    def test_dedup_by_content_prefix(self):
        c1 = "PowerFlex 525 F004 overcurrent during acceleration ramp"
        chunk = {"content": c1, "manufacturer": "AB", "similarity": 0.9}
        per = [[chunk], [dict(chunk)]]
        merged = merge_subquery_results(per, limit=10)
        assert len(merged) == 1
        # rrf_score reflects the chunk being seen twice.
        assert merged[0]["rrf_score"] > 0

    def test_cross_subquery_agreement_wins(self):
        a = {"content": "A" * 120, "similarity": 0.5}
        b = {"content": "B" * 120, "similarity": 0.9}
        # `a` ranked #1 in two streams; `b` only in one.
        per = [[a, b], [a]]
        merged = merge_subquery_results(per, limit=10)
        assert merged[0]["content"].startswith("A")

    def test_limit_respected(self):
        per = [
            [{"content": f"chunk-{i}-" + "x" * 100} for i in range(5)],
            [{"content": f"chunk-{i}-" + "y" * 100} for i in range(5, 10)],
        ]
        merged = merge_subquery_results(per, limit=3)
        assert len(merged) == 3

    def test_empty_input(self):
        assert merge_subquery_results([], limit=6) == []
        assert merge_subquery_results([[], []], limit=6) == []

    def test_skips_empty_content(self):
        per = [[{"content": ""}, {"content": "real chunk " + "x" * 100}]]
        merged = merge_subquery_results(per, limit=6)
        assert len(merged) == 1
        assert merged[0]["content"].startswith("real chunk")
