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
import types
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


# #5826 (Codex #5823 round 2, F1): the make is read from the title and the URL path,
# never the host, and the words of a make name may be joined by a hyphen, an
# underscore or "+". Each table row is one field: the other names nothing.
_NAMES_MAKE_ROWS = [
    ("GE", "Siemens M100 motor manual", "https://catalog.example.ge/siemens/m100", False),
    ("GE", "M100 motor manual", "https://ge.example-catalog.com/p/m100", False),
    ("GE", "GE M100 Motor Manual", "https://catalog.example.ge/p/m100", True),
    ("GE", "M100 motor manual", "https://www.example-motors.com/brands/ge/m100", True),
    ("GE", "M100 motor manual", "https://www.example-motors.com/p/m100_ge_motor", True),
    ("GE", "M100 motor manual", "https://www.example-motors.com/p/m100?brand=GE", False),
    ("GE", "M100 motor manual", "https://www.example-motors.com/p/m100#GE", False),
    ("GE", "GE M100 motor manual", "https://[ge/p/m100", True),
    ("GE", "M100 motor manual", "https://[ge/p/m100", False),
    ("Automation Direct", "Automation-Direct GS10 User Manual", "https://m.example.com/d/1", True),
    ("Automation Direct", "Automation_Direct GS10 drive", "https://m.example.com/d/1", True),
    ("Automation Direct", "Automation - Direct GS10 drive", "https://m.example.com/d/1", True),
    ("Automation Direct", "GS10 drive", "https://m.example.com/automation%20direct/gs10", True),
    ("Automation Direct", "GS10 drive", "https://m.example.com/p/automation_direct_gs10", True),
    ("AutomationDirect", "GS10 drive", "https://m.example.com/brands/automation-direct/gs10", True),
    ("Automation Direct", "Home Automation | Direct-Drive Amplifier", "https://a.example/1", False),
    ("Automation Direct", "Home Automation. Direct-Drive Amplifier", "https://a.example/1", False),
    (
        "Automation Direct",
        "GS10 amplifier",
        "https://a.example.com/automation/direct-drive/gs10",
        False,
    ),
    ("Automation Direct", "Boss Audio GS10 Direct-Drive Amplifier", "https://a.example/1", False),
    (
        "Automation Direct",
        "GS10 drive",
        "https://m.example.com/p/gs10?brand=AutomationDirect",
        False,
    ),
    ("Square D", "Squared QO120 breaker", "https://b.example.com/p/qo120", False),
    ("Square D", "Square_D QO120 breaker", "https://b.example.com/p/qo120", True),
    ("Oriental Motor", "Oriental-Motor BLH series manual", "https://o.example.com/p/blh", True),
    ("Oriental Motor", "Oriental Motor Co., Ltd. BLH manual", "https://o.example.com/p/blh", True),
    ("Pepperl+Fuchs", "Pepperl Fuchs NBB5 sensor", "https://s.example.com/p/nbb5", True),
    ("Pepperl+Fuchs", "Pepperl-Fuchs NBB5 sensor", "https://s.example.com/p/nbb5", True),
    # #5890 F4: a make typed with a non-breaking hyphen is folded as the texts are.
    ("Allen‑Bradley", "Allen‑Bradley 1756-L73 manual", "https://p.example.com/p/l73", True),
    ("Allen‑Bradley", "Allen-Bradley 1756-L73 manual", "https://p.example.com/p/l73", True),
]


@pytest.mark.parametrize("make,title,url,names_it", _NAMES_MAKE_ROWS)
def test_the_make_is_read_from_the_title_and_the_path(make, title, url, names_it):
    assert search_mod._names_make({"url": url, "title": title}, make) is names_it


async def _search_one_page(monkeypatch, enabled, make, model, page, exact_part_number=False):
    """One lookup in one judge mode whose only hit is `page`. Returns the result
    and what the make screen decided for each URL it saw, so a page dropped before
    the screen cannot pass or fail a screen test vacuously."""
    screened: dict[str, bool] = {}
    screen = search_mod._may_offer_unread

    def spy(c, make_, part_number=None):
        screened[c.get("url")] = verdict = screen(c, make_, part_number)
        return verdict

    monkeypatch.setattr(search_mod, "_may_offer_unread", spy)
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
    assert judge.judge_enabled() is (enabled == "1")
    _serve(monkeypatch, [(page["url"], page["title"])])
    r = await search_mod.search_manual(make, model, exact_part_number=exact_part_number)
    return r, screened


def _unread_page(url: str, title: str, make: str) -> dict:
    """A page the make screen decides: not on the make's site and not a direct PDF."""
    assert not search_mod._is_oem_host(urlparse(url).netloc, make), url
    assert not search_mod._is_direct_pdf(url), url
    return {"url": url, "title": title}


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_country_code_host_does_not_name_a_short_make(wired, monkeypatch, enabled):
    page = _unread_page(
        "https://catalog.example.ge/siemens/m100", "Siemens M100 motor manual", "GE"
    )
    r, screened = await _search_one_page(monkeypatch, enabled, "GE", "M100", page)
    assert screened == {page["url"]: False} and r is None


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_control_the_same_host_titled_with_the_make_is_offered(wired, monkeypatch, enabled):
    page = _unread_page("https://catalog.example.ge/p/m100", "GE M100 Motor Manual", "GE")
    r, screened = await _search_one_page(monkeypatch, enabled, "GE", "M100", page)
    assert screened == {page["url"]: True}
    assert r is not None and r["url"] == page["url"] and r["validated"] is False


@pytest.mark.parametrize(
    "url,title",
    [
        (
            "https://www.example-manuals.com/drives/gs10-user-manual",
            "Automation-Direct GS10 User Manual",
        ),
        ("https://www.example-manuals.com/brands/automation_direct/gs10", "GS10 drive user manual"),
    ],
    ids=["hyphenated_title", "underscored_path"],
)
@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_joined_make_name_is_offered(wired, monkeypatch, enabled, url, title):
    assert "automationdirect" not in url.lower() and "automationdirect" not in title.lower()
    page = _unread_page(url, title, "Automation Direct")
    r, screened = await _search_one_page(monkeypatch, enabled, "Automation Direct", "GS10", page)
    assert screened == {page["url"]: True}
    assert r is not None and r["url"] == page["url"] and r["validated"] is False


@pytest.mark.parametrize(
    "url,title",
    [
        (
            "https://www.example-audio.com/automation/direct-drive-amps/gs10",
            "GS10 amplifier manual",
        ),
        ("https://www.example-audio.com/amps/gs10", "Home Automation | Direct-Drive GS10 manual"),
        ("https://www.example-audio.com/amps/gs10", "Home Automation. Direct-Drive GS10 manual"),
    ],
    ids=["path_segments", "title_bar", "title_full_stop"],
)
@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_words_split_by_other_punctuation_do_not_name_the_make(
    wired, monkeypatch, enabled, url, title
):
    page = _unread_page(url, title, "Automation Direct")
    r, screened = await _search_one_page(monkeypatch, enabled, "Automation Direct", "GS10", page)
    assert screened == {page["url"]: False} and r is None


# #5890 F3: with the judge on, the unread pool used the judge's own make check, which
# looks for "automationdirect" only. A joined make name with no model in sight was
# dropped there, while the judge-off search offered the same page.
_JOINED_NO_MODEL = (
    "https://www.example-manuals.com/library/drive-installation",
    "Automation-Direct Drive Installation Manual",
)


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_joined_make_without_the_model_reaches_the_screen(wired, monkeypatch, enabled):
    page = _unread_page(*_JOINED_NO_MODEL, "AutomationDirect")
    assert not judge.relevant(page, "AutomationDirect", "GS10")  # the judge's check alone drops it
    r, screened = await _search_one_page(monkeypatch, enabled, "AutomationDirect", "GS10", page)
    assert screened == {page["url"]: True}, screened
    assert r is not None and r["url"] == page["url"] and r["validated"] is False


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_control_split_make_words_without_the_model_are_not_offered(
    wired, monkeypatch, enabled
):
    page = _unread_page(
        "https://www.example-audio.com/amps/installation",
        "Home Automation | Direct-Drive Installation Manual",
        "AutomationDirect",
    )
    r, screened = await _search_one_page(monkeypatch, enabled, "AutomationDirect", "GS10", page)
    assert r is None and screened.get(page["url"]) is not True


# #5890 F4: the texts are folded (U+2011 reads as "-"), so the make must be too.
@pytest.mark.parametrize(
    "title",
    ["Allen‑Bradley 1756-L73 User Manual", "Allen-Bradley 1756-L73 User Manual"],
    ids=["nonbreaking_hyphen", "ascii_hyphen"],
)
@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_make_typed_with_a_nonbreaking_hyphen_names_itself(
    wired, monkeypatch, enabled, title
):
    make = "Allen‑Bradley"
    page = _unread_page("https://www.example-plc.com/p/1756-l73", title, make)
    r, screened = await _search_one_page(monkeypatch, enabled, make, "1756-L73", page)
    assert screened == {page["url"]: True}, screened
    assert r is not None and r["url"] == page["url"] and r["validated"] is False


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


async def _stalled_get(request):
    import httpx

    if request.method == "HEAD":
        return httpx.Response(200, headers={"content-type": _AS_PDF})
    await asyncio.sleep(30)
    return httpx.Response(200, headers={"content-type": _AS_PDF}, content=_BOSS_PAGE)


def _stalled_body(request):
    import httpx

    async def body():
        await asyncio.sleep(30)
        yield _BOSS_PAGE

    if request.method == "HEAD":
        return httpx.Response(405)
    return httpx.Response(200, headers={"content-type": _AS_PDF}, content=body())


@pytest.mark.parametrize(
    "answer", [_stalled_get, _stalled_body], ids=["head_says_pdf", "get_says_pdf"]
)
async def test_control_a_stalled_read_after_a_pdf_content_type_still_beats_the_deadline(
    wired, monkeypatch, answer
):
    # Main returns as soon as it sees a PDF content type. The extra read must not
    # push the search past the endpoint's cutoff, which the probe guard leaves
    # only HEAD_TIMEOUT plus the return reserve for each probe.
    import time

    monkeypatch.setattr(search_mod, "HEAD_TIMEOUT", 0.3)
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    _serve(monkeypatch, [(_BOSS_PDF, "GS10 brochure")])
    sent = _answer(monkeypatch, {_BOSS_PDF: answer})
    budget = search_mod.HEAD_TIMEOUT + judge.RETURN_RESERVE_S + 0.5
    r = await asyncio.wait_for(
        search_mod.search_manual("AutomationDirect", "GS10", deadline_at=time.monotonic() + budget),
        timeout=budget,
    )
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
    (
        "GS10-20P5",
        "url",
        f"{_DIST}/search?q=gs10-20p5+manual",
        False,
        "a search term is not the document",
    ),
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
    # #5853: only the path and a document-name value of the URL count.
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p6?ref=GS10%2D20P5", False, "#5853 referral value"),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p6#related-GS10%2D20P5", False, "#5853 fragment"),
    (
        "GS10-20P5",
        "url",
        f"{_DIST}/p/gs10-20p6%3Fref%3DGS10-20P5",
        False,
        "an encoded ? in the path",
    ),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p6;ref=GS10-20P5", False, "a path parameter"),
    ("GS10-20P5", "url", "https://gs10-20p5.example-distributor.com/p/drive", False, "the host"),
    ("GS10-20P5", "url", f"{_DIST}/p/GS10%2D20P5", True, "#5853 control: encoded in the path"),
    # A query value never admits a page (#5855 Codex F1, F4). A real PDF behind a
    # download endpoint is found by the content probe before this screen runs.
    ("GS10-20P5", "url", f"{_DIST}/download?document=GS10-20P5+User+Manual", False, "query"),
    ("GS10-20P5", "url", f"{_DIST}/download?FileName=GS10-20P5.pdf", False, "file-name value"),
    ("ACS355-03U-06A7-2", "url", f"{_DIST}/dl?document=ACS355-03U-06A7-2%2BB063", False, "%2B"),
    ("GS10-20P5", "url", f"{_DIST}/download?file=&file=GS10-20P5+Manual", False, "F4 blank"),
    ("GS10-20P5", "url", f"{_DIST}/dl?file=GS10-20P6&filename=GS10-20P5+Manual", False, "F4"),
    ("GS10-20P5", "url", f"{_DIST}/dl?name=GS10-20P5", False, "not a document field"),
    # #5843: the Hub's catalog hyphens read as "-"; an en or em dash does not.
    ("GS10-20P5", "title", "GS10-20P5\u2011X micro drive", False, "#5843 nonbreaking hyphen"),
    ("GS10-20P5", "url", f"{_DIST}/p/gs10-20p5%E2%80%91X", False, "#5843 encoded"),
    ("GS10-20P5", "title", "GS10-20P5\uff0d2 micro drive", False, "fullwidth hyphen-minus"),
    ("GS10-20P5", "title", "GS10\u201120P5 micro drive", True, "nonbreaking hyphen between groups"),
    ("GS10-20P5", "title", "GS10\u201320P5 micro drive", False, "an en dash joins no groups (Hub)"),
    ("GS10-20P5", "title", "GS10-20P5\u2013X micro drive", False, "decided: a dash before a code"),
    ("GS10-20P5", "title", "GS10-20P5 \u2013 user manual", True, "a spaced dash ends it"),
]


@pytest.mark.parametrize("part,field,text,names_it,why", _PART_NUMBER_TABLE)
def test_the_part_number_table(part, field, text, names_it, why):
    assert search_mod._names_part_number({field: text}, part) is names_it, why


