"""Fault-code extraction from chunk text.

Spec: docs/specs/uns-kg-unification-spec.md §4.4 (extractor #2).

Conservative regex matching — we'd rather miss codes than fabricate them.
Confidence is fixed at 0.85 per spec; the caller persists this on the
HAS_FAULT relationship row so a future review queue can filter low-confidence
edges.

Patterns matched
----------------
- Allen-Bradley / Rockwell PowerFlex VFD families: `F\\d{2,4}`
  (e.g. F004, F029, F2021)
- Allen-Bradley GuardLogix / ControlLogix safety codes: `E\\d{2,4}`
  (e.g. E07, E102)
- Generic "Fault N" / "Fault Code N" callouts: digits 1-4 long
- Siemens SINAMICS: `F\\d{5}` and `A\\d{5}` (alarm codes)
- ABB / generic alphanumeric: `OL`, `OC`, `OH`, `UV`, `OV`, `GF`,
  `E-OC`, `E-UV`, etc. — only when surrounded by fault/error context

The extractor returns a list of (code, surrounding_snippet) so the
caller can attach a snippet to the entity's properties for human review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

# ---------------------------------------------------------------------------
# Pattern catalogue
# ---------------------------------------------------------------------------

# Strict alphanumeric codes that are essentially always fault codes when they
# appear in technical text. Anchored with word-boundaries.
_STRONG_PATTERNS = [
    # Allen-Bradley PowerFlex / SINAMICS-style F-codes (2-5 digits)
    re.compile(r"\bF[-_ ]?\d{2,5}\b"),
    # ControlLogix / GuardLogix-style E-codes
    re.compile(r"\bE[-_ ]?\d{2,4}\b"),
    # Siemens SINAMICS alarm codes
    re.compile(r"\bA\d{5}\b"),
    # Allen-Bradley DriveExecutive style "Fault N"
    re.compile(r"\bFault\s*(?:Code\s*)?#?\s*(\d{1,4})\b", re.IGNORECASE),
    # ABB / generic VFD short codes — only matched when in fault context
    # (handled separately by _CONTEXT_PATTERNS below).
]

# Short alpha codes that are too generic to match without context.
# These only count as a fault code when within `_CONTEXT_WINDOW` chars
# of one of the trigger words below.
_SHORT_ALPHA = re.compile(r"\b(?:OL|OC|OH|UV|OV|GF|SC|IT)\b")
_CONTEXT_TRIGGERS = (
    "fault",
    "alarm",
    "trip",
    "error",
    "warning",
    "diagnostic",
    "code",
)
_CONTEXT_WINDOW = 60

# Codes we always discard as false positives. The short-alpha codes (OL, OC,
# UV, ...) are NOT in this list — they require context to fire in the first
# place. The single-digit F/E codes ARE noise: they typically refer to
# enumerated steps in a manual, not actual fault numbers.
_BLACKLIST = {"E1", "E2", "E3", "F1", "F2", "F3"}


@dataclass(frozen=True)
class FaultCodeMatch:
    code: str
    snippet: str  # ~80 chars surrounding the match for human review

    def normalized(self) -> str:
        """Canonical form: uppercase, no separator between letter and digits."""
        # Strip a single separator after the letter prefix.
        return re.sub(r"^([A-Za-z]+)[-_ ]?", lambda m: m.group(1).upper(), self.code).upper()


def _surrounding_snippet(text: str, start: int, end: int, window: int = 80) -> str:
    s = max(0, start - window // 2)
    e = min(len(text), end + window // 2)
    return text[s:e].replace("\n", " ").strip()


def _has_context(text: str, position: int) -> bool:
    """True if a fault-context trigger word appears near `position`."""
    lo = max(0, position - _CONTEXT_WINDOW)
    hi = min(len(text), position + _CONTEXT_WINDOW)
    window = text[lo:hi].lower()
    return any(t in window for t in _CONTEXT_TRIGGERS)


def extract_fault_codes(text: str) -> list[FaultCodeMatch]:
    """Return a deduplicated list of FaultCodeMatch found in `text`.

    Order is the order of first appearance, so callers can rank by
    "what the chunk leads with" if useful. Matches are normalized so
    `F-004`, `F004`, and `F 004` collapse to a single `F004` entity.
    """
    if not text:
        return []

    seen: dict[str, FaultCodeMatch] = {}

    for pat in _STRONG_PATTERNS:
        for m in pat.finditer(text):
            raw = m.group(0)
            # If the pattern was the "Fault N" form, compose `F<N>` so it
            # collapses with the strong F-code pattern.
            grp = m.groups()
            if grp and grp[0]:
                raw = f"F{grp[0]}"
            match = FaultCodeMatch(
                code=raw,
                snippet=_surrounding_snippet(text, m.start(), m.end()),
            )
            norm = match.normalized()
            if norm in _BLACKLIST:
                continue
            if norm not in seen:
                seen[norm] = FaultCodeMatch(code=norm, snippet=match.snippet)

    for m in _SHORT_ALPHA.finditer(text):
        if not _has_context(text, m.start()):
            continue
        raw = m.group(0).upper()
        if raw in _BLACKLIST:
            continue
        if raw not in seen:
            seen[raw] = FaultCodeMatch(
                code=raw,
                snippet=_surrounding_snippet(text, m.start(), m.end()),
            )

    return list(seen.values())


def extract_fault_codes_batch(chunks: Iterable[dict]) -> list[tuple[dict, list[FaultCodeMatch]]]:
    """Convenience wrapper: run `extract_fault_codes` over a list of
    chunk dicts and return only the chunks that yielded ≥1 match.
    Each chunk dict must have a 'text' key."""
    out = []
    for chunk in chunks:
        matches = extract_fault_codes(chunk.get("text", ""))
        if matches:
            out.append((chunk, matches))
    return out
