"""Read-before-choose manual judge (shared/manual_search/judge.py) — Slice 1.

The fixture is the REAL candidate set measured 2026-08-26 for a Harrington
UMS3-0335 end truck (docs/discovery/2026-08-26-feasibility-photo-to-manual-vs-chatgpt.md):
the heuristic scorer ranked a distributor's "Manual Hoists" brochure (40) above
the correct Series 3 End Trucks Owner's Manual (30). These tests pin that the
judge, reading the PDF text, reverses that — and that every failure mode
degrades to the legacy path instead of raising or auto-attaching a brochure.

Run: cd mira-bots && python -m pytest tests/test_manual_search_judge.py -q
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import shared.manual_search.judge as judge  # noqa: E402
import shared.manual_search.search as search_mod  # noqa: E402

SERIES3 = "https://www.aceindustries.com/content/Harrington_Series3_EndTrucks_Manual_Rev821.pdf"
BROCHURE = (
    "https://www.tool-smith.com/custom/content/files/Brands/HARHOI/Harrington%20Manual%20Hoists.pdf"
)
CATALOG = (
    "http://www.cordellmfg.com/wp-content/uploads/2015/02/Harrington-Crane-Component-Catalog.pdf"
)
CX_MANUAL = "https://hoists.com/wp-content/uploads/harrington-cx-manual.pdf"

TEXT = {
    SERIES3: (
        "Owner's Manual END TRUCKS Top Running & Under Running Series 3\n"
        "Table 1 Model UMS-3-0335 capacity 3 ton span 16 ft ... UMS-3-0450 ...\n"
        "Installation, wiring, inspection, lubrication, brake adjustment."
    ),
    BROCHURE: "Harrington Manual Hoists lever hoists LX CX series chain hoists brochure pricing",
    CATALOG: "Harrington Crane Component Catalog end trucks hoists festoon price list",
    CX_MANUAL: "CX Hand Chain Hoist Owner's Manual models CX003 CX005 CX010",
}


def _cands():
    """Heuristic order exactly as measured: brochure first, Series 3 second."""
    return [
        {
            "url": BROCHURE,
            "title": "Harrington Manual Hoists",
            "host": "www.tool-smith.com",
            "score": 40,
            "doc_type": "user_manual",
            "is_direct_pdf": True,
        },
        {
            "url": SERIES3,
            "title": "END TRUCKS Top Running & ...",
            "host": "www.aceindustries.com",
            "score": 30,
            "doc_type": "installation_manual",
            "is_direct_pdf": True,
        },
        {
            "url": CATALOG,
            "title": "Harrington Crane Component Catalog",
            "host": "www.cordellmfg.com",
            "score": 30,
            "doc_type": "installation_manual",
            "is_direct_pdf": True,
        },
        {
            "url": CX_MANUAL,
            "title": "harrington-cx-manual.pdf",
            "host": "hoists.com",
            "score": 40,
            "doc_type": "user_manual",
            "is_direct_pdf": True,
        },
    ]


class FakeRouter:
    """Deterministic stand-in for InferenceRouter: verdict from the text."""

    enabled = True

    def __init__(self):
        self.calls: list[str] = []

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        self.calls.append(user)
        if "UMS-3-0335" in user or "UMS3-0335" in user.split("First pages")[-1]:
            v = {
                "is_manual_for_model": True,
                "doc_type": "user_manual",
                "confidence": 0.93,
                "evidence_quote": "Table 1 Model UMS-3-0335 capacity 3 ton",
                "reason": "End truck owner's manual lists UMS-3-0335.",
            }
        else:
            v = {
                "is_manual_for_model": False,
                "doc_type": "brochure_or_catalog",
                "confidence": 0.85,
                "evidence_quote": "",
                "reason": "Lever/chain hoist literature; no end truck model.",
            }
        return json.dumps(v), {"provider": "fake"}


@pytest.fixture
def wired(monkeypatch):
    """Judge ON, fetch/extract/router mocked, Serper returns the measured set."""
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "1")
    router = FakeRouter()
    monkeypatch.setattr(judge, "_router", router)

    async def fake_fetch(url, max_bytes=judge.MAX_BYTES):
        return b"%PDF-1.4 " + url.encode() if url in TEXT else None

    async def fake_extract(data, max_pages=8, max_chars=7000):
        url = data[9:].decode()
        return TEXT.get(url, "")

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fake_fetch)
    monkeypatch.setattr(judge, "extract_text", fake_extract)

    async def fake_serper(query, num=10):
        return [{"link": c["url"], "title": c["title"]} for c in _cands()]

    monkeypatch.setattr(search_mod, "_serper_search", fake_serper)

    async def no_head(url):  # legacy HEAD path must not be needed on the happy path
        raise AssertionError("validate_pdf should not run when the judge decided")

    monkeypatch.setattr(search_mod, "validate_pdf", no_head)
    return router


# ── the Harrington case ──────────────────────────────────────────────────────


async def test_harrington_positive_judge_picks_series3_over_brochure(wired):
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r is not None
    assert r["url"] == SERIES3, r
    assert r["validated"] is True
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert "UMS-3-0335" in r["reason_detail"]
    assert r["judge"]["is_manual"] is True and r["judge"]["confidence"] == pytest.approx(0.93)
    rejected = {x["url"] for x in r["judged_rejected"]}
    assert BROCHURE in rejected and CX_MANUAL in rejected


async def test_wrong_manual_negative_all_rejected_returns_unvalidated(wired, monkeypatch):
    """If nothing read is the manual, the top candidate comes back validated=False
    with a judged reason — never a byte-valid brochure presented as trusted."""

    async def fake_extract(data, max_pages=8, max_chars=7000):
        return "lever hoist brochure only"  # every candidate reads as a brochure

    monkeypatch.setattr(judge, "extract_text", fake_extract)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r is not None
    assert r["validated"] is False
    assert r["reason"] == judge.REASON_JUDGED_REJECTED
    assert r["judge"]["is_manual"] is False


# ── degradation paths ────────────────────────────────────────────────────────


async def test_judge_disabled_restores_legacy_head_validate(wired, monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    seen = []

    async def head_ok(url):
        seen.append(url)
        return True

    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r["url"] == BROCHURE  # the measured legacy behaviour, unchanged
    assert r["validated"] is True and r["reason"] == "ok"
    assert "judge" not in r


async def test_router_unavailable_falls_through_to_head_validate(wired, monkeypatch):
    class Dead:
        enabled = False

    monkeypatch.setattr(judge, "_router", Dead())
    seen = []

    async def head_ok(url):
        seen.append(url)
        return True

    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    # bytes were fetched (real PDFs) but nobody READ them: not vouched for.
    assert r["validated"] is False
    assert r["reason"] == judge.REASON_JUDGE_UNAVAILABLE
    assert "review" in r["reason_detail"]
    assert r["judge"]["status"] == "unavailable"


async def test_fetch_failure_marks_unfetched_and_never_raises(wired, monkeypatch):
    async def boom(url, max_bytes=judge.MAX_BYTES):
        raise RuntimeError("network")

    async def fetch_none(url, max_bytes=judge.MAX_BYTES):
        return None

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch_none)
    calls = []

    async def head(url):
        calls.append(url)
        return False

    monkeypatch.setattr(search_mod, "validate_pdf", head)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r is not None and r["validated"] is False
    assert r["judge"]["status"] == "unfetched"

    # a raising fetch is contained inside _judge_one's caller too
    monkeypatch.setattr(judge, "fetch_pdf_bytes", boom)
    out = await judge.judge_candidates("Harrington", "UMS3-0335", _cands())
    assert len(out) == 4


async def test_malformed_model_output_is_unjudged(wired, monkeypatch):
    class Garbage:
        enabled = True

        async def complete(self, *a, **k):
            return "I think it's probably the manual?", {}

    monkeypatch.setattr(judge, "_router", Garbage())
    v = await judge.judge_text(
        "Harrington", "UMS3-0335", {"url": SERIES3, "title": ""}, TEXT[SERIES3]
    )
    assert v is None


# ── SSRF + caps on the real fetcher ──────────────────────────────────────────


async def test_fetch_refuses_private_hosts_via_ssrf_guard(monkeypatch):
    blocked = []

    def guard(url):
        blocked.append(url)
        return False

    monkeypatch.setattr(search_mod, "_url_is_probeable", guard)
    assert await judge.fetch_pdf_bytes("http://169.254.169.254/latest/meta-data") is None
    assert blocked == ["http://169.254.169.254/latest/meta-data"]


async def test_fetch_enforces_byte_cap_and_pdf_magic(monkeypatch):
    import httpx

    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: True)

    def handler(request):
        if request.url.path == "/big.pdf":
            return httpx.Response(200, content=b"%PDF-" + b"x" * 5000)
        return httpx.Response(200, content=b"<html>not a pdf</html>")

    monkeypatch.setattr(search_mod, "_transport_for_tests", httpx.MockTransport(handler))
    assert await judge.fetch_pdf_bytes("https://example.com/big.pdf", max_bytes=1000) is None
    assert await judge.fetch_pdf_bytes("https://example.com/big.pdf", max_bytes=10_000) is not None
    assert await judge.fetch_pdf_bytes("https://example.com/page.html") is None


# ── identity variants ────────────────────────────────────────────────────────


def test_model_variants_cover_the_measured_hyphen_flip_and_family():
    assert search_mod._model_variants("UMS3-0335") == [
        "UMS3-0335",
        "UMS30335",
        "UMS3",
        "UMS-3-0335",
    ]
    assert search_mod._model_variants("GS10-20P5") == [
        "GS10-20P5",
        "GS1020P5",
        "GS10",
        "GS-10-20P5",
    ]
    assert search_mod._model_variants("GS10") == ["GS10", "GS-10"]
    assert search_mod._model_variants("") == []


def test_harrington_is_an_oem_domain_now():
    assert search_mod._oem_domains_for("Harrington") == ("harringtonhoists.com",)
    assert search_mod._is_oem_host("www.harringtonhoists.com", "Harrington Hoists and Cranes")


def test_pdfplumber_extracts_text_from_a_real_pdf():
    """The MIT extractor actually works on bytes (guards the requirements pin)."""
    import pdfplumber  # noqa: F401

    # Minimal one-page PDF with a text object.
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 10 50 Td (Model UMS-3-0335 End Truck) Tj ET\nendstream\nendobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    text = judge._extract_text_sync(pdf, 2, 1000)
    assert "UMS-3-0335" in text


# ── defects found on the first LIVE run (2026-08-26) ─────────────────────────

TAX = [f"https://www.nj.gov/treasury/taxation/pdf/tax{i}.pdf" for i in range(4)]


async def test_batches_keep_reading_past_four_rejected_garbage_candidates(wired, monkeypatch):
    """Live: a hyphen variant pulled four NJ tax forms in at heuristic score 40,
    above the Series 3 manual at 30. Reading only the top four never opened
    the manual. Batches must continue until a match (or MAX_TOTAL)."""

    async def serper(query, num=10):
        return [{"link": u, "title": "Application for property tax relief"} for u in TAX] + [
            {"link": c["url"], "title": c["title"]} for c in _cands()
        ]

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    texts = dict(
        TEXT, **{u: "New Jersey Division of Taxation property tax relief form" for u in TAX}
    )

    async def fake_fetch(url, max_bytes=judge.MAX_BYTES):
        return b"%PDF-1.4 " + url.encode() if url in texts else None

    async def fake_extract(data, max_pages=8, max_chars=7000):
        return texts.get(data[9:].decode(), "")

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fake_fetch)
    monkeypatch.setattr(judge, "extract_text", fake_extract)
    # Make the tax forms outrank on the heuristic (they did live: score 40).
    monkeypatch.setattr(
        search_mod,
        "_score",
        lambda url, title, make, model: 40
        if "nj.gov" in url
        else (30 if "aceindustries" in url else 20),
    )

    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r["url"] == SERIES3 and r["validated"] is True
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert all(x["url"] != SERIES3 for x in r["judged_rejected"])


async def test_judged_rejection_is_never_returned_as_validated(wired, monkeypatch):
    """Live: an UNFETCHED candidate topped the ranking, the legacy loop ran, and
    returned a judged-REJECTED catalog as validated=True / judge_unavailable."""

    async def fake_fetch(url, max_bytes=judge.MAX_BYTES):
        if url == CX_MANUAL:
            return None  # unfetched → unjudged, stays in the pool
        return b"%PDF-1.4 " + url.encode()

    async def fake_extract(data, max_pages=8, max_chars=7000):
        return "brochure only"  # every fetched candidate judged NOT a manual

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fake_fetch)
    monkeypatch.setattr(judge, "extract_text", fake_extract)

    async def head(url):
        return url == CX_MANUAL  # the unjudged one HEAD-validates

    monkeypatch.setattr(search_mod, "validate_pdf", head)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    # The rejected ones are never returned; the UNJUDGED candidate is, but
    # held for review (validated=False) because nobody read it.
    assert r["url"] == CX_MANUAL and r["validated"] is False
    assert r["reason"] == judge.REASON_JUDGE_UNAVAILABLE
    assert "review" in r["reason_detail"]


def test_rank_orders_matched_then_unjudged_then_rejected():
    m = {"score": 10, "judge": {"status": "judged", "is_manual": True, "confidence": 0.7}}
    u = {"score": 99, "judge": {"status": "unfetched"}}
    x = {"score": 99, "judge": {"status": "judged", "is_manual": False, "confidence": 0.9}}
    assert judge.rank([x, u, m]) == [m, u, x]


def test_rank_prefers_the_whole_manual_over_one_chapter():
    """Live GS10: the OEM splits the user manual into per-chapter PDFs and the
    warning insert (page W-1) judged as a match first."""
    chapter = {
        "score": 150,
        "judge": {"status": "judged", "is_manual": True, "confidence": 0.95, "scope": "section"},
    }
    whole = {
        "score": 150,
        "judge": {"status": "judged", "is_manual": True, "confidence": 0.8, "scope": "complete"},
    }
    assert judge.rank([chapter, whole]) == [whole, chapter]


async def test_unread_candidate_on_oem_host_is_NOT_validated_while_judge_is_on(wired, monkeypatch):
    """Canary run 1: the only real GS10 hit came back unparseable and the OEM-host
    exception blessed it unread. Owner rule: uncertain stays uncertain."""
    oem = "https://www.harringtonhoists.com/download/2021/03/23/x_59103.pdf"

    async def serper(query, num=10):
        return [{"link": oem, "title": "59103 Model"}]

    monkeypatch.setattr(search_mod, "_serper_search", serper)

    async def fetch_none(url, max_bytes=judge.MAX_BYTES):
        return None

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch_none)

    async def head_ok(url):
        return True

    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r["url"] == oem and r["validated"] is False
    assert r["reason"] == judge.REASON_JUDGE_UNAVAILABLE


def test_relevant_skips_pdfs_that_name_neither_make_nor_model():
    assert (
        judge.relevant(
            {
                "url": "https://www.nj.gov/treasury/taxation/pdf/25-pas1in.pdf",
                "title": "Tax relief",
            },
            "Harrington",
            "UMS3-0335",
        )
        is False
    )
    assert judge.relevant({"url": SERIES3, "title": ""}, "Harrington", "UMS3-0335") is True
    assert (
        judge.relevant(
            {"url": "https://cdn.x.com/gs10m.pdf", "title": ""}, "AutomationDirect", "GS10-20P5"
        )
        is True
    )


async def test_all_relevant_rejected_returns_top_rejection_not_unread_stranger(wired, monkeypatch):
    stranger = "https://providers.highmark.com/files/procedurecodes.pdf"

    async def serper(query, num=10):
        return [{"link": stranger, "title": "Procedure codes"}] + [
            {"link": c["url"], "title": c["title"]} for c in _cands()
        ]

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    texts = dict(TEXT)
    texts[SERIES3] = "brochure only"  # nothing relevant is the manual this time

    async def fake_fetch(url, max_bytes=judge.MAX_BYTES):
        return b"%PDF-1.4 " + url.encode() if url in texts else None

    async def fake_extract(data, max_pages=8, max_chars=7000):
        return texts.get(data[9:].decode(), "")

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fake_fetch)
    monkeypatch.setattr(judge, "extract_text", fake_extract)
    monkeypatch.setattr(
        search_mod, "_score", lambda url, title, make, model: 90 if "highmark" in url else 30
    )

    async def head_ok(url):
        return True

    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    r = await search_mod.search_manual("Harrington", "UMS3-0335")
    assert r["url"] != stranger
    assert r["validated"] is False and r["reason"] == judge.REASON_JUDGED_REJECTED
    assert len(r["judged_rejected"]) >= 3


# ── OEM request-form fallback (decision C, 2026-08-26) ───────────────────────


async def test_oem_request_link_only_when_the_page_answers_200(monkeypatch):
    import httpx

    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: True)
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200 if "harringtonhoists" in str(request.url) else 404)

    monkeypatch.setattr(search_mod, "_transport_for_tests", httpx.MockTransport(handler))
    assert await search_mod.oem_request_link("Harrington Hoists and Cranes") == (
        "https://www.harringtonhoists.com/owners-manual-request"
    )
    assert await search_mod.oem_request_link("Siemens") is None  # no form on file
    assert calls == ["https://www.harringtonhoists.com/owners-manual-request"]


async def test_oem_request_link_dead_page_is_not_offered(monkeypatch):
    import httpx

    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: True)
    monkeypatch.setattr(
        search_mod, "_transport_for_tests", httpx.MockTransport(lambda r: httpx.Response(404))
    )
    assert await search_mod.oem_request_link("Harrington") is None


async def test_oem_request_link_respects_ssrf_guard(monkeypatch):
    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: False)
    assert await search_mod.oem_request_link("Harrington") is None


# ── review findings 2026-08-26 ───────────────────────────────────────────────


def test_extract_json_takes_the_last_parseable_object_past_prose_braces():
    prose = 'Thinking: the table {model list} is on page 10 and {"draft": 1} was wrong.\n'
    good = '{"is_manual_for_model": true, "confidence": 0.9, "reason": "table lists it"}'
    assert judge._extract_json(prose + good) == {
        "is_manual_for_model": True,
        "confidence": 0.9,
        "reason": "table lists it",
    }
    assert judge._extract_json("no json here") is None
    assert judge._extract_json("") is None


def test_score_rejects_non_http_schemes_outright():
    assert (
        search_mod._score("javascript:alert(1)", "Harrington manual", "Harrington", "UMS3-0335")
        == -1
    )
    assert (
        search_mod._score("data:text/html;base64,AAAA", "manual", "Harrington", "UMS3-0335") == -1
    )
    assert (
        search_mod._score("ftp://x.example/manual.pdf", "manual", "Harrington", "UMS3-0335") == -1
    )
    assert (
        search_mod._score("https://x.example/manual.pdf", "manual", "Harrington", "UMS3-0335") > 0
    )


async def test_extract_text_is_killed_on_timeout(monkeypatch):
    """The parse runs in a child process; a hang is killed, not awaited."""
    monkeypatch.setattr(judge, "EXTRACT_TIMEOUT", 0.5)
    monkeypatch.setattr(judge, "_EXTRACT_CHILD", "import time; time.sleep(30)")
    import time

    t = time.monotonic()
    assert await judge.extract_text(b"%PDF-1.4 whatever") == ""
    assert time.monotonic() - t < 5


async def test_extract_text_round_trips_a_real_pdf_through_the_child():
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 10 50 Td (Model UMS-3-0335 End Truck) Tj ET\nendstream\nendobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    assert "UMS-3-0335" in await judge.extract_text(pdf)


# ── canary audit trail (owner protocol 2026-08-26) ───────────────────────────


async def test_every_judgment_and_the_pick_are_logged_as_json(wired, caplog):
    import logging

    caplog.set_level(logging.INFO, logger="mira.manual_search")
    caplog.set_level(logging.INFO, logger="mira.manual_search.judge")
    await search_mod.search_manual("Harrington", "UMS3-0335")
    verdicts = [
        json.loads(r.getMessage().split(" ", 1)[1])
        for r in caplog.records
        if r.getMessage().startswith("MANUAL_JUDGE_VERDICT ")
    ]
    picks = [
        json.loads(r.getMessage().split(" ", 1)[1])
        for r in caplog.records
        if r.getMessage().startswith("MANUAL_JUDGE_PICK ")
    ]
    assert len(verdicts) >= 2 and len(picks) == 1
    match = next(v for v in verdicts if v["url"] == SERIES3)
    assert match["is_manual"] is True and "UMS-3-0335" in match["evidence_quote"]
    assert match["provider"] == "fake" and isinstance(match["latency_ms"], int)
    assert match["text_chars"] > 0
    assert picks[0]["top_url"] == SERIES3 and picks[0]["top_is_match"] is True
    assert picks[0]["rejected"] >= 1


async def test_unparseable_verdict_is_retried_once(wired, monkeypatch):
    calls = []

    class Flaky:
        enabled = True

        async def complete(self, *a, **k):
            calls.append(1)
            if len(calls) == 1:
                return '{"is_manual_for_model": tr', {"provider": "fake"}  # truncated
            return json.dumps({"is_manual_for_model": True, "confidence": 0.9, "reason": "ok"}), {
                "provider": "fake"
            }

    monkeypatch.setattr(judge, "_router", Flaky())
    v = await judge.judge_text(
        "Harrington", "UMS3-0335", {"url": SERIES3, "title": ""}, TEXT[SERIES3]
    )
    assert v is not None and v["is_manual"] is True
    assert len(calls) == 2
