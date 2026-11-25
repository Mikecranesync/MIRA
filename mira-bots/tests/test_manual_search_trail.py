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
import logging
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


@pytest.mark.parametrize(
    "url,bare",
    [
        ("https://u5933:p5933-secret@h.example/a/b.pdf", "https://h.example/a/b.pdf"),
        ("https://u5933@h.example:8443/a/b.pdf?x=1", "https://h.example:8443/a/b.pdf"),
        ("https://u5933:p5933@x@h.example/a.pdf", "https://h.example/a.pdf"),
        ("https://u5933:p5933-secret@/a.pdf", "https:///a.pdf"),
    ],
    ids=["user_and_password", "user_only_with_port", "at_in_password", "no_host_left"],
)
def test_trail_url_drops_userinfo_and_keeps_host_and_port(url, bare):
    # #5933: a search result's user:password part never reaches the trail.
    assert search_mod.trail_url(url) == bare


@pytest.mark.parametrize(
    "host,shown",
    [
        ("u5933:p5933-secret@h.example:8443", "h.example:8443"),
        ("h.example:8443", "h.example:8443"),  # control: no userinfo, unchanged
        ("H.Example", "H.Example"),  # control: case is not touched
        ("", ""),
        (None, None),  # control: a missing host stays missing
    ],
)
def test_a_trail_row_host_drops_userinfo_only(host, shown):
    trail = search_mod.AcquisitionTrail(
        candidates=[{"url": "https://h.example/a.pdf", "host": host, "title": "t", "score": 1}]
    )
    assert trail.to_dict()["candidates"][0]["host"] == shown


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


# ── Codex #4253 r1 ───────────────────────────────────────────────────────────


def test_f1_the_winner_survives_the_row_cap():
    """A fallback winner ranked beyond the cap is still in the trail, with its real rank."""
    pool = [
        {
            "url": f"https://oem.example.com/d{i}.pdf",
            "host": "oem.example.com",
            "score": 200 - i,
            "is_direct_pdf": True,
        }
        for i in range(30)
    ]
    trail = search_mod.AcquisitionTrail(candidates=pool)
    out = trail.to_dict("https://oem.example.com/d24.pdf")
    assert len(out["candidates"]) == search_mod.TRAIL_MAX_CANDIDATES
    selected = [r for r in out["candidates"] if r["selected"]]
    assert len(selected) == 1 and selected[0]["rank"] == 24
    assert out["candidate_count"] == 30


def test_f1_a_winner_inside_the_cap_is_not_duplicated():
    pool = [
        {"url": f"https://oem.example.com/d{i}.pdf", "score": 1, "is_direct_pdf": True}
        for i in range(30)
    ]
    out = search_mod.AcquisitionTrail(candidates=pool).to_dict("https://oem.example.com/d3.pdf")
    assert [r["rank"] for r in out["candidates"]] == list(range(search_mod.TRAIL_MAX_CANDIDATES))
    assert sum(r["selected"] for r in out["candidates"]) == 1


async def test_f2_a_cancelled_read_is_reported_as_interrupted_not_exhausted(monkeypatch):
    import asyncio

    started = asyncio.Event()

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    cands = [
        {
            "url": "https://oem.example.com/m.pdf",
            "title": "Model X manual",
            "score": 150,
            "is_direct_pdf": True,
        }
    ]
    trace: dict = {}
    task = asyncio.create_task(judge.judge_candidates("ExampleOEM", "Model X", cands, trace=trace))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert trace["stop"] == "cancelled"
    assert cands[0]["judge"] == {"status": "interrupted", "reason": "cancelled_during_fetch"}


