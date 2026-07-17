"""Magnetek IMPULSE (Yaskawa-derived) manual dialect — fault + parameter parsers.

Run B of the Magnetek investigation (Run A = PR #2690: genuine unseen baseline,
0 faults / 0 parameters). The IMPULSE G+ Mini Technical Manual (144-25085) uses
a document dialect the PowerFlex-tuned parsers cannot see:

- **Faults are mnemonics**, not numbers: ``oC``, ``bb``, ``Uv1``, ``CoF``,
  ``LC dn`` (with a space), ``oPE02``, ``CPF24``. Casing is SEMANTIC — ``UV``
  (undervoltage during stop, flashing) and ``Uv1`` (DC bus undervolt fault) are
  different codes. Identifiers are therefore SOURCE-PRESERVED strings; this
  module never invents an integer for them and never "fixes" casing. Glyphs
  that are confusable in print (``o``/``O``/``0``, ``l``/``I``/``1``,
  ``v``/``V``, ``b``/``B``, ``r``/``R``) are FLAGGED per entry in
  ``ambiguous_glyphs`` instead of silently normalized.
- **Fault table** (G+ Mini pp.135-140) is three columns —
  ``Fault | Fault or Indicator Name/Description | Corrective Action`` — with
  the header repeated on every page and FULL-WIDTH HORIZONTAL RULES between
  rows (no vertical rules: pdfplumber's table detection finds nothing, but the
  row separators are reliable ``page.rects`` with width > ~400pt). Rows are
  segmented by those rules; columns by header-word x-coordinates.
- **Parameters are dotted** (``B01.18``, ``H03.10``, ``U01.10``) and the
  canonical listing (G+ Mini pp.144+) is a per-page-headed
  ``Parameter | Parameter Name | Default | Range | Units | Page`` table with
  EN-DASH ranges (``0.00–150.00``, not the PowerFlex ``0.00/600.00``), hex
  enum values (``00–1F``), footnote-starred defaults (``0.00*``), and per-line
  enum meanings (``00: Digital Reference Only``).

Page-identity gates are DISJOINT from the PowerFlex parsers by construction:
the Magnetek fault header renders "Name/Description" as ONE word, so the
PowerFlex gate (exact word "Description") never fires on these pages — the
reason Run A returned an honest 0 rather than garbage — and this module's
gates require that same "Name/Description" token, so they can never fire on a
PowerFlex page.

Out of scope BY DESIGN (see MAGNETEK_DIALECT.md):
- the auto-tuning fault table (G+ Mini p.141: ``Er-01``…, ``End 3`` — its own
  namespace under a DIFFERENT header, "Fault Display");
- U-group monitor/fault-trace/maintenance tables (pp.129-133) and the
  Symptom/Corrective-Action troubleshooting guides (p.134) — parameter-shaped
  or fault-shaped but not fault/parameter DEFINITIONS;
- prose/description sections: parameter ids mentioned in corrective actions or
  running text ("Check H01.01 through H01.07") are cross-REFERENCES, captured
  on the fault entry, never emitted as parameter definitions.

Read-only, offline, no runtime imports — same contract as ``extractor.py``.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("drive-pack-extract.magnetek")

Word = dict[str, Any]

# ── identifiers ──────────────────────────────────────────────────────────────

# One mnemonic token: 1-4 letters then 0-2 digits ("oC", "bb", "CPF24",
# "oPE02", "Uv1", "MNT"). Explicitly NOT the PowerFlex F\d+ shape and NOT the
# auto-tune "Er-01"/"End 1" shapes (excluded namespace).
_MNEMONIC_TOKEN_RE = re.compile(r"^[A-Za-z]{1,4}\d{0,2}$")
# A full fault-cell identifier may be two tokens ("LC dn") — validated
# token-wise, preserved verbatim including its single interior space.
_FLASHING_RE = re.compile(r"^\(flashing\)$", re.IGNORECASE)
# Dotted parameter id: letter + 2 digits + '.' + 2 digits (B01.18, U01.10).
_DOTTED_PARAM_RE = re.compile(r"^[A-Za-z]\d{2}\.\d{2}$")
# Dotted ids appearing INSIDE prose/action text (cross-references).
_DOTTED_REF_RE = re.compile(r"\b([A-Za-z]\d{2}\.\d{2})\b")
# Enum/value-meaning line in the parameter listing: "00: Digital Reference
# Only" / "0F: Not Used" (hex values happen), optional trailing manual-page int.
_ENUM_LINE_RE = re.compile(r"^(?P<value>[0-9A-Fa-f]{1,2}):\s+(?P<meaning>.+?)(?:\s+\d{1,3})?$")

# Confusable print glyphs (documented in MAGNETEK_DIALECT.md §3). Detection
# only — the identifier string itself is never altered.
_CONFUSABLE = {
    "o": "O0",
    "O": "o0",
    "0": "oO",
    "l": "I1",
    "I": "l1",
    "1": "lI",
    "v": "V",
    "V": "v",
    "b": "B",
    "B": "b",
    "r": "R",
    "R": "r",
}

_WIDE_RECT_MIN_WIDTH = 400.0  # full-width row separators measure ~504pt
_LINE_TOL = 3.0
_COL_MARGIN = 3.0


def _ambiguous_glyphs(identifier: str) -> list[dict[str, Any]]:
    """Flag confusable glyphs in a source-preserved identifier (never mutate)."""
    flags: list[dict[str, Any]] = []
    for idx, ch in enumerate(identifier):
        confusable = _CONFUSABLE.get(ch)
        if confusable:
            flags.append({"index": idx, "glyph": ch, "confusable_with": confusable})
    return flags


def _cluster_lines(words: list[Word], tol: float = _LINE_TOL) -> list[list[Word]]:
    lines: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0]["top"] - word["top"]) <= tol:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _line_text(line: list[Word]) -> str:
    return " ".join(w["text"] for w in line)


# ── fault table ──────────────────────────────────────────────────────────────


_FOOTER_TOP = 735.0  # the running footer renders below this on every page
_STEP_NUM_RE = re.compile(r"^\d{1,2}\.$")


def _occupied_intervals(words: list[Word], *, join_tol: float = 3.0) -> list[tuple[float, float]]:
    """Merged occupied x-intervals — the whitespace channels between them are
    the table's REAL column boundaries. (The Magnetek headers are CENTERED
    over their columns while cell text is left-aligned, so header x0s are NOT
    usable band edges — measured on the real manual: the 'Corrective' header
    sits ~70pt right of the action cell's own left edge.)"""
    merged: list[list[float]] = []
    for x0, x1 in sorted((w["x0"], w["x1"]) for w in words):
        if merged and x0 <= merged[-1][1] + join_tol:
            merged[-1][1] = max(merged[-1][1], x1)
        else:
            merged.append([x0, x1])
    return [(a, b) for a, b in merged]


