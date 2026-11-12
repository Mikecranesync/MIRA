"""Parse `[DELIVERY-UPDATE: LANE]` agent reports (contract: DELIVERY.md, PR #5314).

Only the block at the top of a comment is the report. Lane comments keep history in
<details> blocks that repeat the marker; those never count as the current state.
Enum fields are strict: an absent field reads "not stated", a value outside the
enum reads "unparsed". A report never implies success on its own (see lifecycle.py).
"""

from __future__ import annotations

import re
from typing import Optional

MARKER_RE = re.compile(r"^\[DELIVERY-UPDATE:\s*([A-Z0-9-]+)\s*\]\s*$")
STATES = ("ACTIVE", "BLOCKED", "HANDOFF", "COMPLETE")
EVIDENCE = ("VERIFIED", "REPORTED", "NOT TESTED")
STAGES = ("local", "review/CI", "staging", "device", "human", "production")
SHA_RE = re.compile(r"\b[0-9a-f]{40}\b")
ITEM_RE = re.compile(r"#(\d{2,6})\b")

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
    """Lines of the first marker block, stopped at the first <details> or next marker."""
    lines = body.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    started = False
    for ln in lines:
        if not started:
            if MARKER_RE.match(ln.strip()):
                started = True
                out.append(ln.strip())
            continue
        if ln.lstrip().startswith("<details") or MARKER_RE.match(ln.strip()):
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


def parse(body: str) -> Optional[dict]:
    """Return the report dict for the top block, or None if the body is not a report."""
    block = _top_block(body or "")
    if not block:
        return None
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
    return r
