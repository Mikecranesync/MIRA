"""Bounded, deterministic recovery of a JSON object from model output.

The vision interpreter (``printsense.interpret``) asks the model for one JSON
object describing a print. On dense sheets the response is sometimes not valid
JSON — truncated at the output-token ceiling, missing a delimiter, wrapped in a
```json fence, or prefixed with reasoning. The 2026-07-22 benchmark reproduced
this deterministically on a dense sheet (``INVALID_MODEL_JSON: Expecting ','
delimiter … char 8422``).

This module recovers an object from such output **without ever inventing a
technical claim or value**. It only performs *structural* repairs the JSON
grammar itself demands:

* strip a ```json fence and any prefixed/suffixed reasoning prose,
* extract the first *unambiguous* balanced ``{...}`` object,
* insert a structural delimiter (``,`` / ``:``) the parser reports as missing,
* drop a trailing comma the parser rejects,
* close a *truncated* object by discarding the incomplete trailing fragment and
  emitting the missing closers — dropping partial data, never fabricating it.

Every repair is bounded (a fixed maximum number of parser-driven fixes; no
unbounded loop) and is re-validated by ``json.loads`` after each step. If the
result is ambiguous, or the caller's schema validation rejects it, recovery
**fails closed** — the caller raises ``INVALID_MODEL_JSON``. A recovered object
is always marked ``repair_attempted`` so the run is visible as degraded and is
blocked from automatic gold promotion (POTD directive).

Pure: no I/O, no network, no imports beyond stdlib. A string in, a
:class:`RecoveryResult` out.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field

CODE = "INVALID_MODEL_JSON"

# Bound on parser-feedback repairs — a real dense-sheet object has far fewer
# missing delimiters than this; hitting the bound means the output is
# irrecoverably malformed and we fail closed rather than loop.
MAX_PARSER_FIXES = 128

# Repair-method vocabulary (persisted as provenance; stable strings).
METHOD_NONE = "none"  # parsed clean, no repair needed
METHOD_EXTRACT = "extract_object"  # fence/prose stripped to a bare object
METHOD_DELIMITER = "insert_delimiter"  # parser-reported missing , or :
METHOD_TRAILING_COMMA = "strip_trailing_comma"
METHOD_CLOSE_TRUNCATED = "close_truncated"  # dropped incomplete tail + closed
METHOD_FAILED = "failed"  # irrecoverable — fail closed


@dataclass
class RecoveryResult:
    """Outcome of a recovery attempt. ``recovered`` is None unless a schema-valid
    object was produced. ``methods`` lists every structural repair applied, in
    order (empty when the input parsed clean)."""

    recovered: dict | None
    repair_attempted: bool
    methods: list[str] = field(default_factory=list)
    detail: str = ""
    valid: bool = False
    truncated: bool = False

    @property
    def method(self) -> str:
        """A single stable label for provenance: the last repair applied, or
        ``none`` (clean) / ``failed`` (irrecoverable)."""
        if self.recovered is None:
            return METHOD_FAILED
        return self.methods[-1] if self.methods else METHOD_NONE


def _defence(raw: str) -> tuple[str, bool]:
    """Strip a leading ```/```json fence and its trailing ```. Returns
    (de-fenced, changed). Does NOT trim to the object — the ambiguity guard needs
    to see every top-level object in the de-fenced text first."""
    s = raw.strip()
    changed = False
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if "```" in s:
            s = s.rsplit("```", 1)[0]
        s = s.strip()
        changed = True
    return s, changed


def _extract_object(s: str) -> tuple[str, bool]:
    """Return (object_str, changed): the first balanced ``{...}`` object (prose
    before/after it dropped), found via a string-aware depth scan — NOT
    ``rfind('}')``, which grabs an inner brace on a truncated object and corrupts
    it. On a truncated object (no matching close), keeps everything from the first
    ``{`` so :func:`_close_truncated` can repair it."""
    changed = False
    start = s.find("{")
    if start < 0:
        return s, changed
    if start > 0:
        changed = True
    depth = 0
    in_str = False
    escape = False
    end = -1
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end != -1:
        if end < len(s) - 1:
            changed = True  # trailing prose after the object
        return s[start : end + 1], changed
    return s[start:], True  # truncated — keep to end for _close_truncated