def _fault_header_top(words: list[Word]) -> float | None:
    """Top of the ``Fault | Fault or Indicator Name/Description | Corrective
    Action`` header line, or None when this page has no Magnetek fault table.

    The gate token is the single word "Name/Description" — present on every
    G+ Mini fault page (header repeats per page; verified against the real
    manual) and absent from every PowerFlex table.
    """
    name_desc = [w for w in words if w["text"] == "Name/Description"]
    if not name_desc:
        return None
    header_top = min(w["top"] for w in name_desc)
    header_words = [w for w in words if abs(w["top"] - header_top) <= _LINE_TOL]
    labels = {w["text"] for w in header_words}
    if "Fault" not in labels or "Corrective" not in labels:
        return None
    return header_top


def _fault_columns(body: list[Word]) -> tuple[float, float] | None:
    """(desc_x0, action_x0) derived from the body's own geometry: the first
    whitespace channel right of the code column bounds the description cell;
    the action cell's left edge is where its numbered steps ("1.", "2.")
    start. Falls back to the next occupied interval when a row has no
    numbered steps at all."""
    intervals = _occupied_intervals(body)
    if len(intervals) < 2:
        return None

    # The description column is the interval holding the MOST words — the
    # narrow code column can itself split into sub-intervals (the "CPF18 and"
    # conjunction words sit 4pt right of the code tokens on the real manual),
    # so "second interval" is not a safe pick.
    def _word_count(interval: tuple[float, float]) -> int:
        a, b = interval
        return sum(1 for w in body if a - 0.5 <= w["x0"] <= b + 0.5)

    step_nums = [w["x0"] for w in body if _STEP_NUM_RE.fullmatch(w["text"])]

    # Compute action_x0 from the DOMINANT step-number cluster, not the global min.
    # Stray "1."/"2." tokens in description cells lower on the page can be the global
    # minimum but not the real action column. Cluster with tolerance, pick the cluster
    # with the most members, use that cluster's min.
    if step_nums:
        step_nums_sorted = sorted(step_nums)
        clusters = []
        current_cluster = [step_nums_sorted[0]]
        for x in step_nums_sorted[1:]:
            if x - current_cluster[-1] <= 5.0:  # tolerance: 5pt
                current_cluster.append(x)
            else:
                clusters.append(current_cluster)
                current_cluster = [x]
        clusters.append(current_cluster)
        dominant_cluster = max(clusters, key=len)
        action_x0_base = min(dominant_cluster)
    else:
        action_x0_base = None

    candidates = [iv for iv in intervals if action_x0_base is None or iv[0] < action_x0_base - 1.0]
    if not candidates:
        return None
    desc_interval = max(candidates[1:] or candidates, key=_word_count)
    desc_x0 = desc_interval[0] - _COL_MARGIN
    if action_x0_base is not None:
        action_x0 = action_x0_base - _COL_MARGIN
    elif len(intervals) >= 3:
        action_x0 = intervals[-1][0] - _COL_MARGIN
    else:
        return None
    if action_x0 <= desc_x0:
        return None
    return desc_x0, action_x0


