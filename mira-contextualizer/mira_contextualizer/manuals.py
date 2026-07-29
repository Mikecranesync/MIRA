"""Manual-driven deep extraction — turn a tag *inventory* into a *diagnosable* machine model.

contextualize.py *spots* entities (which fault codes / parameters / model families appear). This
module mines the tables those entities live in for the two depth dimensions a grounded
fault → cause → next-check answer needs, and links unit-bearing specs to the project's known tags:

  1. **Fault semantics** — fault code → likely cause → next thing to check. Drive/machine fault
     tables ("F004 | Overcurrent | Motor cable shorted | Check wiring, increase accel time") and
     cue-labelled prose ("F004 Overcurrent. Cause: ... Remedy: ...").
  2. **Engineering units / ranges / setpoints** — parameter & spec tables ("P09.03 Comm-loss
     timeout 0...60 s, default 5"; "Rated current 9.6 A"), tied to the matching PLC tag when the
     subject lines up with a tag name.

Pure deterministic rules: regex + a curated unit/cue vocab + table-column awareness. NO LLM, no
cloud — auditable and reproducible. Deliberately silent on prose it can't ground (no guessing).

Output rows are shaped exactly like ``store.add_extractions`` and merge into the same candidate set
contextualize.py produces, so the review surface and the answerability scorecard see one *enriched*
signal per fault/parameter — not a duplicate. The enriched evidence keys (``cause``, ``next_check``,
``units``, ``range``, ``setpoint``) are exactly what ``scorecard.compute_scorecard`` reads to lift a
project from "Inventory" toward "Diagnosable".
"""

from __future__ import annotations

import re

_BAND_TO_NUM = {"high": 0.9, "medium": 0.6, "low": 0.3}


def band_to_num(band: str) -> float:
    return _BAND_TO_NUM.get(band, 0.3)


def _snippet(line: str, limit: int = 200) -> str:
    return " ".join(line.split())[:limit]


# ── fault codes (table-context: trust numeric/short codes the spotting pass won't) ──────────────
# E/F/A + 2-4 digits are distinctive (PowerFlex F004, GS10 E.x); CE10 is a Modbus comm fault. A bare
# 1-3 digit code or a short VFD mnemonic (oC, GF) is only trusted INSIDE a fault table, where the row
# context certifies it. Deliberately NOT matching `[A-Z]\d+` generally — that would swallow drive
# parameters like P09 / Pr05 and misclassify them as faults.
_RE_FAULT_STRONG = re.compile(r"\b([EFA]\d{2,4}|CE\d{1,2})\b")
_RE_FAULT_SHORT = re.compile(r"\b(oC|oL|oH|oU|oV|LU|GF|SC|OH\d?|nP)\b")
_RE_FAULT_NUM = re.compile(r"^\s*(\d{1,3})\b")

# ── units / ranges / setpoints ──────────────────────────────────────────────────────────────────
# Composite tokens (Vac/Arms…) before bare ones; bare m/s/g/h are only ever matched right after a
# number, which keeps them from swallowing ordinary words.
_UNIT = (
    r"kHz|Hz|kVA|VA|kW|MW|mW|W|VAC|VDC|Vac|Vdc|mA|kA|A|kV|mV|V|rpm|RPM|°C|degC|°F|degF"
    r"|ms|µs|us|sec|s|min|hr|h|bar|psi|kPa|MPa|Pa|N·m|Nm|mm|cm|µm|m|%|L|gpm|lpm|kg|g"
)
_NUM = r"-?\d+(?:\.\d+)?"
# A value immediately followed by a unit: "60 Hz", "9.6A", "5 s".
_RE_VALUE_UNIT = re.compile(r"(?<![\w.])(%s)\s?(%s)(?![A-Za-z])" % (_NUM, _UNIT))
# A range: "0...60 s", "0-1800 RPM", "0 to 100 %", "-10 – 50 °C".
_RE_RANGE = re.compile(
    r"(?<![\w.])(%s)\s*(?:\.\.\.|…|–|—|-|to)\s*(%s)\s?(%s)?(?![A-Za-z])" % (_NUM, _NUM, _UNIT)
)
# A default / preset / rated value: "default 5 s", "factory setting: 60 Hz", "rated 9.6 A".
_RE_DEFAULT = re.compile(
    r"(?i)\b(?:default|factory(?:\s+setting)?|preset|set\s+to|setpoint|nominal|rated)\b"
    r"[^\d\n]{0,14}?(%s)\s?(%s)?(?![A-Za-z])" % (_NUM, _UNIT)
)