# #5842: the title and the URL are read on their own. A title naming only a longer
# number names a different part, whatever the URL says; one that lists the exact part
# too still covers it. In the URL path, an order option or a letter or digit run
# straight onto the number names a different part that a shortened title cannot
# outvote; no query value is read (#5855 round 3). A code group after a hyphen in the
# path does not refuse a clean title: slugs join words that way ("Gis-Gs10-150-260"
# for "Gis GS10/150/260").
_ACS = "ACS355-03U-06A7-2"
_TWO_FIELD_TABLE = [
    # (part, title, url, names_it, why)
    (_ACS, f"{_ACS} frequency converter", f"{_DIST}/p/acs355-03u-06a7-2%2BB063", False, "#5842"),
    (_ACS, f"{_ACS}+B063 frequency converter", f"{_DIST}/p/acs355-03u-06a7-2", False, "title"),
    (_ACS, f"{_ACS} frequency converter", f"{_DIST}/dl?file={_ACS}%2BB063", True, "value unread"),
    ("GS10-20P5", "GS10-20P5 micro drive", f"{_DIST}/p/gs10-20p5x", False, "attached letter"),
    ("GS10-20P5", "GS10-20P5X micro drive", f"{_DIST}/p/gs10-20p5", False, "attached in title"),
    (_ACS, f"{_ACS} frequency converter", f"{_DIST}/p/acs355-03u-06a7-2", True, "#5842 control"),
    ("GS10-20P5", "GS10-20P5 0.5 hp drive", f"{_DIST}/p/gs10-20p5-0-5-hp-drive", True, "spec slug"),
    (
        _ACS,
        f"{_ACS} frequency converter",
        f"{_DIST}/p/acs355-03u-06a7-2-b063",
        True,
        "decided: slug",
    ),
    ("GS10-20P5", "GS10-20P5 micro drive", f"{_DIST}/p/gs10-20p5?ref=GS10-20P5X", True, "ref"),
    (
        "GS10-20P5",
        "GS10-20P5 drive manual",
        f"{_DIST}/p/gs10-20p5?file=GS10-20P5X+Quick+Start",
        True,
        "F7 related file",
    ),
    ("GS10-20P5", "GS10-20P6 micro drive", f"{_DIST}/p/gs10-20p6?ref=GS10-20P5", False, "#5853"),
    ("GS10-20P5", "GS10-20P6 micro drive", f"{_DIST}/p/gs10-20p6?file=GS10-20P5", False, "F1"),
    ("GS10-20P5", "GS10-20P5\u2011X micro drive", f"{_DIST}/p/gs10-20p5", False, "F2"),
    ("GS10-20P5", "GS10-20P5-X micro drive", f"{_DIST}/p/gs10-20p5", False, "code in title"),
    ("GS10-20P5", "GS10-20P5 and GS10-20P5X manual", f"{_DIST}/docs/item-8812", True, "F3"),
    ("GS10-20P5", "GS10-20P5 and GS10-20P5X manual", f"{_DIST}/p/gs10-20p5x", False, "F3 URL"),
    (_ACS, "Frequency converter", f"{_DIST}/{_ACS}/{_ACS}+B063", False, "decided: path names both"),
    (_ACS, f"{_ACS} drive", f"{_DIST}/download?document={_ACS}+User+Manual", True, "#5854 space"),
]


@pytest.mark.parametrize("part,title,url,names_it,why", _TWO_FIELD_TABLE)
def test_the_title_and_url_are_read_separately(part, title, url, names_it, why):
    assert search_mod._names_part_number({"title": title, "url": url}, part) is names_it, why


def test_an_unparseable_url_is_not_evidence():
    # urlsplit raises on an unbalanced IPv6 host; the screen refuses instead of failing.
    cand = {"title": "GS10-20P5 micro drive", "url": "https://[gs10-20p5/p/x"}
    assert search_mod._names_part_number(cand, "GS10-20P5") is False


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


# #5829 (Codex #5823 round 2, F8): an exact catalog number spelled with underscores
# reaches the screen in both judge modes. The scorer looked only for the hyphenated
# spelling, and the judge's model check strips only spaces and hyphens, so the page
# was dropped before the screen's own catalog match could run.
_SIMATIC = "6ES7214-1AG40-0XB0"
_UNDERSCORED = [
    (f"{_DIST}/p/6es7214_1ag40_0xb0", "6ES7214_1AG40_0XB0 CPU 1214C compact"),
    (f"{_DIST}/p/6es7214_1ag40_0xb0", "6ES7214_1AG40_0XB0 CPU 1214C manual"),
]


@pytest.mark.parametrize("url,title", _UNDERSCORED, ids=["no_manual_word", "manual_word"])
@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_an_underscored_exact_part_number_is_offered(wired, monkeypatch, enabled, url, title):
    page = _maker_less_stranger(url, title, "Siemens")
    assert not judge.relevant(page, "Siemens", _SIMATIC)  # the judge's check alone drops it
    r, screened = await _search_one_page(
        monkeypatch, enabled, "Siemens", _SIMATIC, page, exact_part_number=True
    )
    assert screened == {url: True}, screened
    assert r is not None and r["url"] == url and r["validated"] is False


@pytest.mark.parametrize("url,title", _UNDERSCORED, ids=["no_manual_word", "manual_word"])
@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_control_the_same_page_on_a_model_lookup_is_not_offered(
    wired, monkeypatch, enabled, url, title
):
    page = _maker_less_stranger(url, title, "Siemens")
    r, _ = await _search_one_page(monkeypatch, enabled, "Siemens", _SIMATIC, page)
    assert r is None


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_longer_underscored_number_is_not_offered(wired, monkeypatch, enabled):
    page = _maker_less_stranger(
        f"{_DIST}/p/6es7214_1ag40_0xb0_z", "6ES7214_1AG40_0XB0_Z CPU 1214C manual", "Siemens"
    )
    r, screened = await _search_one_page(
        monkeypatch, enabled, "Siemens", _SIMATIC, page, exact_part_number=True
    )
    assert r is None and screened.get(page["url"]) is not True


class _Verdicts:
    """Judge verdict per URL: the manual for each URL in `yes`, a plain match (no fault
    code list) for each in `plain`, not the manual for any other. Records what it read."""

    enabled = True

    def __init__(self, yes, plain=()):
        self.yes, self.plain, self.read = set(yes), set(plain), []

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        url = max((u for u in TEXT if u in user), key=len)
        self.read.append(url)
        yes = url in self.yes or url in self.plain
        return json.dumps(
            {
                "is_manual_for_model": yes,
                "doc_type": "user_manual" if yes else "brochure_or_catalog",
                "scope": "complete",
                "confidence": 0.9,
                "lists_fault_codes": url not in self.plain,
                "language": "en",
                "reason": "r",
            }
        ), {"provider": "fake"}


def _serve_by_pass(monkeypatch, site=(), typed=(), wide=(), pdfs=frozenset()):
    """Serve each query pass its own hits: `site` to the site-scoped query, `typed` to
    the typed PDF queries, `wide` to the wide query and the website handoff (they are
    one query string). Returns the queries sent, in order."""
    sent: list[str] = []

    async def serper(query, num=10):
        sent.append(query)
        hits = site if "site:" in query else typed if "filetype:pdf" in query else wide
        return [{"link": u, "title": t} for u, t in hits]

    async def probe(url):
        return url in pdfs

    monkeypatch.setattr(search_mod, "_serper_search", serper)
    monkeypatch.setattr(search_mod, "validate_pdf", probe)
    return sent


def _wide(sent: list[str]) -> bool:
    return any(q.endswith(" manual support") for q in sent)