def _balanced_prefixes(s: str) -> int:
    """Count top-level ``{...}`` objects at depth 0 (string-aware). Used to
    detect the ambiguous 'more than one candidate object' case."""
    depth = 0
    in_str = False
    escape = False
    tops = 0
    for ch in s:
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                tops += 1
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
    return tops


def _close_truncated(s: str) -> str | None:
    """Repair a truncated object by discarding the incomplete trailing fragment
    and emitting the missing closers. A key/value-aware single scan tracks the
    container stack AND whether each string is a key or a value, so the safe cut
    point only ever lands after a **complete value or element** — never after a
    dangling key (``{"tag":`` truncated mid-object drops the whole ``{"tag"…``
    fragment, it does not fabricate a value). Returns the repaired string, or
    None if there is no safe cut point. NEVER adds a key or value — only closers."""
    closers: list[str] = []  # pending '}' / ']'
    kinds: list[str] = []  # 'obj' / 'arr'
    states: list[str] = []  # obj: key|colon|value|comma ; arr: value|comma
    in_str = False
    escape = False
    str_is_key = False
    safe_cut = -1  # index just AFTER the last complete element
    safe_closers: list[str] = []

    def _complete(idx: int) -> None:
        nonlocal safe_cut, safe_closers
        if states:
            states[-1] = "comma"
        safe_cut = idx
        safe_closers = list(closers)

    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
                if str_is_key:
                    if states:
                        states[-1] = "colon"
                else:
                    _complete(i + 1)
            i += 1
            continue
        if ch == '"':
            in_str = True
            escape = False
            str_is_key = bool(kinds) and kinds[-1] == "obj" and states[-1] == "key"
            i += 1
            continue
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == ",":
            if states:
                states[-1] = "key" if kinds[-1] == "obj" else "value"
            i += 1
            continue
        if ch == ":":
            if states:
                states[-1] = "value"
            i += 1
            continue
        if ch == "{":
            closers.append("}")
            kinds.append("obj")
            states.append("key")
            i += 1
            continue
        if ch == "[":
            closers.append("]")
            kinds.append("arr")
            states.append("value")
            i += 1
            continue
        if ch in "}]":
            if closers:
                closers.pop()
                kinds.pop()
                states.pop()
            _complete(i + 1)
            i += 1
            continue
        j = _scalar_end(s, i)
        if j is not None:
            _complete(j)
            i = j
            continue
        break  # unknown char — cannot safely continue

    if safe_cut < 0:
        return None
    head = s[:safe_cut].rstrip()
    if head.endswith(","):
        head = head[:-1].rstrip()
    return head + "".join(reversed(safe_closers))


