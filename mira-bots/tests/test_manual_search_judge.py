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

import asyncio
import json
import pathlib
import sys
from urllib.parse import urlparse

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
        lambda url, title, make, model: (
            40 if "nj.gov" in url else (30 if "aceindustries" in url else 20)
        ),
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


async def test_oem_request_link_is_a_curated_link_not_a_fetch():
    """Decision C's request-form fallback survives, but as a static curated
    link the technician opens (Manual-First R7, Codex G1). The live probe is
    covered as removed in test_manual_search_egress.py."""
    assert await search_mod.oem_request_link("Harrington Hoists and Cranes") == (
        "https://www.harringtonhoists.com/owners-manual-request"
    )
    assert (
        await search_mod.oem_request_link("Siemens") == "https://industry.siemens.com/"
    )  # known OEM site, no form on file


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
            return json.dumps(
                {
                    "is_manual_for_model": True,
                    "doc_type": "user_manual",
                    "confidence": 0.9,
                    "reason": "ok",
                }
            ), {"provider": "fake"}

    monkeypatch.setattr(judge, "_router", Flaky())
    v = await judge.judge_text(
        "Harrington", "UMS3-0335", {"url": SERIES3, "title": ""}, TEXT[SERIES3]
    )
    assert v is not None and v["is_manual"] is True
    assert len(calls) == 2


# ── false positive, phone canary 2026-08-26 (GS1-45P0 → fuse-kit parts list) ─


async def test_parts_list_is_never_the_manual_even_if_the_model_says_yes(monkeypatch):
    class SaysYes:
        enabled = True

        async def complete(self, *a, **k):
            return (
                json.dumps(
                    {
                        "is_manual_for_model": True,
                        "doc_type": "parts_list",
                        "scope": "complete",
                        "confidence": 0.92,
                        "evidence_quote": "GS-45P0 fuse kit",
                        "reason": "lists fuse kits for GS1 drives",
                    }
                ),
                {"provider": "fake", "model": "fake/m"},
            )

    monkeypatch.setattr(judge, "_router", SaysYes())
    v = await judge.judge_text(
        "AutomationDirect",
        "GS1-45P0",
        {"url": "https://cdn.x/gsacfuse.pdf", "title": ""},
        "fuse kits",
    )
    assert v is not None
    assert v["is_manual"] is False and v["downgraded"] is True
    assert v["reason"].startswith("Classified as parts list, not a user/installation manual.")
    cand = {"url": "https://cdn.x/gsacfuse.pdf", "title": "", "is_direct_pdf": True, "score": 150}
    cand["judge"] = dict(v, status="judged")
    assert judge.is_match(cand) is False and judge.is_rejected(cand) is True


async def test_user_and_installation_manuals_still_match(monkeypatch):
    for kind in ("user_manual", "installation_manual"):

        class Yes:
            enabled = True

            async def complete(self, *a, **k):
                return json.dumps(
                    {
                        "is_manual_for_model": True,
                        "doc_type": kind,
                        "confidence": 0.9,
                        "reason": "r",
                    }
                ), {}

        monkeypatch.setattr(judge, "_router", Yes())
        v = await judge.judge_text("X", "Y", {"url": "https://x/m.pdf", "title": ""}, "t")
        assert v["is_manual"] is True and v["downgraded"] is False


# ── which VOLUME wins (Fix A, 2026-10-04 Golden Walk + Pixel 9a) ──────────────
#
# Real picks that were "a manual for this model" and still the wrong book:
# PowerFlex 525 -> 520COM-UM001 (communications, 398 chunks, no F005), ACS580 ->
# a Portuguese firmware manual, FC 302 -> an Indonesian manual, GS10 ->
# contents.pdf. Matches must rank by fault-code coverage and language.


def _match(conf, *, faults=None, lang=None, scope="complete", heading=False, score=150):
    return {
        "score": score,
        "judge": {
            "status": "judged",
            "is_manual": True,
            "confidence": conf,
            "scope": scope,
            "lists_fault_codes": faults,
            "text_language": lang,
            "fault_heading": heading,
        },
    }


def test_rank_prefers_the_fault_code_volume_over_a_communications_manual():
    comms = _match(0.95, faults=False, lang="en")  # 520COM-UM001: confident, wrong book
    programming = _match(0.80, faults=True, lang="en")  # 520-PC001: lists F005
    assert judge.rank([comms, programming]) == [programming, comms]


def test_rank_prefers_the_technicians_language_when_both_list_faults():
    portuguese = _match(0.95, faults=True, lang="pt")
    english = _match(0.70, faults=True, lang="en")
    indonesian = _match(0.99, faults=True, lang="id")
    assert judge.rank([portuguese, indonesian, english])[0] is english


def test_rank_a_fault_code_chapter_beats_a_whole_manual_without_faults():
    contents = _match(0.9, faults=False, lang="en", scope="complete")  # GS10 contents.pdf
    fault_chapter = _match(0.7, faults=True, lang="en", scope="section")
    assert judge.rank([contents, fault_chapter]) == [fault_chapter, contents]


def test_rank_unknown_coverage_sits_between_listed_and_not_listed():
    no, unknown, yes = _match(0.9, faults=False), _match(0.9), _match(0.9, faults=True)
    assert judge.rank([no, unknown, yes]) == [yes, unknown, no]


def test_model_verdict_on_coverage_beats_the_heading_regex():
    # An adapter manual has an "Error codes" heading for the ADAPTER; the model said no.
    adapter = {"lists_fault_codes": False, "fault_heading": True}
    silent = {"lists_fault_codes": None, "fault_heading": True}
    assert judge._fault_list(adapter) is False
    assert judge._fault_list(silent) is True
    assert judge._fault_list({"lists_fault_codes": None, "fault_heading": False}) is None


def test_fault_heading_regex_finds_fault_list_headings_not_prose():
    assert judge._FAULT_HEADING.search("Chapter 4 Troubleshooting ... Fault Codes 4-3")
    assert judge._FAULT_HEADING.search("Faults and Alarms ........ 112")
    assert judge._FAULT_HEADING.search("Códigos de falla y alarmas")
    assert not judge._FAULT_HEADING.search("The drive faulted when the alarm horn sounded.")


EN_TEXT = (
    "This manual describes the installation of the drive and the use of the keypad. "
    "If the drive is not ready, check the wiring to the terminals and the power supply. "
    "For more information, refer to the programming manual and the safety instructions "
    "that are shipped with the product when it is delivered from the factory."
)
PT_TEXT = (
    "Este manual descreve a instalação do inversor e o uso do teclado. Se o inversor não "
    "estiver pronto, verifique a fiação dos terminais e da fonte de alimentação. Para mais "
    "informações, consulte o manual de programação e as instruções de segurança que são "
    "enviadas com o produto quando ele é entregue da fábrica para o cliente final."
)
ID_TEXT = (
    "Manual ini menjelaskan pemasangan konverter dan penggunaan panel. Jika konverter tidak "
    "siap, periksa kabel ke terminal dan catu daya. Untuk informasi lebih lanjut, lihat "
    "panduan pemrograman dan petunjuk keselamatan yang dikirim dengan produk ini pada saat "
    "dikirim dari pabrik dan jika ada masalah dengan unit ini hubungi dukungan."
)


def test_text_language_is_deterministic_and_abstains_on_thin_text():
    assert judge.text_language(EN_TEXT) == "en"
    # The judge reads up to 7,000 characters; a few paragraphs is the realistic floor.
    assert judge.text_language(PT_TEXT * 3) == "pt"
    assert judge.text_language(ID_TEXT * 3) == "id"
    assert judge.text_language("PowerFlex 525 F005 4-3 5-1 A-2") is None


def test_text_language_outranks_the_models_language_guess():
    j = {"text_language": "pt", "language": "en"}
    assert judge._language_ok(j) is False
    assert judge._language_ok({"text_language": None, "language": "en"}) is True
    assert judge._language_ok({}) is None


# --- the loop: a non-ideal first match buys one more batch, inside a deadline ---

COMMS = "https://literature.rockwellautomation.com/520com-um001_-en-e.pdf"
PROG = "https://literature.rockwellautomation.com/520-pc001_-en-p.pdf"
VOLUME_TEXT = {
    COMMS: "PowerFlex 525 Embedded EtherNet/IP Adapter User Manual. " + EN_TEXT,
    PROG: "PowerFlex 525 Adjustable Frequency AC Drive. Fault Codes ... " + EN_TEXT,
}


class VolumeRouter:
    enabled = True

    def __init__(self):
        self.read: list[str] = []

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        url = PROG if PROG in user else COMMS
        self.read.append(url)
        return json.dumps(
            {
                "is_manual_for_model": True,
                "doc_type": "user_manual",
                "scope": "complete",
                "confidence": 0.95 if url == COMMS else 0.8,
                "lists_fault_codes": url == PROG,
                "language": "en",
                "evidence_quote": "PowerFlex 525",
                "reason": "PowerFlex 525 manual",
            }
        ), {"provider": "fake"}


@pytest.fixture
def volumes(monkeypatch):
    router = VolumeRouter()
    monkeypatch.setattr(judge, "_router", router)
    monkeypatch.setattr(judge, "MAX_CANDIDATES", 1)  # one candidate per batch

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        return VOLUME_TEXT[data[9:].decode()]

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    return router


