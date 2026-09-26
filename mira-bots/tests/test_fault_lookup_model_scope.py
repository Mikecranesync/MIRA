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


def test_two_products_each_code_takes_its_nearest_product_in_either_order():
    q = "PowerFlex 525 F004 and PowerFlex 40 F4"
    for products in (["PowerFlex 525", "PowerFlex 40"], ["PowerFlex 40", "PowerFlex 525"]):
        assert sorted(_fault_code_scopes(q, ["F004", "F4"], products)) == [
            ("F004", "PowerFlex 525"),
            ("F4", "PowerFlex 40"),
        ]


def test_two_products_and_an_unlocatable_code_is_not_promoted():
    q = "PowerFlex 525 and PowerFlex 40 both show fault 4"
    assert _fault_code_scopes(q, ["F4"], ["PowerFlex 525", "PowerFlex 40"]) == []


# Codex #4026 round 2 F1: a code equally near two different machines in the same
# clause is ambiguous and is not promoted, whatever the product-list order.
def test_a_code_equidistant_from_two_products_in_one_clause_is_not_promoted():
    q = "PowerFlex 525 F004 PowerFlex 40"
    for products in (["PowerFlex 525", "PowerFlex 40"], ["PowerFlex 40", "PowerFlex 525"]):
        assert _fault_code_scopes(q, ["F004"], products) == []


# The review's own example resolves by clause, identically in either order.
def test_clause_structure_decides_codex_example_deterministically():
    q = "PowerFlex 525 and F004 PowerFlex 40"
    for products in (["PowerFlex 525", "PowerFlex 40"], ["PowerFlex 40", "PowerFlex 525"]):
        assert _fault_code_scopes(q, ["F004"], products) == [("F004", "PowerFlex 40")]


# A clause with a code but no product, when several are named, is ambiguous.
def test_a_code_in_a_clause_with_no_product_is_not_promoted():
    q = "PowerFlex 525 and PowerFlex 40, and it shows F004"
    assert _fault_code_scopes(q, ["F004"], ["PowerFlex 525", "PowerFlex 40"]) == []


# Codex #4026 round 2 F2: the same code on two machines is looked up for both.
def test_the_same_code_on_two_machines_is_looked_up_for_each():
    q = "F004 on PowerFlex 525 and F004 on PowerFlex 40"
    for products in (["PowerFlex 525", "PowerFlex 40"], ["PowerFlex 40", "PowerFlex 525"]):
        assert sorted(_fault_code_scopes(q, ["F004"], products)) == [
            ("F004", "PowerFlex 40"),
            ("F004", "PowerFlex 525"),
        ]
