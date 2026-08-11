"""Unit tests: the gate must judge the REAL sources frame, not just answer text.

ARPK Phase 1e (docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md
§ "Document-scoped chat": "preserve the real source frame").

Why: the NodeChat system prompt instructs the model to cite with `[n]` markers,
and the old gate's CITATION_MARKERS included "[", "manual", and "—" — so a
hallucinated "[1]" with ZERO retrieved chunks satisfied the citation half of the
assertion. The route emits a `data: {"sources": [...]}` SSE frame listing the
actually-retrieved sources; the gate must parse it and, on an SSE surface,
require it to be non-empty before calling an answer "cited".
"""

from __future__ import annotations

import json

import httpx

from ._gate import GateConfig, _ask, _judge, _parse_sse_frames


def _cfg(cookie: str | None = None) -> GateConfig:
    return GateConfig(
        upload_url="https://dev.example/api/namespace/node/n1/files",
        chat_url="https://dev.example/api/namespace/node/n1/chat",
        tenant="t-demo",
        api_key=None,
        asset=None,
        poll_seconds=1,
        cookie=cookie,
    )


def _sse(*frames: object) -> str:
    lines = [f"data: {json.dumps(f)}\n\n" for f in frames]
    lines.append("data: [DONE]\n\n")
    return "".join(lines)


GROUNDED_ANSWER = "oC means overcurrent — output current exceeded the rated current [1]."
SOURCES_FRAME = {
    "sources": [{"index": 1, "title": "gs10_fault_codes.pdf", "page": 2, "verified": False}]
}


# ── _parse_sse_frames: answer + sources from one body ────────────────────────


def test_parse_sse_frames_returns_answer_and_sources():
    body = _sse(SOURCES_FRAME, {"content": "oC means "}, {"content": "overcurrent."})
    answer, sources = _parse_sse_frames(body)
    assert answer == "oC means overcurrent."
    assert sources == SOURCES_FRAME["sources"]


def test_parse_sse_frames_none_when_no_sources_frame():
    body = _sse({"content": "overcurrent."})
    answer, sources = _parse_sse_frames(body)
    assert answer == "overcurrent."
    assert sources is None


# ── _ask: captures the sources frame alongside the answer ────────────────────


def test_ask_captures_sources_on_sse_surface():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=_sse(SOURCES_FRAME, {"content": GROUNDED_ANSWER}),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = _ask(_cfg(), client)

    assert result.answer == GROUNDED_ANSWER
    assert result.sse is True
    assert result.sources == SOURCES_FRAME["sources"]


def test_ask_json_surface_has_no_sources_requirement():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"reply": GROUNDED_ANSWER})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = _ask(_cfg(), client)

    assert result.answer == GROUNDED_ANSWER
    assert result.sse is False
    assert result.sources is None


# ── _judge: the citation verdict ─────────────────────────────────────────────


def test_judge_rejects_hallucinated_citation_without_sources_frame():
    # SSE surface, plausible "[1]" in the text, but NO sources frame was emitted
    # (zero retrieved chunks). The old marker-only gate passed this. It must fail.
    from ._gate import AskResult

    verdict = _judge(AskResult(answer=GROUNDED_ANSWER, sources=None, sse=True))
    assert verdict.cited is False


def test_judge_rejects_empty_sources_list_on_sse():
    from ._gate import AskResult

    verdict = _judge(AskResult(answer=GROUNDED_ANSWER, sources=[], sse=True))
    assert verdict.cited is False


def test_judge_accepts_grounded_sse_answer_with_sources():
    from ._gate import AskResult

    verdict = _judge(
        AskResult(answer=GROUNDED_ANSWER, sources=SOURCES_FRAME["sources"], sse=True)
    )
    assert verdict.cited is True
    assert "sources=1" in verdict.explain


def test_judge_json_surface_keeps_marker_behavior():
    # Engine/pipeline JSON surfaces emit no sources frame; the marker+content
    # heuristic remains their (weaker, unchanged) contract.
    from ._gate import AskResult

    verdict = _judge(AskResult(answer=GROUNDED_ANSWER, sources=None, sse=False))
    assert verdict.cited is True
