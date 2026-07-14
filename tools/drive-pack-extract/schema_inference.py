"""Schema inference — map arbitrary vendor headers onto canonical roles.

Vendors label the same columns a dozen different ways: a fault's remedy is
"Corrective Action" (Magnetek), "What to do" (ABB), "Possible Solutions"
(Yaskawa), "Remedy" (Siemens), "Probable cause" + "Cause / Remedy" (Delta).
This module is the vendor-agnostic dictionary that collapses those synonyms
onto a fixed set of canonical roles, so ``generic_table_parser`` never needs to
know which OEM it's reading. Exact vendor phrases MAY raise a match's
confidence; they are never REQUIRED (that was the old exact-header-gate trap).

Also owns identifier classification: whether a token is a fault/parameter id,
and of what shape (numeric / alphanumeric / dotted / mnemonic) — the signal
``table_discovery`` uses to find an id column without knowing the vendor.

Pure functions, no I/O.
"""
from __future__ import annotations

import re

# --- Canonical roles -------------------------------------------------------
FAULT_ID = "fault_id"
FAULT_NAME = "fault_name"
FAULT_CAUSE = "cause"
FAULT_REMEDY = "remedy"
FAULT_TYPE = "fault_type"
PARAM_ID = "parameter_id"
PARAM_NAME = "parameter_name"
PARAM_DEFAULT = "default"
PARAM_RANGE = "range"
PARAM_UNIT = "unit"

FAULT_ROLES = {FAULT_ID, FAULT_NAME, FAULT_CAUSE, FAULT_REMEDY, FAULT_TYPE}
PARAM_ROLES = {PARAM_ID, PARAM_NAME, PARAM_DEFAULT, PARAM_RANGE, PARAM_UNIT}

# --- Header synonym dictionaries (lowercased, punctuation-stripped) ---------
# A header cell maps to a role if ANY of its tokens (or the whole normalized
# cell) hits one of these sets. Order of precedence handled in ``infer_roles``.
HEADER_SYNONYMS: dict[str, set[str]] = {
    FAULT_ID: {
        "fault", "faults", "code", "codes", "no", "no.", "id", "trip",
        "error", "alarm", "alarms", "event", "display", "lcd", "fault/alarm",
        "faultcode", "faultno", "warning", "warningcode",
    },
    FAULT_NAME: {
        "name", "description", "faultname", "namedescription", "meaning",
        "designation", "text", "message", "faultordescription", "indicator",
    },
    FAULT_CAUSE: {
        "cause", "causes", "reason", "reasons", "probablecause",
        "possiblecause", "rootcause", "condition", "diagnosis", "probable",
    },
    FAULT_REMEDY: {
        "remedy", "remedies", "action", "actions", "correctiveaction",
        "corrective", "whattodo", "solution", "solutions", "possiblesolutions",
        "countermeasure", "countermeasures", "howtoclear", "recovery",
        "clearing", "resolution",
    },
    FAULT_TYPE: {
        "type", "faulttype", "reaction", "class", "category", "severity",
        "acknowledge", "acknowledgement", "resettype",
    },
    PARAM_ID: {
        "parameter", "parameters", "index", "no", "no.", "code", "pr", "id",
        "function", "param", "parameterno", "reference", "addr", "address",
    },
    PARAM_NAME: {
        "name", "parametername", "description", "designation", "function",
        "functionname", "text", "label", "title",
    },
    PARAM_DEFAULT: {
        "default", "defaults", "factory", "factorysetting", "factorydefault",
        "preset", "defaultvalue", "initial", "initialvalue", "def",
    },
    PARAM_RANGE: {
        "range", "ranges", "setting", "settingrange", "min/max", "minmax",
        "min", "max", "values", "valuerange", "adjustmentrange", "data",
        "settings", "选择",
    },
    PARAM_UNIT: {"unit", "units", "uom", "dimension"},
}

# Fault vs parameter table-kind vocabulary (appears anywhere on the page).
FAULT_PAGE_VOCAB = {
    "fault", "faults", "alarm", "alarms", "trip", "error", "errors",
    "cause", "remedy", "corrective", "solution", "solutions", "diagnosis",
    "reaction", "acknowledge", "warning", "warnings", "troubleshooting",
}
PARAM_PAGE_VOCAB = {
    "parameter", "parameters", "default", "setting", "settings", "range",
    "factory", "index", "adjustment", "min", "max",
}

_PUNCT_RE = re.compile(r"[^a-z0-9/]+")