def _row_spans(page, header_top: float) -> list[tuple[float, float]]:
    """Row (top, bottom) spans between full-width horizontal rules below the header."""
    tops = sorted(
        r["top"]
        for r in page.rects
        if r["width"] >= _WIDE_RECT_MIN_WIDTH and r["top"] > header_top + 1.0
    )
    deduped: list[float] = []
    for t in tops:
        if not deduped or t - deduped[-1] > 2.0:
            deduped.append(t)
    return [(a, b) for a, b in zip(deduped, deduped[1:]) if b - a > 6.0]


def _split_codes(cell_first_line: str) -> list[str]:
    """Split a multi-code cell ("CPF18 and CPF19") into verbatim identifiers.

    A single identifier may itself contain a space ("LC dn") — only the
    explicit ``and`` conjunction splits. In a two-token identifier the second
    token must be a SHORT LOWERCASE display suffix (the manual's ``LC dn``):
    anything longer/capitalized ("LC Done") is a secondary display LABEL, not
    a code — treating it as one fabricated a fault in the first live run.
    """
    parts = [p.strip() for p in re.split(r"\s+and\s+", cell_first_line) if p.strip()]
    out: list[str] = []
    for part in parts:
        tokens = part.split()
        if not tokens or not all(_MNEMONIC_TOKEN_RE.match(t) for t in tokens):
            continue
        if len(tokens) == 1:
            out.append(part)
        elif len(tokens) == 2 and len(tokens[1]) <= 2 and tokens[1].islower():
            out.append(part)
    return out


