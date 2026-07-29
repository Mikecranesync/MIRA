"""xref_extractor_v1 — synthetic per-syntax + resolution tests (PR-C/D).

All identifiers fictional (sheets 91-95, K9xx devices). Tokens are injected;
no OCR runs in CI (the OCR adapter's unavailability path is itself tested).
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import xref_extractor as x  # noqa: E402


def _tok(text, x0=100, y0=100, x1=260, y1=130, line=(0, 1)):
    return {"text": text, "bbox": [x0, y0, x1, y1], "line": line}


INDEX = {"sheets": {"92": "p92", "93": "p93", "94": "p94", "95": "p95"},
         "anchors": {"92": ["K911", "DA9.1"], "93": ["K912"],
                     "94": ["DA9.1"]}}


def _one(text, **kw):
    cands = x.lex_page([_tok(text, **kw)], source_page=91)
    assert cands, f"no lexical match for {text!r}"
    return cands[0]


def test_sheet_col_anchor_syntax():
    c = _one("92.1 / K911")
    assert c["pattern_class"] == "SHEET_COL_ANCHOR"
    assert c["target_sheet_lexical"] == "92"
    assert c["target_anchor_lexical"] == "K911"
    assert c["raw_reference"] == "92.1 / K911"
    assert c["evidence_bbox"] == [100, 100, 260, 130]


def test_page_anchor_syntax_da():
    c = _one("92 / DA9.1")
    assert c["pattern_class"] == "PAGE_ANCHOR"
    assert c["target_anchor_lexical"] == "DA9.1"


def test_slash_column_syntax():
    c = _one("/93.4")
    assert c["pattern_class"] == "SLASH_COL"
    assert c["target_sheet_lexical"] == "93"


def test_german_and_english_sheet_phrases():
    assert _one("von Blatt 92")["relationship"] == "CONTINUES_FROM"
    assert _one("nach Blatt 93")["relationship"] == "CONTINUES_ON"
    assert _one("to sheet 94")["relationship"] == "CONTINUES_ON"


def test_external_and_cable_and_grid():
    assert _one("+EXT/19.0/JB907.U1".replace("/JB", "/JB"))["pattern_class"] == "EXTERNAL"
    assert _one("-W5093")["pattern_class"] == "CABLE_CONT"
    assert _one("B7")["pattern_class"] == "GRID_REF"


def test_contact_convention_numbers_never_become_anchors():
    for ref in ("92.1 / 53", "92.1 / 54", "92.1 / A1"):
        assert not x.lex_page([_tok(ref)], source_page=91), ref


def test_confidence_reasons_deterministic_and_margin_bonus():
    a = x.lex_page([_tok("92.1 / K911")], source_page=91, page_width=1000)[0]
    # x0=100 -> within the 12% margin arrow zone of a 1000px page
    assert "margin_arrow_zone:+0.10" in a["confidence_reasons"]
    b = _one("92.1 / K911")
    assert b["confidence_reasons"][0].startswith("pattern_base:")
    assert a["extractor_version"] == "xref_extractor_v1"


def test_resolution_resolved_with_verified_anchor():
    rec = x.resolve([_one("92.1 / K911")], INDEX)[0]
    assert rec["resolution"] == "resolved"
    assert rec["target_page"] == "p92"
    assert "anchor verified" in rec["resolution_reason"]


def test_resolution_missing_target_never_invents():
    rec = x.resolve([_one("99.1 / K999")], INDEX)[0]
    assert rec["resolution"] == "missing_target"
    assert rec["target_page"] is None


def test_resolution_contradictory_when_anchor_absent_on_known_sheet():
    rec = x.resolve([_one("93.4 / K999")], INDEX)[0]
    assert rec["resolution"] == "contradictory"
    assert rec["target_page"] == "p93"


def test_resolution_ambiguous_anchor_on_multiple_sheets():
    cand = _one("92 / DA9.1")
    cand["target_sheet_lexical"] = None  # anchor-only reference
    rec = x.resolve([cand], INDEX)[0]
    assert rec["resolution"] == "ambiguous"
    assert rec["target_page"] is None
    assert [c["sheet"] for c in rec["candidates"]] == ["92", "94"]


def test_stable_json_byte_stable():
    recs = x.resolve(x.lex_page([_tok("92.1 / K911"), _tok("/93.4", y0=300)],
                                source_page=91), INDEX)
    assert x.stable_json(recs) == x.stable_json(list(reversed(recs)))


def test_pageset_conversion_shape():
    recs = x.resolve([_one("92.1 / K911")], INDEX)
    xr = x.to_pageset_xrefs(recs)[0]
    assert xr["raw"] == "92.1 / K911" and xr["sig"] == "K911"
    assert xr["ev"] == "obs"


def test_ocr_unavailable_is_explicit():
    with pytest.raises(x.OcrUnavailable):
        x.ocr_tokens(b"not-an-image")


def test_line_items_joins_lines_and_keeps_singletons_deduped():
    from printsense.xref_extractor import line_items

    tokens = [
        {"text": "A1", "bbox": [10, 10, 20, 18], "line": (0, 1)},
        {"text": "A2", "bbox": [24, 10, 34, 18], "line": (0, 1)},
        {"text": "-K17", "bbox": [40, 30, 70, 38], "line": (0, 2)},
    ]
    items = line_items(tokens)
    assert "A1 A2" in items
    assert "A1" in items and "A2" in items
    assert "-K17" in items
    assert items.count("-K17") == 1
    assert items.index("A1 A2") < items.index("-K17")


def test_line_items_empty():
    from printsense.xref_extractor import line_items

    assert line_items([]) == []