def _vol_cands(*urls):
    return [
        {"url": u, "title": "PowerFlex 525 manual", "score": 150 - i, "is_direct_pdf": True}
        for i, u in enumerate(urls)
    ]


async def test_a_communications_manual_first_still_ends_on_the_fault_code_volume(volumes):
    ranked = await judge.judge_candidates("Allen-Bradley", "PowerFlex 525", _vol_cands(COMMS, PROG))
    assert volumes.read == [COMMS, PROG]
    assert ranked[0]["url"] == PROG and judge.is_ideal(ranked[0])


async def test_an_ideal_first_match_stops_without_reading_further(volumes):
    ranked = await judge.judge_candidates("Allen-Bradley", "PowerFlex 525", _vol_cands(PROG, COMMS))
    assert volumes.read == [PROG]
    assert ranked[0]["url"] == PROG


async def test_upgrade_past_the_deadline_keeps_the_match_in_hand(volumes, monkeypatch):
    monkeypatch.setattr(judge, "UPGRADE_DEADLINE_S", 0.0)
    ranked = await judge.judge_candidates("Allen-Bradley", "PowerFlex 525", _vol_cands(COMMS, PROG))
    assert volumes.read == [COMMS]
    assert ranked[0]["url"] == COMMS and judge.is_match(ranked[0])


async def test_a_slow_upgrade_batch_times_out_and_keeps_the_match(volumes, monkeypatch):
    import asyncio

    monkeypatch.setattr(judge, "UPGRADE_DEADLINE_S", 0.3)
    monkeypatch.setattr(judge, "UPGRADE_MIN_BATCH_S", 0.01)
    fast_fetch = judge.fetch_pdf_bytes

    async def slow_for_prog(url, max_bytes=judge.MAX_BYTES):
        if url == PROG:
            await asyncio.sleep(5)
        return await fast_fetch(url, max_bytes)

    monkeypatch.setattr(judge, "fetch_pdf_bytes", slow_for_prog)
    ranked = await judge.judge_candidates("Allen-Bradley", "PowerFlex 525", _vol_cands(COMMS, PROG))
    assert volumes.read == [COMMS]
    assert ranked[0]["url"] == COMMS and judge.is_match(ranked[0])


# Live 2026-10-04: 520-DU001 ("On Drive Guide", F005 on p4) read as Spanish: its first
# pages carry "En" (Enabled) 33 times against 8 English function words. Same counts,
# synthetic text (not the manual's), so the fixture reproduces the misread exactly.
EN_PARAMETER_TABLE = (
    " ".join(f"P{n:03d} Output Freq En Disabled" for n in range(33))
    + " Additional parameters are listed on the previous page, the value is the fault code"
    + " for this drive."
)


def test_english_parameter_table_with_spanish_looking_abbreviations_is_english():
    assert judge.text_language(EN_PARAMETER_TABLE) == "en"


def test_a_bare_parameter_table_is_unknown_not_spanish():
    table_only = " ".join(f"P{n:03d} Output Freq En Disabled" for n in range(33))
    assert judge.text_language(table_only) is None


# ── Codex #4233 r1 remediation ───────────────────────────────────────────────

CHAPTER = "https://cdn.example-oem.com/manuals/model-x/ch6-fault-codes.pdf"
WHOLE = "https://cdn.example-oem.com/manuals/model-x/user-manual.pdf"
NOLANG = "https://cdn.example-oem.com/manuals/model-x/sheet.pdf"


class ScriptedRouter:
    """Verdict per URL: (lists_fault_codes, scope, language)."""

    enabled = True

    def __init__(self, script):
        self.script, self.read = script, []

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        url = next(u for u in self.script if u in user)
        self.read.append(url)
        faults, scope, lang = self.script[url]
        return json.dumps(
            {
                "is_manual_for_model": True,
                "doc_type": "user_manual",
                "scope": scope,
                "confidence": 0.9,
                "lists_fault_codes": faults,
                "language": lang,
                "reason": "r",
            }
        ), {"provider": "fake"}


def _scripted(monkeypatch, script, texts):
    router = ScriptedRouter(script)
    monkeypatch.setattr(judge, "_router", router)
    monkeypatch.setattr(judge, "MAX_CANDIDATES", 1)

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        return texts[data[9:].decode()]

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    return router


async def test_f3_a_fault_chapter_does_not_stop_before_the_whole_manual(monkeypatch):
    r = _scripted(
        monkeypatch,
        {CHAPTER: (True, "section", "en"), WHOLE: (True, "complete", "en")},
        {CHAPTER: EN_TEXT, WHOLE: EN_TEXT},
    )
    ranked = await judge.judge_candidates("ExampleOEM", "Model X", _vol_cands(CHAPTER, WHOLE))
    assert r.read == [CHAPTER, WHOLE]
    assert ranked[0]["url"] == WHOLE


async def test_f3_unknown_language_does_not_stop_before_a_confirmed_one(monkeypatch):
    r = _scripted(
        monkeypatch,
        {NOLANG: (True, "complete", ""), WHOLE: (True, "complete", "en")},
        {NOLANG: "P001 P002 F005 4-3", WHOLE: EN_TEXT},
    )
    ranked = await judge.judge_candidates("ExampleOEM", "Model X", _vol_cands(NOLANG, WHOLE))
    assert r.read == [NOLANG, WHOLE]
    assert ranked[0]["url"] == WHOLE


def test_f2_shared_words_do_not_make_portuguese_spanish(monkeypatch):
    monkeypatch.setattr(judge, "PREFERRED_LANGUAGE", "es")
    detected = judge.text_language(PT_TEXT * 3)
    assert detected != "es"
    assert judge._language_ok({"text_language": detected, "language": "pt"}) is False


async def test_f1_a_slow_search_still_returns_the_match_inside_the_discovery_timeout(monkeypatch):
    """Provider search eats most of the budget, the first batch finds a non-ideal
    match, the upgrade batch stalls: the call must still return that match before
    the caller's outer timeout (proportional to the live 25 s / 30 s / 50 s)."""
    import asyncio

    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "1")
    monkeypatch.setattr(judge, "UPGRADE_DEADLINE_S", 0.6)
    monkeypatch.setattr(judge, "UPGRADE_MIN_BATCH_S", 0.01)
    monkeypatch.setattr(judge, "MAX_CANDIDATES", 1)
    monkeypatch.setattr(
        judge,
        "_router",
        ScriptedRouter({COMMS: (False, "complete", "en"), PROG: (False, "complete", "en")}),
    )
    reads = {"n": 0}

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        reads["n"] += 1
        if reads["n"] > 1:  # whichever is read second stalls
            await asyncio.sleep(10)
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        return EN_TEXT

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)

    async def slow_serper(query, num=10):
        await asyncio.sleep(0.5)  # provider search before judging starts
        return [
            {"link": COMMS, "title": "PowerFlex 525 User Manual"},
            {"link": PROG, "title": "PowerFlex 525 User Manual"},
        ]

    monkeypatch.setattr(search_mod, "_serper_search", slow_serper)

    async def no_head(url):
        raise AssertionError("the judged match must be returned, not HEAD-validated")

    monkeypatch.setattr(search_mod, "validate_pdf", no_head)
    started = asyncio.get_running_loop().time()
    got = await asyncio.wait_for(
        search_mod.search_manual("Allen-Bradley", "PowerFlex 525"), timeout=1.0
    )
    assert got is not None and judge.is_match(got) and got["validated"] is True
    assert asyncio.get_running_loop().time() - started < 1.0


async def test_r2_f1_the_callers_shorter_timeout_caps_the_upgrade(monkeypatch):
    """Codex r2: MANUAL_DISCOVERY_TIMEOUT below the upgrade budget. The caller's own
    deadline must cap the upgrade so its timeout never discards the match in hand."""
    import asyncio
    import time

    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "1")
    monkeypatch.setattr(judge, "UPGRADE_DEADLINE_S", 5.0)  # longer than the caller allows
    monkeypatch.setattr(judge, "UPGRADE_MIN_BATCH_S", 0.01)
    monkeypatch.setattr(judge, "RETURN_RESERVE_S", 0.1)
    monkeypatch.setattr(judge, "MAX_CANDIDATES", 1)
    monkeypatch.setattr(
        judge,
        "_router",
        ScriptedRouter({COMMS: (False, "complete", "en"), PROG: (False, "complete", "en")}),
    )
    reads = {"n": 0}

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        reads["n"] += 1
        if reads["n"] > 1:
            await asyncio.sleep(10)
        return b"%PDF-1.4 " + url.encode()

    async def extract(data, max_pages=8, max_chars=7000):
        return EN_TEXT

    async def serper(query, num=10):
        return [
            {"link": COMMS, "title": "PowerFlex 525 User Manual"},
            {"link": PROG, "title": "PowerFlex 525 User Manual"},
        ]

    async def no_head(url):
        raise AssertionError("the judged match must be returned, not HEAD-validated")

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", no_head)
    timeout = 0.5
    got = await asyncio.wait_for(
        search_mod.search_manual(
            "Allen-Bradley", "PowerFlex 525", deadline_at=time.monotonic() + timeout
        ),
        timeout=timeout,
    )
    assert got is not None and judge.is_match(got) and got["validated"] is True