# #5890 F1: a page kept only for the part-number credit does not stand in for the wide
# search. Main dropped it, found no candidate, and sent the wide query, which found the
# manual. Skipping that query returned the unvalidated product page instead.
_SIMATIC_MANUAL = "https://www.example-files.com/docs/s7-1200-6ES7214-1AG40-0XB0-system-manual.pdf"


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_page_kept_only_for_the_part_number_does_not_skip_the_wide_search(
    wired, monkeypatch, enabled
):
    url, title = _UNDERSCORED[0]  # no other credit: main scored it 0
    assert search_mod._score(url, title, "Siemens", _SIMATIC) == 0
    assert search_mod._oem_domains_for("Siemens")  # so the site-scoped query is sent
    monkeypatch.setitem(TEXT, _SIMATIC_MANUAL, "S7-1200 system manual 6ES7214-1AG40-0XB0")
    monkeypatch.setattr(judge, "_router", _Verdicts({_SIMATIC_MANUAL}))
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
    sent = _serve_by_pass(
        monkeypatch,
        site=[(url, title)],
        typed=[(url, title)],
        wide=[(_SIMATIC_MANUAL, "S7-1200 6ES7214-1AG40-0XB0 system manual")],
        pdfs=frozenset({_SIMATIC_MANUAL}),
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert _wide(sent), sent
    assert r is not None and r["url"] == _SIMATIC_MANUAL and r["validated"] is True, r


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_control_a_page_main_also_kept_still_skips_the_wide_search(
    wired, monkeypatch, enabled
):
    url, title = _UNDERSCORED[1]  # "manual" in the title: main kept it, at 10
    assert search_mod._score(url, title, "Siemens", _SIMATIC) > 0
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
    sent = _serve_by_pass(
        monkeypatch,
        site=[(url, title)],
        typed=[(url, title)],
        wide=[(_SIMATIC_MANUAL, "S7-1200 6ES7214-1AG40-0XB0 system manual")],
        pdfs=frozenset({_SIMATIC_MANUAL}),
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert not _wide(sent), sent
    assert r is not None and r["url"] == url and r["validated"] is False


# #5890 F2: the judge queues the whole number in another spelling as worth a read, in
# the first round and in the typed-pass retry. Before, a make-named brochure filled the
# queue and the exact PDF was never read.
_EXACT_PDF = "https://www.example-files.com/docs/6es7214_1ag40_0xb0.pdf"
_BROCHURE_PDF = "https://www.example-files.com/docs/siemens-simatic-s7-1200-brochure.pdf"
_OTHER_PDF = "https://www.example-files.com/docs/siemens-s7-1200-price-list.pdf"


def _pdfs_to_read(monkeypatch, *urls):
    for u in urls:
        monkeypatch.setitem(TEXT, u, f"first pages of {u}")
    exact, brochure = (
        {"url": _EXACT_PDF, "title": "6ES7214_1AG40_0XB0"},
        {"url": _BROCHURE_PDF, "title": "Siemens SIMATIC S7-1200 brochure"},
    )
    assert not judge.relevant(exact, "Siemens", _SIMATIC)
    assert judge.relevant(brochure, "Siemens", _SIMATIC)
    router = _Verdicts({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    return router


async def test_an_exact_pdf_in_another_spelling_is_read_beside_a_brochure(wired, monkeypatch):
    router = _pdfs_to_read(monkeypatch, _EXACT_PDF, _BROCHURE_PDF)
    _serve(
        monkeypatch,
        [(_EXACT_PDF, "6ES7214_1AG40_0XB0"), (_BROCHURE_PDF, "Siemens SIMATIC S7-1200 brochure")],
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert set(router.read) == {_EXACT_PDF, _BROCHURE_PDF}, router.read
    assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r


async def test_control_on_a_model_lookup_the_exact_pdf_is_not_queued(wired, monkeypatch):
    router = _pdfs_to_read(monkeypatch, _EXACT_PDF, _BROCHURE_PDF)
    _serve(
        monkeypatch,
        [(_EXACT_PDF, "6ES7214_1AG40_0XB0"), (_BROCHURE_PDF, "Siemens SIMATIC S7-1200 brochure")],
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC)
    assert router.read == [_BROCHURE_PDF], router.read
    assert r is None or r["url"] != _EXACT_PDF


async def test_the_typed_pass_retry_reads_an_exact_pdf_in_another_spelling(wired, monkeypatch):
    # Round one reads the only site-scoped PDF and rejects it, which skipped the typed
    # pass, so the retry runs it (#5822). The retry's pool holds a make-named PDF too,
    # so the exact one is read only if the retry's queue counts it as worth a read.
    router = _pdfs_to_read(monkeypatch, _EXACT_PDF, _BROCHURE_PDF, _OTHER_PDF)
    sent = _serve_by_pass(
        monkeypatch,
        site=[(_BROCHURE_PDF, "Siemens SIMATIC S7-1200 brochure")],
        typed=[(_OTHER_PDF, "Siemens S7-1200 price list"), (_EXACT_PDF, "6ES7214_1AG40_0XB0")],
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert any("filetype:pdf" in q and "site:" not in q for q in sent), sent  # the retry ran
    assert set(router.read) == {_BROCHURE_PDF, _OTHER_PDF, _EXACT_PDF}, router.read
    assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r


# #5890 F5 and round 2: `_collect` keeps exactly main's candidates, at main's scores. A
# hit main drops at 0 that names the whole number in another spelling is set aside.
_ACS = "ACS355-03U-06A7-2"


@pytest.mark.parametrize(
    "title,part_number,aside",
    [
        ("ACS355-03U-06A7-2 drive", _ACS, False),  # main keeps it, at 25
        ("ACS355-03U-06A7 2 drive", _ACS, False),  # main keeps it, at the shorter-token 10
        ("ACS355_03U_06A7_2 drive", _ACS, True),  # main drops it at 0
        ("ACS355_03U_06A7_2 drive", None, False),  # a model lookup sets nothing aside
        ("ACS355-03U-06A7 drive", _ACS, False),  # a prefix: main keeps it, nothing more
    ],
    ids=["literal", "mixed_separators", "underscores", "model_lookup", "prefix_only"],
)
def test_collect_keeps_mains_candidates_and_sets_aside_what_main_drops(title, part_number, aside):
    url = "https://www.example-drives.com/p/a"
    hits = [{"link": url, "title": title}]
    kept: list[dict] = []
    assert search_mod._collect(hits, "ABB", _ACS, part_number, kept) == search_mod._collect(
        hits, "ABB", _ACS
    )
    assert [c["url"] for c in kept] == ([url] if aside else [])


# Round 2: the pages the search leaves aside get a turn only where main's search ends
# without a manual, so main's reads, queries, retries and answers are main's.
_FILES = "https://www.example-files.com/docs"


async def _read_and_match(monkeypatch, make, model, hits, manual, exact_part_number=False):
    """Serve `hits`, every PDF readable, `manual` the only one judged the manual. No
    hit passes the judge's own check, so main reads every PDF and finds the manual."""
    assert not any(judge.relevant({"url": u, "title": t}, make, model) for u, t in hits)
    for u, _ in hits:
        monkeypatch.setitem(TEXT, u, f"first pages of {u}")
    router = _Verdicts({manual})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, hits)
    r = await search_mod.search_manual(make, model, exact_part_number=exact_part_number)
    return r, router


async def test_with_no_pdf_of_its_own_the_judge_still_reads_every_pdf(wired, monkeypatch):
    catalog, manual = f"{_FILES}/ge-motors-catalog.pdf", f"{_FILES}/5ks-motor-instructions.pdf"
    hits = [(catalog, "GE Motors catalog"), (manual, "Motor instructions")]
    assert search_mod._names_make({"url": catalog, "title": "GE Motors catalog"}, "GE")
    r, router = await _read_and_match(monkeypatch, "GE", "M100", hits, manual)
    assert manual in router.read, router.read
    assert r is not None and r["url"] == manual and r["validated"] is True, r


async def test_with_no_pdf_of_its_own_a_part_number_lookup_reads_every_pdf(wired, monkeypatch):
    manual = f"{_FILES}/cpu-system-handbook.pdf"
    hits = [(_EXACT_PDF, "6ES7214_1AG40_0XB0"), (manual, "CPU system handbook")]
    r, router = await _read_and_match(
        monkeypatch, "Siemens", _SIMATIC, hits, manual, exact_part_number=True
    )
    assert manual in router.read, router.read
    assert r is not None and r["url"] == manual and r["validated"] is True, r


_AD_BROCHURE = (f"{_FILES}/automationdirect-gs10-brochure.pdf", "AutomationDirect GS10 brochure")
_AD_EXTRA_PDF = (f"{_FILES}/automation-direct-drive-manual.pdf", "Automation-Direct drive manual")
_AD_EXTRA_PAGE = (
    "https://www.example-manuals.com/library/drive-installation",
    "Automation-Direct Drive Installation Manual",
)
_AD_MANUAL = (f"{_FILES}/gs10-user-manual.pdf", "GS10 user manual")
_SIEMENS_BROCHURE = (_BROCHURE_PDF, "Siemens SIMATIC S7-1200 brochure")
_SIEMENS_MANUAL = (_SIMATIC_MANUAL, "S7-1200 6ES7214-1AG40-0XB0 system manual")


def _readable(monkeypatch, *urls):
    for u in urls:
        monkeypatch.setitem(TEXT, u, f"first pages of {u}")


def _retry_ran(sent: list[str]) -> bool:
    return any("filetype:pdf" in q and "site:" not in q for q in sent)


async def _site_then_retry(monkeypatch, make, model, site, manual, readable, exact=False):
    """Round one gets only `site`; the judge reads its own PDFs there and rejects them,
    which skipped the typed pass, so the retry runs it and finds `manual`."""
    assert search_mod._oem_domains_for(make)  # so the site-scoped query is sent
    assert judge.relevant({"url": manual[0], "title": manual[1]}, make, model)
    _readable(monkeypatch, manual[0], *readable)
    router = _Verdicts({manual[0]})
    monkeypatch.setattr(judge, "_router", router)
    sent = _serve_by_pass(monkeypatch, site=site, typed=[manual])
    r = await search_mod.search_manual(make, model, exact_part_number=exact)
    return r, router, sent


async def test_an_unreadable_extra_pdf_does_not_stop_mains_retry(wired, monkeypatch):
    assert _EXACT_PDF not in TEXT  # the judge cannot read it
    r, router, sent = await _site_then_retry(
        monkeypatch,
        "Siemens",
        _SIMATIC,
        [_SIEMENS_BROCHURE, (_EXACT_PDF, "6ES7214_1AG40_0XB0")],
        _SIEMENS_MANUAL,
        [_BROCHURE_PDF],
        exact=True,
    )
    assert _retry_ran(sent), sent
    assert r is not None and r["url"] == _SIMATIC_MANUAL and r["validated"] is True, r


async def test_an_extra_pdf_past_the_cap_does_not_stop_mains_retry(wired, monkeypatch):
    monkeypatch.setattr(judge, "MAX_TOTAL", 1)  # the brochure alone fills round one
    r, router, sent = await _site_then_retry(
        monkeypatch,
        "Siemens",
        _SIMATIC,
        [_SIEMENS_BROCHURE, (_EXACT_PDF, "6ES7214_1AG40_0XB0")],
        _SIEMENS_MANUAL,
        [_BROCHURE_PDF, _EXACT_PDF],
        exact=True,
    )
    assert _retry_ran(sent), sent
    assert r is not None and r["url"] == _SIMATIC_MANUAL and r["validated"] is True, r


@pytest.mark.parametrize(
    "make,model,site,manual,readable,exact",
    [
        (
            "AutomationDirect",
            "GS10",
            [_AD_BROCHURE, _AD_EXTRA_PAGE],
            _AD_MANUAL,
            [_AD_BROCHURE[0]],
            False,
        ),
        (
            "Siemens",
            _SIMATIC,
            [_SIEMENS_BROCHURE, _UNDERSCORED[1]],
            _SIEMENS_MANUAL,
            [_BROCHURE_PDF],
            True,
        ),
    ],
    ids=["joined_make", "part_number"],
)
async def test_an_extra_page_does_not_stand_in_for_mains_retry(
    wired, monkeypatch, make, model, site, manual, readable, exact
):
    page = {"url": site[1][0], "title": site[1][1]}
    assert not judge.relevant(page, make, model)
    assert search_mod._may_offer_unread(page, make, model if exact else None)
    r, router, sent = await _site_then_retry(
        monkeypatch, make, model, site, manual, readable, exact
    )
    assert _retry_ran(sent), sent
    assert r is not None and r["url"] == manual[0] and r["validated"] is True, r


async def test_an_extra_page_does_not_replace_mains_judged_rejection(wired, monkeypatch):
    # GE has no site-scoped query, so the typed pass runs in round one and no retry
    # follows: main ends with the brochure's judged rejection, and that stands.
    brochure = (f"{_FILES}/ge-m100-brochure.pdf", "GE M100 brochure")
    page = ("https://www.example-motors.com/library/ge-motors", "GE motors installation manual")
    assert not search_mod._oem_domains_for("GE")
    assert not judge.relevant({"url": page[0], "title": page[1]}, "GE", "M100")
    assert search_mod._score(*page, "GE", "M100") > 0
    assert search_mod._may_offer_unread({"url": page[0], "title": page[1]}, "GE", None)
    _readable(monkeypatch, brochure[0])
    monkeypatch.setattr(judge, "_router", _Verdicts(()))
    _serve(monkeypatch, [brochure, page])
    r = await search_mod.search_manual("GE", "M100")
    assert r is not None and r["url"] == brochure[0], r
    assert r["validated"] is False and judge.is_rejected(r), r


async def test_a_plain_match_of_the_judges_own_stands_beside_an_ideal_extra(wired, monkeypatch):
    own = (f"{_FILES}/automationdirect-gs10-quick-start.pdf", "AutomationDirect GS10 quick start")
    _readable(monkeypatch, own[0], _AD_EXTRA_PDF[0])
    router = _Verdicts({_AD_EXTRA_PDF[0]}, plain={own[0]})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [own, _AD_EXTRA_PDF])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert router.read == [own[0]], router.read
    assert r is not None and r["url"] == own[0] and r["validated"] is True, r


async def test_where_main_offers_its_own_page_no_extra_pdf_is_read(wired, monkeypatch):
    # Main's own PDF cannot be read, so main offers its own page on the make's site
    # unread. That is main's answer: the extra PDF is not read in its place.
    own_pdf = (f"{_FILES}/automationdirect-gs10-datasheet.pdf", "AutomationDirect GS10 datasheet")
    page = ("https://www.automationdirect.com/adc/overview/catalog/drives/gs10", "GS10 drive")
    assert own_pdf[0] not in TEXT
    _readable(monkeypatch, _AD_EXTRA_PDF[0])
    router = _Verdicts({_AD_EXTRA_PDF[0]})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [page, own_pdf, _AD_EXTRA_PDF])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert router.read == [], router.read
    assert r is not None and r["url"] == page[0] and r["validated"] is False, r


async def test_where_mains_own_page_is_refused_an_extra_page_is_offered(wired, monkeypatch):
    # Main's only page names the model but another make, so the screen refuses it and
    # main ends with nothing. The page naming GE is offered there instead.
    stranger = ("https://www.example-drives.com/p/m100", "Siemens M100 drive")
    page = ("https://www.example-motors.com/library/ge-motors", "GE motors installation manual")
    assert judge.relevant({"url": stranger[0], "title": stranger[1]}, "GE", "M100")
    assert not search_mod._may_offer_unread({"url": stranger[0], "title": stranger[1]}, "GE", None)
    _serve(monkeypatch, [stranger, page])
    r = await search_mod.search_manual("GE", "M100")
    assert r is not None and r["url"] == page[0] and r["validated"] is False, r


async def test_a_joined_make_pdf_is_read_beside_the_judges_own(wired, monkeypatch):
    brochure = f"{_FILES}/automationdirect-gs10-brochure.pdf"
    joined = f"{_FILES}/automation-direct-drive-manual.pdf"
    hits = [
        (brochure, "AutomationDirect GS10 brochure"),
        (joined, "Automation-Direct drive manual"),
    ]
    assert judge.relevant({"url": brochure, "title": hits[0][1]}, "AutomationDirect", "GS10")
    assert not judge.relevant({"url": joined, "title": hits[1][1]}, "AutomationDirect", "GS10")
    for u, _ in hits:
        monkeypatch.setitem(TEXT, u, f"first pages of {u}")
    router = _Verdicts({joined})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, hits)
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert set(router.read) == {brochure, joined}, router.read
    assert r is not None and r["url"] == joined and r["validated"] is True, r


async def test_an_extra_pdf_does_not_take_the_probe_from_the_judges_own_page(wired, monkeypatch):
    # The judge's own pick is a page on the make's site, which main offers after its
    # probe fails. An extra PDF that would probe as one is not probed in its place.
    page = ("https://www.automationdirect.com/adc/overview/catalog/drives/gs10", "GS10 drive")
    extra = (
        f"{_FILES}/automation-direct-drive-installation-manual.pdf",
        "Automation-Direct drive manual",
    )
    assert search_mod._is_oem_host(urlparse(page[0]).netloc, "AutomationDirect")
    assert judge.relevant({"url": page[0], "title": page[1]}, "AutomationDirect", "GS10")
    assert not judge.relevant({"url": extra[0], "title": extra[1]}, "AutomationDirect", "GS10")
    assert extra[0] not in TEXT  # the judge cannot read it, so it stays unread
    _serve(monkeypatch, [page, extra], pdfs=frozenset({extra[0]}))
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == page[0] and r["validated"] is False, r


async def test_with_the_judge_on_its_own_page_is_offered_before_an_extra_one(wired, monkeypatch):
    extra = (
        "https://www.example-manuals.com/pdf/automation-direct-drive-installation",
        "Automation-Direct drive installation manual",
    )
    own = ("https://www.example-manuals.com/p/gs10-drive", "AutomationDirect GS10 drive")
    # A tie on score, the extra page served first: only the order of the pool decides.
    assert search_mod._score(*extra, "AutomationDirect", "GS10") == search_mod._score(
        *own, "AutomationDirect", "GS10"
    )
    assert not search_mod._is_direct_pdf(extra[0]) and not search_mod._is_direct_pdf(own[0])
    _serve(monkeypatch, [extra, own])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == own[0] and r["validated"] is False, r


async def _assert_screen(monkeypatch, make, part, refused, offered):
    """In both judge modes, each `refused` page alone is a miss and the `offered`
    control alone comes back unvalidated. A refused page must reach the screen and
    be refused there, so a page the scorer dropped earlier cannot pass vacuously."""
    screened: dict[str, bool] = {}
    screen = search_mod._may_offer_unread

    def spy(c, make_, part_number=None):
        screened[c.get("url")] = verdict = screen(c, make_, part_number)
        return verdict

    monkeypatch.setattr(search_mod, "_may_offer_unread", spy)
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        assert judge.judge_enabled() is (enabled == "1")
        for page in refused:
            screened.clear()
            _serve(monkeypatch, [(page["url"], page["title"])])
            r = await search_mod.search_manual(make, part, exact_part_number=True)
            assert r is None, (enabled, page["url"])
            assert screened == {page["url"]: False}, (enabled, page["url"], screened)
        _serve(monkeypatch, [(offered["url"], offered["title"])])
        r = await search_mod.search_manual(make, part, exact_part_number=True)
        assert r is not None and r["url"] == offered["url"] and r["validated"] is False, enabled


async def test_a_part_named_only_in_a_referral_or_fragment_is_not_offered(wired, monkeypatch):
    # #5853: the title and the product path name GS10-20P6; only the referral value
    # or the fragment names the requested GS10-20P5.
    ad = "AutomationDirect"
    refused = [
        _maker_less_stranger(f"{_DIST}/p/gs10-20p6?ref=GS10%2D20P5", "GS10-20P6 micro drive", ad),
        _maker_less_stranger(
            f"{_DIST}/p/gs10-20p6#related-GS10%2D20P5", "GS10-20P6 micro drive", ad
        ),
        # #5855 Codex F1: a document field on a product page names another part's file.
        _maker_less_stranger(
            f"{_DIST}/p/gs10-20p6?file=GS10-20P5+User+Manual", "GS10-20P6 micro drive", ad
        ),
    ]
    # The scorer reads the raw URL, so the title carries "manual" to reach the screen;
    # the title does not name the part, so the offer rests on the encoded path.
    offered = _maker_less_stranger(f"{_DIST}/p/GS10%2D20P5", "Micro drive manual", ad)
    await _assert_screen(monkeypatch, ad, "GS10-20P5", refused, offered)


async def test_a_query_value_neither_refuses_nor_admits_a_page(wired, monkeypatch):
    # #5855 round 3: no query value is read. A value naming a longer part does not
    # refuse a page whose title names the part, and a related-file value does not
    # refuse a product page whose title and path name it (Codex F7). A value naming
    # the part does not admit a page that otherwise names nothing (#5853).
    title = f"{_ACS} frequency converter"
    refused = [
        _maker_less_stranger(f"{_DIST}/download?document={_ACS}%20User%20Manual", "Download", "ABB")
    ]
    offered = _maker_less_stranger(f"{_DIST}/download?document={_ACS}%2BB063", title, "ABB")
    await _assert_screen(monkeypatch, "ABB", _ACS, refused, offered)
    ad = "AutomationDirect"
    offered = _maker_less_stranger(
        f"{_DIST}/p/gs10-20p5?file=GS10-20P5X+Quick+Start", "GS10-20P5 drive manual", ad
    )
    await _assert_screen(monkeypatch, ad, "GS10-20P5", [], offered)


async def test_a_pdf_behind_a_download_endpoint_is_found_by_the_probe(wired, monkeypatch):
    # #5855 Codex F1: the query never admits a page, so a download endpoint is found
    # only when it serves a PDF. The probe runs before the screen; the same URL serving
    # a web page reaches the screen and is refused.
    url = f"{_DIST}/download?document=GS10-20P5+User+Manual"
    _maker_less_stranger(url, "Download", "AutomationDirect")
    screened: list[bool] = []
    screen = search_mod._may_offer_unread

    def spy(c, make_, part_number=None):
        screened.append(verdict := screen(c, make_, part_number))
        return verdict

    monkeypatch.setattr(search_mod, "_may_offer_unread", spy)
    for enabled in ("1", "0"):
        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
        assert judge.judge_enabled() is (enabled == "1")
        screened.clear()
        _serve(monkeypatch, [(url, "Download")], pdfs={url})
        r = await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
        assert r is not None and r["url"] == url and r["validated"] is (enabled == "0"), enabled
        assert screened == [], (enabled, screened)
        _serve(monkeypatch, [(url, "Download")])
        r = await search_mod.search_manual("AutomationDirect", "GS10-20P5", exact_part_number=True)
        assert r is None and screened == [False], (enabled, screened)


async def test_a_shortened_title_does_not_outvote_an_order_option_in_the_url(wired, monkeypatch):
    # #5842: the URL names the longer +B063 order number; the title shortens it.
    title = f"{_ACS} frequency converter"
    refused = [_maker_less_stranger(f"{_DIST}/p/acs355-03u-06a7-2%2BB063", title, "ABB")]
    offered = _maker_less_stranger(f"{_DIST}/p/acs355-03u-06a7-2", title, "ABB")
    await _assert_screen(monkeypatch, "ABB", _ACS, refused, offered)


async def test_a_nonbreaking_hyphen_does_not_end_the_part_number(wired, monkeypatch):
    # #5843: U+2011 before a code group, in the title and encoded in the URL.
    ad = "AutomationDirect"
    refused = [
        _maker_less_stranger(f"{_DIST}/p/item-8812", "GS10-20P5\u2011X micro drive", ad),
        _maker_less_stranger(f"{_DIST}/p/gs10-20p5%E2%80%91X", "Micro drive", ad),
        # #5855 Codex F2: a shortened slug does not outvote the title's longer number.
        _maker_less_stranger(f"{_DIST}/p/gs10-20p5", "GS10-20P5\u2011X micro drive", ad),
    ]
    offered = _maker_less_stranger(f"{_DIST}/p/item-8812", "GS10-20P5 micro drive", ad)
    await _assert_screen(monkeypatch, ad, "GS10-20P5", refused, offered)


async def test_a_title_listing_the_part_with_a_longer_one_is_still_offered(wired, monkeypatch):
    # #5855 Codex F3: a shared manual names the exact part among others. A URL naming
    # the longer number alone still refuses it.
    ad = "AutomationDirect"
    title = "GS10-20P5 and GS10-20P5X user manual"
    refused = [_maker_less_stranger(f"{_DIST}/p/gs10-20p5x", title, ad)]
    offered = _maker_less_stranger(f"{_DIST}/docs/item-8812", title, ad)
    await _assert_screen(monkeypatch, ad, "GS10-20P5", refused, offered)


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


_DRAWING_TEXT = "DURApulse GS10 dimensional drawing / cut sheet"


async def test_fragment_variants_of_rejected_pdfs_do_not_use_up_the_retry_batch(wired, monkeypatch):
    # #5850: the typed pass returns "#page=1" forms of four drawings round one already
    # rejected, ahead of the manual (equal score, provider order). A server never sees
    # a fragment, so they are the same documents: the retry reads only the manual.
    variants = [(f"{u}#page=1", t) for u, t in _AD_READ[:4]]
    router, sent = _stall(monkeypatch, q2_hits=variants + [(_GS10_MANUAL, "GS10 drive")])
    for u, _ in variants:
        monkeypatch.setitem(TEXT, u, _DRAWING_TEXT)
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert len(router.calls) == 7  # six drawings in round one, then only the manual
    added = {c["url"] for c in trail.candidates[len(_AD_READ) :]}
    assert added == {_GS10_MANUAL}


async def test_control_a_query_string_variant_is_still_a_new_document_for_the_retry(
    wired, monkeypatch
):
    # The key keeps the query string: "?rev=2" can select another document, so it is read.
    rev = (f"{_AD_READ[1][0]}?rev=2", _AD_READ[1][1])
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT, rev])
    monkeypatch.setitem(TEXT, rev[0], _DRAWING_TEXT)
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert len(router.calls) == 8  # the manual and the revision were both read


