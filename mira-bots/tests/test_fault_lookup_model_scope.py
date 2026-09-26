"""Codex #4026 review: the structured fault lookup's model scope must be exact.

F1 — `ILIKE '%PowerFlex 40%'` also matches PowerFlex 400/40P, so a same-code row
     for another drive could be promoted as rank-1 evidence. Rows are filtered
     with the same suffix-exclusion `_product_search` already uses (#2914).
F2 — with two products named, every code was scoped to whichever product a set
     happened to iterate first. Each code now takes the product mentioned
     nearest to it; a code that cannot be located is not promoted at all.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, "mira-bots")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import _fault_code_scopes, _row_matches_model  # noqa: E402


def test_row_model_filter_keeps_the_base_model_only():
    assert _row_matches_model("PowerFlex 40", "PowerFlex 40")
    assert _row_matches_model("Allen-Bradley PowerFlex 40 (22B)", "PowerFlex 40")
    assert not _row_matches_model("PowerFlex 400", "PowerFlex 40")
    assert not _row_matches_model("PowerFlex 40P", "PowerFlex 40")
    assert not _row_matches_model("PowerFlex 401", "PowerFlex 40")


def test_recall_fault_code_drops_a_suffix_model_row():
    rows = [
        {"code": "F4", "equipment_model": "PowerFlex 40", "description": "UV"},
        {"code": "F4", "equipment_model": "PowerFlex 400", "description": "other"},
    ]
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = rows
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    with (
        patch.dict("os.environ", {"NEON_DATABASE_URL": "postgresql://x"}),
        patch("sqlalchemy.create_engine", return_value=engine),
    ):
        out = neon_recall.recall_fault_code("F4", "tenant-1", model="PowerFlex 40")
    assert [r["equipment_model"] for r in out] == ["PowerFlex 40"]


def test_one_product_scopes_every_code():
    q = "PowerFlex 525 throwing F004 after the jam"
    assert _fault_code_scopes(q, ["F004"], ["PowerFlex 525"]) == [("F004", "PowerFlex 525")]


def test_no_product_is_unscoped():
    assert _fault_code_scopes("drive shows F004", ["F004"], []) == [("F004", None)]


# Codex #4026 rounds 2-3: every clause/proximity association rule exposed a new
# phrasing edge ("both show F004", "525, F004; 40, F4"). With several machines
# named, each code is looked up against EVERY named machine instead: a row only
# exists where the code is defined for that model, and each promoted row carries
# its own equipment_model — no association guess, so no ambiguity edge.
MULTI = [
    "PowerFlex 525 F004 and PowerFlex 40 F4",
    "PowerFlex 525 and PowerFlex 40 show F004",
    "PowerFlex 525, F004; PowerFlex 40, F4",
    "F004 on PowerFlex 525 and F004 on PowerFlex 40",
    "PowerFlex 525 F004 PowerFlex 40",
]


def test_several_products_look_every_code_up_against_every_product_in_any_order():
    for q in MULTI:
        for products in (["PowerFlex 525", "PowerFlex 40"], ["PowerFlex 40", "PowerFlex 525"]):
            codes = ["F004", "F4"] if "F4" in q.replace("F004", "") else ["F004"]
            got = _fault_code_scopes(q, codes, products)
            assert sorted(got) == sorted(
                (c, p) for c in codes for p in ["PowerFlex 40", "PowerFlex 525"]
            ), q


def test_pairs_are_capped():
    got = _fault_code_scopes("x", ["F1", "F2", "F3"], ["A 1", "B 2", "C 3"])
    assert len(got) <= 6