async def test_f2_an_upgrade_batch_past_its_deadline_marks_its_reads_interrupted(monkeypatch):
    import asyncio

    monkeypatch.setattr(judge, "UPGRADE_DEADLINE_S", 0.3)
    monkeypatch.setattr(judge, "UPGRADE_MIN_BATCH_S", 0.01)
    monkeypatch.setattr(judge, "MAX_CANDIDATES", 1)
    monkeypatch.setattr(judge, "_router", _Router())

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        if url.endswith("slow.pdf"):
            await asyncio.sleep(5)
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        # The first document is a match but not ideal (no fault list): it buys an upgrade batch.
        return EN_TEXT.replace("fault", "status")

    class _NoFaults(_Router):
        async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
            content, usage = await super().complete(messages, max_tokens, session_id, sanitize)
            return content.replace('"lists_fault_codes": true', '"lists_fault_codes": false'), usage

    monkeypatch.setattr(judge, "_router", _NoFaults())
    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    cands = [
        {
            "url": "https://oem.example.com/first.pdf",
            "title": "Model X manual",
            "score": 150,
            "is_direct_pdf": True,
        },
        {
            "url": "https://oem.example.com/slow.pdf",
            "title": "Model X manual",
            "score": 140,
            "is_direct_pdf": True,
        },
    ]
    trace: dict = {}
    await judge.judge_candidates("ExampleOEM", "Model X", cands, trace=trace)
    assert trace["stop"] == "upgrade_deadline"
    slow = next(c for c in cands if c["url"].endswith("slow.pdf"))
    assert slow["judge"] == {"status": "interrupted", "reason": "upgrade_deadline_during_fetch"}


def test_f2_endpoint_timeout_reports_the_interruption(monkeypatch):
    import asyncio

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", "0.5")
    # The search's own deadline handling (#4401) is pushed past the endpoint's timeout
    # so this still covers the ENDPOINT-cancels-mid-read path (any overrunning stage).
    monkeypatch.setattr(judge, "RETURN_RESERVE_S", -60.0)

    async def serper(query, num=10):
        return [
            {
                "link": "https://oem.example.com/docs/model-x/user-manual.pdf",
                "title": "Model X user manual",
            }
        ]

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        await asyncio.sleep(30)

    async def no_link(make):
        return None

    async def ok(_identity):
        return "ok"

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    monkeypatch.setattr(judge, "judge_enabled", lambda: True)
    monkeypatch.setattr(md, "oem_request_link", no_link)
    import shared.manual_search.quota as quota

    monkeypatch.setattr(quota, "reserve_provider_query", ok)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "ExampleOEM", "model": "Model X"}
    ).json()
    assert body["reason"] == "search_unavailable"
    trail = body["candidate_trail"]
    assert trail["stop"] == "cancelled"
    row = trail["candidates"][0]
    assert row["read"] == "interrupted" and row["read_reason"] == "cancelled_during_fetch"


def test_a_slow_read_stops_at_the_search_deadline_instead_of_an_outage(monkeypatch):
    # #4401, staging 2026-10-13: a read still running when mira-ask's discovery timeout
    # fired got the search cancelled, and the Hub said "Manual search is unavailable".
    # The search now stops its own reading before that timeout and answers normally.
    import asyncio

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", str(judge.RETURN_RESERVE_S + 0.5))

    async def serper(query, num=10):
        return [
            {
                "link": "https://oem.example.com/docs/model-x/user-manual.pdf",
                "title": "Model X user manual",
            }
        ]

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        await asyncio.sleep(30)

    async def no_link(make):
        return None

    async def ok(_identity):
        return "ok"

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    monkeypatch.setattr(judge, "judge_enabled", lambda: True)
    monkeypatch.setattr(md, "oem_request_link", no_link)
    import shared.manual_search.quota as quota

    monkeypatch.setattr(quota, "reserve_provider_query", ok)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "ExampleOEM", "model": "Model X"}
    ).json()
    assert body["reason"] != "search_unavailable"
    trail = body["candidate_trail"]
    assert trail["stop"] == "search_deadline"
    row = trail["candidates"][0]
    assert row["read"] == "interrupted" and row["read_reason"] == "search_deadline_during_fetch"


