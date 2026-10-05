"""Manual-First S1 — mira-ask egress hardening (#4160, PRD R7/R13, Codex G1/G2).

G1: the OEM manual-request link is a curated static link; the server never
    fetches it (the old live probe read an uncapped body before admission).
G2: one search_manual() call can send up to six paid provider queries, so the
    per-call ceiling counts provider queries, not operations — and every
    production caller must open that budget.

Run: cd mira-bots && python -m pytest tests/test_manual_search_egress.py -q
"""

from __future__ import annotations

import ast
import pathlib
import sys

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import shared.manual_search.quota as quota_mod  # noqa: E402
import shared.manual_search.search as search_mod  # noqa: E402

MIRA_BOTS = pathlib.Path(__file__).parent.parent

# Captured at module import, BEFORE any per-test monkeypatch can replace the
# module attribute — the one true unfaked reserve_provider_query, for the
# tests below that must exercise quota.py's own real global-cap-unconfigured
# fail-closed check (not the autouse "ok" stub every other test in this file
# relies on).
_REAL_RESERVE = quota_mod.reserve_provider_query


@pytest.fixture(autouse=True)
def _judge_off_and_key_set(monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "test-key")
    monkeypatch.delenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", raising=False)


@pytest.fixture(autouse=True)
def _quota_identity_ok(monkeypatch):
    """#4160 S4 added a quota gate to the exact seam this suite exercises
    (_serper_search). These tests pin the PER-CALL budget, not the quota —
    give every call an identity and a reserver that always answers "ok" so
    they stay hermetic (no Postgres) and the budget math is unaffected.
    Quota-denial behavior itself is covered by test_manual_search_quota.py
    and the "no_identity" refusal below."""

    async def fake_reserve(identity, **kwargs):
        return "ok"

    monkeypatch.setattr(quota_mod, "reserve_provider_query", fake_reserve)
    identity = quota_mod.QuotaIdentity(tenant_id="egress-test-tenant", user_id="egress-test-user")
    with quota_mod.provider_query_quota(identity):
        yield


def _refuse_all_network(monkeypatch):
    def handler(request):  # pragma: no cover - reaching here is the failure
        raise AssertionError(f"unexpected network request: {request.url}")

    monkeypatch.setattr(search_mod, "_transport_for_tests", httpx.MockTransport(handler))
    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: True)


# ── G1: oem_request_link makes no network request ───────────────────────────


async def test_oem_request_link_returns_the_curated_link_without_any_request(monkeypatch):
    _refuse_all_network(monkeypatch)
    assert await search_mod.oem_request_link("Harrington Hoists and Cranes") == (
        "https://www.harringtonhoists.com/owners-manual-request"
    )


async def test_oem_request_link_is_none_for_a_maker_with_no_curated_form(monkeypatch):
    _refuse_all_network(monkeypatch)
    assert await search_mod.oem_request_link("Siemens") is None
    assert await search_mod.oem_request_link("") is None


# ── G2: provider-query ceiling ───────────────────────────────────────────────


def _count_provider_posts(monkeypatch) -> list[str]:
    sent: list[str] = []

    async def fake_post(query: str, num: int):
        sent.append(query)
        return []

    monkeypatch.setattr(search_mod, "_serper_post", fake_post)
    return sent


async def test_an_unbounded_search_sends_six_provider_queries(monkeypatch):
    """Control: the worst case the ceiling exists for. SMC has an OEM domain
    (pass 1), the model yields four variants (pass 2), and pass 3 runs because
    nothing was found — six paid queries for one operation."""
    sent = _count_provider_posts(monkeypatch)
    assert len(search_mod._model_variants("SS5Y3-DUW01302")) == 4
    await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert len(sent) == 6


async def test_the_budget_caps_provider_queries_per_call(monkeypatch):
    sent = _count_provider_posts(monkeypatch)
    with search_mod.provider_query_budget() as budget:
        await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert search_mod.max_provider_queries() == 4
    assert len(sent) == 4
    assert budget.used == 4
    assert budget.refused == 2
    # Pass 1 (the site-scoped, highest-precision query) is never the one cut.
    assert "site:" in sent[0]