async def test_control_a_new_document_keeps_its_fragment_for_display(wired, monkeypatch):
    # Only the comparison drops the fragment; the URL the technician sees is unchanged.
    # Forms of a document round one did not reject are compared by their exact URL,
    # as on main, so both forms stay candidates for the judge.
    page, other = f"{_GS10_MANUAL}#page=3", f"{_GS10_MANUAL}#page=1"
    router, sent = _stall(
        monkeypatch, q2_hits=[(page, _GS10_MANUAL_HIT[1]), (other, _GS10_MANUAL_HIT[1])]
    )
    monkeypatch.setitem(TEXT, page, TEXT[_GS10_MANUAL])
    monkeypatch.setitem(TEXT, other, TEXT[_GS10_MANUAL])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == page and r["validated"] is True, r
    assert {c["url"] for c in trail.candidates[len(_AD_READ) :]} == {page, other}


# #5870 Codex F1 and F2: only a PDF the judge read and rejected is matched without its
# fragment. A first-round copy the judge never read, and a second form of a new
# document, are compared by exact URL, as on main.
_SERIES_MANUAL = "https://www.example-files.com/library/series-ac-drive-manual.pdf"


async def test_an_unread_first_round_copy_does_not_hide_its_retry_form(wired, monkeypatch):
    # Round one finds the manual under a generic title the judge does not queue, and a
    # drawing it rejects. The typed pass returns the manual with a page fragment and a
    # title naming the model: that form is read and found.
    generic = (_SERIES_MANUAL, "AC drive user manual")
    titled = (f"{_SERIES_MANUAL}#page=3", "DURApulse GS10 AC Drive User Manual")
    assert not judge.relevant({"url": generic[0], "title": generic[1]}, "AutomationDirect", "GS10")
    router, sent = _stall(monkeypatch, q1_hits=[_AD_READ[0], generic], q2_hits=[titled])
    monkeypatch.setitem(TEXT, titled[0], TEXT[_GS10_MANUAL])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert trail.judge["not_queued"][_SERIES_MANUAL] == "not_relevant"
    assert r is not None and r["url"] == titled[0] and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert _typed(sent) == _GS10_TYPED
    assert len(router.calls) == 2  # the drawing in round one, the titled form in the retry


async def test_a_second_form_of_a_new_document_is_kept_for_the_judge(wired, monkeypatch):
    # The typed pass returns two equal-scoring forms of a new manual, the generic one
    # first, plus a new drawing. The judge skips the generic form and reads the form
    # whose title names the model in another spelling, so that form has to be there.
    first = (f"{_SERIES_MANUAL}#page=1", "AC drive user manual")
    spelled = (f"{_SERIES_MANUAL}#page=3", "GS 10 AC drive user manual")
    drawing = (f"{_AD}/drawings/gs10-enclosure.pdf", "GS10 enclosure drawing")
    model = "GS10"
    score = search_mod._score
    assert score(*first, "AutomationDirect", model) == score(*spelled, "AutomationDirect", model)
    assert not judge.relevant({"url": first[0], "title": first[1]}, "AutomationDirect", model)
    assert judge.relevant({"url": spelled[0], "title": spelled[1]}, "AutomationDirect", model)
    router, sent = _stall(monkeypatch, q2_hits=[first, spelled, drawing])
    monkeypatch.setitem(TEXT, first[0], TEXT[_GS10_MANUAL])
    monkeypatch.setitem(TEXT, spelled[0], TEXT[_GS10_MANUAL])
    monkeypatch.setitem(TEXT, drawing[0], _DRAWING_TEXT)
    r = await search_mod.search_manual("AutomationDirect", model, deadline_at=_deadline(60))
    assert r is not None and r["url"] == spelled[0] and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH


class _TitleSensitiveJudge(_SaysGs10Manual):
    """Reads the GS10 manual's text as the manual unless the title calls it an
    accessory, which it then rejects with low confidence."""

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        self.calls.append(user)
        line = next((x for x in user.splitlines() if x.startswith("Candidate title:")), "")
        yes = "GS10-MANUAL-TEXT" in user and "accessory" not in line.lower()
        v = {
            "is_manual_for_model": yes,
            "doc_type": "user_manual" if yes else "accessory_guide",
            "confidence": 0.9 if yes else 0.35,
            "evidence_quote": "GS10 user manual" if yes else "",
            "reason": "The GS10 user manual." if yes else "An accessory card.",
        }
        return json.dumps(v), {"provider": "fake"}


async def test_a_fragment_form_under_a_new_title_is_judged_again(wired, monkeypatch):
    # Codex round 2 F4: round one reads the manual under an accessory-card title and
    # rejects it. The typed pass returns it with "#page=3" and the user-manual title,
    # which is new input for the judge, so it is read, as on main, and matches.
    accessory = (_SERIES_MANUAL, "GS10 accessory card")
    titled = (f"{_SERIES_MANUAL}#page=3", "DURApulse GS10 AC Drive User Manual")
    router, sent = _stall(monkeypatch, q1_hits=[_AD_READ[0], accessory], q2_hits=[titled])
    router = _TitleSensitiveJudge()
    monkeypatch.setattr(judge, "_router", router)
    monkeypatch.setitem(TEXT, accessory[0], TEXT[_GS10_MANUAL])
    monkeypatch.setitem(TEXT, titled[0], TEXT[_GS10_MANUAL])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == titled[0] and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH
    assert [c["url"] for c in r["judged_rejected"]] == [_AD_READ[0][0], _SERIES_MANUAL]
    assert len(router.calls) == 3  # the drawing and the accessory title, then the retry form


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


# #5848: the website handoff only adds a support page. A handoff that never answers must
# not turn the search's answer into an outage, and the caller's own timeout must still
# cancel the search. Where the typed-pass retry follows and can still start, the retry
# keeps its window and the handoff gets what is left (#5866 Codex F2). These tests use
# the shrunken timing: the retry needs 1.1 s, so a handoff before it keeps 1.4 s back.
_HANDOFF_TIMEOUT_ROW = {"pass": "q3", "query": _HANDOFF, "result": "timeout"}


def test_a_stalled_website_handoff_leaves_the_retry_its_window(wired, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md
    import shared.manual_search.quota as quota

    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", "2.5")
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], delays={_HANDOFF: 30})

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
    assert search_mod.time.monotonic() - started < 2.5
    # The handoff is cut off at 1.1 s, and the retry still has the 1.4 s it needs.
    assert body["reason"] == judge.REASON_JUDGED_MATCH, body.get("reason")
    assert sent[:2] == [sent[0], _HANDOFF] and _typed(sent) == _GS10_TYPED
    assert len(router.calls) == 7  # six drawings in round one, then the manual
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


