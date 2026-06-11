"""Unit tests for the beta-gate harness protocol (no live env).

The release gate (`_gate.run_beta_gate`) must speak two chat contracts so it can
run against either beta surface:

  * Hub **NodeChat** (`/api/namespace/node/<id>/chat`) — the surface PR #1592
    grounds. Body is a `messages` array; response is an **SSE** stream of
    `data: {"content": "..."}` deltas (+ a leading `sources` frame and a final
    `[DONE]`). This is the surface that makes an uploaded manual citable.
  * Engine / pipeline / OpenAI-compat — JSON body, JSON response.

These tests pin the harness's wire behavior so a future refactor can't silently
break the gate's ability to talk to NodeChat (which would make the gate
un-passable even after the upload→retrieval gap is closed).
"""

from __future__ import annotations

import json

import httpx

from ._gate import GateConfig, _ask, _headers, _parse_sse_answer


def _cfg(
    chat_url: str = "https://dev.example/api/namespace/node/n1/chat",
    cookie: str | None = None,
) -> GateConfig:
    return GateConfig(
        upload_url="https://dev.example/api/namespace/node/n1/files",
        chat_url=chat_url,
        tenant="t-demo",
        api_key=None,
        asset=None,
        poll_seconds=1,
        cookie=cookie,
    )


def _sse(*frames: object) -> str:
    """Render frames as a NodeChat-style SSE body, terminated with [DONE]."""
    lines = [f"data: {json.dumps(f)}\n\n" for f in frames]
    lines.append("data: [DONE]\n\n")
    return "".join(lines)


# ── _parse_sse_answer: accumulate content, ignore everything else ─────────────


def test_parse_sse_accumulates_content_deltas():
    body = _sse(
        {"sources": [{"index": 1, "title": "gs10_fault_codes", "page": 2}]},
        {"content": "Fault "},
        {"content": "oC means "},
        {"content": "overcurrent."},
    )
    assert _parse_sse_answer(body) == "Fault oC means overcurrent."


def test_parse_sse_ignores_done_and_non_content_frames():
    body = _sse({"sources": []}, {"content": "x"}, {"unrelated": "y"})
    assert _parse_sse_answer(body) == "x"


def test_parse_sse_tolerates_malformed_frames():
    body = "data: not-json\n\ndata: {\"content\": \"ok\"}\n\ndata: [DONE]\n\n"
    assert _parse_sse_answer(body) == "ok"


# ── _ask: SSE surface (NodeChat) ──────────────────────────────────────────────


def test_ask_handles_sse_and_sends_messages_array():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=_sse({"content": "oC = "}, {"content": "overcurrent"}),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        answer = _ask(_cfg(), client)

    assert answer == "oC = overcurrent"
    # NodeChat requires a messages array, else it 400s "messages array required".
    body = seen["body"]
    assert isinstance(body, dict)
    assert body.get("messages") == [
        {"role": "user", "content": "What does GS10 fault code oC mean?"}
    ]


def test_ask_detects_sse_by_body_when_content_type_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        # Some proxies strip the content-type — detect SSE by the body shape.
        return httpx.Response(200, text=_sse({"content": "overcurrent"}))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert _ask(_cfg(), client) == "overcurrent"


# ── auth headers: Hub NodeChat needs a session COOKIE, not a bearer ───────────


def test_headers_forward_session_cookie():
    cookie = "next-auth.session-token=abc.def.ghi"
    h = _headers(_cfg(cookie=cookie))
    assert h["Cookie"] == cookie
    assert h["X-Tenant-Id"] == "t-demo"


def test_headers_omit_cookie_when_unset():
    assert "Cookie" not in _headers(_cfg())


def test_ask_sends_cookie_header_to_nodechat():
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie")
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=_sse({"content": "overcurrent"}),
        )

    cookie = "next-auth.session-token=abc.def.ghi"
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        answer = _ask(_cfg(cookie=cookie), client)

    assert answer == "overcurrent"
    assert seen["cookie"] == cookie


# ── _ask: JSON surfaces still work (backward compatibility) ───────────────────


def test_ask_json_reply_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"reply": "overcurrent fault"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert _ask(_cfg(), client) == "overcurrent fault"


def test_ask_openai_choices_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "overcurrent"}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert _ask(_cfg(), client) == "overcurrent"