def parse_magnetek_fault_page(page) -> list[dict[str, Any]]:
    """Parse one Magnetek 3-column fault page into per-fault dicts.

    Returns entries shaped like ``extractor.parse_faults`` output, EXCEPT:
    ``code`` is ``None`` (mnemonics never get an invented integer) and each
    entry adds ``flashing``/``secondary_label``/``ambiguous_glyphs``.
    Returns [] when the page does not carry the Magnetek fault header.
    """
    words = page.extract_words()
    header_top = _fault_header_top(words)
    if header_top is None:
        return []
    body = [w for w in words if header_top + _LINE_TOL < w["top"] < _FOOTER_TOP]
    columns = _fault_columns(body)
    if columns is None:
        return []
    desc_x0, action_x0 = columns
    raw_lines = (page.extract_text() or "").splitlines()

    # Groups survive across ruled spans: a left cell ending in "and"
    # ("CPF18 and" | rule | "CPF19") is ONE multi-code group whose
    # description/action may straddle the rule — verified on the real manual.
    groups: list[dict[str, Any]] = []
    pending_and: dict[str, Any] | None = None
    for row_top, row_bottom in _row_spans(page, header_top):
        row_words = [w for w in words if row_top < w["top"] < row_bottom]
        if not row_words:
            continue
        left = [w for w in row_words if w["x0"] < desc_x0 - _COL_MARGIN]
        mid = [w for w in row_words if desc_x0 - _COL_MARGIN <= w["x0"] < action_x0 - _COL_MARGIN]
        right = [w for w in row_words if w["x0"] >= action_x0 - _COL_MARGIN]

        left_lines = _cluster_lines(left)
        mid_lines = _cluster_lines(mid)
        right_lines = _cluster_lines(right)

        # A ruled span can also hold SEVERAL logical fault rows (the manual
        # omits the rule between e.g. oH1 and oH2): every left-band line that
        # parses as code(s) anchors a sub-group. Flashing markers and
        # secondary display labels attach to the anchor above them.
        span_groups: list[dict[str, Any]] = []
        i = 0
        while i < len(left_lines):
            text = _line_text(left_lines[i])
            top = left_lines[i][0]["top"]
            joined = text
            while joined.rstrip().endswith(" and") and i + 1 < len(left_lines):
                i += 1
                joined = joined.rstrip() + " " + _line_text(left_lines[i])
            if pending_and is not None and not span_groups:
                merged = _split_codes(pending_and["and_text"].rstrip() + " " + joined)
                if merged:
                    pending_and["codes"] = merged
                    pending_and.pop("and_text", None)
                    span_groups.append(pending_and)
                    pending_and = None
                    i += 1
                    continue
                pending_and = None  # continuation didn't parse — drop the hold
            codes = _split_codes(joined)
            if codes:
                span_groups.append(
                    {
                        "codes": codes,
                        "top": top,
                        "flashing": False,
                        "labels": [],
                        "desc": [],
                        "action": [],
                    }
                )
            elif joined.rstrip().endswith(" and") or joined.strip() == "and":
                # dangling conjunction — the partner code is past the next rule
                pending_and = {
                    "codes": [],
                    "and_text": joined,
                    "top": top,
                    "flashing": False,
                    "labels": [],
                    "desc": [],
                    "action": [],
                }
            elif span_groups and _FLASHING_RE.match(text.strip()):
                span_groups[-1]["flashing"] = True
            elif span_groups:
                span_groups[-1]["labels"].append(text.strip())
            i += 1

        # "CPF18 and" itself carries codes AND a dangling and — detect it on
        # the last group of the span so a partner code past the next rule
        # joins this group rather than orphaning.
        if span_groups:
            last_left = _line_text(left_lines[-1]) if left_lines else ""
            if last_left.rstrip().endswith(" and"):
                span_groups[-1]["and_text"] = " ".join(span_groups[-1]["codes"]) + " and"
                pending_and = span_groups[-1]

        targets = span_groups or ([groups[-1]] if groups else [])
        if not targets:
            continue  # nothing anchors this span — safe drop
        for line in mid_lines:
            line_top = line[0]["top"]
            tgt = min(
                targets,
                key=lambda g: (
                    abs(g["top"] - line_top) + (0.0 if line_top >= g["top"] - _LINE_TOL else 1000.0)
                ),
            )
            tgt["desc"].append(_line_text(line))
        for line in right_lines:
            line_top = line[0]["top"]
            tgt = min(
                targets,
                key=lambda g: (
                    abs(g["top"] - line_top) + (0.0 if line_top >= g["top"] - _LINE_TOL else 1000.0)
                ),
            )
            tgt["action"].append(_line_text(line))
        groups.extend(span_groups)

    # Propagate shared actions: when a group has no action text, inherit from the
    # previous group if they share the same name (indicating a multi-row fault entry
    # with a shared action cell, e.g., oH3 and oH4 "Motor Overheating 1/2").
    for i, group in enumerate(groups):
        if not group.get("action") and i > 0:
            prev_group = groups[i - 1]
            prev_desc = " ".join(prev_group["desc"]).strip()
            prev_name = prev_desc.split(". ")[0].rstrip(".").strip() if prev_desc else ""
            curr_desc = " ".join(group["desc"]).strip()
            curr_name = curr_desc.split(". ")[0].rstrip(".").strip() if curr_desc else ""
            # If the name prefix matches (e.g., "Motor Overheating" in both oH3 and oH4),
            # inherit the previous group's action.
            if prev_name and curr_name and prev_name.split()[0] == curr_name.split()[0]:
                group["action"] = prev_group["action"][:]

    entries: list[dict[str, Any]] = []
    for group in groups:
        if not group.get("codes"):
            continue
        desc_text = " ".join(group["desc"]).strip()
        # The bold fault name is the leading sentence of the description cell.
        name = desc_text.split(". ")[0].rstrip(".").strip() if desc_text else ""
        action_text = " ".join(group["action"]).strip()
        refs = sorted(set(_DOTTED_REF_RE.findall(action_text)))
        secondary = " ".join(group["labels"]).strip()
        for identifier in group["codes"]:
            raw_excerpt = next(
                (ln for ln in raw_lines if ln.startswith(identifier.split()[0])),
                f"{identifier} {name}",
            )
            entries.append(
                {
                    "code": None,  # mnemonic — never an invented integer
                    "fault_id": identifier,
                    "name": name,
                    "fault_type": "—",
                    "action": action_text,
                    "references_parameters": refs,
                    "page": page.page_number,
                    "excerpt": raw_excerpt,
                    "flashing": group["flashing"],
                    "secondary_label": secondary,
                    "ambiguous_glyphs": _ambiguous_glyphs(identifier),
                }
            )
    return entries


