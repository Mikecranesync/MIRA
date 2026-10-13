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

import asyncio
import re
import sqlite3
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


def test_engine_hands_an_accounting_identity_to_route_intent() -> None:
    # Source contract: the one production caller builds tenant_platform_chat
    # from the authenticated tenant and the surface — never the bare chat key.
    src = Path(cr.__file__).with_name("engine.py").read_text(encoding="utf-8")
    idx = src.find("await route_intent(")
    assert idx > 0, "route_intent call not found"
    call = re.sub(r"\s+", " ", src[idx : idx + 1200])
    assert re.search(
        r"session_id=accounting_session_id\( ?tenant_id or self\.tenant_id, platform, chat_id,? ?\)",
        call,
    ), call
    assert "session_id=str(chat_id)" not in call
    # And the surface actually reaches that call: process → process_full → _process_full_impl.
    assert re.search(r"self\.process_full\([^)]*platform=platform", src, re.S), (
        "process() drops platform"
    )
    assert re.search(r"self\._process_full_impl\([^)]*platform=platform", src, re.S), (
        "process_full() drops platform"
    )


# ---------------------------------------------------------------------------
# Codex r2 F2 — production session identities: Ignition's chat key is
# "ignition:acme:press7" (colons), the usage writer splits on underscores, and
# the Ignition preflight classifier passed no session at all.
# ---------------------------------------------------------------------------


def test_accounting_session_id_is_tenant_platform_chat() -> None:
    assert (
        cr.accounting_session_id("acme", "ignition", "ignition:acme:press7")
        == "acme_ignition_ignition:acme:press7"
    )
    assert cr.accounting_session_id("acme", "telegram", 1001) == "acme_telegram_1001"
    assert cr.accounting_session_id("", None, None) == "unknown_unknown_unknown"
    assert cr.accounting_session_id("  acme ", " slack ", "C42") == "acme_slack_C42"


async def test_ignition_turn_is_attributed_to_its_tenant_on_the_ignition_platform(
    real_router, tmp_path
) -> None:
    # The REAL usage writer (sqlite row), fed the identity the engine now builds
    # for an authenticated Ignition turn — the exact production chat key shape.
    db = tmp_path / "mira.db"
    db.touch()
    real_router.write_api_usage = (
        InferenceRouter.write_api_usage
    )  # un-mock: capture the actual insert
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch.dict("os.environ", {"MIRA_DB_PATH": str(db)}):
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            await cr.route_intent(
                "drive faulted",
                [],
                "IDLE",
                "",
                session_id=cr.accounting_session_id("acme", "ignition", "ignition:acme:press7"),
            )
    rows = (
        sqlite3.connect(str(db))
        .execute("SELECT tenant_id, platform, session_id FROM api_usage")
        .fetchall()
    )
    assert rows == [("acme", "ignition", "acme_ignition_ignition:acme:press7")]


async def test_control_the_bare_ignition_chat_key_is_the_defect(real_router, tmp_path) -> None:
    # Pinned: the writer READS the bare chat key as tenant "ignition:acme:press7".
    db = tmp_path / "mira.db"
    db.touch()
    real_router.write_api_usage = InferenceRouter.write_api_usage
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch.dict("os.environ", {"MIRA_DB_PATH": str(db)}):
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            await cr.route_intent(
                "drive faulted", [], "IDLE", "", session_id="ignition:acme:press7"
            )
    rows = sqlite3.connect(str(db)).execute("SELECT tenant_id, platform FROM api_usage").fetchall()
    assert rows == [("ignition:acme:press7", "unknown")]


# The Ignition missing-asset preflight (mira-pipeline/ignition_chat.py::_is_asset_specific)
# is covered where that module is importable: tests/pipeline/test_ignition_chat_uns.py.


def test_classifier_source_declares_the_bounded_lane() -> None:
    src = Path(cr.__file__).read_text(encoding="utf-8")
    assert "reasoning_retry=False" in src
    assert 'session_id="conversation_router"' not in src


# ---------------------------------------------------------------------------
# Codex r2 F1 on #4359 — the classifier is under the per-run DOLLAR hard stop.
# It goes through InferenceRouter.complete(), which holds the worst case of every
# OpenAI attempt against the shared run budget (#4355, merged). No second budget
# here: these tests drive the REAL budget singleton through the classifier.
# ---------------------------------------------------------------------------

