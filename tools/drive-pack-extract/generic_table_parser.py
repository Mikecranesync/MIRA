"""Generic table parser — extract rows/blocks from a discovered candidate.

Three deterministic routes, chosen by structure (not by vendor):

* ``ruled``   — a page with ruling lines: use pdfplumber's already-computed
                ``page.tables`` cells (ABB / Schneider / Delta grids).
* ``unruled`` — no ruling: recover columns from the header's x-bands and bin
                each id-row's words by x-position (Yaskawa setting tables).
* ``block``   — an id followed by labelled prose sections (``Cause:`` /
                ``Remedy:`` / ``Reaction:``): the Siemens & Yaskawa fault-list
                shape, which is NOT a row table at all.

Every emitted record preserves the id's exact casing/punctuation, carries a
verbatim ``excerpt`` (a real substring of the page's ``extract_text()`` so
cite-integrity can prove it), and never invents a value it did not read.
Wrapped/continuation rows are merged into the row above. Pure, no I/O beyond
the ``PageIR`` handed in.
"""
from __future__ import annotations

import re
from typing import Any

import schema_inference as si
from document_ir import PageIR, Word
from records import make_record
from table_discovery import TableCandidate, group_row_cells

# Labelled-section markers for block-mode faults (Siemens/Yaskawa).
_SECTION_LABELS = {
    "cause": si.FAULT_CAUSE, "causes": si.FAULT_CAUSE, "reason": si.FAULT_CAUSE,
    "remedy": si.FAULT_REMEDY, "remedies": si.FAULT_REMEDY,
    "action": si.FAULT_REMEDY, "solution": si.FAULT_REMEDY,
    "possiblesolutions": si.FAULT_REMEDY, "whattodo": si.FAULT_REMEDY,
    "reaction": si.FAULT_TYPE, "acknowledge": si.FAULT_TYPE,
}
_SECTION_RE = re.compile(r"^([A-Za-z][A-Za-z /]{2,20}?)\s*:\s*(.*)$")


def _excerpt_for(text: str, ident: str) -> str:
    """First physical ``extract_text`` line that opens with ``ident`` — the
    guaranteed-verifiable excerpt (it IS the source line)."""
    pat = re.compile(rf"^\s*{re.escape(ident)}\b")
    for line in text.splitlines():
        if pat.match(line):
            return line.strip()
    # Fallback: any line containing the id token.
    tokpat = re.compile(rf"(?<![\w.]){re.escape(ident)}(?![\w])")
    for line in text.splitlines():
        if tokpat.search(line):
            return line.strip()
    return ""


def _id_role_key(kind: str) -> str:
    return si.PARAM_ID if kind == "parameter" else si.FAULT_ID


def _name_role_key(kind: str) -> str:
    return si.PARAM_NAME if kind == "parameter" else si.FAULT_NAME


# ---------------------------------------------------------------------------
# Ruled route
# ---------------------------------------------------------------------------
def _pick_id_column(rows: list[list[str]]) -> int | None:
    """Column index whose cells are most often identifiers."""
    if not rows:
        return None
    n_cols = max(len(r) for r in rows)
    best_col, best_hits = None, 0
    for c in range(n_cols):
        hits = 0
        for r in rows:
            if c < len(r) and r[c] and si.is_identifier(str(r[c]).strip().split()[0] if str(r[c]).strip() else ""):
                hits += 1
        if hits > best_hits:
            best_hits, best_col = hits, c
    return best_col if best_hits >= 2 else None


_RULED_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,9}$")


def _ruled_id_ok(tok: str, *, header_gated: bool) -> bool:
    """A ruled table whose header named an id column can trust a wider set of
    id shapes than the strict generic classifier — e.g. ABB's hex warning
    codes (``A2B4``), which interleave letters and digits. Still requires a
    digit and rejects prose, so a header cell or a sentence is not an id."""
    if si.is_identifier(tok):
        return True
    if not header_gated:
        return False
    return bool(_RULED_ID_RE.match(tok)) and any(c.isdigit() for c in tok)


def parse_ruled(page: PageIR, cand: TableCandidate) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    param = cand.kind == "parameter"
    for table in page.tables:
        rows = [[(_clean(c)) for c in row] for row in table if any(c for c in row)]
        if len(rows) < 2:
            continue
        # Header = the row resolving the most roles; data rows follow it.
        header_idx, roles = _best_header_row(rows, param)
        header_gated = roles_id_col(roles) is not None
        id_col = roles_id_col(roles) if roles else _pick_id_column(rows)
        if id_col is None:
            continue
        data = rows[header_idx + 1:] if header_idx is not None else rows
        prev: dict[str, Any] | None = None
        for r in data:
            cell = r[id_col].strip() if id_col < len(r) and r[id_col] else ""
            first = cell.split()[0] if cell else ""
            if first and _ruled_id_ok(first, header_gated=header_gated):
                rec = _row_to_record(r, id_col, roles, first, page, param, "ruled_table", cand.confidence)
                if rec:
                    out.append(rec)
                    prev = rec
            elif prev is not None and any(c.strip() for c in r if c):
                _merge_continuation(prev, r, id_col, roles)
    return out