@pytest.mark.asyncio
async def test_unknown_manufacturer_website_survives_a_manual_miss(monkeypatch):
    async def hits(query):
        return [{"link": "https://novel-controls.example/support/?language=en", "title": "Novel Controls support"}]
    monkeypatch.setattr(search_mod, "_serper_search", hits)
    monkeypatch.setattr(judge, "judge_enabled", lambda: False)
    with search_mod.acquisition_trail() as trail:
        candidate = await search_mod.search_manual("Novel Controls", "Z7")
    assert candidate is None  # website is not a manual candidate
    assert trail.search_page_url == "https://novel-controls.example/support/?language=en"


@pytest.mark.asyncio
async def test_no_website_is_invented_from_an_unknown_manufacturer(monkeypatch):
    async def hits(query):
        return []
    monkeypatch.setattr(search_mod, "_serper_search", hits)
    with search_mod.acquisition_trail() as trail:
        assert await search_mod.search_manual("Unlisted Maker", "Z7") is None
    assert trail.search_page_url is None


@pytest.mark.asyncio
@pytest.mark.parametrize("url,title", [
    ("https://unrelated.example/support", "Different Manufacturer support"),
    ("https://novel-controls.example/manual.pdf", "Novel Controls manual"),
    ("https://novel-controls.example/support?token=secret", "Novel Controls support"),
    ("javascript:alert(1)", "Novel Controls support"),
])
async def test_handoff_does_not_promote_unrelated_documents_or_credentials(monkeypatch, url, title):
    async def hits(query):
        return [{"link": url, "title": title}]
    async def no_pdf(url):
        return False
    monkeypatch.setattr(search_mod, "_serper_search", hits)
    monkeypatch.setattr(search_mod, "validate_pdf", no_pdf)
    monkeypatch.setattr(judge, "judge_enabled", lambda: False)
    with search_mod.acquisition_trail() as trail:
        await search_mod.search_manual("Novel Controls", "Z7")
    assert trail.search_page_url is None


@pytest.mark.asyncio
async def test_rejected_document_still_searches_for_a_website(monkeypatch):
    calls = []
    async def hits(query):
        calls.append(query)
        if "filetype:pdf" in query:
            return [{"link": "https://novel-controls.example/Z7.pdf", "title": "Novel Controls Z7 brochure"}]
        return [{"link": "https://novel-controls.example/support/", "title": "Novel Controls support"}]
    async def reject(make, model, candidates, **kwargs):
        return candidates
    monkeypatch.setattr(search_mod, "_serper_search", hits)
    monkeypatch.setattr(judge, "judge_enabled", lambda: True)
    monkeypatch.setattr(judge, "judge_candidates", reject)
    monkeypatch.setattr(judge, "is_match", lambda c: False)
    monkeypatch.setattr(judge, "is_rejected", lambda c: True)
    monkeypatch.setattr(judge, "judge_summary", lambda c: ("judged_not_applicable", "Not the manual"))
    with search_mod.acquisition_trail() as trail:
        candidate = await search_mod.search_manual("Novel Controls", "Z7")
    assert candidate["reason"] == "judged_not_applicable"
    assert not candidate["validated"]
    assert trail.search_page_url == "https://novel-controls.example/support/"
    assert "filetype:pdf" not in calls[-1]


# ── #5933 / #5935: what the endpoint's trail and candidate carry ─────────────

_USER, _PASSWORD = "u5933", "p5933-secret"
_SIMATIC = "6ES7214-1AG40-0XB0"
_ASIDE = (
    "https://www.example-distributor.com:8443/p/6es7214_1ag40_0xb0",
    "6ES7214_1AG40_0XB0 CPU 1214C compact",
)
_SCORED = ("https://parts.example.net/gs10m.pdf", "GS10 Drive User Manual")


def _with_userinfo(url: str) -> str:
    scheme, rest = url.split("://", 1)
    return f"{scheme}://{_USER}:{_PASSWORD}@{rest}"