# ── cue vocab for splitting a fault row into description / cause / next-check ─────────────────────
_RE_CAUSE_CUE = re.compile(
    r"(?i)\b(?:probable\s+cause|possible\s+cause|likely\s+cause|cause|reason|condition)\b\s*[:\-]?\s*"
)
_RE_REMEDY_CUE = re.compile(
    r"(?i)\b(?:corrective\s+action|countermeasure|remed(?:y|ies)|action|solution|correction"
    r"|what\s+to\s+do|check|verify|inspect|troubleshoot)\b\s*[:\-]?\s*"
)
# header-cell classifiers
_HDR_CODE = re.compile(r"(?i)\b(code|fault|error|alarm|trip|no\.?|number)\b")
_HDR_DESC = re.compile(r"(?i)\b(description|name|display|meaning|fault\s*name|condition)\b")
_HDR_CAUSE = re.compile(r"(?i)\b(cause|reason)\b")
_HDR_REMEDY = re.compile(
    r"(?i)\b(remed\w*|action|solution|correct\w*|countermeasure|check|corrective)\b"
)

_SPLIT_COLS = re.compile(r"\t+|\s{2,}|\s+\|\s+")  # tabs, 2+ spaces, or " | " markdown pipes
_WORD = re.compile(r"[a-z0-9]+")
# spec subjects we'll happily attach units to even without a tag match (named engineering quantities)
_QUANTITY = re.compile(
    r"(?i)\b(speed|frequency|freq|current|amp|voltage|volt|torque|power|temperature|temp|pressure"
    r"|level|flow|rpm|accel(?:eration)?|decel(?:eration)?|timeout|time|count|setpoint)\b"
)


def _clean(s: str) -> str:
    return " ".join((s or "").split()).strip(" :-|\t")


def _cells(line: str) -> list[str]:
    return [c for c in (_clean(c) for c in _SPLIT_COLS.split(line)) if c]


def _fault_code(cell: str, *, table_context: bool) -> str | None:
    """The fault code in a cell. In a certified table context a bare number/short mnemonic counts."""
    m = _RE_FAULT_STRONG.search(cell)
    if m:
        return m.group(1)
    m = _RE_FAULT_SHORT.search(cell)
    if m:
        return m.group(1)
    if table_context:
        m = _RE_FAULT_NUM.match(cell)
        if m:
            return m.group(1)
    return None


def _find_units(text: str) -> dict:
    """Pull units / range / setpoint off one line of spec text. Range wins over a bare value."""
    out: dict = {}
    rng = _RE_RANGE.search(text)
    if rng:
        lo, hi, unit = rng.group(1), rng.group(2), rng.group(3)
        out["range"] = "%s-%s" % (lo, hi)
        if unit:
            out["units"] = unit
    dflt = _RE_DEFAULT.search(text)
    if dflt:
        out["setpoint"] = dflt.group(1) + (" %s" % dflt.group(2) if dflt.group(2) else "")
        if not out.get("units") and dflt.group(2):
            out["units"] = dflt.group(2)
    if not out.get("units"):
        vu = _RE_VALUE_UNIT.search(text)
        if vu:
            out["units"] = vu.group(2)
            if "range" not in out and "setpoint" not in out:
                out["setpoint"] = vu.group(1) + " " + vu.group(2)
    return out


# ── fault-table mining ───────────────────────────────────────────────────────────────────────────
def _header_map(line: str) -> dict | None:
    """If a line looks like a fault-table header, return {desc/cause/remedy: column_index}."""
    cells = _cells(line)
    if len(cells) < 2 or not any(_HDR_CODE.search(c) for c in cells):
        return None
    cols: dict = {}
    for i, c in enumerate(cells):
        if "cause" not in cols and _HDR_CAUSE.search(c):
            cols["cause"] = i
        elif "remedy" not in cols and _HDR_REMEDY.search(c):
            cols["remedy"] = i
        elif "desc" not in cols and _HDR_DESC.search(c):
            cols["desc"] = i
    return cols if ("cause" in cols or "remedy" in cols) else None


