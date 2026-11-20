"""The judge reads the page that names the model (shared/manual_search/judge.py).

Regression case (2026-11-20, staging): for "AutomationDirect GS11N-20P2" the
official 454-page GS10 user manual
(cdn.automationdirect.com/static/manuals/gs10m/gs10usermanual.pdf, 33 MB) was
search rank 1 but never read: it exceeded the 25 MB judge byte cap, and its
first 8 pages (cover, warnings, contents) never name GS11N-20P2, which first
appears on page 26. A one-chapter excerpt (gs10m/ch1.pdf) won instead and the
Hub held it as a partial manual.

These tests use a small, hand-built PDF (no PDF writer is a dependency) whose
first pages never name the model and whose later page does.

Run: cd mira-bots && python -m pytest tests/test_manual_search_model_page.py -q
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import re
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import shared.manual_search.judge as judge  # noqa: E402

MODEL = "GS11N-20P2"


def _pdf(pages: list[str]) -> bytes:
    """A minimal, valid multi-page PDF with one Helvetica text line per page."""
    objs: list[bytes] = []
    n = len(pages)
    font_id = 3 + 2 * n
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    for i, text in enumerate(pages):
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({safe}) Tj ET".encode()
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + 2 * i} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode()
        )
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for k, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{k} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


COVER = "DURApulse GS10 AC Drive User Manual"
WARN = "WARNING Read this manual before installation"
CONTENTS = "Table of Contents Chapter 1 Getting Started Chapter 6 Maintenance and Troubleshooting"
SPEC = f"230V Class 1-Phase Model-Specific Specifications {MODEL} 0.25 HP"
MANUAL = _pdf([COVER, WARN, CONTENTS, "Chapter 1 Getting Started", SPEC])


def test_model_page_finds_the_first_later_page_that_names_the_exact_model():
    window = judge._model_page_sync(MANUAL, MODEL, max_pages=80, max_chars=2500)
    assert window.startswith(f"[Page 5 of this PDF, the first page that names {MODEL}]")
    assert MODEL in window


@pytest.mark.parametrize(
    "model",
    [
        "GS11N-20P3",  # a look-alike catalog number
        "S11N-20P2",  # a fragment of the real token
        "GS11N-20P25",  # a longer token that merely contains it
    ],
)
def test_model_page_matches_only_the_exact_whole_token(model):
    assert judge._model_page_sync(MANUAL, model, max_pages=80, max_chars=2500) == ""


def test_no_family_prefix_is_derived_a_page_naming_only_the_stem_is_not_the_model_page():
    stem_only = _pdf([COVER, WARN, "GS11N series drives, 230V class"])
    assert judge._model_page_sync(stem_only, MODEL, max_pages=80, max_chars=2500) == ""


def test_model_page_respects_the_page_cap():
    assert judge._model_page_sync(MANUAL, MODEL, max_pages=4, max_chars=2500) == ""


def test_too_short_a_model_is_never_scanned():
    assert judge.model_token_re("GS1") is None
    assert asyncio.run(judge.model_page_text(MANUAL, "G-1")) == ""


def test_model_page_text_runs_in_the_child_and_returns_the_window():
    window = asyncio.run(judge.model_page_text(MANUAL, MODEL))
    assert f"names {MODEL}]" in window and MODEL in window


def test_model_page_text_degrades_on_garbage_bytes():
    assert asyncio.run(judge.model_page_text(b"%PDF-1.4 not really a pdf", MODEL)) == ""


class _Router:
    enabled = True

    def __init__(self):
        self.calls: list[str] = []

    async def complete(self, messages, max_tokens=1024, session_id="x", sanitize=True):
        user = messages[-1]["content"]
        self.calls.append(user)
        named = re.search(r"(?<![A-Za-z0-9])GS11N-20P2(?![A-Za-z0-9])", user.split("<<<", 1)[-1])
        v = {
            "is_manual_for_model": bool(named),
            "doc_type": "user_manual",
            "scope": "complete",
            "confidence": 0.9 if named else 0.2,
            "lists_fault_codes": True,
            "language": "en",
            "evidence_quote": SPEC if named else "",
            "reason": "The GS10 manual lists GS11N-20P2." if named else "The model is not named.",
        }
        return json.dumps(v), {"provider": "fake"}


@pytest.fixture
def first_pages_only(monkeypatch):
    """Fetch returns the hand-built manual; extract_text returns only the first
    pages, which never name the model — exactly the staging shape."""
    router = _Router()
    monkeypatch.setattr(judge, "_router", router)

    async def fetch(url, max_bytes=judge.MAX_BYTES):
        return MANUAL

    async def extract(data, max_pages=8, max_chars=7000):
        return "\n".join([COVER, WARN, CONTENTS])

    monkeypatch.setattr(judge, "fetch_pdf_bytes", fetch)
    monkeypatch.setattr(judge, "extract_text", extract)
    return router


def _cand():
    return {
        "url": "https://cdn.automationdirect.com/static/manuals/gs10m/gs10usermanual.pdf",
        "title": "DURApulse GS10 AC Drive User Manual",
        "host": "cdn.automationdirect.com",
        "score": 160,
        "is_direct_pdf": True,
    }


def test_the_judge_reads_the_model_page_and_accepts_the_whole_manual(first_pages_only):
    cand = asyncio.run(judge._judge_one("AutomationDirect", MODEL, _cand()))
    j = cand["judge"]
    assert j["status"] == "judged" and j["is_manual"] is True
    assert j["model_page"] is True
    assert j["scope"] == "complete"
    assert "[Page 5 of this PDF" in first_pages_only.calls[-1]


def test_control_a_look_alike_model_is_not_given_a_page_and_is_not_matched(first_pages_only):
    cand = asyncio.run(judge._judge_one("AutomationDirect", "GS11N-20P3", _cand()))
    j = cand["judge"]
    assert j["status"] == "judged" and j["is_manual"] is False
    assert j["model_page"] is False
    assert "[Page" not in first_pages_only.calls[-1]


def test_control_first_pages_that_already_name_the_model_skip_the_scan(
    monkeypatch, first_pages_only
):
    async def extract(data, max_pages=8, max_chars=7000):
        return SPEC

    async def no_scan(data, model):  # pragma: no cover - must not be called
        raise AssertionError("scanned although the first pages name the model")

    monkeypatch.setattr(judge, "extract_text", extract)
    monkeypatch.setattr(judge, "model_page_text", no_scan)
    cand = asyncio.run(judge._judge_one("AutomationDirect", MODEL, _cand()))
    assert cand["judge"]["is_manual"] is True and cand["judge"]["model_page"] is False


def test_the_byte_cap_admits_the_33_mb_official_manual_and_matches_the_hub_cap():
    assert judge.MAX_BYTES >= 33_039_142
    hub = (
        pathlib.Path(__file__).resolve().parents[2]
        / "mira-hub/src/capabilities/manual-acquisition.ts"
    ).read_text()
    m = re.search(r"MAX_MANUAL_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024", hub)
    assert m, "the Hub download cap moved; keep the judge cap equal to it"
    assert judge.MAX_BYTES == int(m.group(1)) * 1024 * 1024