def _discover(monkeypatch, caplog, enabled, hits, manufacturer, **fields):
    """The real discovery endpoint around the real search, with only the network
    edges stubbed: every query returns ``hits``, and no URL probes as a PDF.
    Returns the response body and the one MANUAL_ACQUISITION_TRAIL line it logged."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md

    async def serper(query, num=10):
        return [{"link": u, "title": t} for u, t in hits]

    async def no_pdf(url):
        return False

    async def no_link(make):
        return None

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
    assert judge.judge_enabled() is (enabled == "1")
    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", no_pdf)
    monkeypatch.setattr(md, "oem_request_link", no_link)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    caplog.clear()
    with caplog.at_level(logging.INFO):
        body = client.post(
            "/manual-discovery/search", json={"manufacturer": manufacturer, **fields}
        ).json()
    logged = [
        m
        for m in (r.getMessage() for r in caplog.records)
        if m.startswith("MANUAL_ACQUISITION_TRAIL ")
    ]
    assert len(logged) == 1, logged
    return body, logged[0]


_CASES = {
    # main's own candidate: a scored PDF, offered unread with the judge off
    "scored_candidate": (_SCORED, "AutomationDirect", {"model": "GS10"}),
    # #5896's row: a score-zero exact-part page, offered at a miss ending
    "set_aside_offer": (_ASIDE, "Siemens", {"catalog_number": _SIMATIC}),
}


@pytest.mark.parametrize("case", sorted(_CASES))
def test_the_trail_never_carries_a_results_userinfo(monkeypatch, caplog, case):
    # #5933, judge off as in production. Each row keeps its host, port and path;
    # neither the returned trail nor the logged line holds the user or password.
    (url, title), make, fields = _CASES[case]
    if case == "set_aside_offer":
        assert search_mod._score(_with_userinfo(url), title, make, _SIMATIC) == 0
    body, line = _discover(monkeypatch, caplog, "0", [(_with_userinfo(url), title)], make, **fields)
    assert body["candidate"]["url"] == _with_userinfo(url), body  # the offer is this page
    rows = body["candidate_trail"]["candidates"]
    selected = [r for r in rows if r["selected"]]
    assert len(selected) == 1, rows
    netloc = url.split("://", 1)[1].split("/", 1)[0]
    assert (selected[0]["url"], selected[0]["host"]) == (url, netloc), selected
    for text in (json.dumps(body["candidate_trail"]), line):
        assert _USER not in text and _PASSWORD not in text, text

    # Control: the same page without userinfo gives the same trail, byte for byte.
    bare_body, bare_line = _discover(monkeypatch, caplog, "0", [(url, title)], make, **fields)
    assert bare_body["candidate_trail"] == body["candidate_trail"]
    assert bare_line == line


@pytest.mark.parametrize("enabled", ["0", "1"])
def test_an_offered_set_aside_page_returns_with_mains_fields(monkeypatch, caplog, enabled):
    # #5935: the trail tags the offered set-aside page with the pass that found it,
    # but the endpoint's candidate keeps main's fields, with no `pass` key.
    url, title = _ASIDE
    assert search_mod._score(url, title, "Siemens", _SIMATIC) == 0  # set aside
    body, _ = _discover(
        monkeypatch, caplog, enabled, [(url, title)], "Siemens", catalog_number=_SIMATIC
    )
    candidate = body["candidate"]
    assert candidate["url"] == url and candidate["validated"] is False, candidate
    expected = {"url", "title", "host", "score", "doc_type", "is_direct_pdf", "validated"}
    if enabled == "1":
        expected |= {"reason", "reason_detail", "judged_rejected"}
    assert set(candidate) == expected, sorted(candidate)
    trail = body["candidate_trail"]
    selected = [r for r in trail["candidates"] if r["selected"]]
    first = trail["queries"][0]["pass"].split()[0]  # every query returns the page
    assert [(r["url"], r["read"], r["pass"]) for r in selected] == [(url, "unread", first)]
