"""Acquisition trail (Golden Walk 2026-10-05) and the PowerFlex 525 replay.

The trail is observability only: it records what a manual search asked, every
candidate it considered, how each was read, how they ranked and why the judge
stopped — and never changes which candidate wins. The replay tests at the bottom
pin the ranking defect the trail was built to explain; they are strict xfails
until the deterministic-ranking fix lands.
"""

from __future__ import annotations

import itertools
import json
import pathlib
import sys

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import shared.manual_search.judge as judge  # noqa: E402
import shared.manual_search.search as search_mod  # noqa: E402

FIXTURE = (
    pathlib.Path(__file__).parent / "fixtures" / "manual_search" / "pf525_replay_2026-10-05.json"
)

EN_TEXT = (
    "This manual describes the installation and the fault codes of the drive. "
    "The fault list is in chapter 4 and it is for this drive. "
) * 3

GOOD = "https://oem.example.com/docs/model-x/user-manual.pdf?x-sign=SECRET123"
BIG = "https://oem.example.com/docs/model-x/hardware-manual.pdf"
PAGE = "https://oem.example.com/products/model-x"


class _Router:
    enabled = True

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        return json.dumps(
            {
                "is_manual_for_model": True,
                "doc_type": "user_manual",
                "scope": "complete",
                "confidence": 0.95,
                "lists_fault_codes": True,
                "language": "en",
                "reason": "r",
            }
        ), {"provider": "fake", "model": "fake-1"}


@pytest.fixture
def scripted_search(monkeypatch):
    """A search whose provider returns three hits: an oversized PDF, the manual
    (behind a signed URL) and an HTML product page."""

    async def serper(query, num=10):
        return [
            {"link": BIG, "title": "Model X hardware manual"},
            {"link": GOOD, "title": "Model X user manual"},
            {"link": PAGE, "title": "Model X product page"},
        ]

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        if url == BIG:
            judge._why("byte_cap")
            return None
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        return EN_TEXT

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "_oem_domains_for", lambda make: ("oem.example.com",))
    monkeypatch.setattr(search_mod, "_is_oem_host", lambda host, make: host == "oem.example.com")
    monkeypatch.setattr(judge, "_router", _Router())
    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    monkeypatch.setattr(judge, "judge_enabled", lambda: True)


async def test_trail_records_the_query_every_candidate_and_the_winner(scripted_search):
    with search_mod.acquisition_trail() as trail:
        top = await search_mod.search_manual("ExampleOEM", "Model X")
    out = trail.to_dict(top["url"])

    assert [q["pass"] for q in out["queries"]] == ["q1"]
    assert out["queries"][0]["result"] == "sent" and out["queries"][0]["hits"] == 3
    rows = {r["url"]: r for r in out["candidates"]}
    # Signed tokens never reach the trail; the row is keyed on the bare URL.
    assert "https://oem.example.com/docs/model-x/user-manual.pdf" in rows
    assert all("x-sign" not in r["url"] for r in out["candidates"])
    good = rows["https://oem.example.com/docs/model-x/user-manual.pdf"]
    assert good["selected"] is True and good["rank"] == 0 and good["read"] == "judged"
    assert good["lists_fault_codes"] is True and good["text_language"] == "en"
    assert rows[BIG]["read"] == "unfetched" and rows[BIG]["read_reason"] == "byte_cap"
    assert rows[PAGE]["not_queued"] == "not_direct_pdf" and rows[PAGE]["read"] == "unread"
    assert out["stop"] == "ideal_match"
    assert out["candidate_count"] == 3


async def test_the_trail_never_changes_the_winner(scripted_search):
    plain = await search_mod.search_manual("ExampleOEM", "Model X")
    with search_mod.acquisition_trail():
        traced = await search_mod.search_manual("ExampleOEM", "Model X")
    assert plain["url"] == traced["url"] == GOOD
    assert plain["validated"] == traced["validated"] is True


async def test_no_trail_outside_a_trail_block(scripted_search):
    assert search_mod._trail.get() is None
    await search_mod.search_manual("ExampleOEM", "Model X")
    assert search_mod._trail.get() is None


def test_trail_url_strips_query_and_fragment():
    assert (
        search_mod.trail_url("https://h.example/a/b.pdf?x-sign=abc#p2")
        == "https://h.example/a/b.pdf"
    )


# ── the real fetch records WHY it returned nothing ──────────────────────────


def _mock_fetch(monkeypatch, handler):
    monkeypatch.setattr(search_mod, "_probe_transport", lambda: httpx.MockTransport(handler))
    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda url: True)


@pytest.mark.parametrize(
    ("handler", "max_bytes", "reason"),
    [
        (lambda req: httpx.Response(200, content=b"%PDF-1.4 " + b"x" * 100), 10, "byte_cap"),
        (lambda req: httpx.Response(404), judge.MAX_BYTES, "http_404"),
        (
            lambda req: httpx.Response(200, content=b"<html>login</html>"),
            judge.MAX_BYTES,
            "not_pdf",
        ),
        (lambda req: httpx.Response(302), judge.MAX_BYTES, "redirect_without_location"),
    ],
)
async def test_fetch_records_its_failure_reason(monkeypatch, handler, max_bytes, reason):
    _mock_fetch(monkeypatch, handler)
    judge._READ_REASON.set(None)
    assert await judge.fetch_pdf_bytes("https://oem.example.com/m.pdf", max_bytes) is None
    assert judge._READ_REASON.get() == reason