# #4401 — staging 2026-10-13: "Emerson IC752DPA062A" pulled four unrelated PDFs
# (a city health-department archive, a reseller brochure, …). Reading them ran past
# mira-ask's 50 s discovery timeout; the router cancelled the search and the Hub told
# the technician "Manual search is unavailable". With NO match in hand, a reading batch
# must still stop at the caller's deadline and hand back what it has.
async def test_a_slow_search_batch_stops_at_the_callers_deadline(volumes, monkeypatch):
    import asyncio
    import time

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        await asyncio.sleep(5)
        return None

    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    trace: dict = {}
    t0 = time.monotonic()
    ranked = await judge.judge_candidates(
        "Allen-Bradley",
        "PowerFlex 525",
        _vol_cands(COMMS),
        deadline_at=time.monotonic() + judge.RETURN_RESERVE_S + 0.3,
        trace=trace,
    )
    assert time.monotonic() - t0 < 2.0
    assert trace["stop"] == "search_deadline"
    assert not any(judge.is_match(c) for c in ranked)


async def test_a_spent_deadline_schedules_no_read_at_all(volumes, monkeypatch):
    # Review of #4408: the deadline was checked only AFTER the batch's reads were
    # scheduled, then cancelled unawaited. A spent deadline must start no work.
    import time

    scheduled: list[str] = []
    real_judge_one = judge._judge_one

    def recording_judge_one(make, model, c):
        scheduled.append(c["url"])
        return real_judge_one(make, model, c)

    monkeypatch.setattr(judge, "_judge_one", recording_judge_one)
    trace: dict = {}
    await judge.judge_candidates(
        "Allen-Bradley",
        "PowerFlex 525",
        _vol_cands(COMMS),
        deadline_at=time.monotonic() + judge.RETURN_RESERVE_S - 0.5,
        trace=trace,
    )
    assert trace["stop"] == "search_deadline"
    assert scheduled == []


async def test_a_search_batch_with_time_to_spare_reads_to_the_end(volumes):
    # Control: a deadline far away changes nothing — the batch is read and judged.
    import time

    trace: dict = {}
    ranked = await judge.judge_candidates(
        "Allen-Bradley",
        "PowerFlex 525",
        _vol_cands(PROG),
        deadline_at=time.monotonic() + 60,
        trace=trace,
    )
    assert volumes.read == [PROG]
    assert trace["stop"] == "ideal_match"
    assert ranked[0]["url"] == PROG and judge.is_match(ranked[0])


# #4400 — staging 2026-10-13, "GE Fanuc IC752DPA062A" (2/2): the only hits were a
# reseller's company profile and unrelated archive PDFs. None names the make or the
# model, none could be read, and the finder still offered the company profile as
# "a possible manual". An unread candidate is offered for review ONLY if it names the
# make or the model; a stranger can win only by being READ and judged the manual.
_STRANGERS = [
    (
        "https://5.imimg.com/data5/SELLER/Doc/2026/7/1/XM/GE/KP/1/brightech-company-profile-5.pdf",
        "industrial - automation and - image",
    ),
    ("https://msa.maryland.gov/megafile/msa/cm1134/000058.pdf", "BALTIMORE CITY HEALTH DEPARTMENT"),
]


async def test_unread_strangers_are_never_offered_as_a_possible_manual(wired, monkeypatch):
    assert not any(
        judge.relevant({"url": u, "title": t}, "GE Fanuc", "IC752DPA062A") for u, t in _STRANGERS
    )

    async def serper(query, num=10):
        return [{"link": u, "title": t} for u, t in _STRANGERS]

    async def head_ok(url):
        return True

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "_score", lambda url, title, make, model: 25)
    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    # wired's fetch returns None for these URLs: unread, so unjudged.
    assert await search_mod.search_manual("GE Fanuc", "IC752DPA062A") is None


async def test_an_unread_candidate_naming_the_model_is_still_offered_for_review(wired, monkeypatch):
    # Control: uncertain stays uncertain — a relevant candidate the judge could not
    # read is still handed back unvalidated, for the technician to check.
    named = "https://cdn.example.com/docs/ic752dpa062a-operator-interface-manual.pdf"
    assert judge.relevant({"url": named, "title": ""}, "GE Fanuc", "IC752DPA062A")

    async def serper(query, num=10):
        return [{"link": named, "title": "Operator interface manual"}]

    async def head_ok(url):
        return True

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "_score", lambda url, title, make, model: 25)
    monkeypatch.setattr(search_mod, "validate_pdf", head_ok)
    r = await search_mod.search_manual("GE Fanuc", "IC752DPA062A")
    assert r is not None and r["url"] == named
    assert r["validated"] is False and r["reason"] == judge.REASON_JUDGE_UNAVAILABLE


# #5789 — staging 2026-11-22, notebook confirmed as "AutomationDirect GS10". The pool,
# copied from that notebook's acquisition trail: six AutomationDirect PDFs that were
# read and judged not to be the manual (a cut sheet and drawings), and three web pages
# that were never read and name only "GS10" — a Boss Audio car amplifier and two Gis
# products. The finder offered the Boss Audio page as "a possible manual". A page the
# judge never reads (not a direct PDF) is offered only if it names the confirmed make
# or sits on that make's own site; the model string alone is shared by strangers.
_AD = "https://cdn.automationdirect.com/static"
_AD_READ = [
    (f"{_AD}/specs/cutsheet/GS10A-N1D_cutsheet.pdf", "GS10A-N1D Cut Sheet"),
    (
        f"{_AD}/drawings/2d/GS11N-22P0.pdf",
        "durapulse gs10 series ac micro drive, enclosed, 230v, 2hp",
    ),
    (
        f"{_AD}/drawings/2d/GS13N-4010.pdf",
        "durapulse gs10 series ac micro drive, enclosed, 460v, 10hp, 3",
    ),
    (
        f"{_AD}/drawings/2d/GS11N-11P0.pdf",
        "DURAPULSE GS10 SERIES AC MICRO DRIVE, ENCLOSED, 120V, ...",
    ),
    (
        f"{_AD}/drawings/2d/GS13N-41P0.pdf",
        "DURAPULSE GS10 SERIES AC MICRO DRIVE, ENCLOSED, 460V, ...",
    ),
    (
        f"{_AD}/drawings/2d/GS11N-20P2.pdf",
        "DURAPULSE GS10 SERIES AC MICRO DRIVE, ENCLOSED, 230V, ...",
    ),
]
_OTHER_MAKERS = [
    (
        "https://tv.manualsonline.com/manuals/mfg/boss_audio_systems/gs10.html",
        "Boss Audio Systems GS-10 Manual",
    ),
    (
        "https://www.manualslib.com/products/Gis-Gs10-150-260-11628317.html",
        "Gis GS10/150/260 Manuals",
    ),
    (
        "https://www.manualslib.de/products/Gis-Gs10-100-260-1316150.html",
        "Gis GS10/100/260 Handbücher",
    ),
]


def _serve(monkeypatch, hits, pdfs=frozenset()):
    async def serper(query, num=10):
        return [{"link": u, "title": t} for u, t in hits]

    async def probe(url):  # a web page never HEAD-validates as a PDF; `pdfs` do
        return url in pdfs

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", probe)


async def test_a_page_naming_only_the_model_is_not_offered_for_another_makers_machine(
    wired, monkeypatch
):
    # The staging pool, unaltered. Every AutomationDirect PDF reads as not-the-manual.
    for url, _ in _AD_READ:
        monkeypatch.setitem(TEXT, url, "DURApulse GS10 dimensional drawing / cut sheet")
    assert all(
        judge.relevant({"url": u, "title": t}, "AutomationDirect", "GS10") for u, t in _OTHER_MAKERS
    )
    _serve(monkeypatch, _AD_READ + _OTHER_MAKERS)
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    # What remains is the judged rejection, which the discovery route turns into an
    # honest "no manual found" with the manufacturer's own site.
    assert r is not None and r["host"] == "cdn.automationdirect.com", r
    assert r["validated"] is False and r["reason"] == judge.REASON_JUDGED_REJECTED


async def test_with_only_other_makers_pages_the_finder_reports_an_honest_miss(wired, monkeypatch):
    _serve(monkeypatch, _OTHER_MAKERS)
    assert await search_mod.search_manual("AutomationDirect", "GS10") is None


