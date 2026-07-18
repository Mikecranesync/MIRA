"""Question-focus resolution for print-workspace follow-ups (Package B).

Resolves which ledger entity a follow-up text turn is about:

  1. an explicit tag in the text matched against the workspace's known OCR
     tags (case- and hyphen-insensitive: "K17" matches "-K17");
  2. a child/contact alias ("K17.1" ↔ "K17", "X2:4" ↔ "-X2") via the
     designations decoder when available, with a deterministic strip-the-
     trailing-suffix prefix match as the always-on fallback;
  3. a pronoun/device-noun reference ("it", "this relay", "the contactor",
     German "es") resolved to the workspace's ``last_entity``.

Pure and fail-open: no I/O, no model calls; the optional
``printsense.designations`` import is lazy and any failure inside it falls
back to the deterministic prefix match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_TAG_RE = re.compile(r"[-+]?[A-Za-z]{1,3}\d{1,4}(?:\.\d{1,3})*(?::\d{1,3})?")
_PRONOUN_RE = re.compile(r"\b(it|this|that|these|those|es)\b", re.IGNORECASE)
_DEVICE_NOUN_RE = re.compile(
    r"\b(?:the|that|this)\s+(relay|contactor|coil|contact|breaker|fuse|overload|"
    r"switch|solenoid|valve|motor|device|terminal)\b",
    re.IGNORECASE,
)
_CHILD_SUFFIX_RE = re.compile(r"(?:[.:]\d{1,3})+$")


@dataclass
class ResolvedQuestion:
    """One resolved follow-up turn: the (unchanged) text, the ledger tag the
    question is about (``None`` when unresolved), and an optional alias note
    rendered as a Derived line when a child designation was folded to its
    parent (or vice versa)."""

    text: str
    focus_tag: str | None
    alias_note: str | None


def _norm(tag: str | None) -> str:
    return (tag or "").strip().lstrip("-+").upper()


def _strip_child(norm_tag: str) -> str:
    """``K17.1`` → ``K17``; ``X2:4`` → ``X2``."""
    return _CHILD_SUFFIX_RE.sub("", norm_tag)


def _designations_related(a: str, b: str) -> bool | None:
    """True when the designations decoder relates ``a`` and ``b``; ``None``
    when the decoder is unavailable or sees no relation (undecidable — the
    caller falls back to the prefix match). Never raises."""
    try:
        from printsense.designations import relationships  # noqa: PLC0415 — lazy
        from printsense.designations.decoder import decode  # noqa: PLC0415 — lazy

        rels = relationships.relate(decode(a), decode(b))
        return True if rels else None
    except Exception:  # noqa: BLE001 — designations are optional enrichment
        return None


def resolve_question_focus(
    text: str,
    last_entity: str | None,
    known_tags: list[str] | None,
) -> ResolvedQuestion:
    """Resolve the follow-up's focus entity. Text is never rewritten."""
    text = text or ""
    try:
        known_by_norm: dict[str, str] = {}
        for tag in known_tags or []:
            if tag:
                known_by_norm.setdefault(_norm(tag), tag)

        candidates: list[str] = []
        for match in _TAG_RE.finditer(text):
            token = match.group(0)
            if token not in candidates:
                candidates.append(token)

        # 1. explicit tag, case/hyphen-insensitive
        for candidate in candidates:
            hit = known_by_norm.get(_norm(candidate))
            if hit is not None:
                return ResolvedQuestion(text=text, focus_tag=hit, alias_note=None)

        # 2. child/contact alias (designations decoder first, prefix fallback)
        for candidate in candidates:
            cand_norm = _norm(candidate)
            for known_norm, known_raw in known_by_norm.items():
                if cand_norm == known_norm:
                    continue
                related = _designations_related(candidate, known_raw)
                if related is None:
                    cand_is_child = (
                        _strip_child(cand_norm) == known_norm
                        and _strip_child(cand_norm) != cand_norm
                    )
                    known_is_child = (
                        _strip_child(known_norm) == cand_norm
                        and _strip_child(known_norm) != known_norm
                    )
                    related = cand_is_child or known_is_child
                if not related:
                    continue
                if _strip_child(cand_norm) == known_norm and cand_norm != known_norm:
                    note = (
                        f"answering for {known_raw} ({candidate} is its contact/child designation)"
                    )
                else:
                    note = (
                        f"answering for {known_raw} "
                        f"({known_raw} is a contact/child designation of {candidate})"
                    )
                return ResolvedQuestion(text=text, focus_tag=known_raw, alias_note=note)

        # 3. pronoun / device-noun continuity → last_entity
        if last_entity and (_PRONOUN_RE.search(text) or _DEVICE_NOUN_RE.search(text)):
            return ResolvedQuestion(text=text, focus_tag=last_entity, alias_note=None)
    except Exception:  # noqa: BLE001 — resolution must never eat a turn
        pass
    return ResolvedQuestion(text=text, focus_tag=None, alias_note=None)


__all__ = ["ResolvedQuestion", "resolve_question_focus"]