async def test_the_ceiling_is_configurable_and_counts_what_was_sent(monkeypatch):
    sent = _count_provider_posts(monkeypatch)
    monkeypatch.setenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", "2")
    with search_mod.provider_query_budget() as budget:
        await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert len(sent) == budget.used == 2


@pytest.mark.parametrize("raw", ["0", "-3", "lots", ""])
def test_a_bad_ceiling_falls_back_to_the_default(monkeypatch, raw):
    monkeypatch.setenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", raw)
    assert search_mod.max_provider_queries() == 4


async def test_the_budget_follows_the_call_into_a_spawned_task(monkeypatch):
    """manual_discovery wraps search_manual in asyncio.wait_for, which runs it
    in a new task; the budget must still be spent there, not bypassed."""
    import asyncio

    sent = _count_provider_posts(monkeypatch)
    with search_mod.provider_query_budget(limit=3) as budget:
        await asyncio.wait_for(search_mod.search_manual("SMC", "SS5Y3-DUW01302"), timeout=5)
    assert len(sent) == budget.used == 3


async def test_budgets_do_not_leak_between_calls(monkeypatch):
    _count_provider_posts(monkeypatch)
    with search_mod.provider_query_budget(limit=1) as first:
        await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    with search_mod.provider_query_budget(limit=5) as second:
        await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert first.used == 1
    assert second.used == 5
    assert search_mod._provider_budget.get() is None


# ── Every production caller opens a budget ───────────────────────────────────


def _called_name(node: ast.Call) -> str | None:
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _unbudgeted_search_calls(tree: ast.AST) -> tuple[int, list[int]]:
    """(calls found, line numbers of calls NOT inside `with provider_query_budget(...)`)."""
    found, bad = 0, []

    def visit(node: ast.AST, budgeted: bool) -> None:
        nonlocal found
        if isinstance(node, (ast.With, ast.AsyncWith)) and any(
            isinstance(i.context_expr, ast.Call)
            and _called_name(i.context_expr) == "provider_query_budget"
            for i in node.items
        ):
            budgeted = True
        if isinstance(node, ast.Call) and _called_name(node) == "search_manual":
            found += 1
            if not budgeted:
                bad.append(node.lineno)
        for child in ast.iter_child_nodes(node):
            visit(child, budgeted)

    visit(tree, False)
    return found, bad


def test_every_production_search_manual_call_is_inside_a_provider_budget():
    """A new caller that forgets the budget re-opens the uncapped six-query
    path. Fail the moment one appears (AST, so docstrings don't count)."""
    offenders, callers = [], 0
    for path in MIRA_BOTS.rglob("*.py"):
        rel = path.relative_to(MIRA_BOTS).as_posix()
        if rel.startswith("tests/") or "/.venv" in rel or rel == "shared/manual_search/search.py":
            continue
        found, bad = _unbudgeted_search_calls(ast.parse(path.read_text(encoding="utf-8")))
        callers += found
        offenders += [f"{rel}:{n}" for n in bad]
    assert callers >= 2, "expected the ask_api and bot vision callers to be found"
    assert offenders == [], f"search_manual called outside provider_query_budget: {offenders}"


def test_the_budget_guard_flags_an_unbudgeted_call():
    """Negative control: the guard above must be able to fail."""
    bare = "async def f():\n    return await search_manual('SMC', 'X')\n"
    wrapped = (
        "async def f():\n"
        "    with provider_query_budget():\n"
        "        return await search_manual('SMC', 'X')\n"
    )
    assert _unbudgeted_search_calls(ast.parse(bare)) == (1, [2])
    assert _unbudgeted_search_calls(ast.parse(wrapped)) == (1, [])


# ── S4: the quota gate at the _serper_search seam (#4160, PRD R13/R14) ──────


