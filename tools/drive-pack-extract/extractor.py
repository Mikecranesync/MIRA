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
bins correctly. Hardcoded fallbacks exist only for the rare page missing its
own header.

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

_FAULT_DESC_HEADER_X_FALLBACK = 334.0
_FAULT_ACTION_HEADER_X_FALLBACK = 444.4
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
_FAULT_ROW_RE = re.compile(
    r"^(?P<code>[A-Za-z]\d{2,3})(?:\(\d+\))?\s+(?P<name>.+?)\s+(?P<ftype>[12]|—)(?:\(\d+\))?$"
)
# A "name only" row: a code sharing its Fault-Type/description/action with a
# later row in the same shared multi-code group (real manual's F038/F039/F040
# "Phase U/V/W to Gnd" style groups). Tried only after the full-row regex
# fails, so it never swallows a full row.
_FAULT_NAME_ONLY_RE = re.compile(r"^(?P<code>[A-Za-z]\d{2,3})(?:\(\d+\))?\s+(?P<name>.+)$")
# A bare Fault-Type token closing a pending group (the real manual centers
# the shared type value on its own line within the merged row).
_FAULT_FTYPE_ONLY_RE = re.compile(r"^(?P<ftype>[12]|—)(?:\(\d+\))?$")

# An explicit fault -> parameter cross-reference: "Modify using C125 [Comm
# Loss Action]." ``pdfplumber`` tokenizes the id and the bracketed name as
# separate words, so this matches on adjacent WORDS, not within one regex.
_CROSS_REF_ID_RE = re.compile(r"^[A-Za-z]\d{2,3}$")


def _find_cross_refs(action_words: list[Word]) -> list[tuple[str, float]]:
    ordered = sorted(action_words, key=lambda w: (w["top"], w["x0"]))
    refs: list[tuple[str, float]] = []
    for i in range(len(ordered) - 1):
        w, nxt = ordered[i], ordered[i + 1]
        if _CROSS_REF_ID_RE.match(w["text"]) and nxt["text"].startswith("["):
            refs.append((w["text"], w["top"]))
    return refs


def _parse_fault_page(
    words: list[Word], raw_lines: list[str], page_number: int
) -> list[dict[str, Any]]:
    desc_header_x = _find_header_x(words, "Description") or _FAULT_DESC_HEADER_X_FALLBACK
    action_header_x = _find_header_x(words, "Action") or _FAULT_ACTION_HEADER_X_FALLBACK

    left_words = [w for w in words if w["x0"] < desc_header_x - _COLUMN_MARGIN]
    action_words = [w for w in words if w["x0"] >= action_header_x - _COLUMN_MARGIN_SMALL]

    groups: list[dict[str, Any]] = []  # {"members": [(code,name,top)], "ftype": str, "top": float}
    pending: list[tuple[str, str, float]] = []
    last_ftype: str | None = None

    left_lines = _cluster_lines(left_words)
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
        # per shared row, so the dangling trailing member(s) inherit the
        # last confirmed value on this page. If no type was ever seen on the
        # page, we drop rather than invent one.
        if last_ftype is not None:
            groups.append({"members": pending, "ftype": last_ftype, "top": pending[-1][2]})
        else:
            logger.warning(
                "drive-pack-extract: dropping %d fault row(s) with no recoverable "
                "Fault-Type on page %s: %s",
                len(pending),
                page_number,
                [code for code, _, _ in pending],
            )

    anchors = [(code, group["top"]) for group in groups for (code, _, _) in group["members"]]
    refs = _find_cross_refs(action_words)
    for group in groups:
        group["references_parameters"] = []
    for param_id, ref_top in refs:
        if not groups:
            continue
        nearest = min(groups, key=lambda g: abs(g["top"] - ref_top))
        if param_id not in nearest["references_parameters"]:
            nearest["references_parameters"].append(param_id)

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
_DEFAULT_LINE_RE = re.compile(r"^Default:\s*(?P<default>\S+)")
_RANGE_LINE_RE = re.compile(r"^Values Min/Max:\s*(?P<range>[\d.]+/[\d.]+)")
_OPTIONS_LINE_RE = re.compile(r"^Options:\s*(?P<options>.+)$")
_OPTION_ITEM_RE = re.compile(r"(?P<value>\d+)\s+(?P<meaning>[^,]+)")
# The real manual's enum options render as one option per line, quoted, with
# an inline "(Default)" annotation on whichever value is the default — e.g.
# `0 "Fault" (Default)` — rather than the synthetic fixture's old single
# "Options: 0 Fault, 1 Coast Stop, ..." shape. Recovers value_meanings AND
# the default for this common real-manual enum shape.
_QUOTED_OPTION_LINE_RE = re.compile(
    r'^(?P<value>\d+)\s+[“"](?P<meaning>[^”"]+)[”"](?:\s*\((?P<is_default>Default)\))?'
)


def _split_related(raw: str) -> list[str]:
    return [tok.strip() for tok in re.split(r"[,\s]+", raw) if tok.strip()]


def _parse_labeled_param_page(
    text: str, raw_lines: list[str], page_number: int
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    lines = [
        ln.strip() for ln in text.splitlines() if ln.strip() and not _PAGE_FURNITURE_RE.search(ln)
    ]
    i = 0
    while i < len(lines):
        line = lines[i]
        labeled = _LABELED_HEADER_RE.match(line)
        if not labeled:
            i += 1
            continue

        block_lines = [line]
        purpose_lines: list[str] = []
        default: str | None = None
        param_range: str | None = None
        value_meanings: list[dict[str, str]] = []

        j = i + 1
        while j < len(lines) and not _LABELED_HEADER_RE.match(lines[j]):
            detail = lines[j]
            block_lines.append(detail)

            default_match = _DEFAULT_LINE_RE.match(detail)
            range_match = _RANGE_LINE_RE.match(detail)
            options_match = _OPTIONS_LINE_RE.match(detail)
            quoted_option = _QUOTED_OPTION_LINE_RE.match(detail)

            if default_match:
                default = default_match["default"]
            elif range_match:
                param_range = range_match["range"]
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
            elif not detail.startswith("Display:") and detail != "Options":
                purpose_lines.append(detail)

            j += 1

        related_parameters = _split_related(labeled["related"]) if labeled["related"] else []
        pid = labeled["pid"]
        raw_excerpt = _find_raw_line(raw_lines, pid) or line

        entries.append(
            {
                "parameter_id": pid,
                "name": labeled["name"].strip(),
                "purpose": " ".join(purpose_lines).strip(),
                "range": param_range,
                "default": default,
                "unit": None,
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
            words = page.extract_words()
            text = page.extract_text() or ""
            raw_lines = text.splitlines()
            if _looks_like_grid_page(words):
                entries.extend(_parse_grid_param_page(words, raw_lines, page.page_number))
            else:
                entries.extend(_parse_labeled_param_page(text, raw_lines, page.page_number))
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
    fault_citations: list[dict[str, str]] = []
    for fault in faults:
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
