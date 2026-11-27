"""Parse `[DELIVERY-UPDATE: LANE]` agent reports (contract: DELIVERY.md, PR #5314).

Only the block at the top of a comment is the report. Lane comments keep history in
<details> blocks that repeat the marker; those never count as the current state.
Enum fields are strict: an absent field reads "not stated", a value outside the
enum reads "unparsed". A report never implies success on its own (see lifecycle.py).
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, NamedTuple, Optional

if TYPE_CHECKING:
    from markdown_it.token import Token

MARKER_RE = re.compile(r"^\[DELIVERY-UPDATE:\s*([A-Z0-9-]+)\s*\]\s*$")
STATES = ("ACTIVE", "BLOCKED", "HANDOFF", "COMPLETE")
EVIDENCE = ("VERIFIED", "REPORTED", "NOT TESTED")
STAGES = ("local", "review/CI", "staging", "device", "human", "production")
SHA_RE = re.compile(r"\b[0-9a-f]{40}\b")
ITEM_RE = re.compile(r"#(\d{2,6})\b")
CAPABILITY_FIELD = re.compile(r"^capability\s+candidate\s*:", re.I)
CAPABILITY_CANDIDATE = re.compile(r"Capability candidate: #([1-9]\d{0,5}) @ ([0-9a-f]{40})")
HISTORY_RE = re.compile(r"^[ \t]*<details(?=[\s>/]|$)", re.I)
FENCE_RE = re.compile(r"(?m)^[ \t]{0,3}(?:`{3,}|~{3,})")

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


class _ReportBlock(NamedTuple):
    lines: list[str]
    offset: int
    tokens: Optional[list[Token]]
    uncertain: bool = False


def _paragraphs(tokens: list[Token]):
    for previous, inline in zip(tokens, tokens[1:]):
        if (previous.type, previous.level, inline.type) == ("paragraph_open", 0, "inline"):
            yield inline


def _visible_lines(inline: Token) -> list[str]:
    return "".join(
        child.content if child.type == "text" else
        "\n" if child.type in {"softbreak", "hardbreak"} else
        "\0" if child.type in {"code_inline", "image"} else ""
        for child in inline.children or []
    ).split("\n")


def _top_block(body: str) -> Optional[_ReportBlock]:
    """Find the live report and stop at its first rendered history boundary."""
    if "[DELIVERY-UPDATE:" not in body:
        return None
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    lines = body.split("\n")
    markers: list[int] = []
    history = len(lines)
    uncertain = False
    try:
        from markdown_it import MarkdownIt
    except ImportError:
        # Simple legacy reports still provide status. With a fence we cannot know
        # whether a marker or a history delimiter is live, so do not certify scope.
        tokens = None
        uncertain = bool(FENCE_RE.search(body))
        for index, line in enumerate(lines):
            if HISTORY_RE.match(line):
                history = index
                break
            if MARKER_RE.fullmatch(line.strip()):
                markers.append(index)
    else:
        tokens = MarkdownIt("commonmark").parse(body)
        history = next((t.map[0] for t in tokens
                        if t.type == "html_block" and t.level == 0 and HISTORY_RE.match(t.content)),
                       history)
        for inline in _paragraphs(tokens):
            start, end = inline.map
            if start >= history:
                break
            source = [i for i in range(start, end) if MARKER_RE.fullmatch(lines[i].strip())]
            if not source:
                continue
            visible = _visible_lines(inline)
            if len(visible) == end - start:
                markers.extend(i for i in source if visible[i - start].strip() == lines[i].strip())
                continue
            live_markers = [line.strip() for line in visible if MARKER_RE.fullmatch(line.strip())]
            if live_markers:
                # A multiline inline code span can collapse source lines. Only
                # use the source positions if the marker occurrences still agree.
                uncertain |= live_markers != [lines[i].strip() for i in source]
                markers.extend(source)
    if not markers:
        return None
    end = markers[1] if len(markers) > 1 else history
    return _ReportBlock(lines[markers[0]:end], markers[0], tokens, uncertain)


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


def _capability_fields(block: _ReportBlock) -> CapabilityFields:
    """Read live capability fields and identify their exact source lines."""
    if block.uncertain:
        return CapabilityFields(malformed=True)
    lines = block.lines
    if block.tokens is None:
        return CapabilityFields(malformed=any(CAPABILITY_FIELD.match(line.lstrip()) for line in lines))

    offset = block.offset
    last = offset + len(lines)
    fences = [token for token in block.tokens if token.type == "fence" and token.level == 0
              and offset <= token.map[0] < last
              and token.info.strip().split()[:1] == ["capability-results"]]
    if len(fences) > 1:
        return CapabilityFields(malformed=True)
    excluded: set[int] = set()
    results = None
    if fences:
        fence = fences[0]
        start, end = (index - offset for index in fence.map)
        if (end > len(lines) or end - start < 3 or lines[start] != "```capability-results"
                or lines[end - 1] != "```"):
            return CapabilityFields(malformed=True)
        try:
            results = json.loads(fence.content)
        except (ValueError, RecursionError):
            return CapabilityFields(malformed=True)
        if not isinstance(results, dict):
            return CapabilityFields(malformed=True)
        excluded.update(range(start, end))

    candidate_lines = []
    for inline in _paragraphs(block.tokens):
        start, end = inline.map
        if end <= offset or start >= last:
            continue
        visible = _visible_lines(inline)
        if len(visible) != end - start:
            if any(CAPABILITY_FIELD.match(field) for field in visible):
                return CapabilityFields(malformed=True)
            continue
        for index, field in enumerate(visible, start - offset):
            if 0 <= index < len(lines) and CAPABILITY_FIELD.match(field):
                candidate_lines.append(field if lines[index] == field else "")
                excluded.add(index)
    match = CAPABILITY_CANDIDATE.fullmatch(candidate_lines[0]) if len(candidate_lines) == 1 else None
    candidate = (int(match[1]), match[2]) if match else None
    return CapabilityFields(candidate, bool(candidate_lines), results, frozenset(excluded))


def read_capability_fields(body: str) -> CapabilityFields:
    block = _top_block(body)
    return _capability_fields(block) if block else CapabilityFields()


def live_report_text(body: str) -> str:
    block = _top_block(body)
    if not block or block.uncertain:
        return ""
    examples = {index for token in block.tokens or []
                if token.type in {"fence", "code_block", "html_block"}
                for index in range(*token.map)}
    return "\n".join(line for index, line in enumerate(block.lines, block.offset)
                     if index not in examples)


def parse(body: str, *, include_capability: bool = True) -> Optional[dict]:
    """Return the report dict for the top block, or None if the body is not a report."""
    live = _top_block(body or "")
    if live is None:
        return None
    fields = _capability_fields(live) if include_capability else CapabilityFields()
    block = [line for index, line in enumerate(live.lines) if index not in fields.excluded]
    lane = MARKER_RE.fullmatch(block[0].strip()).group(1)  # type: ignore[union-attr]
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
