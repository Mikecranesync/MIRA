"""The intent classifier is a BOUNDED lane with honest usage attribution (Codex r1 on #4359).

Two findings on the first review of #4359, both reproduced here against the REAL
InferenceRouter with a fake HTTP client (no network):

F1 — the classifier asked for 300 tokens, but when a provider burned them all on
     reasoning and returned no content, the shared router's one reasoning-burn
     retry re-sent the request with LLM_REASONING_RETRY_MAX_TOKENS (8,192)
     headroom. The "300-token cap" was a 8,192-token lane. `reasoning_retry=False`
     makes the cap hard: one capped attempt per provider, never the headroom.
F2 — every tenant's classification usage was written with
     session_id="conversation_router", which write_api_usage splits into
     tenant_id="conversation", platform="router". The engine now hands its own
     session id (str(chat_id), tenant_platform_chat) through route_intent, so
     each usage row names the tenant and platform it served.

Run: cd mira-bots && python3 -m pytest tests/test_conversation_router_bounded.py -q
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared import conversation_router as cr  # noqa: E402
from shared.inference.router import InferenceRouter  # noqa: E402

CLASSIFY = '{"intent": "diagnose_equipment", "confidence": 0.9, "reasoning": "fault"}'


def _response(content: str, completion_tokens: int):
    fake = MagicMock()
    fake.raise_for_status = MagicMock()
    fake.json = MagicMock(
        return_value={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 120, "completion_tokens": completion_tokens},
        }
    )
    return fake


class _FakeAsyncClient:
    """Async context manager whose .post records the request and pops a queued reply."""

    queue: list = []
    posts: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        _FakeAsyncClient.posts.append({"url": url, "json": dict(json)})
        return _FakeAsyncClient.queue.pop(0)


def _queue(*responses) -> None:
    _FakeAsyncClient.queue = list(responses)
    _FakeAsyncClient.posts = []


def _provider():
    p = MagicMock()
    p.name = "openai"
    p.model = "gpt-5.4-mini"
    p.vision_model = None
    p.api_url = "https://api.openai.com/v1/chat/completions"
    p.api_key = "sk-test"
    p.timeout = 30
    return p


@pytest.fixture
def real_router(monkeypatch: pytest.MonkeyPatch) -> InferenceRouter:
    """A real InferenceRouter with ONE fake OpenAI-compatible provider and a
    capturing usage writer, installed as the classifier's shared router."""
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "cloud"}, clear=True):
        with patch("shared.inference.router._build_providers", return_value=[]):
            r = InferenceRouter()
    r.providers = [_provider()]
    r.enabled = True
    r.write_api_usage = MagicMock()
    monkeypatch.setattr(cr, "_get_router", lambda: r)
    return r


# ---------------------------------------------------------------------------
# F1 — the 300-token cap is hard: a reasoning burn is NOT retried at 8,192
# ---------------------------------------------------------------------------


async def test_reasoning_burn_is_not_retried_beyond_the_classifier_cap(real_router) -> None:
    # The provider spends all 300 tokens reasoning and returns nothing visible.
    _queue(_response("", completion_tokens=300))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        out = await cr._call_router_llm([{"role": "user", "content": "the drive faulted"}])
    caps = [p["json"]["max_tokens"] for p in _FakeAsyncClient.posts]
    assert caps == [300], caps  # one attempt, at the declared cap — never [300, 8192]
    assert '"continue_current"' in out  # the honest fallback, not a bigger bill


async def test_control_the_shared_router_still_retries_a_burn_for_unbounded_callers(
    real_router,
) -> None:
    # Same provider, same burn, called the ordinary way (the default) — the
    # reasoning-burn retry the chat path relies on is unchanged.
    _queue(_response("", completion_tokens=1024), _response("answer", completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        content, _ = await real_router.complete(
            [{"role": "user", "content": "what does FF mean"}], max_tokens=1024, session_id="t_tg_1"
        )
    assert content == "answer"
    assert [p["json"]["max_tokens"] for p in _FakeAsyncClient.posts] == [1024, 8192]


async def test_served_classification_is_one_capped_request(real_router) -> None:
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        out = await cr._call_router_llm([{"role": "user", "content": "the drive faulted"}])
    assert out == CLASSIFY
    assert [p["json"]["max_tokens"] for p in _FakeAsyncClient.posts] == [300]


# ---------------------------------------------------------------------------
# F2 — usage is attributed to the session that asked, not a fictitious tenant
# ---------------------------------------------------------------------------


async def test_usage_rows_carry_each_callers_session_identity(real_router) -> None:
    # Two tenants on two platforms classify a turn each.
    _queue(_response(CLASSIFY, completion_tokens=40), _response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        await cr.route_intent("the drive faulted", [], "IDLE", "", session_id="acme_telegram_1001")
        await cr.route_intent("send me the manual", [], "IDLE", "", session_id="globex_slack_C42")
    sessions = [c.kwargs["session_id"] for c in real_router.write_api_usage.call_args_list]
    assert sessions == ["acme_telegram_1001", "globex_slack_C42"]
    assert "conversation_router" not in sessions


async def test_usage_row_without_a_session_falls_back_to_the_routers_unknown_triplet(
    real_router,
) -> None:
    # A caller that has no session (tests, tools) is recorded as unknown, which
    # the writer splits into tenant "unknown" / platform "unknown" — never into
    # a word pair that reads like a real tenant.
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        await cr.route_intent("the drive faulted", [], "IDLE", "")
    (call,) = real_router.write_api_usage.call_args_list
    assert call.kwargs["session_id"] == "unknown_unknown_unknown"


def test_engine_hands_its_session_id_to_route_intent() -> None:
    # Source contract: the one production caller passes the chat's own identity.
    src = Path(cr.__file__).with_name("engine.py").read_text(encoding="utf-8")
    m = re.search(r"await route_intent\((.*?)\)\n", src, re.S)
    assert m, "route_intent call not found"
    assert "session_id=str(chat_id)" in m.group(1), m.group(1)


def test_classifier_source_declares_the_bounded_lane() -> None:
    src = Path(cr.__file__).read_text(encoding="utf-8")
    assert "reasoning_retry=False" in src
    assert 'session_id="conversation_router"' not in src
