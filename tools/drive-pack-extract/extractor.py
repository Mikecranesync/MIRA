"""Manual -> drive-pack structured extractor (offline, read-only).

Turns an OEM drive manual PDF into structured, CITED drive-pack fragments —
fault codes, configurable parameters, and (where a clean procedure exists)
keypad navigation — matching the shapes in
``mira-bots/shared/drive_packs/schema.py``.

This is the REUSABLE TOOL only. It does not ship the real PowerFlex pack (a
separate, offline PR-B run) and it never touches
``mira-bots/shared/drive_packs/`` runtime code. Read-only: reads a PDF file,
writes nothing but the JSON fragment it returns. No fieldbus, no sockets, no
DB, no hardware writes (`.claude/rules/fieldbus-readonly.md`).

POSITION-AWARE extraction (``page.extract_words()`` with x0/x1/top
coordinates), NOT ``extract_text()`` line-regex matching. The real PowerFlex
520-UM001 fault and parameter-grid tables are genuinely multi-column: a
fault's Name/Fault-Type/Description/Action columns wrap independently and at
different heights, so ``extract_text()`` interleaves them onto lines that mix
several logical columns together (see the README for the measured example —
the real manual's own "Modify using C125" action clause for fault F081
physically renders *above* F081's own "F081 DSI Comm Loss 2" code line). A
pure line-regex over ``extract_text()`` either bleeds description text into
the fault name or drops the grid parameter's Min/Max and Default columns
outright (both confirmed on a real-manual run — see the README's "Verified
against the real manual" section for the recovered sample).

Column geometry is discovered PER PAGE from that page's own header row (the
words "No.", "Description", "Action" for the fault table; "No.", "Parameter",
"Min/Max", "Display/Options", "Default" for the parameter grid) — not
hardcoded pixel constants — so a page with a slightly shifted layout still
bins correctly. A fault page is identified by carrying BOTH the "Description"
and "Action" headers; a page without them yields no faults (the safe drop a
whole-document or over-broad page range relies on).

Two manual dialects are supported. The PowerFlex 520/525 fault table encodes
Fault-Type as a trailing "1"/"2"/"—" TEXT token; the PowerFlex 40 table encodes
it as a ZapfDingbats circled-digit glyph (➀/➁) in its own column, rendered ~3pt
above its code row, and uses single-digit fault codes (F2..F8) — both handled
by the fault parser. The parameter labeled-block parser tolerates both label
dialects ("Default:" vs "Values Default:", "Values Min/Max:" vs "Min/Max:") and
gates parameter headers on a BOLD heading font so a plain-Helvetica graph/curve
callout (the PF40 p.71 "A034 [Minimum Freq]" typo) is never emitted as a real
parameter.

Cross-references (``references_parameters`` on a fault, ``related_faults`` on
a parameter) are populated ONLY from explicit manual text, and the DIRECTION
matters: a fault's action text says "Modify using C125 [Comm Loss Action]" —
that is a FAULT -> PARAMETER reference. A parameter's ``related_faults`` is
the INVERSE of that relationship (built by ``link_fault_actions_to_parameters``
after both tables are parsed), never a parameter's own "Related Parameters:"
line (that is a param<->param link, out of scope for ``related_faults`` — see
the README's "related_faults semantics" note). Never inferred from co-mention.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import cite_integrity
import magnetek_dialect
import pdfplumber

logger = logging.getLogger("drive-pack-extract.extractor")

Word = dict[str, Any]

# ---------------------------------------------------------------------------
# Shared position-aware helpers
# ---------------------------------------------------------------------------

_LINE_TOL = 2.5  # points — words within this vertical band are "one line"


def _cluster_lines(words: list[Word], tol: float = _LINE_TOL) -> list[list[Word]]:
    """Group words into visual lines, sorted top-to-bottom / left-to-right.

    Real-manual rows occasionally have a 1pt vertical jitter between tokens
    that are visually on the same line (e.g. a footnote-marked fault-type
    token rendering ~1pt higher than its row's other words) — ``tol``
    absorbs that without merging genuinely different rows (row spacing in
    both tables is >=10pt).
    """
    ordered = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: list[list[Word]] = []
    current: list[Word] = []
    for w in ordered:
        if current and abs(w["top"] - current[-1]["top"]) > tol:
            lines.append(current)
            current = []
        current.append(w)
    if current:
        lines.append(current)
    return lines


def _line_text(line_words: list[Word]) -> str:
    return " ".join(w["text"] for w in sorted(line_words, key=lambda w: w["x0"]))


def _find_header_x(words: list[Word], label: str, top_max: float = 200.0) -> float | None:
    """Locate a header column's left edge by its exact label text, searched
    only in the page's top margin (avoids matching the same word if it ever
    recurs in body text)."""
    for w in words:
        if w["top"] <= top_max and w["text"] == label:
            return w["x0"]
    return None


def _find_header_top(words: list[Word], label: str, top_max: float = 200.0) -> float | None:
    """Like ``_find_header_x`` but returns the header word's own ``top`` —
    used to exclude the page's title/intro paragraph (everything ABOVE the
    table header) from column binning, so it can't get nearest-assigned onto
    the first data row (confirmed on the real manual: without this, the
    page's own title/intro text bleeds into the first parameter's Default)."""
    for w in words:
        if w["top"] <= top_max and w["text"] == label:
            return w["top"]
    return None


def _nearest_key(anchors: list[tuple[str, float]], top: float) -> str | None:
    if not anchors:
        return None
    return min(anchors, key=lambda a: abs(a[1] - top))[0]


def _nearest_assign_text(words: list[Word], anchors: list[tuple[str, float]]) -> dict[str, str]:
    """Assign each word to whichever anchor's row-top is vertically nearest,
    then join each anchor's assigned words in natural reading order.

    This is the general fallback for columns (Min/Max, Display, Default,
    Action) whose per-row content doesn't line up with any single column's
    own row-start marker — validated against the real manual: a cross-ref
    phrase like "Modify using C125" that physically renders *between* two
    fault code lines still lands on the geometrically closer fault.
    """
    buckets: dict[str, list[Word]] = {pid: [] for pid, _ in anchors}
    for w in words:
        pid = _nearest_key(anchors, w["top"])
        if pid is not None:
            buckets[pid].append(w)
    return {
        pid: " ".join(w["text"] for w in sorted(ws, key=lambda w: (w["top"], w["x0"])))
        for pid, ws in buckets.items()
    }


def _find_raw_line(raw_lines: list[str], code: str) -> str | None:
    """Return the page's OWN raw ``extract_text()`` line that starts with
    ``code`` (allowing a footnote-parenthesized suffix like ``F015(3)``).

    This is how excerpts are built: instead of reassembling a possibly
    cross-column, non-contiguous span of position-binned words (which could
    fail the cite-integrity substring check if the real column layout
    interleaves other columns' lines in between), grab the ONE physical line
    verbatim. It is guaranteed to verify because it IS the source text.
    """
    pattern = re.compile(rf"^{re.escape(code)}(?:\(\d+\))?\b")
    for line in raw_lines:
        stripped = line.strip()
        if pattern.match(stripped):
            return stripped
    return None


# ---------------------------------------------------------------------------
# Fault table parsing (position-aware)
# ---------------------------------------------------------------------------

# Header-word x0 measures the LABEL, which sits almost flush against its own
# column's data (e.g. "Description" header at x0=334.02, real Description
# data also starting at x0=333.98..334.06 on the SAME page) — using the raw
# header x0 as an exclusive upper bound for the PRECEDING column is off by a
# hair's-width of float jitter and leaks the first Description word onto the
# fault name (confirmed on the real manual: "No Fault -- No" instead of "No
# Fault"). Subtract a margin so the cut falls inside the real visual gap
# between columns (measured >=20pt for Name/Type -> Description).
_COLUMN_MARGIN = 8.0
_COLUMN_MARGIN_SMALL = 3.0

# A "full" row: code (+ optional footnote paren attached to the code, e.g.
# "F015(3)"), name, then the Fault-Type column (1=Auto-Reset/Run,
# 2=Non-Resettable, or an em-dash for "no type" like F000 "No Fault") with an
# optional footnote paren attached to the TYPE instead (e.g. "F013 ... 1(2)").
# ``\d{1,3}`` (not ``\d{2,3}``) so single-digit fault codes parse: the
# PowerFlex 40 fault table uses F2..F8 (7 of its 26 codes are single-digit),
# where the 520/525 table starts at F000. Only the FAULT-code regexes are
# relaxed — parameter ids (``_PARAM_CODE_RE``, ``_LABELED_HEADER_RE``,
# ``_CROSS_REF_ID_RE``, the grid comma-group check) are ALWAYS >=2 digits in
# both manuals, so they stay ``\d{2,3}`` to keep the false-positive surface
# small (a single-digit param id does not exist in either family).
_FAULT_ROW_RE = re.compile(
    r"^(?P<code>[A-Za-z]\d{1,3})(?:\(\d+\))?\s+(?P<name>.+?)\s+(?P<ftype>[12]|—)(?:\(\d+\))?$"
)
# A "name only" row: a code sharing its Fault-Type/description/action with a
# later row in the same shared multi-code group (real manual's F038/F039/F040
# "Phase U/V/W to Gnd" style groups). Tried only after the full-row regex
# fails, so it never swallows a full row.
_FAULT_NAME_ONLY_RE = re.compile(r"^(?P<code>[A-Za-z]\d{1,3})(?:\(\d+\))?\s+(?P<name>.+)$")
# A bare Fault-Type token closing a pending group (the real manual centers
# the shared type value on its own line within the merged row).
_FAULT_FTYPE_ONLY_RE = re.compile(r"^(?P<ftype>[12]|—)(?:\(\d+\))?$")

# An explicit fault -> parameter cross-reference: "Modify using C125 [Comm
# Loss Action]." ``pdfplumber`` tokenizes the id and the bracketed name as
# separate words, so this matches on adjacent WORDS, not within one regex.
# Parameter ids are always >=2 digits (see the ``\d{1,3}`` note above), so this
# stays ``\d{2,3}``.
_CROSS_REF_ID_RE = re.compile(r"^[A-Za-z]\d{2,3}$")

# ---------------------------------------------------------------------------
# Fault-Type dingbat column (PowerFlex 40 layout)
# ---------------------------------------------------------------------------
# The PF40 fault table encodes Fault-Type NOT as a trailing "1"/"2"/"—" text
# token (the 520/525 shape ``_FAULT_ROW_RE`` handles) but as a ZapfDingbats
# circled digit — ➀ (U+2780) = type 1, ➁ (U+2781) = type 2 — in a dedicated
# column at a per-page-constant x0, rendered ~3pt ABOVE its own code row. That
# 3pt gap is larger than ``_LINE_TOL`` so the glyph never clusters onto its
# row's text line, which is exactly why the 520/525 line-regex dropped every
# PF40 row. We detect the column by the glyphs themselves (the "Type" header
# renders as a garbled reversed ")1(epyT" and can't be matched), map each
# glyph to its digit, and nearest-assign it to the fault row it sits above.
_DINGBAT_ROW_TOL = 8.0  # < row spacing (~19pt), > the ~3pt glyph-above-row gap
_CIRCLED_DIGIT_BASES = (0x2460, 0x2776, 0x2780)  # ①.. ❶.. ➀.. — all "n at base+n-1"
# A wrapped fault name continues on the very next line (~one line-height below);
# anything farther is a different row, the page footer, or a following section
# heading — NOT part of the name. Bounds name collection so the LAST fault on a
# page doesn't sweep in the footer / a trailing "Common Symptoms" table.
_NAME_WRAP_TOL = 15.0
# The action of the LAST fault on a page has no next-row to bound it. Cap its
# action span so a cross-reference that lives in an UNRELATED table below the
# fault table (the PF40 p.95 "Common Symptoms" corrective-action column, ~230pt
# below F122) is not misattributed to that last fault. Comfortably covers a real
# multi-line numbered action list (F81's "…4. Turn off using A105" is ~78pt).
_MAX_ACTION_SPAN = 130.0


def _circled_digit(text: str) -> str | None:
    """Return "1".."9" if ``text`` is a single circled-digit glyph, else None.

    Covers the three Unicode circled-digit runs a manual might use for a
    Fault-Type marker (the real PF40 uses ➀/➁ = U+2780/U+2781). A general
    lookup, not a fixture-specific hack — any manual using circled digits for
    its fault-type column parses through this one path.
    """
    if len(text) != 1:
        return None
    cp = ord(text)
    for base in _CIRCLED_DIGIT_BASES:
        if base <= cp <= base + 8:  # digits 1..9
            return str(cp - base + 1)
    return None


def _find_ftype_dingbats(words: list[Word]) -> list[tuple[str, float]]:
    """Every Fault-Type circled-digit glyph as ``(ftype, top)`` (PF40 layout).

    Empty for the 520/525 layout (no circled digits), so the presence of any
    entry is the signal that this page uses the dingbat Fault-Type column.
    """
    return [(d, w["top"]) for w in words if (d := _circled_digit(w["text"])) is not None]


def _dingbat_type_for_row(dingbats: list[tuple[str, float]], top: float) -> str | None:
    """The Fault-Type of the circled-digit glyph nearest ``top`` within
    ``_DINGBAT_ROW_TOL``, or None when this row has no own glyph (a shared-group
    continuation like F39/F40, or a genuinely untyped fault like F48)."""
    best: tuple[float, str] | None = None
    for ftype, dtop in dingbats:
        dist = abs(dtop - top)
        if dist <= _DINGBAT_ROW_TOL and (best is None or dist < best[0]):
            best = (dist, ftype)
    return best[1] if best is not None else None


def _find_cross_refs(action_words: list[Word]) -> list[tuple[str, float]]:
    """Every "<PARAM_ID> [Bracketed Name]" cross-reference in the action band.

    Clusters the action words into visual LINES first (``_cluster_lines``), then
    scans each line in x0 (reading) order. A raw global ``(top, x0)`` sort — the
    original approach — is fragile to the sub-pixel ``top`` jitter pdfplumber
    gives tokens on a single physical line: on the real PF525 manual the bracket
    ``[Reset`` renders at top 177.279 while its own id ``P053`` is at
    177.2793, so the bracket sorts *before* the id and the "id immediately
    followed by [" adjacency check misses it. That is the real cause of the
    PF525 F100/F109 -> P053 links being dropped (F101 survived only because its
    tokens happened to tie). Line-clustering absorbs that jitter the same way the
    rest of the extractor already does (``_LINE_TOL``)."""
    refs: list[tuple[str, float]] = []
    for line in _cluster_lines(action_words):
        ordered = sorted(line, key=lambda w: w["x0"])
        for i in range(len(ordered) - 1):
            w, nxt = ordered[i], ordered[i + 1]
            if _CROSS_REF_ID_RE.match(w["text"]) and nxt["text"].startswith("["):
                refs.append((w["text"], w["top"]))
    return refs


def _assign_cross_refs(
    groups: list[dict[str, Any]], refs: list[tuple[str, float]], *, span_bounded: bool
) -> None:
    """Attribute each fault->parameter cross-reference to the fault whose action
    text contains it — mutating each group's ``references_parameters``.

    Two attribution strategies, because the two manual layouts place a fault's
    action differently relative to its own code line:

    - ``span_bounded=True`` (PF40 dingbat layout): the action is a numbered list
      running BELOW the code line, often many lines long, so a late step's ref
      is vertically far from its own code and CLOSER to the next fault. Attribute
      by row span: the ref belongs to the last fault at-or-above it, bounded so a
      ref in an unrelated table below the LAST fault (PF40 p.95 "Common Symptoms"
      column, ~230pt under F122) is dropped rather than misattributed.
    - ``span_bounded=False`` (520/525 layout): the action can render ABOVE its
      own code line, so nearest-by-top is correct there (unchanged behavior).
    """
    if not groups:
        return
    if not span_bounded:
        for param_id, ref_top in refs:
            nearest = min(groups, key=lambda g: abs(g["top"] - ref_top))
            if param_id not in nearest["references_parameters"]:
                nearest["references_parameters"].append(param_id)
        return

    ordered = sorted(groups, key=lambda g: g["top"])
    bounds = [
        (
            g,
            g["top"] - _DINGBAT_ROW_TOL,
            (ordered[i + 1]["top"] if i + 1 < len(ordered) else g["top"] + _MAX_ACTION_SPAN),
        )
        for i, g in enumerate(ordered)
    ]
    for param_id, ref_top in refs:
        for group, lo, hi in bounds:
            if lo <= ref_top < hi:
                if param_id not in group["references_parameters"]:
                    group["references_parameters"].append(param_id)
                break


def _fault_groups_from_dingbats(
    left_lines: list[list[Word]], dingbats: list[tuple[str, float]]
) -> list[dict[str, Any]]:
    """PF40 fault rows: one group per code line, Fault-Type from the nearest
    circled-digit glyph (or ``"—"`` for a shared-group continuation like
    F39/F40, or a genuinely untyped fault like F48 — never fabricated).

    Names that wrap onto a following line (the real manual's "Heatsink" /
    "OvrTmp" for F8) are rejoined within the row's vertical span — the span is
    bounded below by the NEXT code row, and the description column is already
    excluded from ``left_lines`` by x-position, so a continuation line can only
    be a wrapped name fragment.

    No pending/backward accumulation here: each code emits its own entry (which
    is what lands in the pack's ``fault_codes`` map). Fault-Type is NOT carried
    into the pack, so declining to fabricate a shared-continuation's type costs
    nothing downstream while keeping the extractor honest.
    """
    code_rows: list[tuple[int, str, str, float]] = []  # (line_idx, code, name0, top)
    for i, line_words in enumerate(left_lines):
        text = _line_text(line_words)
        m = _FAULT_NAME_ONLY_RE.match(text)
        if m:
            code_rows.append((i, m["code"], m["name"].strip(), line_words[0]["top"]))

    groups: list[dict[str, Any]] = []
    for k, (i, code, name0, top) in enumerate(code_rows):
        next_line_idx = code_rows[k + 1][0] if k + 1 < len(code_rows) else len(left_lines)
        name_parts = [name0]
        prev_top = top
        for j in range(i + 1, next_line_idx):
            cont_words = left_lines[j]
            cont_top = cont_words[0]["top"]
            cont = _line_text(cont_words).strip()
            # A wrapped-name line sits ~one line-height below the previous one
            # and is neither a footnote nor page furniture. Anything else ends
            # the name (stops the last row on a page sweeping in the footer / a
            # following section table — the real F29/F100/F122 bleed).
            if (
                not cont
                or _FOOTNOTE_DEF_RE.match(cont)
                or _PAGE_FURNITURE_RE.search(cont)
                or cont_top - prev_top > _NAME_WRAP_TOL
            ):
                break
            name_parts.append(cont)
            prev_top = cont_top
        name = " ".join(p for p in name_parts if p).strip()
        ftype = _dingbat_type_for_row(dingbats, top) or "—"
        groups.append({"members": [(code, name, top)], "ftype": ftype, "top": top})
    return groups


def _fault_groups_from_text(left_lines: list[list[Word]], page_number: int) -> list[dict[str, Any]]:
    """520/525 fault rows: Fault-Type is a trailing ``[12]|—`` text token (or a
    bare type line closing a shared multi-code group). This is the original
    position-aware machinery, unchanged except that a shared group with no
    recoverable type now emits ``fault_type="—"`` instead of being dropped
    (emit-not-drop: an untyped fault still belongs in the pack's fault map)."""
    groups: list[dict[str, Any]] = []  # {"members": [(code,name,top)], "ftype": str, "top": float}
    pending: list[tuple[str, str, float]] = []
    last_ftype: str | None = None

    idx = 0
    while idx < len(left_lines):
        line_words = left_lines[idx]
        text = _line_text(line_words)
        top = line_words[0]["top"]

        full = _FAULT_ROW_RE.match(text)
        if full:
            members = [*pending, (full["code"], full["name"].strip(), top)]
            groups.append({"members": members, "ftype": full["ftype"], "top": top})
            last_ftype = full["ftype"]
            pending = []
            idx += 1
            continue

        ftype_only = _FAULT_FTYPE_ONLY_RE.match(text)
        if ftype_only and pending:
            ftype = ftype_only["ftype"]
            groups.append({"members": pending, "ftype": ftype, "top": top})
            last_ftype = ftype
            pending = []
            idx += 1
            # The real manual sometimes renders the shared Fault-Type value
            # BETWEEN member lines rather than after the last one — e.g.
            # F038/F039 close here, but F040 (sharing the SAME type) still
            # follows with no type of its own before an unrelated fault
            # starts. If the very next left-bin line is a bare code+name
            # with no type indicator, it is that trailing member — close it
            # with the type we just saw instead of letting it accumulate
            # into whatever unrelated group happens to close next.
            if idx < len(left_lines):
                trailing_text = _line_text(left_lines[idx])
                trailing_top = left_lines[idx][0]["top"]
                trailing_name_only = _FAULT_NAME_ONLY_RE.match(trailing_text)
                if (
                    trailing_name_only
                    and not _FAULT_ROW_RE.match(trailing_text)
                    and not _FAULT_FTYPE_ONLY_RE.match(trailing_text)
                ):
                    groups.append(
                        {
                            "members": [
                                (
                                    trailing_name_only["code"],
                                    trailing_name_only["name"].strip(),
                                    trailing_top,
                                )
                            ],
                            "ftype": ftype,
                            "top": trailing_top,
                        }
                    )
                    idx += 1
            continue

        name_only = _FAULT_NAME_ONLY_RE.match(text)
        if name_only:
            pending.append((name_only["code"], name_only["name"].strip(), top))
            idx += 1
            continue
        # Anything else in the left band (page title, "No. Fault Type(1)
        # Description Action" header, a footnote definition line like "(1)
        # See Fault Types...") never matches a fault-row shape — skip it.
        idx += 1

    if pending:
        # A shared-row group whose Fault-Type value renders BETWEEN member
        # lines rather than after the last one (the real manual does this —
        # see F038/F039/F040, where the bare "2" line closes after F039 but
        # F040 still follows). The manual's own convention is one Fault-Type
        # per shared row, so the dangling trailing member(s) inherit the last
        # confirmed value on this page. If no type was ever seen on the page,
        # emit "—" (unknown) rather than drop the fault or invent a type —
        # the code+name still belong in the pack's fault map.
        ftype = last_ftype if last_ftype is not None else "—"
        if last_ftype is None:
            logger.info(
                "drive-pack-extract: %d fault row(s) with no recoverable Fault-Type "
                "on page %s emitted as unknown ('—'): %s",
                len(pending),
                page_number,
                [code for code, _, _ in pending],
            )
        groups.append({"members": pending, "ftype": ftype, "top": pending[-1][2]})

    return groups


def _parse_fault_page(
    words: list[Word], raw_lines: list[str], page_number: int
) -> list[dict[str, Any]]:
    desc_header_x = _find_header_x(words, "Description")
    action_header_x = _find_header_x(words, "Action")
    # Page-identity gate: a fault table carries BOTH the "Description" and
    # "Action" column headers. A parameter-only page does not — and its left
    # band is full of "P042 [Decel Time 1]" lines that also match the
    # vendor-neutral fault-code shape, so without this gate they would emit as
    # fabricated faults (previously masked by dropping untyped rows; now that
    # untyped faults are EMITTED, this gate carries the "no fabricated faults on
    # a param page" guarantee). Returning [] here is the safe drop a whole-doc or
    # over-broad page range relies on.
    if desc_header_x is None or action_header_x is None:
        return []

    action_words = [w for w in words if w["x0"] >= action_header_x - _COLUMN_MARGIN_SMALL]

    # PF40 encodes Fault-Type as a circled-digit glyph in its own column; the
    # presence of any such glyph selects the dingbat parser. The glyphs are
    # excluded from ``left_words`` so they never pollute a fault name.
    dingbats = _find_ftype_dingbats(words)
    left_words = [
        w
        for w in words
        if w["x0"] < desc_header_x - _COLUMN_MARGIN and _circled_digit(w["text"]) is None
    ]
    left_lines = _cluster_lines(left_words)

    if dingbats:
        groups = _fault_groups_from_dingbats(left_lines, dingbats)
    else:
        groups = _fault_groups_from_text(left_lines, page_number)

    anchors = [(code, group["top"]) for group in groups for (code, _, _) in group["members"]]
    refs = _find_cross_refs(action_words)
    for group in groups:
        group["references_parameters"] = []
    _assign_cross_refs(groups, refs, span_bounded=bool(dingbats))

    action_text_by_code = _nearest_assign_text(action_words, anchors) if anchors else {}

    entries: list[dict[str, Any]] = []
    for group in groups:
        references = sorted(set(group["references_parameters"]))
        for code, name, _top in group["members"]:
            raw_excerpt = _find_raw_line(raw_lines, code) or f"{code} {name}"
            entries.append(
                {
                    "code": int(re.sub(r"\D", "", code)),
                    "fault_id": code,
                    "name": name,
                    "fault_type": group["ftype"],
                    "action": action_text_by_code.get(code, ""),
                    "references_parameters": references,
                    "page": page_number,
                    "excerpt": raw_excerpt,
                }
            )
    return entries


def parse_faults(pdf_path: str | Path, *, pages: list[int] | None = None) -> list[dict[str, Any]]:
    """Parse every page's fault table into a list of per-fault-code dicts.

    Position-aware: bins each page's ``extract_words()`` into a
    Code/Name/Fault-Type band (left of the Description column) and an Action
    band (right of it), by header-derived x-coordinates. Handles
    SHARED-description multi-code rows: consecutive "name only" fault codes
    accumulate until a row (or a bare type-value line) carrying the
    Fault-Type closes the group; every code in the group emits its own entry
    sharing that type.

    ``pages``, when given, is a list of 1-based page numbers (matching
    pdfplumber's ``Page.page_number``) — ONLY those pages of the ORIGINAL pdf
    are read; every other page is skipped before any word/text extraction
    runs (the expensive step), which is what makes scoping fast on a large
    manual. Pages are selected by number from the original document, never by
    re-slicing into a new PDF — re-slicing would renumber/reorder pages and
    disturb the per-page column geometry the position-aware parser depends
    on. ``pages=None`` (default) scans every page — the whole-doc behavior,
    kept for back-compat but not the recommended path for a large manual.

    Returns dicts shaped: ``{code:int, fault_id:str, name, fault_type,
    action, references_parameters:list[str], page:int, excerpt:str}``.
    ``references_parameters`` is the fault's own outbound cross-reference
    (e.g. ``["C125"]``) — the inverse (a parameter's ``related_faults``) is
    built by ``link_fault_actions_to_parameters``.
    """
    wanted = set(pages) if pages is not None else None
    entries: list[dict[str, Any]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            if wanted is not None and page.page_number not in wanted:
                continue
            # Magnetek/Yaskawa IMPULSE dialect first — its page gate (the
            # single word "Name/Description") is disjoint from the PowerFlex
            # gate below by construction, so exactly one parser can fire.
            magnetek = magnetek_dialect.parse_magnetek_fault_page(page)
            if magnetek:
                entries.extend(magnetek)
                continue
            words = page.extract_words()
            text = page.extract_text() or ""
            entries.extend(_parse_fault_page(words, text.splitlines(), page.page_number))
    return entries


# ---------------------------------------------------------------------------
# Parameter parsing — grid layout (position-aware) + labeled-block layout
# ---------------------------------------------------------------------------

_PARAM_NAME_X_FALLBACK = 235.0
_PARAM_MINMAX_X_FALLBACK = 298.0
_PARAM_DISPLAY_X_FALLBACK = 384.0
_PARAM_DEFAULT_X_FALLBACK = 465.0

_PARAM_CODE_RE = re.compile(r"^(?P<pid>[A-Za-z]\d{2,3})$")
_RANGE_RE = re.compile(r"(?P<lo>[\d.]+)\s*/\s*(?P<hi>[\d.]+)\s*(?P<unit>[A-Za-z%]+)?")
_DEFAULT_NUMERIC_RE = re.compile(r"^(?P<value>[\d.]+)\s*(?P<unit>[A-Za-z%]*)$")

# Page furniture that must never leak into a purpose/description field.
_PAGE_FURNITURE_RE = re.compile(r"SYNTHETIC TEST FIXTURE|Rockwell Automation Publication")
_FOOTNOTE_DEF_RE = re.compile(r"^\(\d+\)\s")


def _looks_like_grid_page(words: list[Word]) -> bool:
    return _find_header_x(words, "Min/Max") is not None and (
        _find_header_x(words, "Default") is not None
    )


def _drop_footnote_definition_lines(words: list[Word]) -> list[Word]:
    """Drop footnote-DEFINITION lines (``"(3) When P039 [Torque Perf Mode] =
    ..."``) from the Name column before bracket-span extraction.

    These sentences reference OTHER parameters' bracketed names inline
    (sometimes glued with no space, e.g. ``"A535[Motor"``) — left in, they
    make a real name's bracket span swallow the entire footnote paragraph
    because the span-closer just looks for the next "]" it can find. A real
    parameter name line always starts with "[" as its FIRST word; a footnote
    line never does (it starts with the "(n)" marker, or continues the
    footnote's own prose). So: once a line matching "(n) ..." is seen, treat
    every following line as part of that footnote until a line starts fresh
    with "[" — that is the next real parameter name.
    """
    kept: list[Word] = []
    in_footnote = False
    for line in _cluster_lines(words):
        text = _line_text(line)
        if not in_footnote and _FOOTNOTE_DEF_RE.match(text):
            in_footnote = True
            continue
        if in_footnote:
            if text.startswith("["):
                in_footnote = False
            else:
                continue
        kept.extend(line)
    return kept


def _extract_bracket_spans(words: list[Word]) -> list[dict[str, Any]]:
    """Find every ``[Bracketed Name]`` span in a column's words, in reading
    order, tolerating a name that wraps across >=2 physical lines (the real
    manual does this, e.g. ``[Torque Perf`` / ``Mode]``)."""
    ordered = sorted(words, key=lambda w: (w["top"], w["x0"]))
    spans: list[dict[str, Any]] = []
    i = 0
    while i < len(ordered):
        w = ordered[i]
        if w["text"].startswith("["):
            collected = [w["text"]]
            start_top = w["top"]
            j = i
            # Look for "]" ANYWHERE in the last collected word, not just at its
            # end — the real manual sometimes glues trailing punctuation onto
            # the closing bracket with no space (e.g. "Reference3]." for a
            # footnote reference immediately after the name), so a strict
            # ``endswith("]")`` check never closes and silently swallows every
            # remaining word in the column.
            while "]" not in collected[-1] and j + 1 < len(ordered):
                j += 1
                collected.append(ordered[j]["text"])
            end_top = ordered[j]["top"]
            full = " ".join(collected)
            close_idx = full.find("]")
            name = full[1:close_idx] if close_idx != -1 else full.strip("[]")
            spans.append({"name": name.strip(), "start_top": start_top, "end_top": end_top})
            i = j + 1
        else:
            i += 1
    return spans


def _purpose_for_spans(name_words: list[Word], spans: list[dict[str, Any]]) -> dict[int, str]:
    """Purpose text = words in the Name column strictly between one bracket
    span's end and the NEXT span's start. Bracket-delimited, not position-vs-
    code-anchor — this stays correct even when the "No." column's code line
    renders at an unrelated height within the row (confirmed on the real
    manual: P031's own code line sits mid-row, not at the row's start or end)."""
    ordered = sorted(name_words, key=lambda w: (w["top"], w["x0"]))
    purposes: dict[int, str] = {}
    for idx, span in enumerate(spans):
        lo = span["end_top"]
        hi = spans[idx + 1]["start_top"] if idx + 1 < len(spans) else float("inf")
        lines: dict[float, list[Word]] = {}
        for w in ordered:
            if lo < w["top"] < hi and not _PAGE_FURNITURE_RE.search(w["text"]):
                lines.setdefault(w["top"], []).append(w)
        text_lines = [
            _line_text(ws)
            for _, ws in sorted(lines.items())
            if not _PAGE_FURNITURE_RE.search(_line_text(ws))
        ]
        purposes[idx] = " ".join(text_lines).strip()
    return purposes


def _code_name_boundary(words: list[Word], name_x0: float) -> float:
    """Split point between the "No." and "Parameter" columns.

    The header word's own x0 is off by a few points from the real data (the
    same float-jitter issue as the fault table's Description column), and
    here the visual gap is only ~4pt wide, so a fixed margin risks landing on
    the wrong side. Instead, measure the real gap directly: the rightmost
    edge of any actual code-shaped token near this boundary, and the leftmost
    edge of any actual "[Name" token near it, then split at the midpoint.
    """
    near = [w for w in words if w["x0"] < name_x0 + 20]
    code_max_x1 = max(
        (w["x1"] for w in near if re.match(r"^[A-Za-z]\d{2,3},?$", w["text"])), default=None
    )
    name_min_x0 = min((w["x0"] for w in near if w["text"].startswith("[")), default=None)
    if code_max_x1 is not None and name_min_x0 is not None and code_max_x1 < name_min_x0:
        return (code_max_x1 + name_min_x0) / 2
    return name_x0 - _COLUMN_MARGIN


def _parse_grid_param_page(
    words: list[Word], raw_lines: list[str], page_number: int
) -> list[dict[str, Any]]:
    name_x0 = _find_header_x(words, "Parameter") or _PARAM_NAME_X_FALLBACK
    # Small epsilon: header-label x0 measures a hair to the RIGHT of its own
    # column's real data start (same float-jitter class as the fault table's
    # Description column, just a smaller offset here) — e.g. "Min/Max" header
    # at x0=304.0089 while the real "0.00/600.00" data for the very same
    # column sits at x0=304.0, which fails a strict ``>=`` inclusion test.
    minmax_x0 = (
        _find_header_x(words, "Min/Max") or _PARAM_MINMAX_X_FALLBACK
    ) - _COLUMN_MARGIN_SMALL
    display_x0 = (
        _find_header_x(words, "Display/Options")
        or _find_header_x(words, "Display")
        or _PARAM_DISPLAY_X_FALLBACK
    ) - _COLUMN_MARGIN_SMALL
    default_x0 = (
        _find_header_x(words, "Default") or _PARAM_DEFAULT_X_FALLBACK
    ) - _COLUMN_MARGIN_SMALL
    # Everything above the table's own header row is page title/intro prose,
    # never table data — excluding it stops that prose from getting
    # nearest-assigned onto the FIRST parameter's Min/Max/Default (confirmed
    # on the real manual: "Chapter 2 Startup is simple..." bleeding into
    # P030's Default).
    header_top = _find_header_top(words, "No.") or 0.0
    footer_top = min(
        (w["top"] for w in words if w["text"] in ("Rockwell", "SYNTHETIC") and w["top"] > 400),
        default=None,
    )
    words = [
        w for w in words if w["top"] > header_top and (footer_top is None or w["top"] < footer_top)
    ]

    code_name_x0 = _code_name_boundary(words, name_x0)
    code_words = [w for w in words if w["x0"] < code_name_x0]
    name_words = _drop_footnote_definition_lines(
        [w for w in words if code_name_x0 <= w["x0"] < minmax_x0]
    )
    minmax_words = [w for w in words if minmax_x0 <= w["x0"] < display_x0]
    display_words = [w for w in words if display_x0 <= w["x0"] < default_x0]
    default_words = [w for w in words if w["x0"] >= default_x0]

    def _not_in_excluded_range(w: Word, ranges: list[tuple[float, float]]) -> bool:
        return not any(lo <= w["top"] <= hi for lo, hi in ranges)

    codes: list[tuple[str, float]] = []
    excluded_ranges: list[tuple[float, float]] = []  # (start_top, end_top) of skipped groups
    in_comma_group = False
    group_start_top: float | None = None
    for line in _cluster_lines(code_words):
        # A shared row lists several codes as a comma-separated group (e.g.
        # "P046, P048, P050 [Start Source 2]") — each code gets its OWN
        # Default value that this grid parser cannot recover per-code
        # without inventing an attribution, so the whole group is skipped.
        # The real manual sometimes wraps each member onto its OWN physical
        # line ("P046," / "P048," / "P050"), so grouping can't be detected by
        # counting tokens on a single line alone — track the trailing comma
        # across lines instead: a comma-suffixed code always starts/extends a
        # group; the next bare (non-comma) code closes it and is ALSO part of
        # the group, not a fresh standalone parameter. The group's own
        # Min/Max/Display/Default content (between its first and last member)
        # is excluded from nearest-assignment too, so it can't bleed onto a
        # surviving neighboring parameter (KNOWN LIMITATION: content that
        # continues past the last member line — e.g. a multi-line enum
        # options list — is not covered by this narrow exclusion and may
        # still bleed onto whichever single-code parameter is nearest).
        code_tokens = [w for w in line if re.match(r"^[A-Za-z]\d{2,3},?$", w["text"])]
        if len(code_tokens) > 1:
            in_comma_group = False  # multiple on one line -> already a group
            continue
        if not code_tokens:
            continue
        token = code_tokens[0]["text"]
        top = code_tokens[0]["top"]
        if token.endswith(","):
            if not in_comma_group:
                group_start_top = top
            in_comma_group = True
            continue
        if in_comma_group:
            in_comma_group = False
            if group_start_top is not None:
                excluded_ranges.append((group_start_top, top))
            continue
        m = _PARAM_CODE_RE.match(token)
        if m:
            codes.append((m["pid"], top))
    if not codes:
        return []

    if excluded_ranges:
        minmax_words = [w for w in minmax_words if _not_in_excluded_range(w, excluded_ranges)]
        display_words = [w for w in display_words if _not_in_excluded_range(w, excluded_ranges)]
        default_words = [w for w in default_words if _not_in_excluded_range(w, excluded_ranges)]

    spans = _extract_bracket_spans(name_words)
    name_by_pid: dict[str, str] = {}
    span_index_by_pid: dict[str, int] = {}
    for pid, top in codes:
        if not spans:
            continue
        idx = min(range(len(spans)), key=lambda i: abs(spans[i]["start_top"] - top))
        name_by_pid[pid] = spans[idx]["name"]
        span_index_by_pid[pid] = idx
    purposes_by_span = _purpose_for_spans(name_words, spans) if spans else {}

    minmax_text = _nearest_assign_text(minmax_words, codes)
    default_text = _nearest_assign_text(default_words, codes)

    entries: list[dict[str, Any]] = []
    for pid, _top in codes:
        raw_range_text = minmax_text.get(pid, "")
        raw_default_text = default_text.get(pid, "").strip()

        range_match = _RANGE_RE.search(raw_range_text)
        param_range = f"{range_match['lo']}/{range_match['hi']}" if range_match else None
        unit = range_match["unit"] if range_match and range_match["unit"] else None

        default_match = _DEFAULT_NUMERIC_RE.match(raw_default_text)
        if default_match:
            default = default_match["value"]
            unit = unit or (default_match["unit"] or None)
        elif raw_default_text:
            default = raw_default_text
        else:
            default = None

        name = name_by_pid.get(pid, "")
        purpose = purposes_by_span.get(span_index_by_pid.get(pid, -1), "")
        raw_excerpt = _find_raw_line(raw_lines, pid) or f"{pid} [{name}]"

        entries.append(
            {
                "parameter_id": pid,
                "name": name,
                "purpose": purpose,
                "range": param_range,
                "default": default,
                "unit": unit,
                "value_meanings": [],
                "related_faults": [],  # filled by link_fault_actions_to_parameters
                "related_parameters": [],  # grid layout carries none in this manual
                "page": page_number,
                "excerpt": raw_excerpt,
            }
        )
    return entries


# --- Labeled-block layout (unchanged extraction strategy — real-manual runs
# show this layout's Default:/Values Min/Max:/Display: lines already parse
# cleanly off extract_text(); the fix needed here is semantic, not
# positional: "Related Parameters:" must never populate related_faults.) ---

_LABELED_HEADER_RE = re.compile(
    r"^(?P<pid>[A-Za-z]\d{2,3})\s+\[(?P<name>[^\]]+)\]"
    r"(?:\s+Related Parameters:\s*(?P<related>.+))?$"
)
# ``(?:Values\s+)?`` tolerates BOTH label dialects: the PF525 manual attaches
# "Values" to Min/Max ("Default: 100" / "Values Min/Max: 1/247"); the PF40
# manual attaches it to Default instead ("Values Default: 5.0 Secs" /
# "Min/Max: 0.1/60.0 Secs"). The default group is NUMERIC-only: a worded/
# conditional default ("Based on Drive Rating") does NOT match, so ``default``
# stays None (honest null, not a truncated "Based"). A trailing engineering unit
# (Secs, Hz, %, …) — glued as "0.0%" or spaced as "5.0 Secs" — is captured and
# normalized so a numeric labeled value carries its unit.
_DEFAULT_LINE_RE = re.compile(
    r"^(?:Values\s+)?Default:\s*(?P<default>-?\d[\d.]*)\s*(?P<unit>%|[A-Za-z°]+)?"
)
_RANGE_LINE_RE = re.compile(
    r"^(?:Values\s+)?Min/Max:\s*(?P<range>-?[\d.]+/-?[\d.]+)\s*(?P<unit>%|[A-Za-z°]+)?"
)
# A Default:/Min/Max: LABEL line whose value wasn't numeric (worded default) must
# still be recognized as a label and kept OUT of the purpose free-text.
_VALUE_LABEL_LINE_RE = re.compile(r"^(?:Values\s+)?(?:Default|Min/Max):")
# A "Related Parameters:" list that wrapped onto a following line renders as a
# line of PURELY bare, comma-separated param ids ("A098, A114, A118") — no
# bracket, no prose. Unambiguous (prose never looks like this), so it is safe to
# treat as a related-list continuation regardless of block position.
_RELATED_CONT_LINE_RE = re.compile(r"^(?:[A-Za-z]\d{2,3}\s*,\s*)*[A-Za-z]\d{2,3},?$")
_OPTIONS_LINE_RE = re.compile(r"^Options:\s*(?P<options>.+)$")
_OPTION_ITEM_RE = re.compile(r"(?P<value>\d+)\s+(?P<meaning>[^,]+)")
# The real manual's enum options render as one option per line, quoted, with
# an inline "(Default)" annotation on whichever value is the default — e.g.
# `0 "Fault" (Default)` — rather than the synthetic fixture's old single
# "Options: 0 Fault, 1 Coast Stop, ..." shape. Recovers value_meanings AND
# the default for this common real-manual enum shape. The PF40 manual prefixes
# the FIRST option line with the label word ("Options 0 "Fault" (Default) …");
# ``_strip_options_prefix`` removes it so the first option parses like the rest.
_QUOTED_OPTION_LINE_RE = re.compile(
    r'^(?P<value>\d+)\s+[“"](?P<meaning>[^”"]+)[”"](?:\s*\((?P<is_default>Default)\))?'
)
_OPTIONS_PREFIX_RE = re.compile(r"^Options\s+(?=\d)")

# Engineering-unit normalization for labeled-block values — maps the manual's
# spelling to the canonical token the pack/grading use (and that the candidate
# generator's ``_KNOWN_UNITS`` accepts). Anything not listed returns None, so a
# bleed word never becomes a unit.
_UNIT_NORMALIZE = {
    "secs": "s",
    "sec": "s",
    "seconds": "s",
    "second": "s",
    "s": "s",
    "hz": "Hz",
    "ms": "ms",
    "min": "min",
    "mins": "min",
    "a": "A",
    "amps": "A",
    "amp": "A",
    "v": "V",
    "vac": "VAC",
    "vdc": "VDC",
    "rpm": "rpm",
    "poles": "poles",
    "%": "%",
    "kw": "kW",
    "w": "W",
    "ma": "mA",
}


def _normalize_unit(raw: str | None) -> str | None:
    if not raw:
        return None
    return _UNIT_NORMALIZE.get(raw.strip().lower())


def _strip_options_prefix(detail: str) -> str:
    return _OPTIONS_PREFIX_RE.sub("", detail, count=1)


def _bold_header_pids(words: list[Word]) -> set[str]:
    """Parameter ids whose header word is a BOLD heading font.

    Real param-definition headers (Helvetica-Narrow-Bold on the PF40/525
    template) are bold; plain-Helvetica graph/curve callouts (the PF40 p.71
    "A034 [Minimum Freq]" typo — a label that does NOT exist as a real
    parameter — plus duplicated callouts like A087/P031) and Helvetica-Narrow
    body references are NOT. Requiring the pid word to be bold rejects a callout
    before it becomes a fabricated parameter that would otherwise pass
    cite-integrity (the callout line really IS on the page). This generalizes
    PR-B's hardcoded page-98 skip. Precision over recall: a manual whose headers
    aren't bold loses recall (an honest gap), never ships a callout as real.
    """
    return {
        w["text"]
        for w in words
        if "bold" in (w.get("fontname") or "").lower() and _PARAM_CODE_RE.match(w["text"])
    }


def _split_related(raw: str) -> list[str]:
    return [tok.strip() for tok in re.split(r"[,\s]+", raw) if tok.strip()]


def _parse_labeled_param_page(
    text: str, raw_lines: list[str], page_number: int, words: list[Word] | None = None
) -> list[dict[str, Any]]:
    # Bold-header gate: only a pid rendered in a bold heading font is a real
    # parameter definition; a plain-Helvetica graph callout that happens to
    # match the header shape (PF40 p.71 "A034 [Minimum Freq]") is rejected. When
    # no font info is available (``words`` None/empty), fall back to accepting
    # every header (legacy behavior — keeps callers that pass only text working).
    words = words or []
    bold_pids = _bold_header_pids(words)
    font_seen = any(w.get("fontname") for w in words)

    def _is_real_header(m: re.Match[str] | None) -> bool:
        return bool(m) and (not font_seen or m["pid"] in bold_pids)

    entries: list[dict[str, Any]] = []
    lines = [
        ln.strip() for ln in text.splitlines() if ln.strip() and not _PAGE_FURNITURE_RE.search(ln)
    ]
    i = 0
    while i < len(lines):
        line = lines[i]
        labeled = _LABELED_HEADER_RE.match(line)
        if not _is_real_header(labeled):
            i += 1
            continue

        block_lines = [line]
        purpose_lines: list[str] = []
        related_cont: list[str] = []
        default: str | None = None
        unit: str | None = None
        param_range: str | None = None
        value_meanings: list[dict[str, str]] = []

        j = i + 1
        while j < len(lines) and not _is_real_header(_LABELED_HEADER_RE.match(lines[j])):
            detail = lines[j]
            block_lines.append(detail)

            default_match = _DEFAULT_LINE_RE.match(detail)
            range_match = _RANGE_LINE_RE.match(detail)
            options_match = _OPTIONS_LINE_RE.match(detail)
            quoted_option = _QUOTED_OPTION_LINE_RE.match(_strip_options_prefix(detail))

            if default_match:
                default = default_match["default"]
                unit = unit or _normalize_unit(default_match["unit"])
            elif range_match:
                param_range = range_match["range"]
                unit = unit or _normalize_unit(range_match["unit"])
            elif options_match:
                for item in _OPTION_ITEM_RE.finditer(options_match["options"]):
                    value_meanings.append(
                        {"value": item["value"], "meaning": item["meaning"].strip()}
                    )
            elif quoted_option:
                value_meanings.append(
                    {"value": quoted_option["value"], "meaning": quoted_option["meaning"].strip()}
                )
                if quoted_option["is_default"] and default is None:
                    default = quoted_option["value"]
            elif _RELATED_CONT_LINE_RE.match(detail):
                # A "Related Parameters:" list that wrapped to a second line —
                # a line that is PURELY bare, comma-separated param ids (no
                # bracket, no prose), e.g. "A098, A114, A118" under P033. Extend
                # related_parameters and keep it OUT of the purpose free-text
                # (the real manual wraps these lists on the motor params).
                related_cont.extend(_split_related(detail))
            elif (
                not detail.startswith("Display:")
                and detail != "Options"
                and not _VALUE_LABEL_LINE_RE.match(detail)
            ):
                purpose_lines.append(detail)

            j += 1

        related_parameters = (_split_related(labeled["related"]) if labeled["related"] else []) + [
            r for r in related_cont if r not in _split_related(labeled["related"] or "")
        ]
        pid = labeled["pid"]
        raw_excerpt = _find_raw_line(raw_lines, pid) or line

        entries.append(
            {
                "parameter_id": pid,
                "name": labeled["name"].strip(),
                "purpose": " ".join(purpose_lines).strip(),
                "range": param_range,
                "default": default,
                "unit": unit,
                "value_meanings": value_meanings,
                "related_faults": [],  # filled by link_fault_actions_to_parameters
                "related_parameters": related_parameters,
                "page": page_number,
                "excerpt": raw_excerpt,
            }
        )
        i = j

    return entries


def parse_parameters(
    pdf_path: str | Path, *, pages: list[int] | None = None
) -> list[dict[str, Any]]:
    """Parse every page's parameter tables (both layouts) into a list of
    per-parameter dicts.

    Dispatches PER PAGE by header shape — a page carrying both a "Min/Max"
    and a "Default" column header uses the position-aware GRID parser
    (``_parse_grid_param_page``); every other page uses the labeled-block
    line parser (``_parse_labeled_param_page``). The real manual's chapters
    use exactly one layout per page, never mixed.

    ``pages``, when given, is a list of 1-based page numbers (matching
    pdfplumber's ``Page.page_number``) — ONLY those pages of the ORIGINAL pdf
    are read, selected by number (never by re-slicing into a new PDF — see
    ``parse_faults`` docstring for why). ``pages=None`` (default) scans every
    page.

    Returns dicts shaped: ``{parameter_id, name, purpose, range, default,
    unit, value_meanings:list[{value,meaning}], related_faults:list[str],
    related_parameters:list[str], page:int, excerpt:str}``. ``related_faults``
    starts empty on every entry here — it is populated by
    ``link_fault_actions_to_parameters`` from the FAULT table's own outbound
    references, never from this page's "Related Parameters:" line (that is a
    param<->param link, out of scope for ``related_faults`` — see module
    docstring).
    """
    wanted = set(pages) if pages is not None else None
    entries: list[dict[str, Any]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            if wanted is not None and page.page_number not in wanted:
                continue
            # Magnetek/Yaskawa IMPULSE dotted-parameter listing first — gated
            # on its own per-page header shape (see magnetek_dialect), which
            # no PowerFlex page carries.
            magnetek = magnetek_dialect.parse_magnetek_param_page(page)
            if magnetek:
                entries.extend(magnetek)
                continue
            # ``fontname`` is needed by the labeled parser's bold-header gate to
            # tell a real (bold) parameter header from a plain-Helvetica graph
            # callout; it is harmless to the grid parser (x0/top only).
            words = page.extract_words(extra_attrs=["fontname"])
            text = page.extract_text() or ""
            raw_lines = text.splitlines()
            if _looks_like_grid_page(words):
                entries.extend(_parse_grid_param_page(words, raw_lines, page.page_number))
            else:
                entries.extend(_parse_labeled_param_page(text, raw_lines, page.page_number, words))
    return entries


def link_fault_actions_to_parameters(
    faults: list[dict[str, Any]], parameters: list[dict[str, Any]]
) -> None:
    """Invert each fault's outbound ``references_parameters`` into the
    referenced parameter's ``related_faults`` — mutates ``parameters`` in
    place.

    This is the fix for the semantically-wrong direction: a parameter's
    ``related_faults`` MUST contain only fault codes (e.g. ``"F081"``),
    derived from a FAULT's "Modify using <PARAM>" action text — never a
    parameter id, and never sourced from another parameter's own "Related
    Parameters:" line.
    """
    param_to_faults: dict[str, set[str]] = {}
    for fault in faults:
        for ref in fault.get("references_parameters", []):
            param_to_faults.setdefault(ref, set()).add(fault["fault_id"])

    for param in parameters:
        param["related_faults"] = sorted(param_to_faults.get(param["parameter_id"], set()))


# ---------------------------------------------------------------------------
# Cite-integrity gate + pack-fragment assembly
# ---------------------------------------------------------------------------


def verify_and_filter_entries(
    pdf_path: str | Path, entries: list[dict[str, Any]], *, label: str
) -> list[dict[str, Any]]:
    """Drop any entry whose ``excerpt`` doesn't verify on its claimed ``page``.

    This is the anti-fabrication gate in force: the extractor calls this on
    every parsed entry before it is allowed into the output. A dropped entry
    is logged (never silently discarded without a trace) and never raises —
    an unverifiable entry is a data-quality finding, not a crash.

    Opens ``pdf_path`` ONCE for this call and re-derives each referenced
    page's own text directly from that single read — not a stale/caller-
    supplied cache, still the page's real ``extract_text()`` output, just
    read once instead of once-per-entry. This matters on a real, large
    manual: ``cite_integrity.verify_excerpt_on_page`` (unchanged, and still
    the single-excerpt contract the cite-integrity tests exercise directly)
    reopens the whole PDF from disk on every call, which is fine for one-off
    checks but made this function the dominant cost on the real 274-page,
    32.9MB manual (~0.6s per entry x 83 entries =~ 50s) even after page-range
    scoping cut the parse step itself to under 2s — a second, independent
    perf layer (`.claude/rules/debugging-conventions.md` #1: re-measure after
    each fix and look for the next compounding cause) worth closing so the
    scoped end-to-end run is actually fast, not just "not a timeout."
    """
    needed_pages = {entry["page"] for entry in entries}
    page_text_by_number: dict[int, str] = {}
    if needed_pages:
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                if page.page_number in needed_pages:
                    page_text_by_number[page.page_number] = cite_integrity.normalize(
                        page.extract_text() or ""
                    )

    kept: list[dict[str, Any]] = []
    for entry in entries:
        identifier = entry.get("fault_id") or entry.get("parameter_id")
        excerpt_norm = cite_integrity.normalize(entry["excerpt"])
        page_text = page_text_by_number.get(entry["page"])
        verified = bool(excerpt_norm) and page_text is not None and excerpt_norm in page_text
        if verified:
            kept.append(entry)
        else:
            logger.warning(
                "drive-pack-extract: dropping unverifiable %s entry %s "
                "(page %s) — excerpt not found verbatim on that page",
                label,
                identifier,
                entry.get("page"),
            )
    return kept


def assemble_pack_fragment(
    faults: list[dict[str, Any]], parameters: list[dict[str, Any]], *, doc: str
) -> dict[str, Any]:
    """Reshape parsed fault/parameter dicts into drive-pack-shaped JSON.

    This is a FRAGMENT, not a complete ``pack.json`` — it carries only what a
    manual's fault/parameter pages can supply
    (``fault_codes``/``parameters``/``keypad_navigation``, plus
    ``fault_citations`` so the per-fault manual reference isn't lost even
    though ``schema.LiveDecode.fault_codes`` itself is a flat int->name map).
    A separate offline run (PR-B) merges this fragment with the family/
    nameplate/live_decode.status_bits/cmd_word/envelope data that only bench
    verification — not manual text — can supply, into a full pack.json
    matching ``mira-bots/shared/drive_packs/schema.py``.
    """
    fault_codes: dict[int, str] = {}
    fault_entries: list[dict[str, Any]] = []
    fault_citations: list[dict[str, str]] = []
    for fault in faults:
        if fault["code"] is None:
            # Mnemonic identifier (Magnetek/Yaskawa dialect: "oC", "Uv1",
            # "LC dn") — the runtime ``live_decode.fault_codes`` map is
            # dict[int,str] and CANNOT hold it. Never invent an integer:
            # the entry goes to the candidate-layer ``fault_entries`` list,
            # SOURCE-PRESERVED, as Run C schema evidence. The runtime loader
            # tolerates (ignores) this extra key; nothing consumes it yet.
            fault_entries.append(
                {
                    "fault_id": fault["fault_id"],
                    "name": fault["name"],
                    "action": fault.get("action", ""),
                    "flashing": fault.get("flashing", False),
                    "secondary_label": fault.get("secondary_label", ""),
                    "references_parameters": fault.get("references_parameters", []),
                    "ambiguous_glyphs": fault.get("ambiguous_glyphs", []),
                    "source_citation": {
                        "doc": doc,
                        "page": str(fault["page"]),
                        "excerpt": fault["excerpt"],
                    },
                }
            )
        else:
            fault_codes[fault["code"]] = fault["name"]
        fault_citations.append(
            {
                "fault_id": fault["fault_id"],
                "doc": doc,
                "page": str(fault["page"]),
                "excerpt": fault["excerpt"],
            }
        )

    parameter_cards: list[dict[str, Any]] = []
    for param in parameters:
        parameter_cards.append(
            {
                "parameter_id": param["parameter_id"],
                "name": param["name"],
                "purpose": param["purpose"],
                "value_meanings": param["value_meanings"],
                "default": param["default"],
                "range": param["range"],
                "unit": param["unit"],
                "related_faults": param["related_faults"],
                "source_citation": {
                    "doc": doc,
                    "page": str(param["page"]),
                    "excerpt": param["excerpt"],
                },
                "provenance_tier": "manual_cited",
            }
        )

    return {
        "fault_codes": fault_codes,
        "fault_entries": fault_entries,
        "fault_citations": fault_citations,
        "parameters": parameter_cards,
        "keypad_navigation": [],
    }


def read_pages(pdf_path: str | Path) -> list[tuple[int, str]]:
    """Read every page of ``pdf_path`` as ``(page_number, extract_text())``.

    ``page_number`` is 1-indexed (pdfplumber's ``Page.page_number``), matching
    what ``cite_integrity.verify_excerpt_on_page`` expects. Kept for callers
    (and tests) that just want raw page text; ``parse_faults``/
    ``parse_parameters`` no longer use it internally — they open the PDF
    themselves so they can also read ``extract_words()``.
    """
    with pdfplumber.open(str(pdf_path)) as pdf:
        return [(page.page_number, page.extract_text() or "") for page in pdf.pages]


def extract(
    pdf_path: str | Path,
    *,
    doc: str | None = None,
    fault_pages: list[int] | None = None,
    param_pages: list[int] | None = None,
) -> dict[str, Any]:
    """End-to-end: read a manual PDF, parse faults + parameters, link each
    fault's outbound parameter reference into that parameter's
    ``related_faults``, drop any entry that fails cite-integrity
    verification, and return a drive-pack fragment (see
    ``assemble_pack_fragment``).

    ``doc`` labels the source in every citation; defaults to the PDF's
    filename. ``fault_pages``/``param_pages`` are optional 1-based page
    number lists (see ``parse_faults``/``parse_parameters``) that scope which
    pages of the ORIGINAL pdf each parser reads — pass these for any large
    manual so the run stays fast (seconds, not a whole-document scan) and so
    parameter-only pages don't get scanned (harmlessly, but slowly and
    noisily) by the fault parser and vice versa. ``None`` (default) scans the
    whole document with each parser, matching the pre-scoping behavior.
    Read-only: opens the PDF, writes nothing to disk itself (the caller
    decides whether/where to write the returned dict as JSON).
    """
    pdf_path = Path(pdf_path)
    doc_label = doc or pdf_path.name

    faults = parse_faults(pdf_path, pages=fault_pages)
    parameters = parse_parameters(pdf_path, pages=param_pages)
    link_fault_actions_to_parameters(faults, parameters)

    verified_faults = verify_and_filter_entries(pdf_path, faults, label="fault")
    verified_parameters = verify_and_filter_entries(pdf_path, parameters, label="parameter")

    return assemble_pack_fragment(verified_faults, verified_parameters, doc=doc_label)