def _clean(cell: str | None) -> str:
    return re.sub(r"\s+", " ", (cell or "").replace("\n", " ")).strip()


def _best_header_row(rows: list[list[str]], param: bool) -> tuple[int | None, dict[int, str]]:
    best_i, best_roles, best_n = None, {}, 0
    for i, r in enumerate(rows[:6]):
        roles = si.infer_roles(r, param_context=param)
        if len(set(roles.values())) > best_n:
            best_n, best_i, best_roles = len(set(roles.values())), i, roles
    return (best_i, best_roles) if best_n >= 2 else (None, {})


def roles_id_col(roles: dict[int, str]) -> int | None:
    for idx, role in roles.items():
        if role in (si.FAULT_ID, si.PARAM_ID):
            return idx
    return None


def _row_to_record(row, id_col, roles, ident, page, param, route, conf) -> dict[str, Any] | None:
    id_kind = si.classify_identifier(ident) or "alnum"
    name = ""
    fields: dict[str, str] = {}
    name_role = _name_role_key(param_kind(param))
    for idx, role in roles.items():
        if idx >= len(row) or idx == id_col:
            continue
        val = _clean(row[idx])
        if not val:
            continue
        if role == name_role:
            name = val
        elif role not in (si.FAULT_ID, si.PARAM_ID):
            fields[role] = val
    # If no header-mapped name, use the first column to the RIGHT of the id
    # that isn't a mapped value column (the usual ``id | name | values``
    # layout) — falling back to the widest remaining cell.
    if not name:
        value_roles = {si.FAULT_CAUSE, si.FAULT_REMEDY, si.FAULT_TYPE,
                       si.PARAM_DEFAULT, si.PARAM_RANGE, si.PARAM_UNIT}
        for i in range(id_col + 1, len(row)):
            if roles.get(i) in value_roles:
                continue
            val = _clean(row[i])
            if val:
                name = val
                break
        if not name:
            cand_cells = [(_clean(row[i])) for i in range(len(row)) if i != id_col and _clean(row[i])]
            if cand_cells:
                name = max(cand_cells, key=len)
    excerpt = _excerpt_for(page.text, ident)
    if not excerpt:
        return None
    return make_record(
        record_type="parameter" if param else "fault",
        ident=ident, id_kind=id_kind, name=name, fields=fields,
        page=page.number, bbox=None, excerpt=excerpt, route=route, confidence=conf,
        field_evidence={},
    )


def param_kind(param: bool) -> str:
    return "parameter" if param else "fault"


def _merge_continuation(prev, row, id_col, roles):
    """Append wrapped cells to the previous record (name/fields spilled over)."""
    name_role = _name_role_key(prev["record_type"])
    for idx, role in roles.items():
        if idx >= len(row) or idx == id_col:
            continue
        val = _clean(row[idx])
        if not val:
            continue
        if role == name_role:
            prev["name"] = (prev["name"] + " " + val).strip()
        elif role not in (si.FAULT_ID, si.PARAM_ID):
            prev["fields"][role] = (prev["fields"].get(role, "") + " " + val).strip()


# ---------------------------------------------------------------------------
# Unruled route (word-position columns)
# ---------------------------------------------------------------------------
def _header_line_cells(page: PageIR, header_top: float | None) -> list[dict[str, Any]]:
    if header_top is None:
        return []
    line = [w for w in page.words if abs(w["top"] - header_top) <= 2.5]
    return group_row_cells(line) if line else []


def parse_unruled(page: PageIR, cand: TableCandidate) -> list[dict[str, Any]]:
    param = cand.kind == "parameter"
    header_cells = _header_line_cells(page, cand.header_top)
    roles_by_x: list[tuple[float, float, str]] = []
    for c in header_cells:
        role = si.role_of_header_cell(c["text"], param_context=param)
        if role:
            roles_by_x.append((c["x0"], c["x1"], role))
    out: list[dict[str, Any]] = []
    lo, hi = cand.id_band
    prev: dict[str, Any] | None = None
    for line in page.word_lines:
        if not line:
            continue
        first = min(line, key=lambda w: w["x0"])
        if lo - 2 <= first["x0"] <= hi + 2 and si.is_identifier(first["text"]):
            rec = _unruled_row(line, first, roles_by_x, page, param, cand.confidence)
            if rec:
                out.append(rec)
                prev = rec
        elif prev is not None and roles_by_x:
            _unruled_continuation(line, roles_by_x, prev)
    return out


def _assign_role_by_x(x0: float, x1: float, roles_by_x, id_role: str) -> str | None:
    center = (x0 + x1) / 2
    best, bestd = None, 1e9
    for rx0, rx1, role in roles_by_x:
        if role == id_role:
            continue
        rc = (rx0 + rx1) / 2
        d = abs(rc - center)
        if d < bestd:
            bestd, best = d, role
    return best