async def test_a_website_handoff_stalled_on_the_quota_reservation_is_cut_off_too(
    wired, monkeypatch
):
    # The cutoff covers the whole provider call: here the real _serper_search waits on
    # the handoff's quota reservation, so the handoff is never posted.
    import shared.manual_search.quota as quota

    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, _ = _stall(monkeypatch)
    reservations = 0
    posted: list[str] = []

    async def reserve(_identity):
        nonlocal reservations
        reservations += 1
        if reservations == 2:  # q1, then the handoff
            await asyncio.sleep(30)
        return "ok"

    async def post(query, num):
        posted.append(query)
        if "site:" in query:
            return [{"link": u, "title": t} for u, t in _AD_READ]
        if "filetype:pdf" in query:
            return [{"link": _GS10_MANUAL_HIT[0], "title": _GS10_MANUAL_HIT[1]}]
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
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(2.5)),
            timeout=2.5,
        )
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert _HANDOFF not in posted and _typed(posted) == _GS10_TYPED
    assert reservations == 4 and budget.used == 3  # the stalled handoff was never sent
    assert _HANDOFF_TIMEOUT_ROW in trail.queries


async def test_a_caller_timeout_during_the_website_handoff_is_still_a_cancellation(
    wired, monkeypatch
):
    # Control: with a 60 s deadline the handoff's own cutoff is far away, so the
    # caller's 0.5 s timeout lands first and must reach the caller, not be absorbed.
    router, sent = _stall(monkeypatch, delays={_HANDOFF: 30})
    with search_mod.acquisition_trail() as trail:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60)),
                timeout=0.5,
            )
    assert sent[-1] == _HANDOFF and len(router.calls) == 6
    assert _HANDOFF_TIMEOUT_ROW not in trail.queries  # the caller cancelled, not the cutoff


async def test_a_handoff_window_too_short_to_use_is_not_sent_and_the_retry_runs(wired, monkeypatch):
    # 1.5 s left: the retry keeps 1.4 s, which leaves the handoff no more than a return
    # reserve, so the handoff is not sent and the retry starts at once.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], handoff_hits=[_SUPPORT])
    with search_mod.acquisition_trail() as trail:
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.5)),
            timeout=1.5,
        )
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert _HANDOFF not in sent and _typed(sent) == _GS10_TYPED
    assert trail.search_page_url is None and _HANDOFF_TIMEOUT_ROW not in trail.queries


# The endpoint reasons the Hub records as retryable (search_unavailable, and
# quota_exceeded, which it stores as search_limit_reached).
_HUB_RETRIES = {"search_unavailable", "quota_exceeded"}


