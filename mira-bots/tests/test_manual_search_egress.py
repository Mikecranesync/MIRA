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

import shared.manual_search.search as search_mod  # noqa: E402

MIRA_BOTS = pathlib.Path(__file__).parent.parent


@pytest.fixture(autouse=True)
def _judge_off_and_key_set(monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "test-key")
    monkeypatch.delenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", raising=False)


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