def _row_from_cols(cells: list[str], cols: dict, code: str) -> dict:
    ev: dict = {}
    for key, ekey in (("desc", "description"), ("cause", "cause"), ("remedy", "next_check")):
        idx = cols.get(key)
        if idx is not None and idx < len(cells):
            val = cells[idx]
            if val and val != code:
                ev[ekey] = val
    # if there's no explicit description column, the first non-code cell names the fault
    if "description" not in ev:
        for c in cells:
            if c != code and not c.isdigit():
                ev["description"] = c
                break
    return ev


def _row_from_cues(rest: str) -> dict:
    """Split 'Overcurrent. Cause: motor short. Remedy: check wiring' into desc/cause/next_check."""
    ev: dict = {}
    cause_m = _RE_CAUSE_CUE.search(rest)
    remedy_m = _RE_REMEDY_CUE.search(rest)
    cuts = sorted([m.start() for m in (cause_m, remedy_m) if m])
    if cuts:
        desc = _clean(rest[: cuts[0]])
        if desc:
            ev["description"] = desc.rstrip(".")
    else:
        desc = _clean(rest)
        if desc:
            ev["description"] = desc.rstrip(".")
    if cause_m:
        end = remedy_m.start() if (remedy_m and remedy_m.start() > cause_m.end()) else len(rest)
        cause = _clean(rest[cause_m.end() : end])
        if cause:
            ev["cause"] = cause.rstrip(".")
    if remedy_m:
        end = cause_m.start() if (cause_m and cause_m.start() > remedy_m.end()) else len(rest)
        nxt = _clean(rest[remedy_m.end() : end])
        if nxt:
            ev["next_check"] = nxt.rstrip(".")
    return ev


def mine_faults(blocks: list[dict], file_name: str) -> dict[str, dict]:
    """Mine fault tables / cue-prose. Returns {code: {evidence...}} with cause/next_check/description.

    Header-delimited tables are parsed by column; everything else falls back to per-line cue parsing.
    """
    out: dict[str, dict] = {}

    def attach(code: str, ev: dict, line: str, page):
        # Only emit when we found real diagnostic depth (cause / next-check). A bare description is
        # contextualize.py's job (entity spotting) — emitting it here would duplicate that candidate
        # and would mis-trust short mnemonics (e.g. "oC") that need a fault keyword to be real.
        if not ev or not (ev.get("cause") or ev.get("next_check")):
            return
        cur = out.setdefault(code, {"mentions": []})
        for k in ("description", "cause", "next_check"):
            if ev.get(k) and not cur.get(k):
                cur[k] = ev[k]
        cur["mentions"].append({"file": file_name, "page": page, "snippet": _snippet(line)})

    for b in blocks:
        page = b.get("page")
        lines = [ln for ln in (b.get("text") or "").splitlines() if ln.strip()]
        cols = None
        # detect a header anywhere in the block; rows after it use the column map
        header_idx = None
        for i, ln in enumerate(lines):
            hm = _header_map(ln)
            if hm:
                cols, header_idx = hm, i
                break
        for i, ln in enumerate(lines):
            cells = _cells(ln)
            if cols and header_idx is not None and i > header_idx and len(cells) >= 2:
                code = _fault_code(cells[0], table_context=True)
                if code:
                    attach(code, _row_from_cols(cells, cols, code), ln, page)
                    continue
            # cue-prose fallback (works with or without a table)
            code = _fault_code(ln, table_context=False)
            if not code and len(cells) >= 2:
                code = (
                    _fault_code(cells[0], table_context=True)
                    if _RE_REMEDY_CUE.search(ln) or _RE_CAUSE_CUE.search(ln)
                    else None
                )
            if code:
                # strip the leading code token, parse the remainder by cues / columns
                rest = ln[ln.find(code) + len(code) :]
                ev = _row_from_cues(rest)
                attach(code, ev, ln, page)
    return out


# ── spec / parameter mining ──────────────────────────────────────────────────────────────────────
_RE_PARAM = re.compile(r"\b([Pp]\d{1,2}\.\d{1,2}|[Pp][rR]\.?\d{1,3}|[Pp]\d{3,4})\b")


