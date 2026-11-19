"""Parse `[DELIVERY-UPDATE: LANE]` agent reports (contract: DELIVERY.md, PR #5314).

Only the block at the top of a comment is the report. Lane comments keep history in
<details> blocks that repeat the marker; those never count as the current state.
Enum fields are strict: an absent field reads "not stated", a value outside the
enum reads "unparsed". A report never implies success on its own (see lifecycle.py).
"""

from __future__ import annotations

import json
import re
from typing import NamedTuple, Optional

MARKER_RE = re.compile(r"^\[DELIVERY-UPDATE:\s*([A-Z0-9-]+)\s*\]\s*$")
STATES = ("ACTIVE", "BLOCKED", "HANDOFF", "COMPLETE")
EVIDENCE = ("VERIFIED", "REPORTED", "NOT TESTED")
STAGES = ("local", "review/CI", "staging", "device", "human", "production")
SHA_RE = re.compile(r"\b[0-9a-f]{40}\b")
ITEM_RE = re.compile(r"#(\d{2,6})\b")
CAPABILITY_CANDIDATE = re.compile(r"Capability candidate: #([1-9]\d{0,5}) @ ([0-9a-f]{40})")

NOT_STATED = "not stated"
UNPARSED = "unparsed"

# template label -> (result key, allowed values or None for free text)
FIELDS = {
    "state": ("state", STATES),
    "evidence": ("evidence", EVIDENCE),
    "stage": ("stage", STAGES),
    "goal / slice": ("goal", None),
    "changed": ("changed", None),
    "next": ("next", None),
    "blocked by / needs": ("blocked_by", None),
    "decision for mike": ("decision", None),
    "updated": ("updated", None),
}


def _top_block(body: str) -> list[str]:
    """Lines of the first marker block, stopped at the first <details> or next marker.

    A marker that first appears after a <details> tag is history, not a report: nothing
    nested in a collapsed block may ever surface as the current state.
    """
    lines = body.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    started = False
    for ln in lines:
        if not started:
            if ln.lstrip().lower().startswith("<details"):
                return []
            if MARKER_RE.match(ln.strip()):
                started = True
                out.append(ln.strip())
            continue
        if ln.lstrip().lower().startswith("<details") or MARKER_RE.match(ln.strip()):
            break
        out.append(ln.rstrip())
    return out


def _enum(value: str, allowed: tuple[str, ...]) -> str:
    head = value.strip()
    for a in allowed:
        if (
            head == a
            or head.startswith(a + " ")
            or head.startswith(a + " —")
            or head.startswith(a + ";")
        ):
            return a
    return UNPARSED


class CapabilityFields(NamedTuple):
    candidate: Optional[tuple[int, str]] = None
    candidate_provided: bool = False
    results: Optional[dict] = None
    excluded: frozenset[int] = frozenset()
    malformed: bool = False


def _capability_fields(lines: list[str]) -> CapabilityFields:
    """Read live capability fields and identify their exact source lines."""
    raw = "\n".join(lines)
    lowered = raw.lower()
    if "capability candidate:" not in lowered and "capability-results" not in lowered:
        return CapabilityFields()
    try:
        from markdown_it import MarkdownIt
    except ImportError:
        # Unqualified installations keep the raw report and fail readiness closed.
        return CapabilityFields(malformed=True)

    tokens = MarkdownIt("commonmark").parse(raw)
    fences = [token for token in tokens if token.type == "fence" and token.level == 0
              and token.info.strip().split()[:1] == ["capability-results"]]
    if len(fences) > 1:
        return CapabilityFields(malformed=True)
    excluded: set[int] = set()
    results = None
    if fences:
        fence = fences[0]
        start, end = fence.map
        if (end - start < 3 or lines[start] != "```capability-results"
                or lines[end - 1] != "```"):
            return CapabilityFields(malformed=True)
        try:
            results = json.loads(fence.content)
        except ValueError:
            return CapabilityFields(malformed=True)
        if not isinstance(results, dict):
            return CapabilityFields(malformed=True)
        excluded.update(range(start, end))

    candidate_lines = []
    for previous, inline in zip(tokens, tokens[1:]):
        if (previous.type, previous.level, inline.type) != ("paragraph_open", 0, "inline"):
            continue
        start, end = inline.map
        visible = "".join(child.content if child.type == "text" else
                          "\n" if child.type in {"softbreak", "hardbreak"} else ""
                          for child in inline.children or []).split("\n")
        if len(visible) != end - start:
            continue
        for index, field in enumerate(visible, start):
            if (field.lower().startswith("capability candidate:")
                    and lines[index].lower().startswith("capability candidate:")):
                candidate_lines.append(field if lines[index] == field else "")
                excluded.add(index)
    match = CAPABILITY_CANDIDATE.fullmatch(candidate_lines[0]) if len(candidate_lines) == 1 else None
    candidate = (int(match[1]), match[2]) if match else None
    return CapabilityFields(candidate, bool(candidate_lines), results, frozenset(excluded))


def read_capability_fields(body: str) -> CapabilityFields:
    return _capability_fields(_top_block(body))


def parse(body: str) -> Optional[dict]:
    """Return the report dict for the top block, or None if the body is not a report."""
    block = _top_block(body or "")
    if not block:
        return None
    fields = _capability_fields(block)
    block = [line for index, line in enumerate(block) if index not in fields.excluded]
    lane = MARKER_RE.match(block[0]).group(1)  # type: ignore[union-attr]
    found: dict[str, str] = {}
    for ln in block[1:]:
        if ":" not in ln:
            continue
        label, _, value = ln.partition(":")
        key = label.strip().lower()
        if key in FIELDS and FIELDS[key][0] not in found:
            found[FIELDS[key][0]] = value.strip()
    if "updated" not in found:
        return None
    text = "\n".join(block)
    sha = SHA_RE.search(text)
    items: list[int] = []
    for m in ITEM_RE.finditer(text):
        n = int(m.group(1))
        if n not in items:
            items.append(n)
    r: dict = {"lane": lane, "updated": found["updated"], "sha": sha.group(0) if sha else None}
    for _label, (key, allowed) in FIELDS.items():
        if key == "updated":
            continue
        raw = found.get(key)
        if raw is None:
            r[key] = NOT_STATED
        elif allowed:
            r[key] = _enum(raw, allowed)
        else:
            r[key] = raw
    r["items"] = items
    if fields.malformed:
        r["malformed_capability"] = True
    return r