def _discovery(monkeypatch, timeout_s, reserve=None):
    """The real discovery endpoint with a ``timeout_s`` budget. ``reserve`` replaces
    the quota reservation; by default every query is allowed."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md
    import shared.manual_search.quota as quota

    async def no_link(make):
        return None

    async def ok(_identity):
        return "ok"

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", str(timeout_s))
    monkeypatch.setattr(md, "oem_request_link", no_link)
    monkeypatch.setattr(quota, "reserve_provider_query", reserve or ok)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    started = search_mod.time.monotonic()
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "AutomationDirect", "model": "GS10"}
    ).json()
    return body, search_mod.time.monotonic() - started


# After a handoff cut off where the retry follows, a retry that ran short of time did
# not finish: unless it found the manual, that is the outage main returns for any
# stalled search, which the Hub retries. A judged rejection there would be recorded as
# final (#5866 Codex round 2, F2 and F4). A retry that ran to its end keeps its judged
# rejection, as a completed search does.
async def test_a_stall_once_the_retry_cannot_start_is_the_outage_main_returns(wired, monkeypatch):
    # 1.0 s left is less than the retry needs, so the handoff keeps today's cutoff and
    # the retry cannot start.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], delays={_HANDOFF: 30})
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 1.0)
    assert took < 1.0
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert body["reason_detail"] == "Manual search ran out of time before it finished."
    assert sent[-1] == _HANDOFF and _typed(sent) == []
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


def _first_spelling_empty(monkeypatch, sent, delay):
    # The first typed spelling answers after ``delay`` with nothing; the second, if it
    # is sent, gets the stub's answer (the manual).
    inner = search_mod._serper_search

    async def serper(query, num=10):
        if query == _GS10_TYPED[0]:
            budget = search_mod._provider_budget.get()
            budget.used += 1  # sent and answered, as _serper_search counts a send
            sent.append(query)
            await asyncio.sleep(delay)
            return []
        return await inner(query, num)

    monkeypatch.setattr(search_mod, "_serper_search", serper)


async def test_a_stall_that_cuts_the_typed_pass_short_is_the_outage_main_returns(
    wired, monkeypatch
):
    # Codex F2: the handoff is cut off at 1.1 s, the first spelling then takes 0.6 s
    # and finds nothing, and the second, which holds the manual, no longer fits.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], delays={_HANDOFF: 30})
    _first_spelling_empty(monkeypatch, sent, 0.6)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert _typed(sent) == _GS10_TYPED[:1] and len(router.calls) == 6
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


async def test_control_without_the_stall_the_second_spelling_finds_the_manual(wired, monkeypatch):
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT])
    _first_spelling_empty(monkeypatch, sent, 0.6)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert body["reason"] == judge.REASON_JUDGED_MATCH, body.get("reason")
    assert _typed(sent) == _GS10_TYPED


async def test_a_stall_then_a_retry_query_cut_off_mid_flight_is_the_outage_main_returns(
    wired, monkeypatch
):
    # The handoff is cut off at 1.1 s, and the first spelling then never answers: the
    # retry's own cutoff ends it with nothing back, and the second is never sent.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(
        monkeypatch, q2_hits=[_GS10_MANUAL_HIT], delays={_HANDOFF: 30, _GS10_TYPED[0]: 30}
    )
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert _typed(sent) == _GS10_TYPED[:1] and len(router.calls) == 6
    rows = body["candidate_trail"]["queries"]
    assert _HANDOFF_TIMEOUT_ROW in rows
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "timeout"} in rows


async def test_a_stall_before_a_retry_that_runs_to_its_end_keeps_its_judged_rejection(
    wired, monkeypatch
):
    # The handoff is cut off at 1.1 s, and the retry still sends both spellings and
    # reads the one new PDF they return, a drawing. The search finished, so its judged
    # rejection is final, as when the handoff answers.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_OTHER], delays={_HANDOFF: 30})
    monkeypatch.setitem(TEXT, _OTHER[0], "DURApulse GS10 dimensional drawing")
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == "judged_not_applicable", body.get("reason")
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 7
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]
    assert body["candidate_trail"]["stop"] == "queue_exhausted"


@pytest.mark.parametrize("delays", [{_HANDOFF: 30}, None], ids=["handoff_stalls", "no_stall"])
async def test_control_a_retry_stopped_by_the_query_ceiling_keeps_its_judged_rejection(
    wired, monkeypatch, delays
):
    # The ceiling is three queries: q1, the handoff and the first spelling. The second
    # spelling is stopped by the ceiling, not by time, and a prompt handoff stops it the
    # same way, so a stall changes nothing: the judged rejection stands either way.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    monkeypatch.setenv("MANUAL_SEARCH_MAX_PROVIDER_QUERIES", "3")
    router, sent = _stall(monkeypatch, delays=delays)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == "judged_not_applicable", body.get("reason")
    assert sent[1] == _HANDOFF and _typed(sent) == _GS10_TYPED[:1]
    assert (_HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]) == bool(delays)


async def test_a_stall_that_leaves_the_retry_read_unfinished_is_the_outage_main_returns(
    wired, monkeypatch
):
    # The retry sends both spellings, but the new PDF never finishes downloading, so
    # its read stops at the deadline: the search did not finish.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_OTHER], delays={_HANDOFF: 30})
    monkeypatch.setitem(TEXT, _OTHER[0], "DURApulse GS10 dimensional drawing")
    fetch = judge.fetch_pdf_bytes

    async def stalled_fetch(url, max_bytes=judge.MAX_BYTES):
        if url == _OTHER[0]:
            await asyncio.sleep(30)
        return await fetch(url, max_bytes)

    monkeypatch.setattr(judge, "fetch_pdf_bytes", stalled_fetch)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 6
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


async def test_a_quota_answer_held_past_the_cutoff_is_the_outage_not_a_final_miss(
    wired, monkeypatch
):
    # Codex F4: the handoff's reservation would answer user_cap at 0.82 s, after the
    # 0.7 s cutoff, with no time left for the retry. On main that is quota_exceeded,
    # the Hub's next-day retry. It must not become a judged rejection with no denial.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, _ = _stall(monkeypatch)
    reservations = 0
    posted: list[str] = []

    async def reserve(_identity):
        nonlocal reservations
        reservations += 1
        if reservations == 2:  # q1, then the handoff
            await asyncio.sleep(0.82)
            return "user_cap"
        return "ok"

    async def post(query, num):
        posted.append(query)
        if "site:" in query:
            return [{"link": u, "title": t} for u, t in _AD_READ]
        return []

    monkeypatch.setattr(search_mod, "_serper_search", _REAL_SERPER_SEARCH)
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "k")
    monkeypatch.setattr(search_mod, "_serper_post", post)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 1.0, reserve)
    # Either answer the Hub retries: the outage (ordinary backoff, which asks the
    # quota again) or, where the denial lands in time, the next-day cap retry.
    assert body["reason"] in _HUB_RETRIES, body.get("reason")
    assert _HANDOFF not in posted and reservations == 2
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


# A retry that ended early for a reason other than time did not finish either: a
# spelling that failed or was refused went unanswered, and a PDF it queued but could not
# read was not read. After a handoff cutoff that is main's outage. Without the stall the
# same retry ends in the judged rejection, as it does on main.
_STALL_OR_NOT = pytest.mark.parametrize(
    ("delays", "reason"),
    [({_HANDOFF: 30}, "search_unavailable"), (None, "judged_not_applicable")],
    ids=["handoff_stalls", "no_stall"],
)


@_STALL_OR_NOT
async def test_a_stall_before_a_retry_whose_spellings_fail_is_the_outage_main_returns(
    wired, monkeypatch, delays, reason
):
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_GS10_MANUAL_HIT], q2_raises=True, delays=delays)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == reason, body.get("reason")
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 6
    assert (_HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]) == bool(delays)


async def test_a_stall_before_a_retry_refused_by_a_quota_outage_is_the_outage_main_returns(
    wired, monkeypatch
):
    # q1 and the handoff are reserved; the handoff's request never answers. The quota
    # store then fails for the retry's first spelling, and the second is refused on the
    # same denial: no spelling was answered. Without the stall this is #5849's case.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, _ = _stall(monkeypatch)
    reservations = 0
    posted: list[str] = []

    async def reserve(_identity):
        nonlocal reservations
        reservations += 1
        return "ok" if reservations <= 2 else "quota_unavailable"

    async def post(query, num):
        posted.append(query)
        if query == _HANDOFF:
            await asyncio.sleep(30)
        if "site:" in query:
            return [{"link": u, "title": t} for u, t in _AD_READ]
        return [{"link": u, "title": t} for u, t in [_GS10_MANUAL_HIT]]

    monkeypatch.setattr(search_mod, "_serper_search", _REAL_SERPER_SEARCH)
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "k")
    monkeypatch.setattr(search_mod, "_serper_post", post)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5, reserve)
    assert took < 2.5
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert posted[1] == _HANDOFF and _typed(posted) == [] and reservations == 3
    assert _HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]


@_STALL_OR_NOT
async def test_a_stall_before_a_retry_that_cannot_read_its_pdf_is_the_outage_main_returns(
    wired, monkeypatch, delays, reason
):
    # Both spellings answer with one new PDF, and the download fails, so it is unread.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_OTHER], delays=delays)
    assert _OTHER[0] not in TEXT  # the wired fetch returns nothing for it
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == reason, body.get("reason")
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 6
    assert (_HANDOFF_TIMEOUT_ROW in body["candidate_trail"]["queries"]) == bool(delays)


@_STALL_OR_NOT
async def test_a_stall_before_a_retry_that_raises_is_the_outage_main_returns(
    wired, monkeypatch, delays, reason
):
    # The retry's judge call raises; the caller logs it and today's answer stands.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q2_hits=[_OTHER], delays=delays)
    monkeypatch.setitem(TEXT, _OTHER[0], "DURApulse GS10 dimensional drawing")
    real, calls = judge.judge_candidates, []

    async def second_call_raises(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("judge broke")
        return await real(*args, **kwargs)

    monkeypatch.setattr(judge, "judge_candidates", second_call_raises)
    body, took = await asyncio.to_thread(_discovery, monkeypatch, 2.5)
    assert took < 2.5
    assert body["reason"] == reason, body.get("reason")
    assert _typed(sent) == _GS10_TYPED and len(calls) == 2 and len(router.calls) == 6


async def test_control_with_no_retry_to_follow_a_slow_handoff_keeps_its_whole_window(
    wired, monkeypatch
):
    # No site-scoped PDF, so round one ran the typed pass and no retry can follow. The
    # handoff answers at 0.9 s, inside today's 1.2 s cutoff, and the page is kept.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(
        monkeypatch, q1_hits=(), q2_hits=_AD_READ, handoff_hits=[_SUPPORT], delays={_HANDOFF: 0.9}
    )
    with search_mod.acquisition_trail() as trail:
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.5)),
            timeout=1.5,
        )
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert sent[-1] == _HANDOFF and len(router.calls) == 6
    assert trail.search_page_url == _SUPPORT[0]
    assert _HANDOFF_TIMEOUT_ROW not in trail.queries


async def test_after_the_screen_a_stalled_handoff_also_leaves_the_retry_its_window(
    wired, monkeypatch
):
    # The other place the retry follows the handoff: round one's web pages naming only
    # "GS10" (the staging pool) are probed and screened out first, then it stalls.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    monkeypatch.setattr(search_mod, "HEAD_TIMEOUT", 0.2)
    router, sent = _stall(
        monkeypatch,
        q1_hits=_AD_READ + _OTHER_MAKERS,
        q2_hits=[_GS10_MANUAL_HIT],
        delays={_HANDOFF: 30},
    )
    with search_mod.acquisition_trail() as trail:
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(2.5)),
            timeout=2.5,
        )
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert sorted(router.probed) == sorted(u for u, _ in _OTHER_MAKERS)
    assert sent[1:] == [_HANDOFF, *_GS10_TYPED]
    assert _HANDOFF_TIMEOUT_ROW in trail.queries


async def test_after_the_screen_a_stall_once_the_retry_cannot_start_is_the_outage_too(
    wired, monkeypatch
):
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    monkeypatch.setattr(search_mod, "HEAD_TIMEOUT", 0.2)
    router, sent = _stall(
        monkeypatch,
        q1_hits=_AD_READ + _OTHER_MAKERS,
        q2_hits=[_GS10_MANUAL_HIT],
        delays={_HANDOFF: 30},
    )
    with search_mod.acquisition_trail() as trail:
        with pytest.raises(TimeoutError, match="website handoff stalled"):
            await asyncio.wait_for(
                search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.0)),
                timeout=1.0,
            )
    assert sorted(router.probed) == sorted(u for u, _ in _OTHER_MAKERS)
    assert sent[1:] == [_HANDOFF] and _HANDOFF_TIMEOUT_ROW in trail.queries


async def test_control_a_finished_search_keeps_its_answer_when_the_handoff_stalls(
    wired, monkeypatch
):
    # Round one ran the typed pass itself, so no retry follows: the search finished,
    # and a stalled handoff leaves its judged rejection standing, as #5848 intends.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.3)
    router, sent = _stall(monkeypatch, q1_hits=(), q2_hits=_AD_READ, delays={_HANDOFF: 30})
    with search_mod.acquisition_trail() as trail:
        r = await asyncio.wait_for(
            search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(1.5)),
            timeout=1.5,
        )
    assert r is not None and r["reason"] == judge.REASON_JUDGED_REJECTED, r
    assert sent[-1] == _HANDOFF and _HANDOFF_TIMEOUT_ROW in trail.queries


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


async def test_a_page_round_one_can_offer_waits_for_the_retry(wired, monkeypatch):
    # F5: round one probes this page and can offer it for review. #5904: every site
    # PDF was read and rejected, so the typed-pass retry runs before that offer, and
    # its judged match wins. Round one's probe still runs first, and no website
    # handoff is sent, so nothing round one could offer is put at risk.
    page = (_EXTENSIONLESS, "AutomationDirect GS10 installation guide")
    router, sent = _stall(monkeypatch, q1_hits=_AD_READ + [page], q2_hits=[_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH and len(r["judged_rejected"]) == 6
    assert sent[1:] == _GS10_TYPED and router.probed == [_EXTENSIONLESS]


async def test_a_page_that_probes_as_a_pdf_waits_for_the_retry(wired, monkeypatch):
    # The same before main's other unvalidated return: a page that probes as a PDF.
    page = (_EXTENSIONLESS, "GS10 drive documentation")
    router, sent = _stall(
        monkeypatch,
        q1_hits=_AD_READ + [page],
        q2_hits=[_GS10_MANUAL_HIT],
        pdfs=frozenset({_EXTENSIONLESS}),
    )
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH and len(r["judged_rejected"]) == 6
    assert sent[1:] == _GS10_TYPED and router.probed == [_EXTENSIONLESS]


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


_OEM_FORM = "https://www.automationdirect.com/support/manual-request"


def _discovery_with_quota(
    monkeypatch,
    deny_on,
    reason,
    *,
    typed_hits=(),
    handoff_hits=(),
    oem_link=None,
    site_hits=_AD_READ,
):
    """POST the discovery endpoint through the real _serper_search: the reservation
    numbered ``deny_on`` (1 = q1, 2 = the handoff, 3 = the first typed query) is
    denied with ``reason``; every other one succeeds (``deny_on=None``: none is
    denied). The site query answers ``site_hits``, the typed pass ``typed_hits``,
    the handoff ``handoff_hits``, and the manufacturer's request link is
    ``oem_link``."""
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
            hits = site_hits
        elif "filetype:pdf" in query:
            hits = typed_hits
        else:
            hits = handoff_hits
        return [{"link": u, "title": t} for u, t in hits]

    async def link(make):
        return oem_link

    monkeypatch.setattr(search_mod, "_serper_search", _REAL_SERPER_SEARCH)
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "k")
    monkeypatch.setattr(search_mod, "_serper_post", post)
    monkeypatch.setattr(quota, "reserve_provider_query", reserve)
    monkeypatch.setattr(md, "oem_request_link", link)
    app = FastAPI()
    app.include_router(md.router)
    client = TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "AutomationDirect", "model": "GS10"}
    ).json()
    return body, reservations


@pytest.mark.parametrize("reason", ["quota_unavailable", "global_cap_unconfigured"])
def test_an_infrastructure_denial_on_the_retry_query_is_retryable(wired, monkeypatch, reason):
    # #5849: round one read every site PDF and judged none the manual, and the retry
    # that asks for it by name was denied by quota infrastructure. A judged rejection
    # is terminal (the Hub records no_manual_found and never searches again), so the
    # denial is reported as the outage it is, as one in round one is (#4168), and the
    # Hub searches again after its backoff.
    router, _ = _stall(monkeypatch)
    body, reservations = _discovery_with_quota(
        monkeypatch,
        deny_on=3,
        reason=reason,
        typed_hits=[_GS10_MANUAL_HIT],
        handoff_hits=[_SUPPORT],
        oem_link=_OEM_FORM,
    )
    assert reservations == 3 and len(router.calls) == 6
    assert body["reason"] == "search_unavailable", body.get("reason")
    assert body["found"] is False
    assert body["search_stats"]["quota_denied"] == reason
    assert body["search_stats"]["refused_queries"] == 2  # both typed variants
    # The support page, the manufacturer's request form and round one's reads stay.
    assert body["search_page_url"] == _SUPPORT[0]
    assert body["oem_request_url"] == _OEM_FORM
    trail = body["candidate_trail"]
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "refused", "hits": 0} in trail[
        "queries"
    ]
    judged = [r for r in trail["candidates"] if r["read"] == "judged"]
    assert len(judged) == len(_AD_READ) and not any(r["is_manual"] for r in judged)

    # With quota restored, the same lookup asks for the manual by name and finds it.
    body, _ = _discovery_with_quota(
        monkeypatch, deny_on=None, reason=reason, typed_hits=[_GS10_MANUAL_HIT]
    )
    assert body["found"] is True, body.get("reason")
    assert body["candidate"]["url"] == _GS10_MANUAL
    assert body["search_stats"]["quota_denied"] is None


@pytest.mark.parametrize("reason", ["user_cap", "tenant_cap", "global_cap"])
def test_a_cap_the_retry_query_meets_is_reported_as_the_limit(wired, monkeypatch, reason):
    # PRD R5 (#4168): a cap denial is never cached as a miss. The next-day retry then
    # runs the typed pass the cap stopped.
    router, _ = _stall(monkeypatch)
    body, _ = _discovery_with_quota(monkeypatch, deny_on=3, reason=reason)
    assert len(router.calls) == 6
    assert body["reason"] == "quota_exceeded", body.get("reason")
    assert body["search_stats"]["quota_denied"] == reason


def test_a_quota_denial_before_the_retry_still_reports_the_limit(wired, monkeypatch):
    # Control: the handoff's own denial is today's behaviour, unchanged.
    router, _ = _stall(monkeypatch)
    body, _ = _discovery_with_quota(monkeypatch, deny_on=2, reason="user_cap")
    assert body["reason"] == "quota_exceeded", body.get("reason")
    assert body["search_stats"]["quota_denied"] == "user_cap"


@pytest.mark.parametrize("enabled", ["1", "0"])
async def test_a_set_aside_copy_of_a_candidate_is_left_to_that_candidate(
    wired, monkeypatch, enabled
):
    # One URL, two snippets: the site-scoped one spells the whole number with
    # underscores (set aside), the typed one names only a prefix (a candidate the screen
    # refuses). The URL is the candidate's: the set-aside copy is not offered for it.
    url = "https://www.example-distributor.com/p/12345"
    aside, kept = (url, "6ES7214_1AG40_0XB0"), (url, "6ES7214 CPU module manual")
    assert search_mod._score(*aside, "Siemens", _SIMATIC) == 0
    assert search_mod._score(*kept, "Siemens", _SIMATIC) > 0
    assert search_mod._may_offer_unread({"url": url, "title": aside[1]}, "Siemens", _SIMATIC)
    assert not search_mod._may_offer_unread({"url": url, "title": kept[1]}, "Siemens", _SIMATIC)
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", enabled)
    _serve_by_pass(monkeypatch, site=[aside], typed=[kept])
    assert await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True) is None


# Round 2 review: the guards inside the reads and offers at main's endings.
_AD_PLAIN_PDF = (
    f"{_FILES}/variable-frequency-drive-user-manual.pdf",
    "Variable frequency drive user manual",
)


@pytest.mark.parametrize("is_manual", [True, False])
async def test_an_extra_pdf_judged_not_the_manual_is_neither_returned_nor_offered(
    wired, monkeypatch, is_manual
):
    # Main's cap lets it read one PDF, the first served, which cannot be fetched: it
    # ends with nothing judged. The extra PDF is read there. Judged the manual, it is
    # returned; judged not the manual, it is neither returned nor offered unread.
    for u, t in (_AD_PLAIN_PDF, _AD_EXTRA_PDF):
        assert not judge.relevant({"url": u, "title": t}, "AutomationDirect", "GS10")
    plain, extra = ({"url": u, "title": t} for u, t in (_AD_PLAIN_PDF, _AD_EXTRA_PDF))
    assert not search_mod._names_make(plain, "AutomationDirect")
    assert search_mod._names_make(extra, "AutomationDirect")
    assert _AD_PLAIN_PDF[0] not in TEXT
    monkeypatch.setattr(judge, "MAX_TOTAL", 1)
    _readable(monkeypatch, _AD_EXTRA_PDF[0])
    router = _Verdicts({_AD_EXTRA_PDF[0]} if is_manual else ())
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_AD_PLAIN_PDF, _AD_EXTRA_PDF])
    r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert router.read == [_AD_EXTRA_PDF[0]], router.read
    if is_manual:
        assert r is not None and r["url"] == _AD_EXTRA_PDF[0] and r["validated"] is True, r
    else:
        assert r is None, r


async def test_a_pdf_main_already_read_is_not_read_again(wired, monkeypatch):
    # No PDF passes the judge's own check, so main reads both PDFs naming GE and
    # rejects them. Its rejection ending does not read them a second time.
    a = (f"{_FILES}/ge-motors-catalog.pdf", "GE Motors catalog")
    b = (f"{_FILES}/ge-motors-drive-manual.pdf", "GE motors drive manual")
    for u, t in (a, b):
        c = {"url": u, "title": t}
        assert not judge.relevant(c, "GE", "M100") and search_mod._names_make(c, "GE")
    _readable(monkeypatch, a[0], b[0])
    router = _Verdicts(())
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [a, b])
    r = await search_mod.search_manual("GE", "M100")
    assert sorted(router.read) == sorted([a[0], b[0]]), router.read
    assert r is not None and judge.is_rejected(r) and r["validated"] is False, r


@pytest.mark.parametrize("spent", [True, False])
async def test_an_extra_pdf_is_read_only_in_the_time_the_deadline_leaves(wired, monkeypatch, spent):
    brochure = (f"{_FILES}/ge-m100-brochure.pdf", "GE M100 brochure")
    extra = (f"{_FILES}/ge-motors-drive-manual.pdf", "GE motors drive manual")
    assert judge.relevant({"url": brochure[0], "title": brochure[1]}, "GE", "M100")
    assert not judge.relevant({"url": extra[0], "title": extra[1]}, "GE", "M100")
    clock = [1000.0]
    fake_time = types.SimpleNamespace(monotonic=lambda: clock[0])
    monkeypatch.setattr(search_mod, "time", fake_time)
    monkeypatch.setattr(judge, "time", fake_time)
    _readable(monkeypatch, brochure[0], extra[0])

    class _Slow(_Verdicts):
        async def complete(self, messages, **kw):
            out = await super().complete(messages, **kw)
            if spent and self.read[-1] == brochure[0]:
                clock[0] += 30.0  # main's own read uses up what the deadline left
            return out

    router = _Slow({extra[0]})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [brochure, extra])
    deadline = 1000.0 + judge.RETURN_RESERVE_S + 10.0
    r = await search_mod.search_manual("GE", "M100", deadline_at=deadline)
    if spent:
        assert router.read == [brochure[0]], router.read
        assert r is not None and r["url"] == brochure[0] and judge.is_rejected(r), r
    else:
        assert router.read == [brochure[0], extra[0]], router.read
        assert r is not None and r["url"] == extra[0] and r["validated"] is True, r


async def test_the_trail_lists_an_extra_read_after_mains_own(wired, monkeypatch):
    _readable(monkeypatch, _AD_BROCHURE[0], _AD_EXTRA_PDF[0])
    monkeypatch.setattr(judge, "_router", _Verdicts({_AD_EXTRA_PDF[0]}))
    _serve(monkeypatch, [_AD_BROCHURE, _AD_EXTRA_PDF])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10")
    assert r is not None and r["url"] == _AD_EXTRA_PDF[0] and r["validated"] is True, r
    rows = {row["url"]: row for row in trail.to_dict(r["url"])["candidates"]}
    own, won = rows[_AD_BROCHURE[0]], rows[_AD_EXTRA_PDF[0]]
    assert own["queue_pos"] == 0 and own["read"] == "judged", own
    assert won["queue_pos"] == 1 and won["not_queued"] is None, won
    assert won["read"] == "judged" and won["selected"] is True, won


async def test_a_pdf_main_could_not_fetch_is_not_fetched_again(wired, monkeypatch):
    # No PDF passes the judge's own check, so main queues every PDF, this one too, and
    # its fetch fails: main ends with nothing judged. The extra reads at that ending
    # skip it, so it is fetched once and listed once on the trail.
    pdf = (f"{_FILES}/ge-motors-drive-manual.pdf", "GE motors drive manual")
    c = {"url": pdf[0], "title": pdf[1]}
    assert not judge.relevant(c, "GE", "M100") and search_mod._names_make(c, "GE")
    fetched: list[str] = []

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        fetched.append(url)
        return None

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    _serve(monkeypatch, [pdf])
    with search_mod.acquisition_trail() as trail:
        await search_mod.search_manual("GE", "M100")
    assert fetched == [pdf[0]], fetched
    assert list(trail.judge.get("queue") or []).count(pdf[0]) == 1, trail.judge
    row = {r["url"]: r for r in trail.to_dict(None)["candidates"]}[pdf[0]]
    assert row["queue_pos"] == 0, row


# #5895 (#5890 Codex F2): main ends by offering an unread candidate while a PDF naming
# the whole part number in a spelling the judge's relevance check misses sits unread.
# On a part-number lookup that PDF is read first, after main's own reads, in the time
# the deadline leaves. A judged match wins; otherwise main's offer stands unchanged.
_SIEMENS_PAGE = (
    "https://mall.industry.siemens.com/mall/en/WW/Catalog/Product/6ES7214-1AG40-0XB0",
    "6ES7214-1AG40-0XB0 SIMATIC S7-1200 CPU 1214C",
)
_SIEMENS_SHEET = (
    "https://cache.industry.siemens.com/dl/files/6ES7214-1AG40-0XB0-data-sheet.pdf",
    "6ES7214-1AG40-0XB0 data sheet",
)
_SIEMENS_EXACT = (_EXACT_PDF, "6ES7214_1AG40_0XB0")


def _offer_preconditions():
    page = {"url": _SIEMENS_PAGE[0], "title": _SIEMENS_PAGE[1]}
    assert judge.relevant(page, "Siemens", _SIMATIC)
    assert search_mod._may_offer_unread(page, "Siemens", _SIMATIC)
    assert not search_mod._is_direct_pdf(page["url"])
    exact = {"url": _SIEMENS_EXACT[0], "title": _SIEMENS_EXACT[1]}
    assert not judge.relevant(exact, "Siemens", _SIMATIC)
    assert search_mod._names_part_number(exact, _SIMATIC)


@pytest.mark.parametrize("is_manual", [True, False])
async def test_an_exact_part_pdf_is_read_before_mains_unread_page_offer(
    wired, monkeypatch, is_manual
):
    _offer_preconditions()
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF} if is_manual else ())
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [_BROCHURE_PDF, _EXACT_PDF], router.read
    # The exact PDF's read is on the trail either way, after main's own. Its verdict
    # is recorded there; a rejection is not added to the offer's `judged_rejected`,
    # as at #5890's miss endings. The trail's stop is the last round's.
    assert r is not None and [x["url"] for x in r["judged_rejected"]] == [_BROCHURE_PDF], r
    rows = {row["url"]: row for row in trail.to_dict(r["url"])["candidates"]}
    assert rows[_BROCHURE_PDF]["queue_pos"] == 0, rows[_BROCHURE_PDF]
    read = rows[_EXACT_PDF]
    assert read["queue_pos"] == 1 and read["not_queued"] is None, read
    assert read["read"] == "judged" and read["selected"] is is_manual, read
    assert trail.judge.get("stop") == ("ideal_match" if is_manual else "queue_exhausted")
    if is_manual:
        assert r["url"] == _EXACT_PDF and r["validated"] is True, r
    else:
        assert r["url"] == _SIEMENS_PAGE[0], r
        assert r["validated"] is False and r["reason"] == judge.REASON_JUDGE_UNAVAILABLE, r


@pytest.mark.parametrize("is_manual", [True, False])
async def test_an_exact_part_pdf_is_read_before_mains_unread_pdf_offer(
    wired, monkeypatch, is_manual
):
    # The OEM data sheet is HEAD-validated as a PDF but cannot be fetched for the
    # judge, so main offers it unread from its HEAD-probe loop.
    sheet = {"url": _SIEMENS_SHEET[0], "title": _SIEMENS_SHEET[1]}
    assert judge.relevant(sheet, "Siemens", _SIMATIC) and sheet["url"] not in TEXT
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF} if is_manual else ())
    monkeypatch.setattr(judge, "_router", router)
    _serve(
        monkeypatch,
        [_SIEMENS_SHEET, _SIEMENS_BROCHURE, _SIEMENS_EXACT],
        pdfs={_SIEMENS_SHEET[0]},
    )
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [_BROCHURE_PDF, _EXACT_PDF], router.read
    if is_manual:
        assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r
    else:
        assert r is not None and r["url"] == _SIEMENS_SHEET[0], r
        assert r["validated"] is False and r["reason"] == judge.REASON_JUDGE_UNAVAILABLE, r


@pytest.mark.parametrize("spent", [True, False])
async def test_an_exact_part_pdf_before_mains_offer_is_read_only_in_the_time_left(
    wired, monkeypatch, spent
):
    _offer_preconditions()
    clock = [1000.0]
    fake_time = types.SimpleNamespace(monotonic=lambda: clock[0])
    monkeypatch.setattr(search_mod, "time", fake_time)
    monkeypatch.setattr(judge, "time", fake_time)
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF)

    class _Slow(_Verdicts):
        async def complete(self, messages, **kw):
            out = await super().complete(messages, **kw)
            if spent and self.read[-1] == _BROCHURE_PDF:
                clock[0] += 30.0  # main's own read uses up what the deadline left
            return out

    router = _Slow({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT])
    deadline = 1000.0 + judge.RETURN_RESERVE_S + search_mod.HEAD_TIMEOUT + 10.0
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual(
            "Siemens", _SIMATIC, deadline_at=deadline, exact_part_number=True
        )
    if spent:
        assert router.read == [_BROCHURE_PDF], router.read
        assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r
        # The trail says the deadline, not an exhausted queue, left it unread.
        row = {x["url"]: x for x in trail.to_dict(r["url"])["candidates"]}[_EXACT_PDF]
        assert row["queue_pos"] == 1 and row["read"] == "unread", row
        assert trail.judge.get("stop") == "search_deadline", trail.judge
    else:
        assert router.read == [_BROCHURE_PDF, _EXACT_PDF], router.read
        assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r


async def test_control_on_a_model_lookup_the_exact_pdf_is_not_read_before_mains_offer(
    wired, monkeypatch
):
    _offer_preconditions()
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT])
    r = await search_mod.search_manual("Siemens", _SIMATIC)
    assert router.read == [_BROCHURE_PDF], router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r


async def test_control_with_the_judge_off_nothing_is_read_before_mains_offer(wired, monkeypatch):
    _offer_preconditions()
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    assert not judge.judge_enabled()
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT])
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [], router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r


_AD_PART = "GS10-20P5"
_AD_PART_PAGE = (
    "https://www.automationdirect.com/adc/shopping/catalog/drives/gs10-20p5",
    "GS10-20P5 DURApulse GS10 AC drive",
)
_AD_PART_BROCHURE = (f"{_FILES}/gs10-20p5-brochure.pdf", "GS10-20P5 brochure")


async def test_control_a_pdf_naming_only_the_make_is_not_read_before_mains_offer(
    wired, monkeypatch
):
    # Only a PDF naming the whole part number is read before main's offer. A PDF that
    # names just the make, in a joining the relevance check misses, waits for main's
    # miss endings, as before.
    page = {"url": _AD_PART_PAGE[0], "title": _AD_PART_PAGE[1]}
    assert judge.relevant(page, "AutomationDirect", _AD_PART)
    assert search_mod._may_offer_unread(page, "AutomationDirect", _AD_PART)
    extra = {"url": _AD_EXTRA_PDF[0], "title": _AD_EXTRA_PDF[1]}
    assert not judge.relevant(extra, "AutomationDirect", _AD_PART)
    assert search_mod._names_make(extra, "AutomationDirect")
    assert not search_mod._names_part_number(extra, _AD_PART)
    _readable(monkeypatch, _AD_PART_BROCHURE[0], _AD_EXTRA_PDF[0])
    router = _Verdicts({_AD_EXTRA_PDF[0]})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_AD_PART_PAGE, _AD_PART_BROCHURE, _AD_EXTRA_PDF])
    r = await search_mod.search_manual("AutomationDirect", _AD_PART, exact_part_number=True)
    assert router.read == [_AD_PART_BROCHURE[0]], router.read
    assert r is not None and r["url"] == _AD_PART_PAGE[0] and r["validated"] is False, r


async def test_an_exact_part_pdf_main_already_read_is_not_read_again_before_its_offer(
    wired, monkeypatch
):
    # No PDF passes the judge's own check, so main queues every PDF, the exact one too,
    # and rejects it. Its unread page offer does not read that PDF a second time.
    _offer_preconditions()
    _readable(monkeypatch, _EXACT_PDF)
    router = _Verdicts(())
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_EXACT])
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [_EXACT_PDF], router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r
    assert [x["url"] for x in r["judged_rejected"]] == [_EXACT_PDF], r


# #5899 Codex F1: a fragment form of a PDF the judge read and rejected, under the same
# title, is the same document (the server never sees a fragment). It is not read again
# before main's offer, as the typed-pass retry already refuses (#5850). The fragment
# here names the make, so main's own round reads and rejects that form.
_SIEMENS_EXACT_FRAG = (_EXACT_PDF + "#siemens", _SIEMENS_EXACT[1])


def _fragment_preconditions(plain_title: str):
    frag = {"url": _SIEMENS_EXACT_FRAG[0], "title": _SIEMENS_EXACT_FRAG[1]}
    plain = {"url": _EXACT_PDF, "title": plain_title}
    assert judge.relevant(frag, "Siemens", _SIMATIC)
    assert not judge.relevant(plain, "Siemens", _SIMATIC)
    assert search_mod._names_part_number(plain, _SIMATIC)
    assert search_mod._document_key(frag["url"]) == search_mod._document_key(plain["url"])


async def test_a_fragment_form_of_a_rejected_pdf_is_not_read_again_before_mains_offer(
    wired, monkeypatch
):
    _offer_preconditions()
    _fragment_preconditions(_SIEMENS_EXACT[1])
    _readable(monkeypatch, _SIEMENS_EXACT_FRAG[0], _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF})  # a second read would be accepted
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_EXACT_FRAG, _SIEMENS_EXACT])
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [_SIEMENS_EXACT_FRAG[0]], router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r
    assert [x["url"] for x in r["judged_rejected"]] == [_SIEMENS_EXACT_FRAG[0]], r


async def test_control_a_fragment_form_under_another_title_is_read_before_mains_offer(
    wired, monkeypatch
):
    # A different title tells the judge something new, so that form stays readable.
    other = (_EXACT_PDF, "6ES7214_1AG40_0XB0 system manual")
    _offer_preconditions()
    _fragment_preconditions(other[1])
    _readable(monkeypatch, _SIEMENS_EXACT_FRAG[0], _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_EXACT_FRAG, other])
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert router.read == [_SIEMENS_EXACT_FRAG[0], _EXACT_PDF], router.read
    assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r


# #5899 Codex F2: the read before main's offer is folded into the trail without
# repeating a URL an earlier round queued, and a PDF it leaves out carries its reason.
async def test_the_trail_keeps_a_pdf_main_queued_at_its_first_position(wired, monkeypatch):
    # No PDF passes the judge's own check, so main queues the exact PDF itself, but its
    # judge has no time left: the PDF is queued and unread, and queued again before the
    # offer. The trail lists it once, at main's position.
    _offer_preconditions()
    search_clock, judge_clock = [1000.0], [5000.0]  # the judge's own clock is spent
    monkeypatch.setattr(
        search_mod, "time", types.SimpleNamespace(monotonic=lambda: search_clock[0])
    )
    monkeypatch.setattr(judge, "time", types.SimpleNamespace(monotonic=lambda: judge_clock[0]))
    _readable(monkeypatch, _EXACT_PDF)
    router = _Verdicts({_EXACT_PDF})
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_EXACT])
    deadline = 1000.0 + judge.RETURN_RESERVE_S + search_mod.HEAD_TIMEOUT + 10.0
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual(
            "Siemens", _SIMATIC, deadline_at=deadline, exact_part_number=True
        )
    assert router.read == [], router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r
    assert trail.judge.get("queue") == [_EXACT_PDF], trail.judge
    row = {x["url"]: x for x in trail.to_dict(r["url"])["candidates"]}[_EXACT_PDF]
    assert row["queue_pos"] == 0 and row["read"] == "unread", row


async def test_the_trail_gives_a_pdf_over_the_extra_cap_that_rounds_reason(wired, monkeypatch):
    # One read per round. Main reads the brochure; two exact-part PDFs qualify for the
    # read before main's offer, which reads one and leaves the other over its cap.
    second = (f"{_FILES}/6es7214_1ag40_0xb0-manual.pdf", "6ES7214_1AG40_0XB0 manual")
    c = {"url": second[0], "title": second[1]}
    assert not judge.relevant(c, "Siemens", _SIMATIC)
    assert search_mod._names_part_number(c, _SIMATIC)
    _offer_preconditions()
    monkeypatch.setattr(judge, "MAX_TOTAL", 1)
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF, second[0])
    router = _Verdicts(())
    monkeypatch.setattr(judge, "_router", router)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT, second])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert len(router.read) == 2 and router.read[0] == _BROCHURE_PDF, router.read
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r
    rows = {x["url"]: x for x in trail.to_dict(r["url"])["candidates"]}
    (read_one,) = (u for u in (_EXACT_PDF, second[0]) if u in router.read)
    left = second[0] if read_one == _EXACT_PDF else _EXACT_PDF
    assert rows[read_one]["queue_pos"] == 1 and rows[read_one]["read"] == "judged", rows[read_one]
    assert rows[left]["queue_pos"] is None, rows[left]
    assert rows[left]["not_queued"] == "over_max_total", rows[left]


async def test_an_exact_part_pdf_main_could_not_fetch_is_not_fetched_again_before_its_offer(
    wired, monkeypatch
):
    # No PDF passes the judge's own check, so main queues the exact PDF itself, and its
    # fetch fails: it is unread but not rejected, so only its read state keeps it out
    # of the read before main's offer.
    _offer_preconditions()
    fetched: list[str] = []

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        fetched.append(url)
        return None

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    _serve(monkeypatch, [_SIEMENS_PAGE, _SIEMENS_EXACT])
    r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert fetched == [_EXACT_PDF], fetched
    assert r is not None and r["url"] == _SIEMENS_PAGE[0] and r["validated"] is False, r


# #5904: round one read every site PDF and judged none the manual, but an unread page
# naming the make survived the make screen, so main offered it, and the typed-pass
# retry, which finds the manual, never ran. The staging walk of 2026-11-24 met exactly
# this: the site query also returned a manualslib page titled with the make.
_AD_MANUALSLIB = (
    "https://www.manualslib.com/products/Automationdirect-Com-Gs13n-40p5-14522200.html",
    "Automationdirect.com GS13N-40P5 Manuals",
)
_AD_WALK_POOL = _AD_READ + [_AD_MANUALSLIB]


def _make_page_preconditions():
    """A web page the judge's relevance check keeps and the make screen lets through:
    main offers it unread."""
    c = {"url": _AD_MANUALSLIB[0], "title": _AD_MANUALSLIB[1]}
    assert not search_mod._is_direct_pdf(c["url"])
    assert judge.relevant(c, "AutomationDirect", "GS10")
    assert search_mod._may_offer_unread(c, "AutomationDirect")


async def test_an_unread_make_page_waits_for_the_retry_that_finds_the_manual(wired, monkeypatch):
    _make_page_preconditions()
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[_GS10_MANUAL_HIT])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
        row = trail.to_dict(r["url"] if r else None)
    assert r is not None and r["url"] == _GS10_MANUAL and r["validated"] is True, r
    assert r["reason"] == judge.REASON_JUDGED_MATCH and len(r["judged_rejected"]) == 6
    # Round one's probe of the page first, then only the typed queries: no handoff.
    assert router.probed == [_AD_MANUALSLIB[0]]
    assert sent[1:] == _GS10_TYPED and len(router.calls) == 7
    assert [q["pass"] for q in row["queries"]] == ["q1", "q2", "q2"]
    pos = {c["url"]: c["queue_pos"] for c in row["candidates"]}
    assert sorted(pos[search_mod.trail_url(u)] for u, _ in _AD_READ) == list(range(6))
    assert pos[search_mod.trail_url(_GS10_MANUAL)] == 6


async def test_control_with_no_manual_from_the_retry_the_page_is_offered_as_before(
    wired, monkeypatch
):
    # The retry reads one more drawing and rejects it: main's offer stands, with round
    # one's rejections, as main returns it. The retry's read is on the trail only.
    _make_page_preconditions()
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[_OTHER])
    monkeypatch.setitem(TEXT, _OTHER[0], _DRAWING_TEXT)
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
        row = trail.to_dict(r["url"] if r else None)
    assert r is not None and r["url"] == _AD_MANUALSLIB[0] and r["validated"] is False, r
    assert r["reason"] == judge.REASON_JUDGE_UNAVAILABLE
    assert sorted(x["url"] for x in r["judged_rejected"]) == sorted(u for u, _ in _AD_READ)
    assert sent[1:] == _GS10_TYPED and len(router.calls) == 7
    by_url = {c["url"]: c for c in row["candidates"]}
    assert by_url[search_mod.trail_url(_OTHER[0])]["read"] == "judged"


async def test_a_retry_pdf_it_could_not_read_is_never_offered_or_probed(wired, monkeypatch):
    # #5844 F5, F6: nothing the retry adds is probed or offered unread. Here the retry
    # adds a PDF it cannot fetch, and the page from round one is what is offered.
    unread = (f"{_AD}/manuals/gs10m/gs10m_ch1.pdf", "DURApulse GS10 user manual chapter 1")
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[unread])
    with search_mod.acquisition_trail() as trail:
        r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
        row = trail.to_dict(r["url"] if r else None)
    assert r is not None and r["url"] == _AD_MANUALSLIB[0] and r["validated"] is False, r
    assert router.probed == [_AD_MANUALSLIB[0]] and _typed(sent) == _GS10_TYPED
    by_url = {c["url"]: c for c in row["candidates"]}
    assert by_url[search_mod.trail_url(unread[0])]["read"] == "unfetched"


async def test_control_an_unread_site_pdf_sends_no_typed_query_before_the_offer(wired, monkeypatch):
    # A queued site PDF went unread, so it may still be the manual: no retry, as before.
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[_GS10_MANUAL_HIT])
    monkeypatch.delitem(TEXT, _AD_READ[0][0])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["validated"] is False, r
    assert _typed(sent) == [] and len(router.calls) == 5


async def test_control_with_the_judge_off_no_typed_query_is_sent_before_the_offer(
    wired, monkeypatch
):
    monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["validated"] is False, r
    assert _typed(sent) == [] and router.calls == []


async def test_control_a_typed_pass_round_one_ran_is_not_run_again_before_the_offer(
    wired, monkeypatch
):
    # The site query found only the page, so the typed pass ran in round one, as before;
    # it found a drawing, judged not the manual. The page is offered, and the typed
    # queries were each sent once.
    router, sent = _stall(monkeypatch, q1_hits=[_AD_MANUALSLIB], q2_hits=[_OTHER])
    monkeypatch.setitem(TEXT, _OTHER[0], _DRAWING_TEXT)
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(60))
    assert r is not None and r["url"] == _AD_MANUALSLIB[0] and r["validated"] is False, r
    assert _typed(sent) == _GS10_TYPED and len(router.calls) == 1


async def test_a_deadline_too_short_for_the_retry_still_offers_the_page(wired, monkeypatch):
    # One query plus one judge batch plus the return reserve does not fit in 20 s: no
    # typed query is sent, and round one's offer stands.
    router, sent = _stall(monkeypatch, q1_hits=_AD_WALK_POOL, q2_hits=[_GS10_MANUAL_HIT])
    r = await search_mod.search_manual("AutomationDirect", "GS10", deadline_at=_deadline(20))
    assert _typed(sent) == [] and len(router.calls) == 6
    assert r is not None and r["url"] == _AD_MANUALSLIB[0] and r["validated"] is False, r
    assert r["reason"] == judge.REASON_JUDGE_UNAVAILABLE


def _discovery_endpoint(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import ask_api.manual_discovery as md
    import shared.manual_search.quota as quota

    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "k")

    async def no_link(make):
        return None

    async def ok(_identity):
        return "ok"

    monkeypatch.setattr(md, "oem_request_link", no_link)
    monkeypatch.setattr(quota, "reserve_provider_query", ok)
    app = FastAPI()
    app.include_router(md.router)
    return TestClient(app, headers={"X-Mira-Key": "k", "X-Mira-Tenant": "t", "X-Mira-User": "u"})


_PROBED_PAGE = (_EXTENSIONLESS, "GS10 drive documentation")


@pytest.mark.parametrize(
    "page,pdfs",
    [(_AD_MANUALSLIB, frozenset()), (_PROBED_PAGE, frozenset({_EXTENSIONLESS}))],
    ids=["unread_offer", "probe_offer"],
)
def test_a_stalled_retry_query_before_an_offer_still_returns_the_offer(
    wired, monkeypatch, page, pdfs
):
    # #5844 F5's guarantee, kept: the retry must never cost round one's offer. Its
    # typed query never answers; the endpoint returns the offer before its own timeout.
    _scale(monkeypatch, search_timeout=0.5, batch=0.3, reserve=0.1)
    monkeypatch.setattr(search_mod, "HEAD_TIMEOUT", 0.05)
    monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", "1.5")
    router, sent = _stall(
        monkeypatch, q1_hits=_AD_READ + [page], delays={_GS10_TYPED[0]: 30}, pdfs=pdfs
    )
    client = _discovery_endpoint(monkeypatch)
    started = search_mod.time.monotonic()
    body = client.post(
        "/manual-discovery/search", json={"manufacturer": "AutomationDirect", "model": "GS10"}
    ).json()
    assert search_mod.time.monotonic() - started < 1.5
    assert body["found"] is True and body["validated"] is False, body.get("reason")
    assert body["candidate"]["url"] == page[0]
    assert body["reason"] == judge.REASON_JUDGE_UNAVAILABLE
    assert router.probed == [page[0]]
    assert _typed(sent) == [_GS10_TYPED[0]] and len(router.calls) == 6
    rows = body["candidate_trail"]["queries"]
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "timeout"} in rows


@pytest.mark.parametrize("reason", ["quota_unavailable", "user_cap"])
def test_a_quota_denial_on_the_retry_before_an_offer_keeps_the_offer(wired, monkeypatch, reason):
    # #5849 reports a denial on the retry as retryable only where the search would end
    # with no candidate or the judged rejection. Before an offer, the offer stands.
    router, _ = _stall(monkeypatch)
    body, reservations = _discovery_with_quota(
        monkeypatch,
        deny_on=2,  # no handoff before an offer: the first typed query is the second
        reason=reason,
        typed_hits=[_GS10_MANUAL_HIT],
        site_hits=_AD_WALK_POOL,
    )
    # The second spelling is refused without a reservation, as in #5849.
    assert reservations == 2 and len(router.calls) == 6
    assert body["found"] is True and body["validated"] is False, body.get("reason")
    assert body["candidate"]["url"] == _AD_MANUALSLIB[0]
    assert body["reason"] == judge.REASON_JUDGE_UNAVAILABLE
    assert body["search_stats"]["quota_denied"] == reason
    assert body["search_stats"]["refused_queries"] == 2
    queries = body["candidate_trail"]["queries"]
    assert [q["pass"] for q in queries] == ["q1", "q2", "q2"], queries
    assert {"pass": "q2", "query": _GS10_TYPED[0], "result": "refused", "hits": 0} in queries


async def test_on_a_part_number_lookup_the_exact_part_pdf_is_read_before_the_retry(
    wired, monkeypatch
):
    # The exact-part read (#5895) needs no query, so it goes first: a match there sends
    # no typed query, although the retry would also find a manual.
    _offer_preconditions()
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF, _SIMATIC_MANUAL)
    router = _Verdicts({_EXACT_PDF, _SIMATIC_MANUAL})
    monkeypatch.setattr(judge, "_router", router)
    sent = _serve_by_pass(
        monkeypatch,
        site=[_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT],
        typed=[_SIEMENS_MANUAL],
    )
    with search_mod.acquisition_trail():
        r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert r is not None and r["url"] == _EXACT_PDF and r["validated"] is True, r
    assert router.read == [_BROCHURE_PDF, _EXACT_PDF] and not _retry_ran(sent), sent


async def test_on_a_part_number_lookup_the_retry_follows_a_rejected_exact_part_pdf(
    wired, monkeypatch
):
    _offer_preconditions()
    _readable(monkeypatch, _BROCHURE_PDF, _EXACT_PDF, _SIMATIC_MANUAL)
    router = _Verdicts({_SIMATIC_MANUAL})
    monkeypatch.setattr(judge, "_router", router)
    sent = _serve_by_pass(
        monkeypatch,
        site=[_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT],
        typed=[_SIEMENS_MANUAL],
    )
    with search_mod.acquisition_trail():
        r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert r is not None and r["url"] == _SIMATIC_MANUAL and r["validated"] is True, r
    assert router.read == [_BROCHURE_PDF, _EXACT_PDF, _SIMATIC_MANUAL] and _retry_ran(sent), sent


@pytest.mark.parametrize("with_trail", [True, False], ids=["trail", "no_trail"])
async def test_an_exact_part_pdf_it_could_not_fetch_does_not_decide_the_retry(
    wired, monkeypatch, with_trail
):
    # The retry runs on round one's verdict, as #5822 defines it. The exact-part read
    # before the offer joins the trail's judge record, and its PDF could not be
    # fetched; the answer must not depend on whether the caller opened a trail.
    _offer_preconditions()
    _readable(monkeypatch, _BROCHURE_PDF, _SIMATIC_MANUAL)  # not the exact PDF
    router = _Verdicts({_SIMATIC_MANUAL})
    monkeypatch.setattr(judge, "_router", router)
    sent = _serve_by_pass(
        monkeypatch,
        site=[_SIEMENS_PAGE, _SIEMENS_BROCHURE, _SIEMENS_EXACT],
        typed=[_SIEMENS_MANUAL],
    )
    if with_trail:
        with search_mod.acquisition_trail():
            r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    else:
        r = await search_mod.search_manual("Siemens", _SIMATIC, exact_part_number=True)
    assert r is not None and r["url"] == _SIMATIC_MANUAL and r["validated"] is True, r
    assert router.read == [_BROCHURE_PDF, _SIMATIC_MANUAL] and _retry_ran(sent), sent