def _scalar_end(s: str, i: int) -> int | None:
    """If a JSON scalar (number/true/false/null) starts at ``i`` outside a
    string, return the index just past it; else None. Conservative — only used
    to advance the safe-cut scanner past complete scalars."""
    import re  # noqa: PLC0415 — local, stdlib

    m = re.match(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null", s[i:])
    if not m:
        return None
    return i + m.end()


def _repair_by_parser_feedback(s: str) -> tuple[str, list[str], bool]:
    """Drive repairs from ``json.loads`` errors: insert the exact delimiter the
    grammar reports missing, drop a rejected trailing comma, or hand a
    truncation error to :func:`_close_truncated`. Returns (string, methods,
    truncated). Bounded by ``MAX_PARSER_FIXES`` — no unbounded loop."""
    methods: list[str] = []
    truncated = False
    cur = s

    def _try_close() -> bool:
        nonlocal cur, truncated
        closed = _close_truncated(cur)
        if closed is None or closed == cur:
            return False
        cur = closed
        truncated = True
        if METHOD_CLOSE_TRUNCATED not in methods:
            methods.append(METHOD_CLOSE_TRUNCATED)
        return True

    for _ in range(MAX_PARSER_FIXES):
        try:
            json.loads(cur)
            return cur, methods, truncated
        except json.JSONDecodeError as exc:
            msg = exc.msg
            pos = exc.pos
            # EOF errors are TRUNCATION, not a genuinely missing delimiter —
            # inserting a delimiter at EOF makes it worse. Close the object.
            if pos >= len(cur) or msg.startswith("Unterminated string"):
                if _try_close():
                    continue
                return cur, methods, True
            if msg.startswith("Expecting ',' delimiter"):
                cur = cur[:pos] + "," + cur[pos:]
                if METHOD_DELIMITER not in methods:
                    methods.append(METHOD_DELIMITER)
            elif msg.startswith("Expecting ':' delimiter"):
                cur = cur[:pos] + ":" + cur[pos:]
                if METHOD_DELIMITER not in methods:
                    methods.append(METHOD_DELIMITER)
            elif msg.startswith("Illegal trailing comma"):
                # newer CPython: pos points AT the offending comma
                comma = pos if pos < len(cur) and cur[pos] == "," else cur.rfind(",", 0, pos + 1)
                if comma < 0:
                    return cur, methods, truncated
                cur = cur[:comma] + cur[comma + 1 :]
                if METHOD_TRAILING_COMMA not in methods:
                    methods.append(METHOD_TRAILING_COMMA)
            elif msg.startswith("Expecting property name enclosed in double quotes"):
                # older CPython trailing comma before } — remove the comma before pos
                comma = cur.rfind(",", 0, pos + 1)
                if comma < 0:
                    return cur, methods, truncated
                cur = cur[:comma] + cur[comma + 1 :]
                if METHOD_TRAILING_COMMA not in methods:
                    methods.append(METHOD_TRAILING_COMMA)
            else:
                # an ambiguous / unmodeled defect — do not guess
                return cur, methods, truncated
    return cur, methods, truncated


def recover_json_object(
    raw: str, *, validate: Callable[[dict], None] | None = None
) -> RecoveryResult:
    """Recover a single JSON object from ``raw`` model output, fail-closed.

    ``validate`` (optional) is called with the recovered dict; if it raises, the
    object is rejected (``valid=False``, ``recovered=None``) — a structurally
    valid but schema-invalid object is NOT accepted. Returns a
    :class:`RecoveryResult`; ``recovered`` is set only on success.
    """
    if not raw or not raw.strip():
        return RecoveryResult(None, repair_attempted=False, detail="empty output")

    defenced, fenced = _defence(raw)

    # Ambiguity guard: more than one top-level object in the de-fenced text → we
    # cannot know which is THE object. Fail closed rather than guess. (Checked on
    # the de-fenced text, BEFORE trimming to the first object.)
    if _balanced_prefixes(defenced) > 1:
        return RecoveryResult(
            None,
            repair_attempted=fenced,
            methods=[METHOD_EXTRACT] if fenced else [],
            detail="ambiguous: multiple top-level JSON objects",
        )

    candidate, extracted = _extract_object(defenced)
    methods: list[str] = []
    if fenced or extracted:
        methods.append(METHOD_EXTRACT)

    # First, a clean parse of the (possibly de-fenced) candidate.
    try:
        obj = json.loads(candidate)
        parsed_clean = True
    except json.JSONDecodeError:
        parsed_clean = False
        obj = None

    truncated = False
    if not parsed_clean:
        repaired, repair_methods, truncated = _repair_by_parser_feedback(candidate)
        methods.extend(repair_methods)
        try:
            obj = json.loads(repaired)
        except json.JSONDecodeError as exc:
            return RecoveryResult(
                None,
                repair_attempted=True,
                methods=methods,
                detail=f"irrecoverable: {exc.msg} at char {exc.pos}",
                truncated=truncated,
            )

    if not isinstance(obj, dict):
        return RecoveryResult(
            None,
            repair_attempted=bool(methods),
            methods=methods,
            detail=f"recovered value is {type(obj).__name__}, not an object",
            truncated=truncated,
        )

    repair_attempted = bool(methods) and methods != [METHOD_EXTRACT]
    # a pure fence/prose strip that then parsed clean is NOT a structural repair
    # of the model's JSON — but it IS a deviation from clean output, so we still
    # surface it. Treat any non-empty method list as "attempted" for degradation.
    repair_attempted = bool(methods)

    if validate is not None:
        try:
            validate(obj)
        except Exception as exc:  # noqa: BLE001 — any schema rejection fails closed
            return RecoveryResult(
                None,
                repair_attempted=repair_attempted,
                methods=methods,
                detail=f"schema validation failed after recovery: {exc}",
                truncated=truncated,
            )

    return RecoveryResult(
        recovered=obj,
        repair_attempted=repair_attempted,
        methods=methods,
        detail="recovered" if repair_attempted else "clean",
        valid=True,
        truncated=truncated,
    )