def _unruled_row(line: list[Word], first: Word, roles_by_x, page, param, conf) -> dict[str, Any] | None:
    ident = first["text"]
    id_kind = si.classify_identifier(ident) or "alnum"
    id_role = _id_role_key(param_kind(param))
    name_role = _name_role_key(param_kind(param))
    cells = group_row_cells([w for w in line if w is not first])
    fields: dict[str, str] = {}
    name = ""
    for c in cells:
        role = _assign_role_by_x(c["x0"], c["x1"], roles_by_x, id_role) if roles_by_x else name_role
        if role == name_role or role is None:
            name = (name + " " + c["text"]).strip()
        else:
            fields[role] = (fields.get(role, "") + " " + c["text"]).strip()
    if not name and cells:
        name = " ".join(c["text"] for c in cells)
    excerpt = _excerpt_for(page.text, ident)
    if not excerpt:
        return None
    bbox = (first["x0"], min(w["top"] for w in line), max(w["x1"] for w in line), max(w["bottom"] for w in line))
    return make_record(
        record_type="parameter" if param else "fault",
        ident=ident, id_kind=id_kind, name=name, fields=fields,
        page=page.number, bbox=bbox, excerpt=excerpt, route="unruled_table", confidence=conf,
    )


def _unruled_continuation(line: list[Word], roles_by_x, prev):
    name_role = _name_role_key(prev["record_type"])
    id_role = _id_role_key(prev["record_type"])
    for c in group_row_cells(line):
        role = _assign_role_by_x(c["x0"], c["x1"], roles_by_x, id_role)
        if role == name_role or role is None:
            prev["name"] = (prev["name"] + " " + c["text"]).strip()
        else:
            prev["fields"][role] = (prev["fields"].get(role, "") + " " + c["text"]).strip()


# ---------------------------------------------------------------------------
# Block route (id + labelled prose)
# ---------------------------------------------------------------------------
def parse_blocks(page: PageIR, cand: TableCandidate) -> list[dict[str, Any]]:
    param = cand.kind == "parameter"
    lo, hi = cand.id_band
    out: list[dict[str, Any]] = []
    # Segment the page's rows into blocks starting at each id row.
    starts: list[int] = []
    for i, line in enumerate(page.word_lines):
        if not line:
            continue
        first = min(line, key=lambda w: w["x0"])
        if lo - 2 <= first["x0"] <= hi + 2 and si.is_identifier(first["text"]):
            starts.append(i)
    for si_idx, start in enumerate(starts):
        end = starts[si_idx + 1] if si_idx + 1 < len(starts) else len(page.word_lines)
        block = page.word_lines[start:end]
        if not block:
            continue
        first_line = block[0]
        first = min(first_line, key=lambda w: w["x0"])
        ident = first["text"]
        # Name = remainder of the id's own line.
        head_text = " ".join(w["text"] for w in sorted(first_line, key=lambda w: w["x0"]))
        name = head_text[len(ident):].strip(" :.-") if head_text.startswith(ident) else ""
        body_lines = [" ".join(w["text"] for w in sorted(ln, key=lambda w: w["x0"])) for ln in block[1:]]
        fields = _sections_from_body(body_lines)
        if not name and body_lines:
            name = body_lines[0][:120]
        excerpt = _excerpt_for(page.text, ident)
        if not excerpt:
            continue
        out.append(make_record(
            record_type="parameter" if param else "fault",
            ident=ident, id_kind=si.classify_identifier(ident) or "alnum",
            name=name, fields=fields, page=page.number,
            bbox=(first["x0"], min(w["top"] for w in first_line),
                  max(w["x1"] for w in first_line), max(w["bottom"] for w in first_line)),
            excerpt=excerpt, route="block", confidence=cand.confidence * 0.9,
        ))
    return out


def _sections_from_body(body_lines: list[str]) -> dict[str, str]:
    fields: dict[str, str] = {}
    cur_role: str | None = None
    for ln in body_lines:
        m = _SECTION_RE.match(ln)
        if m:
            label = re.sub(r"[^a-z]", "", m.group(1).lower())
            role = _SECTION_LABELS.get(label)
            if role:
                cur_role = role
                fields[role] = (fields.get(role, "") + " " + m.group(2)).strip()
                continue
        if cur_role:
            fields[cur_role] = (fields[cur_role] + " " + ln).strip()
    return fields


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
def parse_candidate(page: PageIR, cand: TableCandidate) -> list[dict[str, Any]]:
    """Deterministically choose a route and return its records.

    Tries the strongest structural route first, falls back until something
    yields records. Never raises — a route that finds nothing returns []."""
    routes: list[list[dict[str, Any]]] = []
    if page.tables:
        try:
            routes.append(parse_ruled(page, cand))
        except Exception:
            routes.append([])
    try:
        routes.append(parse_unruled(page, cand))
    except Exception:
        routes.append([])
    try:
        routes.append(parse_blocks(page, cand))
    except Exception:
        routes.append([])
    # Pick the route that produced the most records (structure won).
    routes = [r for r in routes if r]
    if not routes:
        return []
    return max(routes, key=len)