async def test_no_identity_refuses_every_query_and_never_sends(monkeypatch):
    """PRD R14: a caller that cannot supply a tenant/user identity gets no web
    search at all — the gate must refuse BEFORE _serper_post, never invent an
    identity to let the query through."""
    sent = _count_provider_posts(monkeypatch)
    quota_mod._quota_identity.set(None)  # override the autouse default
    with search_mod.provider_query_budget() as budget:
        result = await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert sent == []
    assert budget.used == 0
    # SMC's worst case tries 6 provider queries (test_an_unbounded_search_...);
    # every single one is refused — the FIRST on "no_identity", the rest
    # short-circuited by budget.quota_denied without re-checking identity.
    assert budget.refused == 6
    assert budget.quota_denied == "no_identity"
    assert result is None


async def test_a_denial_mid_call_stops_the_remaining_queries_without_touching_the_db_again(
    monkeypatch,
):
    """Fix B (code-review follow-up, #4160 S4): once one query in a call is
    quota-denied, every remaining pass must refuse WITHOUT reserving again —
    a DB outage must not cost up to six round trips inside one 50s caller
    budget. SMC's worst case sends 6 provider queries unbounded; this proves
    only the FIRST one ever reaches reserve_provider_query()."""
    sent = _count_provider_posts(monkeypatch)
    reserve_calls: list[str] = []

    async def deny_after_first(identity, **kwargs):
        reserve_calls.append(identity.tenant_id)
        return "tenant_cap"

    monkeypatch.setattr(quota_mod, "reserve_provider_query", deny_after_first)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    with quota_mod.provider_query_quota(identity):
        with search_mod.provider_query_budget() as budget:
            await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert sent == []
    assert budget.used == 0
    assert len(reserve_calls) == 1, (
        f"reserve_provider_query must be called exactly once per call after a denial, got {reserve_calls}"
    )
    assert budget.quota_denied == "tenant_cap"


async def test_tenant_and_user_never_enter_the_provider_query_text(monkeypatch):
    """PRD R4: the Serper query string is built only from (make, model) —
    tenant/user identity must never leak into it. Runs the REAL search_manual
    (only _serper_post and the reserver are mocked), with sentinel tenant/user
    strings that would be unmistakable if they leaked."""
    sent: list[str] = []

    async def fake_post(query: str, num: int):
        sent.append(query)
        return []

    async def fake_reserve(identity, **kwargs):
        return "ok"

    monkeypatch.setattr(search_mod, "_serper_post", fake_post)
    monkeypatch.setattr(quota_mod, "reserve_provider_query", fake_reserve)
    identity = quota_mod.QuotaIdentity(
        tenant_id="SENTINEL-TENANT-ID-ZZZ", user_id="SENTINEL-USER-ID-ZZZ"
    )
    with quota_mod.provider_query_quota(identity):
        with search_mod.provider_query_budget():
            await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert sent, "expected at least one provider query to be sent"
    for q in sent:
        assert "SENTINEL-TENANT-ID-ZZZ" not in q
        assert "SENTINEL-USER-ID-ZZZ" not in q
    # Positive control: the query text DOES carry make/model (so this test
    # isn't vacuously passing against an empty/garbled query).
    assert any("SMC" in q for q in sent)


async def test_unconfigured_global_cap_sends_no_query_through_the_real_reserver(monkeypatch):
    """D4 (owner amendment, 2026-09-30): proves "no query sent", not merely
    "no DB connect" (that narrower claim is test_manual_search_quota.py's
    job) — this test runs the REAL reserve_provider_query (restored via
    _REAL_RESERVE, captured before the autouse "ok" stub ever patched it) all
    the way through _serper_search, with the global cap genuinely unset."""
    sent = _count_provider_posts(monkeypatch)
    monkeypatch.setattr(quota_mod, "reserve_provider_query", _REAL_RESERVE)
    monkeypatch.delenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raising=False)
    identity = quota_mod.QuotaIdentity(tenant_id="t-d4", user_id="u-d4")
    with quota_mod.provider_query_quota(identity):
        with search_mod.provider_query_budget() as budget:
            await search_mod.search_manual("SMC", "SS5Y3-DUW01302")
    assert sent == []
    assert budget.used == 0
    assert budget.quota_denied == "global_cap_unconfigured"