from shared.inference import run_budget as rb  # noqa: E402


class _GatedAsyncClient(_FakeAsyncClient):
    """Like _FakeAsyncClient, but every post waits for one shared event, so N
    classifications are genuinely in flight at once when the budget decides."""

    gate: asyncio.Event | None = None

    async def post(self, url, headers=None, json=None):
        _FakeAsyncClient.posts.append({"url": url, "json": dict(json)})
        assert _GatedAsyncClient.gate is not None
        await _GatedAsyncClient.gate.wait()
        return _response(CLASSIFY, completion_tokens=40)


@pytest.fixture
def fresh_budget(monkeypatch: pytest.MonkeyPatch):
    for k in (
        "OPENAI_RUN_BUDGET_USD",
        "OPENAI_RUN_BUDGET_WINDOW_S",
        "OPENAI_PRICE_PER_MTOK_IN",
        "OPENAI_PRICE_PER_MTOK_OUT",
    ):
        monkeypatch.delenv(k, raising=False)
    rb.reset_openai_run_budget()
    yield
    rb.reset_openai_run_budget()


async def test_exhausted_budget_classification_sends_no_paid_request(
    real_router, fresh_budget
) -> None:
    budget = rb.get_openai_run_budget()
    budget.record(10**9, 0)  # this window's cap is spent
    assert budget.spent_usd > budget.cap_usd  # precondition
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        out = await cr._call_router_llm(
            [{"role": "user", "content": "the drive faulted"}], "t_tg_1"
        )
    assert _FakeAsyncClient.posts == []  # no paid HTTP at all
    assert '"continue_current"' in out  # the honest fallback
    assert budget.held_usd == 0


async def test_control_with_budget_left_the_classification_is_sent_and_booked(
    real_router, fresh_budget
) -> None:
    budget = rb.get_openai_run_budget()
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        out = await cr._call_router_llm(
            [{"role": "user", "content": "the drive faulted"}], "t_tg_1"
        )
    assert out == CLASSIFY
    assert len(_FakeAsyncClient.posts) == 1
    assert budget.spent_usd == pytest.approx(budget.estimate_usd(120, 40))
    assert budget.held_usd == 0


async def test_concurrent_classifications_cannot_overshoot_the_cap(
    real_router, fresh_budget, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Measure one classification's held worst case through the real path.
    shapes: list[tuple[int, int]] = []
    real_reserve = rb.OpenAIRunBudget.reserve

    def spy(self, input_tokens, output_tokens):
        shapes.append((input_tokens, output_tokens))
        return real_reserve(self, input_tokens, output_tokens)

    monkeypatch.setattr(rb.OpenAIRunBudget, "reserve", spy)
    _queue(_response(CLASSIFY, completion_tokens=40))
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        await cr._call_router_llm([{"role": "user", "content": "the drive faulted"}], "t_tg_1")
    assert shapes and shapes[0][1] == cr.ROUTER_MAX_TOKENS  # precondition: held at the hard cap
    worst = rb.get_openai_run_budget().estimate_usd(*shapes[0])

    # A cap with room for ONE classification's worst case, not two.
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", repr(worst * 1.5))
    rb.reset_openai_run_budget()
    budget = rb.get_openai_run_budget()
    assert budget.cap_usd == pytest.approx(worst * 1.5)  # precondition

    _FakeAsyncClient.posts = []
    _GatedAsyncClient.gate = asyncio.Event()
    with patch("shared.inference.router.httpx.AsyncClient", _GatedAsyncClient):
        tasks = [
            asyncio.create_task(
                cr._call_router_llm([{"role": "user", "content": "the drive faulted"}], f"t_tg_{i}")
            )
            for i in range(5)
        ]
        for _ in range(50):  # let every task reach its admission decision
            await asyncio.sleep(0)
        in_flight = len(_FakeAsyncClient.posts)
        _GatedAsyncClient.gate.set()
        outs = await asyncio.gather(*tasks)
    assert in_flight == 1  # five asked at once; only one fit the cap
    assert len(_FakeAsyncClient.posts) == 1
    assert sum(o == CLASSIFY for o in outs) == 1
    assert sum('"continue_current"' in o for o in outs) == 4
    assert budget.spent_usd <= budget.cap_usd
    assert budget.held_usd == 0