async def test_fetch_timeout_is_named(monkeypatch):
    def boom(req):
        raise httpx.ReadTimeout("slow", request=req)

    _mock_fetch(monkeypatch, boom)
    judge._READ_REASON.set(None)
    assert await judge.fetch_pdf_bytes("https://oem.example.com/m.pdf") is None
    assert judge._READ_REASON.get() == "fetch_timeout"


async def test_a_successful_fetch_records_no_reason(monkeypatch):
    _mock_fetch(monkeypatch, lambda req: httpx.Response(200, content=b"%PDF-1.4 ok"))
    judge._READ_REASON.set(None)
    assert await judge.fetch_pdf_bytes("https://oem.example.com/m.pdf") == b"%PDF-1.4 ok"
    assert judge._READ_REASON.get() is None


# ── PowerFlex 525 replay (real pool + real verdicts, 2026-10-05) ────────────
#
# The judge says the EtherNet/IP adapter manual (520com-um001, no F005) lists the
# drive's fault codes, so it ties the On Drive Guide (520-du001, F005 on p4) on
# every rank key and the SEARCH ENGINE's result order picks the winner — the
# Golden Walk flip between after-4236 (du001, PASS) and after-4239 (520com, FAIL).
# Strict xfails: they turn green with the deterministic-ranking fix, not before.


def _replay():
    data = json.loads(FIXTURE.read_text())
    return data["candidates"]


def test_replay_fixture_reproduces_the_tie():
    """Green today: the defect the xfails below pin is real, not a fixture artefact."""
    by_name = {c["url"].rsplit("/", 1)[-1]: c for c in _replay()}
    du, com = by_name["520-du001_-en-e.pdf"], by_name["520com-um001_-en-e.pdf"]
    assert du["has_F005"] is True and com["has_F005"] is False
    assert judge.is_ideal(du) and judge.is_ideal(com)
    winners = {
        judge.rank([dict(c) for c in order])[0]["url"].rsplit("/", 1)[-1]
        for order in itertools.permutations([du, com])
    }
    assert winners == {"520-du001_-en-e.pdf", "520com-um001_-en-e.pdf"}


@pytest.mark.xfail(
    strict=True,
    reason="deterministic ranking (Golden Walk PR 2): adapter manual outranks the drive's fault volume",
)
def test_replay_winner_always_holds_the_fault_code():
    pool = _replay()
    judged = [c for c in pool if c.get("judge")]
    for order in itertools.permutations(judged):
        top = judge.rank([dict(c) for c in order] + [dict(c) for c in pool if not c.get("judge")])[
            0
        ]
        assert top.get("has_F005") is True, top["url"]


@pytest.mark.xfail(
    strict=True,
    reason="deterministic ranking (Golden Walk PR 2): the winner depends on search-engine order",
)
def test_replay_winner_is_the_same_in_any_input_order():
    pool = _replay()
    judged = [c for c in pool if c.get("judge")]
    winners = {
        judge.rank([dict(c) for c in order])[0]["url"] for order in itertools.permutations(judged)
    }
    assert len(winners) == 1, winners


# ── the endpoint returns the trail with every result ─────────────────────────


def _endpoint(monkeypatch, result):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")

    async def fake_search(make, model, deadline_at=None):
        trail = search_mod._trail.get()
        assert trail is not None, "the endpoint must open a trail around the search"
        trail.queries.append({"pass": "q1", "query": "q", "result": "sent", "hits": 1})
        trail.candidates = [
            {
                "url": GOOD,
                "host": "oem.example.com",
                "title": "t",
                "score": 175,
                "is_direct_pdf": True,
            }
        ]
        return result

    async def no_link(make):
        return None

    monkeypatch.setattr(md, "search_manual", fake_search)
    monkeypatch.setattr(md, "oem_request_link", no_link)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    return client.post(
        "/manual-discovery/search", json={"manufacturer": "ExampleOEM", "model": "Model X"}
    ).json()


def test_endpoint_attaches_the_trail_and_marks_the_winner(monkeypatch):
    body = _endpoint(
        monkeypatch,
        {
            "url": GOOD,
            "title": "t",
            "host": "oem.example.com",
            "validated": True,
            "is_direct_pdf": True,
        },
    )
    trail = body["candidate_trail"]
    assert trail["version"] == search_mod.TRAIL_VERSION
    assert trail["queries"][0]["pass"] == "q1"
    assert trail["candidates"][0]["selected"] is True
    assert "x-sign" not in json.dumps(trail)


def test_endpoint_attaches_the_trail_when_nothing_is_found(monkeypatch):
    body = _endpoint(monkeypatch, None)
    assert body["found"] is False
    assert body["candidate_trail"]["candidates"][0]["selected"] is False
