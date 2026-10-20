"""V3 prototype: table-aware claim check (ARCHITECTURE_MISSION_PLAN.md T6). Developed on round-1 data only.

Evidence is the cited page as structured markdown (Docling). A *claimed cell* is a table cell whose
normalised text occurs in the answer (cells shorter than 2 chars or without a digit/letter mix are only
used when the cell is code-like). A claimed cell is BOUND when
  - its row holds another cell whose text occurs in the question (the row subject), and
  - its column header shares a content word (>= 3 letters) with the question.
Verdict: supported if every claimed cell that occurs in the answer is bound in some cited grid;
unsupported if a claimed value occurs only in unbound positions; no_opinion if no grid cell is claimed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from column_lookup import md_tables, norm  # noqa: E402

STOP = {
    "what",
    "the",
    "for",
    "and",
    "with",
    "this",
    "that",
    "are",
    "which",
    "value",
    "from",
    "does",
}


def words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9]*", s.lower()) if len(w) >= 2 and w not in STOP}


def in_question(cell: str, question: str) -> bool:
    """Cell text appears in the question as a whole token run (short ids like '6' or '2.2' included)."""
    c = " ".join(cell.lower().split())
    if not c:
        return False
    return re.search(rf"(?<![\w.]){re.escape(c)}(?![\w.])", " ".join(question.lower().split())) is not None


def informative(cell: str) -> bool:
    n = norm(cell)
    if len(n) < 2:
        return False
    return bool(re.search(r"\d", n)) or bool(re.fullmatch(r"[a-z0-9_.:\-/#%]+", n)) and len(n) >= 3


def check(question: str, answer: str, pages_md: list[str]) -> dict:
    nq, na, qw = norm(question), norm(answer), words(question)
    claimed_any, bound_vals, unbound_vals = False, set(), set()
    for md in pages_md:
        for grid in md_tables(md):
            if len(grid) < 2:
                continue
            for ri, row in enumerate(grid[1:], start=1):
                subj = any(in_question(c, question) for c in row)
                for j, cell in enumerate(row):
                    nc = norm(cell)
                    if not informative(cell) or nc not in na or nc in nq:
                        continue
                    claimed_any = True
                    # header text: every cell of this column above the row (multi-row headers, merged-in group labels)
                    head = " ".join(r[j] for r in grid[:ri] if j < len(r))
                    col_ok = bool(words(head) & qw) or (len(norm(head)) >= 2 and norm(head) in nq)
                    (bound_vals if subj and col_ok else unbound_vals).add(nc)
    if not claimed_any:
        return {"verdict": "no_opinion", "reason": "no_claimed_cell"}
    stray = unbound_vals - bound_vals
    if not bound_vals:
        return {
            "verdict": "unsupported",
            "reason": "value_not_in_asked_cell",
            "values": sorted(stray)[:5],
        }
    if stray and not any(v in b or b in v for v in stray for b in bound_vals):
        return {
            "verdict": "unsupported",
            "reason": "extra_unbound_value",
            "values": sorted(stray)[:5],
        }
    return {"verdict": "supported", "reason": "bound_cell"}