def _subject(line: str, param: str | None) -> str:
    """The thing a spec line is about — the text before the first number, minus the param id."""
    head = line
    if param:
        head = head.replace(param, " ", 1)
    head = re.split(_NUM, head, maxsplit=1)[0]
    return _clean(head)


def mine_specs(blocks: list[dict], file_name: str, plc_tags: list[str] | None = None) -> list[dict]:
    """Pull units/range/setpoint from spec & parameter lines, tying each to a matching PLC tag when
    the subject overlaps a tag name. Returns store-shaped rows (role parameter|spec|tag_reference)."""
    plc_tags = list(plc_tags or [])
    tag_tokens = {t: set(_WORD.findall(t.lower())) for t in plc_tags}
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for b in blocks:
        page = b.get("page")
        for line in (b.get("text") or "").splitlines():
            if not line.strip():
                continue
            units = _find_units(line)
            if not units:
                continue
            pm = _RE_PARAM.search(line)
            param = pm.group(1) if pm else None
            subject = _subject(line, param)
            linked = _match_tag(subject, line, tag_tokens)
            # Keep the spec only if it has something to anchor to: a tag, a parameter id, or a
            # recognized engineering quantity. A bare number+unit with no subject is not a guess.
            if not (linked or param or _QUANTITY.search(subject) or _QUANTITY.search(line)):
                continue

            if linked:
                role, value, base_conf, extra = "tag_reference", linked, 0.6, {"match": "semantic"}
            elif param:
                role, value, base_conf, extra = "parameter", param, 0.9, {}
            else:
                role, value, base_conf, extra = "spec", _slug(subject), 0.85, {}
            key = (role, value.lower())
            if key in seen:
                continue
            seen.add(key)

            ev = {
                "source": "manual_spec",
                "entity_type": role,
                **units,
                **extra,
                "mentions": [{"file": file_name, "page": page, "snippet": _snippet(line)}],
            }
            if subject:
                ev["subject"] = subject
            if param and role != "parameter":
                ev["parameter"] = param
            rows.append(
                {
                    "tag_name": value,
                    "roles": [role],
                    "uns_path_proposed": None,
                    "i3x_element_id": None,
                    "confidence": base_conf,
                    "evidence_json": ev,
                }
            )
    return rows


def _match_tag(subject: str, line: str, tag_tokens: dict[str, set]) -> str | None:
    """Tie a spec to a PLC tag: exact name appearance, else a shared engineering token (speed,
    current, temp, …). Conservative — a generic overlap like 'run'/'status' is not enough."""
    low = line.lower()
    for tag in tag_tokens:
        if re.search(r"\b%s\b" % re.escape(tag), line):
            return tag
    subj_tokens = set(_WORD.findall(subject.lower()))
    if not subj_tokens:
        return None
    quantities = {m.group(0).lower() for m in _QUANTITY.finditer(subject)} | {
        m.group(0).lower() for m in _QUANTITY.finditer(low)
    }
    if not quantities:
        return None
    best = None
    for tag, toks in tag_tokens.items():
        shared = toks & subj_tokens & quantities
        if shared:
            best = tag
            break
    return best


_SLUG = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    return _SLUG.sub("_", (text or "").lower()).strip("_")[:48] or "spec"


# ── public entry point ─────────────────────────────────────────────────────────────────────────
def mine(blocks: list[dict], file_name: str, plc_tags: list[str] | None = None) -> list[dict]:
    """Run the full manual depth pass. Returns store-shaped rows carrying the diagnostic depth
    (cause/next_check on fault codes, units/range/setpoint on params/specs/tags). Callers merge
    these into the contextualize candidate set keyed by (roles[0], tag_name.lower())."""
    rows: list[dict] = []
    for code, ev in mine_faults(blocks, file_name).items():
        mentions = ev.pop("mentions", [])
        evidence = {
            "source": "manual_fault",
            "entity_type": "fault_code",
            "mentions": mentions,
            **ev,
        }
        rows.append(
            {
                "tag_name": code,
                "roles": ["fault_code"],
                "uns_path_proposed": None,
                "i3x_element_id": None,
                "confidence": 0.9,
                "evidence_json": evidence,
            }
        )
    rows.extend(mine_specs(blocks, file_name, plc_tags))
    return rows