async def test_judge_off_a_page_naming_only_the_model_is_not_offered(wired, monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    assert not judge.judge_enabled()
    _serve(monkeypatch, _OTHER_MAKERS)
    assert await search_mod.search_manual("AutomationDirect", "GS10") is None


async def test_judge_off_a_page_naming_the_make_is_still_offered_for_review(wired, monkeypatch):
    # Control for the judge-off filter: only the stranger is dropped.
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    named = "https://www.manualslib.com/products/Automationdirect-Gs10-12345.html"
    _serve(monkeypatch, [(named, "AutomationDirect GS10 Manuals")])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == named and r["validated"] is False


async def test_an_unread_page_naming_the_make_is_still_offered_for_review(wired, monkeypatch):
    # Control: uncertain stays uncertain when the page names the confirmed make.
    named = "https://www.manualslib.com/products/Automationdirect-Gs10-12345.html"
    _serve(monkeypatch, [(named, "AutomationDirect GS10 Manuals")])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == named
    assert r["validated"] is False and r["reason"] == judge.REASON_JUDGE_UNAVAILABLE


async def test_an_unread_page_on_the_makers_own_site_is_offered_without_naming_it(
    wired, monkeypatch
):
    # Control: a brand sold under another company's domain (Square D on se.com) is
    # recognised by its site, not by the name — the page never says "Square D".
    page = "https://www.se.com/us/en/product/QO120/miniature-circuit-breaker-qo-20a/"
    assert not judge._mentions_make(
        {"url": page, "title": "QO120 - Miniature circuit breaker"}, "Square D"
    )
    assert search_mod._is_oem_host("www.se.com", "Square D")
    _serve(monkeypatch, [(page, "QO120 - Miniature circuit breaker")])
    r = await search_mod.search_manual("Square D", "QO120")
    assert r is not None and r["url"] == page and r["validated"] is False


async def test_an_exact_part_number_lookup_still_offers_a_page_naming_only_the_part(
    wired, monkeypatch
):
    # The photo part search sends a full catalog number read off a label. A
    # distributor page naming that number may be the part even without the maker's
    # name; the same page on a model lookup is screened like any other stranger.
    page = "https://www.example-distributor.com/p/6es7214-1ag40-0xb0"
    title = "6ES7214-1AG40-0XB0 CPU 1214C compact"
    assert not judge._mentions_make({"url": page, "title": title}, "Siemens")
    _serve(monkeypatch, [(page, title)])
    assert await search_mod.search_manual("Siemens", "6ES7214-1AG40-0XB0") is None
    r = await search_mod.search_manual("Siemens", "6ES7214-1AG40-0XB0", exact_part_number=True)
    assert r is not None and r["url"] == page and r["validated"] is False


async def test_a_lookup_with_no_make_screens_nothing(wired, monkeypatch):
    # Control: with no make there is nothing to compare a page against.
    page, title = _OTHER_MAKERS[0]
    _serve(monkeypatch, [(page, title)])
    r = await search_mod.search_manual("", "GS10")
    assert r is not None and r["url"] == page and r["validated"] is False


# Codex #5823 round 1. F1: the make is matched as a whole name, not a fragment.
async def test_a_fragment_of_the_make_does_not_count_as_naming_it(wired, monkeypatch):
    page = "https://www.example-audio.com/boss-audio-gs10"
    title = "Boss Audio GS10 Direct-Drive Amplifier Manual"
    assert judge._mentions_make({"url": page, "title": title}, "Automation Direct")
    _serve(monkeypatch, [(page, title)])
    assert await search_mod.search_manual("Automation Direct", "GS10") is None


async def test_a_page_naming_another_spelling_of_the_make_is_offered(wired, monkeypatch):
    # Control: "Automation Direct" and "AutomationDirect" share one OEM entry.
    page = "https://www.manualslib.com/products/gs10-ac-drive-12345.html"
    _serve(monkeypatch, [(page, "AutomationDirect GS10 Manuals")])
    r = await search_mod.search_manual("Automation Direct", "GS10")
    assert r is not None and r["url"] == page and r["validated"] is False


async def test_a_short_make_named_in_full_is_offered(wired, monkeypatch):
    page = "https://www.example-motors.com/products/5ks184saa205"
    title = "GE 5KS184SAA205 Motor Manual"
    assert not judge._mentions_make({"url": page, "title": title}, "GE")
    _serve(monkeypatch, [(page, title)])
    r = await search_mod.search_manual("GE", "5KS184SAA205")
    assert r is not None and r["url"] == page and r["validated"] is False


async def test_an_unread_direct_pdf_that_does_not_probe_keeps_the_older_rule(wired, monkeypatch):
    # A direct PDF the judge could not fetch and the probe could not confirm is still
    # offered for review on the model alone, as before #5789: only web pages are screened.
    pdf = "https://www.example-files.com/library/gs10-manual.pdf"
    assert pdf not in TEXT
    _serve(monkeypatch, [(pdf, "GS10 manual")])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == pdf and r["validated"] is False


# #5830: that older rule holds only while the probe cannot tell what the link serves.
# A .pdf link whose probe gets a successful answer starting with markup serves a page,
# so the make screen applies to it as to one. These run the real validate_pdf against
# canned answers, with the judge on and off.
_REAL_VALIDATE_PDF = search_mod.validate_pdf  # captured before any fixture replaces it
_BOSS_PDF = "https://www.example-files.com/boss-audio/gs10-brochure.pdf"
_BOSS_PAGE = b"<!DOCTYPE html><html><title>Boss Audio GS10 amplifier support</title></html>"
_OTHER_PDF = "https://www.example-files.com/library/gs10-manual.pdf"


def _answer(monkeypatch, answers):
    """Serve the probe through the real validate_pdf. ``answers`` maps a URL to a
    function of the request; returns the list of (method, url) the probe sent."""
    import httpx

    sent: list[tuple[str, str]] = []

    def respond(request):
        sent.append((request.method, str(request.url)))
        return answers[str(request.url)](request)

    monkeypatch.setattr(search_mod, "_url_is_probeable", lambda u: True)
    monkeypatch.setattr(search_mod, "_transport_for_tests", httpx.MockTransport(respond))
    monkeypatch.setattr(search_mod, "validate_pdf", _REAL_VALIDATE_PDF)
    return sent


def _page(status=200, body=_BOSS_PAGE, content_type="text/html"):
    import httpx

    return lambda request: httpx.Response(
        status, headers={"content-type": content_type}, content=body
    )


def _unreachable(request):
    import httpx

    raise httpx.ConnectError("no route to host", request=request)


async def test_a_pdf_link_that_serves_a_web_page_is_screened_like_one(wired, monkeypatch):
    c = {"url": _BOSS_PDF, "title": "GS10 brochure"}
    assert search_mod._is_direct_pdf(_BOSS_PDF) and _BOSS_PDF not in TEXT
    assert not search_mod._names_make(c, "AutomationDirect")
    assert not search_mod._is_oem_host(urlparse(_BOSS_PDF).netloc, "AutomationDirect")
    # The markup is the proof, whatever the content type claims.
    for content_type in ("text/html", "application/octet-stream"):
        for enabled in ("1", "0"):
            monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
            _serve(monkeypatch, [(_BOSS_PDF, c["title"])])
            sent = _answer(monkeypatch, {_BOSS_PDF: _page(content_type=content_type)})
            r = await search_mod.search_manual("AutomationDirect", "GS10")
            assert r is None, (content_type, enabled)
            assert ("GET", _BOSS_PDF) in sent, (enabled, sent)  # the screen followed a probe
            assert search_mod._probed_not_pdf.get() is None


@pytest.mark.parametrize(
    "answer",
    [
        _page(status=403),
        _page(status=404),
        _page(status=503),
        _page(body=b""),
        _page(body=b"\n\x00\x00%PDF-1.7", content_type="application/octet-stream"),
        _unreachable,
    ],
    ids=["forbidden", "missing", "unavailable", "empty", "bytes_before_header", "unreachable"],
)
async def test_control_a_pdf_link_whose_probe_cannot_tell_keeps_the_older_rule(
    wired, monkeypatch, answer
):
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
        sent = _answer(monkeypatch, {_BOSS_PDF: answer})
        r = await search_mod.search_manual("AutomationDirect", "GS10")
        assert r is not None and r["url"] == _BOSS_PDF and r["validated"] is False, enabled
        assert "probed_not_pdf" not in r and ("GET", _BOSS_PDF) in sent, (enabled, sent)


async def test_control_a_pdf_link_serving_a_page_that_names_the_make_is_still_offered(
    wired, monkeypatch
):
    title = "AutomationDirect GS10 manual"
    assert search_mod._names_make({"url": _BOSS_PDF, "title": title}, "AutomationDirect")
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, title)])
        _answer(monkeypatch, {_BOSS_PDF: _page()})
        r = await search_mod.search_manual("AutomationDirect", "GS10")
        assert r is not None and r["url"] == _BOSS_PDF and r["validated"] is False, enabled
        assert r["probed_not_pdf"] is True


async def test_control_a_pdf_link_serving_a_page_on_the_makes_own_site_is_still_offered(
    wired, monkeypatch
):
    # The other way a page passes the screen: the host is on the make's OEM list,
    # although neither the host nor the title spells the make.
    url = "https://literature.rockwellautomation.com/idc/groups/literature/520-um001.pdf"
    c = {"url": url, "title": "PowerFlex 525 installation instructions"}
    assert url not in TEXT and not search_mod._names_make(c, "Allen-Bradley")
    assert search_mod._is_oem_host(urlparse(url).netloc, "Allen-Bradley")
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(url, c["title"])])
        _answer(monkeypatch, {url: _page()})
        r = await search_mod.search_manual("Allen-Bradley", "PowerFlex 525")
        assert r is not None and r["url"] == url and r["validated"] is False, enabled
        assert r["probed_not_pdf"] is True


async def test_control_a_pdf_link_serving_a_pdf_is_never_marked(wired, monkeypatch):
    import httpx

    def pdf(request):
        return httpx.Response(206, headers={"content-type": ""}, content=b"%PDF-1.7")

    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
    _answer(monkeypatch, {_BOSS_PDF: pdf})
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == _BOSS_PDF and r["validated"] is True
    assert "probed_not_pdf" not in r


def _by_method(head, get):
    return lambda request: head(request) if request.method == "HEAD" else get(request)


_AS_PDF = "application/pdf"