def _norm_cell(cell: str) -> str:
    return _PUNCT_RE.sub("", (cell or "").strip().lower())


def _tokens(cell: str) -> list[str]:
    return [t for t in re.split(r"[\s]+", (cell or "").strip().lower()) if t]


def role_of_header_cell(cell: str, *, param_context: bool) -> str | None:
    """Best canonical role for one header cell.

    ``param_context`` steers ambiguous cells ("no", "code", "name",
    "description") toward parameter vs fault roles. Whole-cell match wins over
    token match (so "min/max" -> range beats "min" alone)."""
    norm = _norm_cell(cell)
    if not norm:
        return None
    roles = PARAM_ROLES if param_context else FAULT_ROLES
    # Whole normalized cell exact hit first.
    for role in _role_order(param_context):
        if role in roles and norm in HEADER_SYNONYMS[role]:
            return role
    # Token-level hit.
    toks = {_norm_cell(t) for t in _tokens(cell)}
    for role in _role_order(param_context):
        if role in roles and toks & HEADER_SYNONYMS[role]:
            return role
    return None


def _role_order(param_context: bool) -> list[str]:
    """Precedence so a cell matching multiple sets picks the most specific.
    Id first (leftmost, most distinctive), then the specific value columns,
    name last (name synonyms like 'description' overlap several)."""
    if param_context:
        return [PARAM_ID, PARAM_DEFAULT, PARAM_RANGE, PARAM_UNIT, PARAM_NAME]
    return [FAULT_ID, FAULT_TYPE, FAULT_CAUSE, FAULT_REMEDY, FAULT_NAME]


def infer_roles(header_cells: list[str], *, param_context: bool) -> dict[int, str]:
    """Map header column index -> canonical role. First cell to claim a role
    keeps it (a later duplicate synonym doesn't overwrite)."""
    out: dict[int, str] = {}
    claimed: set[str] = set()
    for idx, cell in enumerate(header_cells):
        role = role_of_header_cell(cell, param_context=param_context)
        if role and role not in claimed:
            out[idx] = role
            claimed.add(role)
    return out


def header_role_score(header_cells: list[str], *, param_context: bool) -> int:
    """How many distinct roles a candidate header row resolves — used to pick
    the real header line among a page's rows."""
    return len(set(infer_roles(header_cells, param_context=param_context).values()))


# --- Identifier classification --------------------------------------------
_ID_NUMERIC = re.compile(r"^\d{1,4}$")
_ID_ALNUM = re.compile(r"^[A-Za-z]{1,4}[-.]?\d{2,5}[A-Za-z]?$")   # F30001, A0503, SCF1
# Dotted ids: optional letter prefix (with or without a following separator),
# then a digit group and 1-2 more dotted/hyphen groups. Covers 00.00, B01.18,
# 01-05 and Delta's "Pr.04.03" (letters then a separator before the digits).
_ID_DOTTED = re.compile(r"^[A-Za-z]{0,3}[.\-]?\d{1,3}([.\-]\d{1,3}){1,2}$")
_MNEMONIC = re.compile(r"^[A-Za-z]{1,3}\d{0,2}$")   # oC, Uv1, bb (mnemonic dialects)


def classify_identifier(tok: str) -> str | None:
    """Return the id shape (``numeric``/``alnum``/``dotted``/``mnemonic``) or
    None. Deliberately conservative: pure hex 4-tuples (status words) and long
    prose tokens are rejected so an id column stays an id column."""
    if not tok:
        return None
    tok = tok.strip()
    if _ID_DOTTED.match(tok):
        return "dotted"
    if _ID_ALNUM.match(tok):
        return "alnum"
    if _ID_NUMERIC.match(tok):
        return "numeric"
    return None


def is_identifier(tok: str) -> bool:
    return classify_identifier(tok) is not None


def is_mnemonic(tok: str) -> bool:
    """A short letter(+digit) mnemonic (oC, Uv1). Kept separate from
    ``classify_identifier`` because bare-alpha tokens are too common to treat
    as ids generically — only the Magnetek dialect route trusts these."""
    return bool(_MNEMONIC.match(tok)) and any(c.isalpha() for c in tok)


def page_kind_scores(text: str) -> tuple[int, int]:
    """(fault_vocab_hits, param_vocab_hits) for a page's text."""
    low = text.lower()
    f = sum(1 for v in FAULT_PAGE_VOCAB if v in low)
    p = sum(1 for v in PARAM_PAGE_VOCAB if v in low)
    return f, p
