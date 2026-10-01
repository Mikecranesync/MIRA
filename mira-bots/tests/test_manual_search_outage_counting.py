"""#4171 Codex r1 F2: availability is judged from requests actually SENT.

With the default 4-query budget, SMC SS5Y3-DUW01302 generates more passes than
the budget allows. When every real Serper request fails, the extra passes are
refused locally and return [] — those skipped passes must not count as
"attempted and returned nothing", or a total outage reads as "no manual".
Only the reservation and the network call are faked; search_manual,
_serper_search and provider_query_budget are real.
"""

import pytest

import shared.manual_search.quota as quota_mod
import shared.manual_search.search as s


@pytest.fixture
def real_search(monkeypatch):
    monkeypatch.setattr(s, "SERPER_API_KEY", "test-key")
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    monkeypatch.delenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", raising=False)

    async def ok(identity, **kwargs):
        return "ok"

    monkeypatch.setattr(quota_mod, "reserve_provider_query", ok)
    calls = []
    return calls


def _ident():
    return quota_mod.provider_query_quota(quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1"))


async def test_total_outage_is_unavailable_even_when_the_budget_skips_passes(monkeypatch, real_search):
    async def down(query, num=10):
        real_search.append(query)
        raise RuntimeError("serper 503")

    monkeypatch.setattr(s, "_serper_post", down)
    with _ident(), s.provider_query_budget() as budget:
        with pytest.raises(s.ManualSearchUnavailable):
            await s.search_manual("SMC", "SS5Y3-DUW01302")
    assert len(real_search) == budget.limit == 4
    assert budget.refused >= 1, "the scenario must include locally skipped passes"


async def test_control_successful_empty_responses_are_a_genuine_miss(monkeypatch, real_search):
    async def empty(query, num=10):
        real_search.append(query)
        return []

    monkeypatch.setattr(s, "_serper_post", empty)
    with _ident(), s.provider_query_budget():
        assert await s.search_manual("SMC", "SS5Y3-DUW01302") is None


async def test_control_one_failure_among_successes_is_not_unavailable(monkeypatch, real_search):
    async def flaky(query, num=10):
        real_search.append(query)
        if len(real_search) == 1:
            raise RuntimeError("serper 503")
        return []

    monkeypatch.setattr(s, "_serper_post", flaky)
    with _ident(), s.provider_query_budget():
        assert await s.search_manual("SMC", "SS5Y3-DUW01302") is None