@pytest.mark.parametrize(
    "answer",
    [
        _page(content_type=_AS_PDF),
        _by_method(_page(content_type="text/html"), _page(content_type=_AS_PDF)),
        _by_method(_page(status=405, body=b""), _page(content_type=_AS_PDF)),
    ],
    ids=["head_and_get_say_pdf", "only_get_says_pdf", "head_refused"],
)
async def test_a_pdf_link_that_serves_a_page_as_a_pdf_is_screened_like_one(
    wired, monkeypatch, answer
):
    # #5871 Codex F1: the content type claims a PDF, the bytes are a web page.
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
        sent = _answer(monkeypatch, {_BOSS_PDF: answer})
        assert await search_mod.search_manual("AutomationDirect", "GS10") is None, enabled
        assert ("GET", _BOSS_PDF) in sent, (enabled, sent)


async def test_a_page_whose_markup_follows_leading_whitespace_is_screened_like_one(
    wired, monkeypatch
):
    # #5871 Codex F2: the server honours the requested range, and the page starts
    # with eight bytes of whitespace before its markup.
    import httpx

    body = b" \t\r\n    " + _BOSS_PAGE
    assert len(body) - len(_BOSS_PAGE) == 8

    def ranged(request):
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-type": "text/html"})
        first, last = request.headers["range"].removeprefix("bytes=").split("-")
        part = body[int(first) : int(last) + 1]
        return httpx.Response(
            206,
            headers={
                "content-type": "text/html",
                "content-range": f"bytes {first}-{int(first) + len(part) - 1}/{len(body)}",
            },
            content=part,
        )

    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
        sent = _answer(monkeypatch, {_BOSS_PDF: ranged})
        assert await search_mod.search_manual("AutomationDirect", "GS10") is None, enabled
        assert ("GET", _BOSS_PDF) in sent, (enabled, sent)


@pytest.mark.parametrize(
    "get",
    [_page(body=b"", content_type=_AS_PDF), _page(status=403), _unreachable],
    ids=["empty", "forbidden", "unreachable"],
)
async def test_control_a_pdf_content_type_still_validates_when_the_bytes_prove_nothing(
    wired, monkeypatch, get
):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
    sent = _answer(monkeypatch, {_BOSS_PDF: _by_method(_page(content_type=_AS_PDF), get)})
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == _BOSS_PDF and r["validated"] is True
    assert "probed_not_pdf" not in r and ("GET", _BOSS_PDF) in sent


async def test_control_outside_a_candidate_probe_a_pdf_content_type_ends_the_check(monkeypatch):
    # Only a candidate probe pays for the extra GET; every other caller stops at HEAD.
    sent = _answer(monkeypatch, {_BOSS_PDF: _page(content_type=_AS_PDF)})
    assert search_mod._probed_not_pdf.get() is None
    assert await search_mod.validate_pdf(_BOSS_PDF) is True
    assert sent == [("HEAD", _BOSS_PDF)]


async def test_a_pdf_link_that_redirects_to_a_web_page_is_screened_like_one(wired, monkeypatch):
    import httpx

    support = "https://www.example-files.com/boss-audio/support/gs10"

    def moved(request):
        return httpx.Response(301, headers={"location": support})

    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
        sent = _answer(monkeypatch, {_BOSS_PDF: moved, support: _page()})
        assert await search_mod.search_manual("AutomationDirect", "GS10") is None, enabled
        assert ("GET", support) in sent, (enabled, sent)


async def test_only_the_link_that_served_a_page_loses_the_older_rule(wired, monkeypatch):
    # The issue's shape: a stranger's brochure link now serving its support page, and
    # a PDF link the probe cannot reach. Only the first is screened.
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure"), (_OTHER_PDF, "GS10 manual")])
        sent = _answer(monkeypatch, {_BOSS_PDF: _page(), _OTHER_PDF: _page(status=403)})
        r = await search_mod.search_manual("AutomationDirect", "GS10")
        assert r is not None and r["url"] == _OTHER_PDF and r["validated"] is False, enabled
        assert {u for _, u in sent} == {_BOSS_PDF, _OTHER_PDF}, (enabled, sent)


# F2: an exact part number lets a page through only when it names the whole number.
async def test_an_exact_part_number_lookup_screens_a_page_naming_only_the_family(
    wired, monkeypatch
):
    page = "https://www.example-audio.com/products/sony-gs10"
    _serve(monkeypatch, [(page, "Sony GS10 amplifier manual")])
    assert (
        await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
        is None
    )
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    assert not judge.judge_enabled()
    assert (
        await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
        is None
    )


async def test_an_exact_part_number_lookup_offers_a_page_naming_it_in_both_modes(
    wired, monkeypatch
):
    page = "https://www.example-distributor.com/p/gs10-20p5"
    _serve(monkeypatch, [(page, "GS10-20P5 micro drive manual")])
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        r = await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
        assert r is not None and r["url"] == page and r["validated"] is False, enabled
    for spelled in ("GS10 20P5", "GS1020P5", "gs10_20p5"):
        assert search_mod._names_part_number({"title": spelled}, "GS10-20P5"), spelled
    for other in ("GS10-20P5X", "GS10", "XGS10-20P5"):
        assert not search_mod._names_part_number({"title": other}, "GS10-20P5"), other


# #5827 / #5837: a longer order number that starts with the part is a different part.
# The haystack is title + URL, so the table covers both. Rows marked "decided" are
# ambiguous and fail toward NOT offering an unread maker-less page: such a page is
# only ever offered for review, and a miss still hands over the maker's own site.
_DIST = "https://www.example-distributor.com"
_PART_NUMBER_TABLE = [
    # (part, field, text, names_it, why)
    ("GS10-20P5", "title", "GS10-20P5-X micro drive", False, "#5827 hyphen code suffix"),
    ("GS10-20P5", "title", "GS10-20P5X micro drive", False, "attached suffix (as before)"),
    ("ACS355-03U-06A7-2", "title", "ACS355-03U-06A7-2+B063 drive", False, "#5837 order option"),
    ("ACS355-03U-06A7-2", "url", f"{_DIST}/p/acs355-03u-06a7-2+b063", False, "#5837 in a URL"),
    ("ACS355-03U-06A7-2", "title", "ACS355-03U-06A7-2-01 drive", False, "hyphen digit group"),
    ("GS10-20P5", "title", "GS10-20P5_B063 drive", False, "underscore code group"),
    ("GS10-20P5", "title", "GS10-20P5-EN data", False, "decided: two letters read as a code"),
    ("GS10-20P5", "url", f"{_DIST}/search?q=gs10-20p5+manual", False, "decided: + is an option"),
    ("ACS355-03U-06A7-2", "url", f"{_DIST}/p/ACS355-03U-06A7-2%2BB063", False, "encoded plus"),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p5-0-5-hp-drive", False, "decided: numeric slug"),
    ("ACS355-03U-06A7-2", "url", f"{_DIST}/p/acs355-03u-06a7-2%20manual", True, "encoded space"),
    ("GS10-20P5", "title", "GS10 20P5 micro drive", True, "space between groups"),
    ("GS10-20P5", "title", "GS1020P5 micro drive", True, "no separator"),
    ("GS10-20P5", "title", "gs10_20p5 micro drive", True, "underscore between groups"),
    ("ACS355-03U-06A7-2", "title", "ACS355-03U-06A7-2 user manual", True, "#5837 control"),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p5-user-manual", True, "slug word after a hyphen"),
    ("GS10-20P5", "url", f"{_DIST}/gs10-20p5/manual.html", True, "path segment"),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p5.html", True, "file extension"),
    ("GS10-20P5", "title", "Drive GS10-20P5: manual (0.5 hp), 230 V", True, "punctuation"),
    ("1756-L83E", "title", "1756-L83E/B ControlLogix controller", True, "decided: /B series mark"),
    ("GS10-20P5", "url", f"{_DIST}/p/ad-gs10-20p5", True, "decided: leading side unchanged"),
]


@pytest.mark.parametrize("part,field,text,names_it,why", _PART_NUMBER_TABLE)
def test_the_part_number_table(part, field, text, names_it, why):
    assert search_mod._names_part_number({field: text}, part) is names_it, why


def _maker_less_stranger(url: str, title: str, make: str) -> dict:
    """A candidate that reaches the part-number check: it does not name the make,
    is not on the make's site, and is not a direct PDF."""
    cand = {"url": url, "title": title}
    assert not search_mod._names_make(cand, make), cand
    assert not search_mod._is_oem_host(urlparse(url).netloc, make), cand
    assert not search_mod._is_direct_pdf(url), cand
    return cand


async def test_a_longer_order_number_is_not_offered_in_either_mode(wired, monkeypatch):
    option = _maker_less_stranger(
        f"{_DIST}/p/acs355-03u-06a7-2-b063", "ACS355-03U-06A7-2+B063 frequency converter", "ABB"
    )
    variant = _maker_less_stranger(
        f"{_DIST}/p/gs10-20p5-x", "GS10-20P5-X micro drive", "AutomationDirect"
    )
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(option["url"], option["title"])])
        assert (
            await search_mod.search_manual("ABB", "ACS355-03U-06A7-2", exact_part_number=True)
            is None
        ), enabled
        _serve(monkeypatch, [(variant["url"], variant["title"])])
        assert (
            await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
            is None
        ), enabled


