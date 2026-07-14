"""Table discovery — find fault/parameter table candidates on any page.

Vendor-agnostic. A page is a table candidate when a repeated IDENTIFIER column
(numeric/alphanumeric/dotted codes stacked in the same left x-band) coincides
with role vocabulary (fault/parameter header words somewhere on the page). No
exact vendor header phrase is ever REQUIRED — an exact phrase only raises the
confidence. This is the layer that fixes the 0/5 generalization gap: the old
parsers returned ``[]`` unless "Name/Description" (Magnetek) or
"Description"+"Action" (PowerFlex) appeared verbatim; here, any stacked id
column with role vocabulary is discoverable.

Consumes ``document_ir.PageIR``. Pure, no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import schema_inference as si
from document_ir import PageIR, Word

_ID_BAND_TOL = 12.0     # x0 within this many pts share one id column
_MIN_ID_ROWS = 3        # a table needs at least this many stacked ids
_CELL_GAP = 10.0        # x-gap (pts) that separates two cells on a row


def group_row_cells(line_words: list[Word], gap: float = _CELL_GAP) -> list[dict[str, Any]]:
    """Group a visual row's words into cells by horizontal whitespace gaps.

    Returns cells left-to-right, each ``{"text", "x0", "x1", "words"}``. This
    is how an UNRULED table's columns are recovered when there are no ruling
    lines to key on — a real column boundary shows up as a gap wider than the
    inter-word spacing within a cell."""
    ordered = sorted(line_words, key=lambda w: w["x0"])
    cells: list[dict[str, Any]] = []
    cur: list[Word] = []
    for w in ordered:
        if cur and w["x0"] - cur[-1]["x1"] > gap:
            cells.append(_cell(cur))
            cur = []
        cur.append(w)
    if cur:
        cells.append(_cell(cur))
    return cells


def _cell(words: list[Word]) -> dict[str, Any]:
    return {
        "text": " ".join(w["text"] for w in words),
        "x0": min(w["x0"] for w in words),
        "x1": max(w["x1"] for w in words),
        "words": words,
    }


@dataclass
class TableCandidate:
    page: int
    kind: str                    # "fault" | "parameter"
    confidence: float            # 0..1
    id_band: tuple[float, float]  # x0 range of the identifier column
    id_row_tops: list[float]     # top y of each id row (for parsing)
    header_cells: list[str]      # inferred header cell texts (may be [])
    header_top: float | None     # y of the header row, if found
    reasons: list[str] = field(default_factory=list)


def _first_token(line_words: list[Word]) -> Word | None:
    return min(line_words, key=lambda w: w["x0"]) if line_words else None


def _dominant_id_band(page: PageIR) -> tuple[tuple[float, float], list[list[Word]]] | None:
    """Find the left x-band holding the most identifier-first rows.

    Returns ((x0_lo, x0_hi), [rows]) or None. Rows are the word-lines whose
    leftmost token is an identifier within that band."""
    id_rows: list[tuple[float, list[Word]]] = []
    for line in page.word_lines:
        first = _first_token(line)
        if first is None:
            continue
        if si.is_identifier(first["text"]):
            id_rows.append((first["x0"], line))
    if len(id_rows) < _MIN_ID_ROWS:
        return None
    # Cluster the id x0 values; keep the densest cluster (the real id column).
    id_rows.sort(key=lambda r: r[0])
    best: list[tuple[float, list[Word]]] = []
    i = 0
    while i < len(id_rows):
        j = i
        while j < len(id_rows) and id_rows[j][0] - id_rows[i][0] <= _ID_BAND_TOL:
            j += 1
        cluster = id_rows[i:j]
        if len(cluster) > len(best):
            best = cluster
        i = j
    if len(best) < _MIN_ID_ROWS:
        return None
    lo = min(r[0] for r in best)
    hi = max(r[0] for r in best)
    return (lo, hi), [r[1] for r in best]


def _find_header(page: PageIR, *, param_context: bool
                 ) -> tuple[list[str], float | None, int]:
    """Best header row: the word-line resolving the most distinct roles.

    Returns (header_cell_texts, header_top, role_count). Searches all rows (a
    manual's table header repeats per page, and may sit a few rows above the
    id column). Ties broken toward the row nearest the top of the id band."""
    best_cells: list[str] = []
    best_top: float | None = None
    best_score = 0
    for line in page.word_lines:
        cells = group_row_cells(line)
        texts = [c["text"] for c in cells]
        if len(texts) < 2:
            continue
        score = si.header_role_score(texts, param_context=param_context)
        if score > best_score:
            best_score = score
            best_cells = texts
            best_top = min(w["top"] for w in line)
    return best_cells, best_top, best_score


def discover_tables(page: PageIR) -> list[TableCandidate]:
    """Zero or one table candidate per page (a page rarely holds two distinct
    table kinds). Returns [] when no id column is found."""
    band_rows = _dominant_id_band(page)
    if band_rows is None:
        return []
    id_band, rows = band_rows
    id_row_tops = sorted(min(w["top"] for w in ln) for ln in rows)

    fault_hits, param_hits = si.page_kind_scores(page.text)
    # Header role-count under each hypothesis decides the kind more reliably
    # than raw vocab alone (a param page mentions "fault" in prose too).
    f_cells, f_top, f_score = _find_header(page, param_context=False)
    p_cells, p_top, p_score = _find_header(page, param_context=True)

    if p_score > f_score or (p_score == f_score and param_hits >= fault_hits):
        kind, cells, htop, hscore = "parameter", p_cells, p_top, p_score
        vocab = param_hits
    else:
        kind, cells, htop, hscore = "fault", f_cells, f_top, f_score
        vocab = fault_hits

    reasons = [f"{len(rows)} stacked ids in x[{id_band[0]:.0f},{id_band[1]:.0f}]"]
    conf = 0.0
    conf += min(len(rows) / 12.0, 0.45)              # id density (up to .45)
    if hscore >= 2:
        conf += 0.30
        reasons.append(f"header resolves {hscore} roles: {cells[:6]}")
    elif hscore == 1:
        conf += 0.12
    if page.is_ruled:
        conf += 0.10
        reasons.append("ruled")
    if vocab >= 2:
        conf += 0.10
        reasons.append(f"{kind} vocab={vocab}")
    conf = round(min(conf, 1.0), 3)

    return [TableCandidate(
        page=page.number,
        kind=kind,
        confidence=conf,
        id_band=id_band,
        id_row_tops=id_row_tops,
        header_cells=cells,
        header_top=htop,
        reasons=reasons,
    )]


def discover_document(pages: list[PageIR], *, min_conf: float = 0.35) -> list[TableCandidate]:
    """All candidates across a document above ``min_conf``, page-ordered."""
    out: list[TableCandidate] = []
    for p in pages:
        for c in discover_tables(p):
            if c.confidence >= min_conf:
                out.append(c)
    return out