# ── parameter listing ────────────────────────────────────────────────────────


def _param_header(words: list[Word]) -> tuple[float, dict[str, float]] | None:
    """(header_top, {right-column label -> header x-center}) for the listing
    header ``Parameter | Parameter Name | Default | Range | Units | Page``,
    or None when this is not a listing page.

    The right-side columns (Default/Range/Units/Page) hold SHORT cells that
    render roughly under their centered headers, so nearest-header-center
    assignment is reliable there; the parameter/name boundary comes from the
    body's own whitespace channel instead (headers are centered, cells
    left-aligned — header x0s are not band edges).
    """
    name_words = [w for w in words if w["text"] == "Name"]
    for name_w in name_words:
        header_top = name_w["top"]
        header = [w for w in words if abs(w["top"] - header_top) <= _LINE_TOL]
        labels = {w["text"] for w in header}
        if not ({"Parameter", "Default", "Range", "Units", "Page"}.issubset(labels)):
            continue
        anchors = {
            label.lower(): min((w["x0"] + w["x1"]) / 2.0 for w in header if w["text"] == label)
            for label in ("Default", "Range", "Units", "Page")
        }
        return header_top, anchors
    return None


def parse_magnetek_param_page(page) -> list[dict[str, Any]]:
    """Parse one page of the Magnetek dotted-parameter listing.

    Position-aware: words are binned into the six header-derived column bands,
    then clustered into visual lines. A line whose *parameter* band holds a
    dotted id opens a new entry; a line with an empty parameter band and an
    enum-shaped name cell (``00: Digital Reference Only``) accumulates as a
    value meaning of the open entry. Everything else closes the open entry.
    The trailing "Page" column is the manual's own cross-reference — the
    citation ``page`` is always the real PDF page the row was read from.
    Cells are preserved verbatim (en-dash ranges, ``0.00*`` stars, ``–``
    defaults); nothing is coerced. Malformed rows are skipped and logged,
    never guessed at.
    """
    words = page.extract_words()
    header = _param_header(words)
    if header is None:
        return []
    header_top, anchors = header
    body = [w for w in words if header_top + _LINE_TOL < w["top"] < _FOOTER_TOP]
    if not body:
        return []
    # Parameter ids are SINGLE dotted tokens at the row's left edge — parse
    # per-line off that instead of a page-wide param/name whitespace channel
    # (the p.173 footnote-legend paragraphs bridge that channel and would
    # swallow the whole page). Right-side cells (Default/Range/Units/Page)
    # are short and sit under their centered headers → nearest-center assign.
    right_x0 = anchors["default"] - 24.0
    id_x_max = min(w["x0"] for w in body) + 25.0  # ids share the left margin

    entries: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    name_col_x: float | None = None  # learned from the first accepted row
    for line in _cluster_lines(body):
        first = line[0]

        def _cells(words_in_line: list[Word]) -> dict[str, str]:
            cells: dict[str, list[str]] = {}
            for w in words_in_line:
                if w["x0"] < right_x0:
                    label = "name"
                else:
                    center = (w["x0"] + w["x1"]) / 2.0
                    label = min(anchors, key=lambda k: abs(anchors[k] - center))
                cells.setdefault(label, []).append(w["text"])
            return {k: " ".join(v) for k, v in cells.items()}

        if _DOTTED_PARAM_RE.fullmatch(first["text"]) and first["x0"] <= id_x_max:
            # Grouped-range definition ("F07.23 to F07.32 DOA116 (1 to 10)"):
            # one row defines N instances that cannot be attributed per-id —
            # skipped DELIBERATELY (precision over recall, same posture as the
            # PowerFlex comma-group skip), loudly logged, never silent.
            if (
                len(line) >= 3
                and line[1]["text"] == "to"
                and _DOTTED_PARAM_RE.fullmatch(line[2]["text"])
            ):
                logger.info(
                    "magnetek-dialect: skipping GROUPED parameter-range row on p%s "
                    "(cannot attribute per-id): %r",
                    page.page_number,
                    _line_text(line)[:80],
                )
                current = None
                continue
            cell = _cells(line[1:])
            name = cell.get("name", "").strip()
            page_ref = cell.get("page", "").strip()
            # The trailing manual-page column may legitimately be a dash
            # (L03.20/N02.04/T01.05 in the real manual) — accept it as "no
            # cross-reference"; the citation page is the PDF page regardless.
            if not name or not (re.fullmatch(r"\d{1,3}", page_ref) or page_ref in ("-", "–", "")):
                logger.info(
                    "magnetek-dialect: skipping malformed parameter row on p%s: %r",
                    page.page_number,
                    _line_text(line)[:80],
                )
                current = None
                continue
            unit = cell.get("units", "").strip()
            if name_col_x is None and len(line) > 1:
                name_col_x = line[1]["x0"]
            current = {
                "parameter_id": first["text"],  # source-preserved, dotted
                "name": name,
                "purpose": "",
                "range": cell.get("range", "").strip() or None,  # verbatim
                "default": cell.get("default", "").strip() or None,  # verbatim
                "unit": None if unit in ("-", "–", "") else unit,
                "value_meanings": [],
                "related_faults": [],
                "related_parameters": [],
                "page": page.page_number,
                "excerpt": _line_text(line),
                "manual_page_ref": page_ref if re.fullmatch(r"\d{1,3}", page_ref) else None,
                "ambiguous_glyphs": _ambiguous_glyphs(first["text"]),
            }
            entries.append(current)
        elif (
            current is not None
            and name_col_x is not None
            # continuation/enum lines live in the NAME column — a line that
            # starts back at the id margin (footnote legends, section prose)
            # closes the open row instead of polluting it.
            and first["x0"] > id_x_max
            and abs(first["x0"] - name_col_x) < 40.0
        ):
            cell = _cells(line)
            enum = _ENUM_LINE_RE.match(cell.get("name", "").strip())
            if enum:
                current["value_meanings"].append(
                    {"value": enum.group("value"), "meaning": enum.group("meaning").strip()}
                )
            elif cell.get("name") and not any(
                cell.get(k) for k in ("default", "range", "units", "page")
            ):
                # wrapped continuation of the parameter name — only when every
                # other band is empty (conservative: headings/prose close it).
                # The citation excerpt stays the FIRST physical line only: it
                # must remain verbatim-findable on the page for the
                # cite-integrity gate (a joined multi-line string is not).
                current["name"] += " " + cell["name"].strip()
            else:
                current = None
        else:
            current = None
    return entries