async def test_an_encoded_order_option_in_the_url_is_not_offered(wired, monkeypatch):
    # #5841 Codex F1: the title says nothing, so only the URL can identify the part.
    encoded = _maker_less_stranger(
        f"{_DIST}/p/ACS355-03U-06A7-2%2BB063", "Frequency converter", "ABB"
    )
    exact = _maker_less_stranger(f"{_DIST}/p/ACS355-03U-06A7-2", "Frequency converter", "ABB")
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(encoded["url"], encoded["title"])])
        assert (
            await search_mod.search_manual("ABB", "ACS355-03U-06A7-2", exact_part_number=True)
            is None
        ), enabled
        _serve(monkeypatch, [(exact["url"], exact["title"])])
        r = await search_mod.search_manual("ABB", "ACS355-03U-06A7-2", exact_part_number=True)
        assert r is not None and r["url"] == exact["url"] and r["validated"] is False, enabled


async def test_the_exact_order_number_with_ordinary_text_is_still_offered(wired, monkeypatch):
    page = _maker_less_stranger(
        f"{_DIST}/p/acs355-03u-06a7-2-user-manual", "ACS355-03U-06A7-2 user manual", "ABB"
    )
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(page["url"], page["title"])])
        r = await search_mod.search_manual("ABB", "ACS355-03U-06A7-2", exact_part_number=True)
        assert r is not None and r["url"] == page["url"] and r["validated"] is False, enabled


# F4: the content probe runs before the screen, so a real PDF at an extensionless
# URL is still found; the same URL serving a web page is screened.
_EXTENSIONLESS = "https://www.example-distributor.com/docs/download?id=8812"


async def test_judge_off_a_real_pdf_at_an_extensionless_url_is_still_found(wired, monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    _serve(monkeypatch, [(_EXTENSIONLESS, "GS10 user manual")], pdfs={_EXTENSIONLESS})
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == _EXTENSIONLESS and r["validated"] is True


async def test_judge_on_a_real_pdf_at_an_extensionless_url_is_offered_for_review(
    wired, monkeypatch
):
    _serve(monkeypatch, [(_EXTENSIONLESS, "GS10 user manual")], pdfs={_EXTENSIONLESS})
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == _EXTENSIONLESS
    assert r["validated"] is False and r["reason"] == judge.REASON_JUDGE_UNAVAILABLE


async def test_an_extensionless_url_serving_a_web_page_is_screened(wired, monkeypatch):
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        _serve(monkeypatch, [(_EXTENSIONLESS, "GS10 user manual")])
        assert await search_mod.search_manual("AutomationDirect", "GS10") is None, enabled


async def test_the_website_handoff_is_not_sent_twice(wired, monkeypatch):
    # When the wide pass already sent "<make> <model> manual support" and only a
    # stranger came back, the miss does not send the same query again.
    page, title = _OTHER_MAKERS[0]

    async def serper(query, num=10):
        return [{"link": page, "title": title}] if query.endswith("manual support") else []

    async def probe(url):
        return False

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", probe)
    with search_mod.acquisition_trail() as trail:
        assert await search_mod.search_manual("AutomationDirect", "GS10") is None
    sent = [q["query"] for q in trail.queries if q["query"].endswith("manual support")]
    assert sent == ["AutomationDirect GS10 manual support"], trail.queries


# ── OEM publication code outranks the model (staging 2026-10-19, PF525 25B-D010N104) ─

RA_LIT = "https://literature.rockwellautomation.com/idc/groups/literature/documents"


class _SaysInstallManual:
    """The exact misjudgement observed: a product profile called an installation manual."""

    enabled = True

    async def complete(self, *a, **k):
        return (
            json.dumps(
                {
                    "is_manual_for_model": True,
                    "doc_type": "installation_manual",
                    "scope": "complete",
                    "confidence": 0.97,
                    "evidence_quote": "PowerFlex 525 ... Catalog Number 25B",
                    "reason": "official installation/product information",
                }
            ),
            {"provider": "fake", "model": "fake/m"},
        )


@pytest.mark.parametrize("code", ["pc", "td", "ca", "br", "sg"])
async def test_rockwell_non_manual_publication_code_is_never_the_manual(monkeypatch, code):
    monkeypatch.setattr(judge, "_router", _SaysInstallManual())
    url = f"{RA_LIT}/{code}/520-{code}001_-en-p.pdf"
    v = await judge.judge_text("Allen-Bradley", "25B-D010N104", {"url": url, "title": ""}, "t")
    assert v is not None
    assert v["is_manual"] is False
    assert v["downgraded"] is True
    assert v["doc_type"] != "installation_manual"


@pytest.mark.parametrize("code", ["um", "qs", "in"])
async def test_rockwell_manual_publication_codes_keep_the_model_verdict(monkeypatch, code):
    # control: a user manual / quick start / installation instruction stays a match
    monkeypatch.setattr(judge, "_router", _SaysInstallManual())
    url = f"{RA_LIT}/{code}/520-{code}001_-en-e.pdf"
    v = await judge.judge_text("Allen-Bradley", "25B-D010N104", {"url": url, "title": ""}, "t")
    assert v is not None and v["is_manual"] is True and v["downgraded"] is False


async def test_non_rockwell_url_with_a_pc_segment_is_untouched(monkeypatch):
    monkeypatch.setattr(judge, "_router", _SaysInstallManual())
    url = "https://example.com/idc/groups/literature/documents/pc/x.pdf"
    v = await judge.judge_text("X", "Y", {"url": url, "title": ""}, "t")
    assert v is not None and v["is_manual"] is True


# #5822: the site-scoped pass found only PDFs that are not the manual (the six
# staging AutomationDirect drawings and cut sheet), which skipped the typed pass, so
# no query ever asked for the manual by name. The search stub answers per query.
_GS10_MANUAL = f"{_AD}/manuals/gs10m/gs10m.pdf"
_GS10_MANUAL_HIT = (_GS10_MANUAL, "DURApulse GS10 AC Drive User Manual")
_GS10_TYPED = [
    "AutomationDirect GS10 manual filetype:pdf",
    "AutomationDirect GS-10 manual filetype:pdf",
]


class _SaysGs10Manual(FakeRouter):
    probed: list[str]  # the URLs search_manual probed, set by _stall

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        self.calls.append(user)
        yes = "GS10-MANUAL-TEXT" in user
        v = {
            "is_manual_for_model": yes,
            "doc_type": "user_manual" if yes else "datasheet",
            "confidence": 0.9,
            "evidence_quote": "GS10 user manual" if yes else "",
            "reason": "The GS10 user manual." if yes else "A drawing, not the manual.",
        }
        return json.dumps(v), {"provider": "fake"}


def _stall(
    monkeypatch,
    *,
    q1_hits=_AD_READ,
    q2_hits=(),
    q2_raises=False,
    handoff_hits=(),
    delays=None,
    pdfs=frozenset(),
):
    """q1 (site-scoped) answers ``q1_hits``, the typed pass ``q2_hits``, anything else
    (the website handoff) ``handoff_hits``. A query in ``delays`` answers that many
    seconds after it is sent. Every AutomationDirect drawing reads as one. Only the
    URLs in ``pdfs`` probe as PDFs; every probed URL is kept in ``router.probed``."""
    router = _SaysGs10Manual()
    router.probed = []
    monkeypatch.setattr(judge, "_router", router)
    for url, _ in _AD_READ:
        monkeypatch.setitem(TEXT, url, "DURApulse GS10 dimensional drawing / cut sheet")
    monkeypatch.setitem(TEXT, _GS10_MANUAL, "DURApulse GS10 user manual GS10-MANUAL-TEXT")
    sent: list[str] = []

    async def serper(query, num=10):
        # The per-call ceiling exactly as _serper_search applies it: checked first,
        # and a query counts as used only when it is sent.
        budget = search_mod._provider_budget.get()
        if budget is not None:
            if budget.used >= budget.limit:
                budget.refused += 1
                return []
            budget.used += 1
        sent.append(query)
        if delays and query in delays:
            await asyncio.sleep(delays[query])
        if "site:" in query:
            hits = q1_hits
        elif "filetype:pdf" in query:
            if q2_raises:
                raise RuntimeError("provider down")
            hits = q2_hits
        else:
            hits = handoff_hits
        return [{"link": u, "title": t} for u, t in hits]

    async def probe(url):
        router.probed.append(url)
        return url in pdfs

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", probe)
    return router, sent


_HANDOFF = "AutomationDirect GS10 manual support"


def _typed(sent):
    return [q for q in sent if q in _GS10_TYPED]


def _deadline(seconds):
    return search_mod.time.monotonic() + seconds


async def test_when_every_site_pdf_is_not_the_manual_the_typed_pass_finds_it(wired, monkeypatch):
    # The typed pass also returns a drawing round one already rejected.
    router, sent = _stall(monkeypatch, q2_hits=[_AD_READ[1], _GS10_MANUAL_HIT])
    with search_mod.provider_query_budget(limit=4) as budget:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert _typed(sent) == _GS10_TYPED
    # Six reads in round one and one in round two: no rejected drawing is read twice.
    assert len(router.calls) == 7
    assert len(r["judged_rejected"]) == 6
    assert budget.used == 3 and budget.refused == 0


async def test_a_site_pdf_judged_the_manual_sends_no_typed_pass(wired, monkeypatch):
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + [_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert _typed(sent) == []


async def test_with_the_judge_off_the_typed_pass_is_skipped_as_before(wired, monkeypatch):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert _typed(sent) == [] and router.calls == []


async def test_an_unread_site_pdf_sends_no_typed_pass(wired, monkeypatch):
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    monkeypatch.delitem(TEXT, _AD_READ[0][0])  # fetch fails: it may still be the manual
    await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert len(router.calls) == 5  # the other five were read and rejected
    assert _typed(sent) == []


async def test_a_nearly_spent_deadline_sends_no_typed_pass(wired, monkeypatch):
    # One query plus one judge batch plus the return reserve does not fit in 20 s.
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(20))
    assert _typed(sent) == [] and len(router.calls) == 6
    assert r is not None and r["validated"] is False and r["reason"] == judge.REASON_JUDGED_REJECTED


async def test_the_retry_never_costs_the_website_handoff_its_query(wired, monkeypatch):
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    with search_mod.acquisition_trail(), search_mod.provider_query_budget(limit=2) as budget:
        await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert sent[1:] == [_HANDOFF]  # the handoff was sent; nothing was left for the retry
    assert budget.used == 2 and budget.refused == 0


async def test_a_failing_typed_pass_leaves_todays_answer(wired, monkeypatch):
    router, sent = _stall(monkeypatch, q2_raises=True)
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 6
    assert r is not None and r["validated"] is False and r["reason"] == judge.REASON_JUDGED_REJECTED


async def test_a_miss_after_the_typed_pass_still_hands_off_within_four_queries(wired, monkeypatch):
    other = (f"{_AD}/drawings/2d/GS11N-21P0.pdf", "DURAPULSE GS10 SERIES AC MICRO DRIVE, 230V")
    router, sent = _stall(monkeypatch, q2_hits=[other])
    monkeypatch.setitem(TEXT, other[0], "DURApulse GS10 dimensional drawing")
    with (
        search_mod.acquisition_trail() as trail,
        search_mod.provider_query_budget(limit=4) as budget,
    ):
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
        row = trail.to_dict()
    assert r is not None and r["validated"] is False and r["reason"] == judge.REASON_JUDGED_REJECTED
    # Today's answer exactly: round one's rejections. Round two's read is on the trail.
    assert len(r["judged_rejected"]) == 6 and len(router.calls) == 7
    assert sent[1] == _HANDOFF  # sent before the retry, where this miss sends it today
    assert budget.used == 4 and budget.refused == 0
    # One trail for both rounds: round one keeps its queue positions, round two follows.
    pos = {c["url"]: c["queue_pos"] for c in row["candidates"]}
    assert sorted(pos[search_mod.trail_url(u)] for u, _ in _AD_READ) == list(range(6))
    assert pos[search_mod.trail_url(other[0])] == 6
    assert row["stop"] == "queue_exhausted"
    assert [q["pass"] for q in row["queries"]] == ["q1", "q3", "q2", "q2"]


async def test_the_typed_pass_reads_at_most_one_more_batch(wired, monkeypatch):
    more = [
        (f"{_AD}/drawings/2d/GS1xN-{i}.pdf", f"DURAPULSE GS10 DRIVE drawing {i}") for i in range(6)
    ]
    router, sent = _stall(monkeypatch, q2_hits=more)
    for url, _ in more:
        monkeypatch.setitem(TEXT, url, "DURApulse GS10 dimensional drawing")
    with search_mod.acquisition_trail() as trail:
        await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert len(router.calls) == 6 + judge.MAX_CANDIDATES
    over = [u for u, why in trail.judge["not_queued"].items() if why == "over_max_total"]
    assert len(over) == 6 - judge.MAX_CANDIDATES


async def test_a_site_pass_over_the_read_cap_sends_no_typed_pass(wired, monkeypatch):
    extra = [
        (f"{_AD}/drawings/2d/GS1yN-{i}.pdf", f"DURAPULSE GS10 DRIVE sheet {i}") for i in range(3)
    ]
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + extra, q2_hits=[_GS10_MANUAL_HIT])
    for url, _ in extra:
        monkeypatch.setitem(TEXT, url, "DURApulse GS10 dimensional drawing")
    await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert len(router.calls) == judge.MAX_TOTAL  # one site PDF was never read
    assert _typed(sent) == []


