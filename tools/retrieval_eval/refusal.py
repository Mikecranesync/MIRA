"""Notebook chat's honest-refusal classifier, ported verbatim for offline scoring.

Source of truth: ``isRefusal`` in
``mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts``. The pattern
strings below must equal that file's regex literals byte for byte;
``tests/retrieval_eval/test_refusal_drift.py`` fails the moment they diverge,
so this copy can never silently score refusals differently from production.
"""

from __future__ import annotations

import re

ROUTE_TS = "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts"

PATTERNS: dict[str, str] = {
    "REFUSAL_PHRASE_RE": (
        r"\b(could|couldn'?t|can'?t|cannot|do(?:es)? not|don'?t)\b[^.]*\b(find|contain|include|have|see|"
        r"specify|state|list|give|provide|mention|show|cover)\b"
    ),
    "EVIDENCE_SUBJECT_REFUSAL_RE": (
        r"\b(excerpts?|sources?|references?|documents?|documentation|manuals?|pages?|data ?sheets?|"
        r"materials?)\s+(?:[a-z'-]+\s+){0,2}(?:do(?:es)? not|don't|doesn't|did not|didn't)\s+"
        r"(?:[a-z'-]+\s+){0,2}(?:say|define|identify|confirm|describe|explain|indicate)\b"
    ),
    "FIRST_PERSON_REFUSAL_RE": (
        r"\b(?:i|we)\s+(?:can't|cannot|could not|couldn't|am unable to|was unable to|'m unable to)\s+"
        r"(?:[a-z'-]+\s+){0,2}(?:say|define|identify|confirm|describe|explain|indicate)\b"
    ),
    "EVIDENCE_PHRASE_RE": (
        r"\b(excerpts?|sources?|references?|documents?|documentation|manuals?|data ?sheets?|ratings?|"
        r"specifications?|specs?|provided|supplied|selected|information)\b"
    ),
    "IMPERATIVE_NEGATION_RE": r"^(?:please\s+)?(?:do not|don't|never)\b",
}
# JavaScript regexes without the ``u`` flag treat only [A-Za-z0-9_] as word characters, so
# their ``\b`` is an ASCII boundary; Python's is Unicode-aware ("écan't" has no boundary
# before "c" in Python, one in JavaScript). Translate ``\b`` so the copy behaves like the
# original. ``\s`` is Unicode in both and is left alone.
_ASCII_B = r"(?:(?<![A-Za-z0-9_])(?=[A-Za-z0-9_])|(?<=[A-Za-z0-9_])(?![A-Za-z0-9_]))"


def _js_to_py(pattern: str) -> str:
    return pattern.replace(r"\b", _ASCII_B)


_RE = {k: re.compile(_js_to_py(v)) for k, v in PATTERNS.items()}
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
MAX_REFUSAL_CHARS = 400


def _fold(text: str) -> str:
    return re.sub("[‘’ʼ]", "'", text.lower())


def _phrase_in(folded: str) -> bool:
    for raw in _SENTENCE_SPLIT.split(folded):
        s = _RE["IMPERATIVE_NEGATION_RE"].sub("", raw.strip(), count=1)
        if (
            _RE["REFUSAL_PHRASE_RE"].search(s)
            or _RE["EVIDENCE_SUBJECT_REFUSAL_RE"].search(s)
            or _RE["FIRST_PERSON_REFUSAL_RE"].search(s)
        ):
            return True
    return False


def is_refusal(answer: str) -> bool:
    a = _fold(answer)
    js_length = len(a.encode("utf-16-le")) // 2  # JavaScript's length: an emoji counts 2
    return (
        _phrase_in(a)
        and bool(_RE["EVIDENCE_PHRASE_RE"].search(a))
        and js_length < MAX_REFUSAL_CHARS
    )