async def test_a_typed_pass_that_already_ran_is_not_run_again(wired, monkeypatch):
    # The site-scoped pass found no PDF, so the typed pass ran in round one as before.
    other = (f"{_AD}/drawings/2d/GS11N-21P0.pdf", "DURAPULSE GS10 SERIES AC MICRO DRIVE, 230V")
    router, sent = _stall(monkeypatch, q1_hits=(), q2_hits=[other])
    monkeypatch.setitem(TEXT, other[0], "DURApulse GS10 dimensional drawing")
    await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 1


# #5844 Codex review round 1. The judge bounds its own reads by the caller's deadline;
# these pin the retry's typed queries, the support page and cancellation.
_REAL_SERPER_SEARCH = search_mod._serper_search  # captured before any fixture replaces it
_OTHER = (f"{_AD}/drawings/2d/GS11N-21P0.pdf", "DURAPULSE GS10 SERIES AC MICRO DRIVE, 230V")
_SUPPORT = ("https://www.automationdirect.com/support/manuals", "AutomationDirect manuals support")


def _scale(monkeypatch, search_timeout, batch, reserve):
    """Shrink the deadline arithmetic so a timing test runs in about a second."""
    monkeypatch.setattr(search_mod, "SEARCH_TIMEOUT", search_timeout)
    monkeypatch.setattr(judge, "UPGRADE_MIN_BATCH_S", batch)
    monkeypatch.setattr(judge, "RETURN_RESERVE_S", reserve)


def test_a_stalled_retry_query_still_returns_the_judged_rejection(wired, monkeypatch):
    # F1: the typed query never answers. The endpoint must answer with the judged
    # rejection before its own timeout, not report an outage.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md
    import shared.manual_search.quota as quota

    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.1)
    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", "1.5")
    router, sent = _stall(monkeypatch, delays={_GS10_TYPED[0]: 30})

    async def no_link(make):
        return None

    async def ok(_identity):
        return "ok"

    monkeypatch.setattr(md, "oem_request_link", no_link)
    monkeypatch.setattr(quota, "reserve_provider_query", ok)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    started = search_mod.time.monotonic()
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "AutomationDirect", "model": "GS10"}
    ).json()
    assert search_mod.time.monotonic() - started < 1.5
    assert body["reason"] == "judged_not_applicable", body.get("reason")
    assert _typed(sent) == [_GS10_TYPED[0]] and len(router.calls) == 6
    rows = body["candidate_trail"]["queries"]
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "timeout"} in rows


async def test_a_retry_stalled_on_the_quota_reservation_is_cut_off_too(wired, monkeypatch):
    # The cutoff covers the whole provider call, not only the HTTP request: here the
    # real _serper_search waits on the quota reservation and never sends.
    import shared.manual_search.quota as quota

    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.1)
    router, _ = _stall(monkeypatch)
    reservations = 0

    async def reserve(_identity):
        nonlocal reservations
        reservations += 1
        if reservations == 3:  # q1, the handoff, then the typed query
            await asyncio.sleep(30)
        return "ok"

    async def post(query, num):
        if "site:" in query:
            return [{"link": u, "title": t} for u, t in _AD_READ]
        return []

    monkeypatch.setattr(search_mod, "_serper_search", _REAL_SERPER_SEARCH)
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "k")
    monkeypatch.setattr(search_mod, "_serper_post", post)
    monkeypatch.setattr(quota, "reserve_provider_query", reserve)
    with (
        quota.provider_query_quota(quota.QuotaIdentity(tenant_id="t", user_id="u")),
        search_mod.acquisition_trail() as trail,
        search_mod.provider_query_budget(limit=4) as budget,
    ):
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.5)),
            timeout=1.5,
        )
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert reservations == 3 and budget.used == 2  # the stalled query was never sent
    assert trail.queries[-1] == {"pass": "q2", "query": _GS10_TYPED[0], "result": "timeout"}


async def test_a_slow_retry_query_never_costs_the_support_page(wired, monkeypatch):
    # F2: the typed query answers just before its cutoff, too late for a handoff sent
    # after it. The handoff goes first, so the support page is in the answer.
    _scale(monkeypatch, search_timeout=1.6, batch=0.8, reserve=0.2)
    router, sent = _stall(
        monkeypatch, q2_hits=[_OTHER], handoff_hits=[_SUPPORT], delays={_GS10_TYPED[0]: 2.4}
    )
    monkeypatch.setitem(TEXT, _OTHER[0], "DURApulse GS10 dimensional drawing")
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(4.0))
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert len(router.calls) == 7  # the late hit was still read, and rejected
    assert sent[:3] == [sent[0], _HANDOFF, _GS10_TYPED[0]]
    assert trail.search_page_url == _SUPPORT[0]


async def test_a_cut_off_second_variant_keeps_the_first_variants_hits(wired, monkeypatch):
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.1)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], delays={_GS10_TYPED[1]: 30})
    with search_mod.acquisition_trail() as trail:
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.5)),
            timeout=1.5,
        )
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert _typed(sent) == _GS10_TYPED
    assert trail.queries[-1] == {"pass": "q2", "query": _GS10_TYPED[1], "result": "timeout"}


async def test_a_caller_timeout_during_the_retry_query_is_still_a_cancellation(wired, monkeypatch):
    # A site PDF naming neither the make nor the model is never queued, so it stays
    # unread; round one's ranking lists it above the rejected drawings.
    stray = ("https://www.example-distributor.com/files/terminal-blocks.pdf", "Terminal blocks")
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + [stray], delays={_GS10_TYPED[0]: 30})
    with search_mod.acquisition_trail() as trail:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60)),
                timeout=0.5,
            )
        row = trail.to_dict()
    assert _typed(sent) == [_GS10_TYPED[0]]
    assert row["stop"] == "cancelled"
    # Round one stays on the trail, in its judged order.
    by_url = {c["url"]: c for c in row["candidates"]}
    assert by_url[search_mod.trail_url(stray[0])]["not_queued"] == "not_relevant"
    assert row["candidates"][0]["url"] == search_mod.trail_url(stray[0])
    assert sorted(by_url[search_mod.trail_url(u)]["queue_pos"] for u, _ in _AD_READ) == list(
        range(6)
    )


async def test_a_caller_timeout_while_reading_a_retry_pdf_keeps_it_on_the_trail(wired, monkeypatch):
    # F3: the read the caller interrupted is on the trail, after round one's reads.
    router, sent = _stall(monkeypatch, q2_hits=[_OTHER])
    monkeypatch.setitem(TEXT, _OTHER[0], "DURApulse GS10 dimensional drawing")
    fetch = judge.fetch_pdf_bytes

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        if url == _OTHER[0]:
            await asyncio.sleep(30)
        return await fetch(url, max_bytes)

    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    with search_mod.acquisition_trail() as trail:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60)),
                timeout=0.5,
            )
        row = trail.to_dict()
    assert row["stop"] == "cancelled"
    by_url = {c["url"]: c for c in row["candidates"]}
    late = by_url[search_mod.trail_url(_OTHER[0])]
    assert late["read"] == "interrupted" and late["read_reason"] == "cancelled_during_fetch"
    assert late["queue_pos"] == 6
    assert sorted(by_url[search_mod.trail_url(u)]["queue_pos"] for u, _ in _AD_READ) == list(
        range(6)
    )


# #5844 Codex review round 2. The retry now runs only where this search ends with the
# judged rejection, after the website handoff, at either of the two places it does.
# Only a judged match from it changes the answer; nothing it adds is probed.
_PAGES = [u for u, _ in _OTHER_MAKERS]


async def test_with_the_staging_pool_the_retry_runs_after_the_screen(wired, monkeypatch):
    # The staging GS10 pools: the site-scoped query also returned web pages naming only
    # "GS10". They are probed and screened out first, then the retry finds the manual.
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + _OTHER_MAKERS, q2_hits=[_GS10_MANUAL_HIT])
    with search_mod.acquisition_trail():
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH and len(r["judged_rejected"]) == 6
    assert sorted(router.probed) == sorted(_PAGES)  # round one's pages, before the retry
    assert sent[1:] == [_HANDOFF, *_GS10_TYPED] and len(router.calls) == 7


async def test_an_unread_retry_hit_is_listed_but_never_probed_or_offered(wired, monkeypatch):
    unread = (f"{_AD}/manuals/gs10m/gs10m_ch1.pdf", "DURApulse GS10 user manual chapter 1")
    pool = _AD_READ + _OTHER_MAKERS
    router, _ = _stall(monkeypatch, q1_hits=pool)
    without = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    router, _ = _stall(monkeypatch, q1_hits=pool, q2_hits=[unread])  # not fetchable
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
        row = trail.to_dict()
    assert r is not None and without is not None
    assert r["reason"] == judge.REASON_JUDGED_REJECTED and r["validated"] is False
    assert (r["url"], r["judged_rejected"]) == (without["url"], without["judged_rejected"])
    assert sorted(router.probed) == sorted(_PAGES)
    by_url = {c["url"]: c for c in row["candidates"]}
    assert by_url[search_mod.trail_url(unread[0])]["read"] == "unfetched"


async def test_a_page_round_one_can_offer_sends_no_typed_query(wired, monkeypatch):
    # F5: base probes this page and offers it for review, so the search never ends
    # with the judged rejection and the retry never runs.
    page = (_EXTENSIONLESS, "AutomationDirect GS10 installation guide")
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + [page], q2_hits=[_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _EXTENSIONLESS and r["validated"] is False, r
    assert _typed(sent) == [] and len(sent) == 1


async def test_a_page_that_probes_as_a_pdf_sends_no_typed_query(wired, monkeypatch):
    page = (_EXTENSIONLESS, "GS10 drive documentation")
    router, sent = _stall(
        monkeypatch,
        q1_hits=_AD_READ + [page],
        q2_hits=[_GS10_MANUAL_HIT],
        pdfs=frozenset({_EXTENSIONLESS}),
    )
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _EXTENSIONLESS and r["validated"] is False, r
    assert _typed(sent) == [] and router.probed == [_EXTENSIONLESS]


async def test_an_error_in_the_retry_leaves_todays_answer(wired, monkeypatch):
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    real = judge.judge_candidates
    rounds = 0

    async def second_round_raises(*args, **kwargs):
        nonlocal rounds
        rounds += 1
        if rounds == 2:
            raise RuntimeError("judge down")
        return await real(*args, **kwargs)

    monkeypatch.setattr(judge, "judge_candidates", second_round_raises)
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert rounds == 2 and _typed(sent) == _GS10_TYPED
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED and r["validated"] is False
    assert len(r["judged_rejected"]) == 6


_GS10_PAGE = (
    "https://www.automationdirect.com/adc/overview/catalog/drives/gs10",
    "DURApulse GS10 AC Drives manual downloads",
)


async def test_a_retry_miss_scores_its_pages_as_support_pages_like_any_query(wired, monkeypatch):
    # Not "exactly today's answer": every query's non-PDF hits are scored as support
    # pages, the retry's too. A better page from a typed query is offered on a miss;
    # one that does not outscore the handoff's own page is not.
    _stall(monkeypatch, q2_hits=[_GS10_PAGE])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert len(r["judged_rejected"]) == 6
    assert trail.search_page_url == _GS10_PAGE[0]

    _stall(monkeypatch, q2_hits=[_GS10_PAGE], handoff_hits=[_SUPPORT])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert trail.search_page_url == _SUPPORT[0]  # equal score: the handoff's page stays


def _discovery_with_quota(monkeypatch, deny_on, reason):
    """POST the discovery endpoint through the real _serper_search: the reservation
    numbered ``deny_on`` (1 = q1, 2 = the handoff, 3 = the first typed query) is
    denied with ``reason``; every other one succeeds."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md
    import shared.manual_search.quota as quota

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    reservations = 0

    async def reserve(_identity):
        nonlocal reservations
        reservations += 1
        return reason if reservations == deny_on else "ok"

    async def post(query, num):
        if "site:" in query:
            return [{"link": u, "title": t} for u, t in _AD_READ]
        return []

    async def no_link(make):
        return None

    monkeypatch.setattr(search_mod, "_serper_search", _REAL_SERPER_SEARCH)
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "k")
    monkeypatch.setattr(search_mod, "_serper_post", post)
    monkeypatch.setattr(quota, "reserve_provider_query", reserve)
    monkeypatch.setattr(md, "oem_request_link", no_link)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "AutomationDirect", "model": "GS10"}
    ).json()
    return body, reservations


@pytest.mark.parametrize("reason", ["quota_unavailable", "global_cap_unconfigured"])
def test_an_infrastructure_denial_on_the_retry_query_keeps_the_judged_rejection(
    wired, monkeypatch, reason
):
    # Today's search finished with the judged rejection; only the retry's own query was
    # denied, by infrastructure. That must not turn the answer into an outage.
    router, _ = _stall(monkeypatch)
    body, reservations = _discovery_with_quota(monkeypatch, deny_on=3, reason=reason)
    assert reservations == 3 and len(router.calls) == 6
    assert body["reason"] == "judged_not_applicable", body.get("reason")
    assert body["search_stats"]["quota_denied"] is None
    assert body["search_stats"]["refused_queries"] == 2  # both typed variants
    rows = body["candidate_trail"]["queries"]
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "refused", "hits": 0} in rows


@pytest.mark.parametrize("reason", ["user_cap", "tenant_cap", "global_cap"])
def test_a_cap_the_retry_query_meets_is_reported_as_the_limit(wired, monkeypatch, reason):
    # PRD R5 (#4168): a cap denial is never cached as a miss. The next-day retry then
    # runs the typed pass the cap stopped.
    router, _ = _stall(monkeypatch)
    body, _ = _discovery_with_quota(monkeypatch, deny_on=3, reason=reason)
    assert len(router.calls) == 6
    assert body["reason"] == "quota_exceeded", body.get("reason")
    assert body["search_stats"]["quota_denied"] == reason


def test_the_cap_denials_match_the_endpoint():
    import ask_api.manual_discovery as md

    assert search_mod._CAP_DENIALS == md._QUOTA_CAP_REASONS


def test_a_quota_denial_before_the_retry_still_reports_the_limit(wired, monkeypatch):
    # Control: the handoff's own denial is today's behaviour, unchanged.
    router, _ = _stall(monkeypatch)
    body, _ = _discovery_with_quota(monkeypatch, deny_on=2, reason="user_cap")
    assert body["reason"] == "quota_exceeded", body.get("reason")
    assert body["search_stats"]["quota_denied"] == "user_cap"
