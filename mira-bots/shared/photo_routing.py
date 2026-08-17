"""Deterministic photo-turn routing predicates — zero tokens, pure functions.

Two halves of one live defect (prod, 2026-08-17). A technician photographed an
equipment nameplate and captioned it *"Here's the model number can you please
find the PDF user manual for me?"*. The vision classifier called it
``ELECTRICAL_PRINT`` at confidence 0.66 — a dense plate has the same visual
signature as a schematic (57 Tesseract line items) — so the print interpreter
took the turn, spent ~40 s and a model call, and produced a schematic analysis
whose OWN FIRST LINE read *"This photograph is the equipment's factory
nameplate, not a wiring schematic."* We shipped that to the technician.

Both guards live here because both are stable reasoning exported as
deterministic artifacts (`.claude/rules/zero-token-architecture.md`): no model
is needed to know that "find me the manual" is not a print question, or that an
interpretation which disowns the photo must not be delivered.

- ``asks_for_documentation`` / ``asks_for_identity`` — caption intent. The
  photo rungs use these for flow OWNERSHIP only (the same carve-out shape the
  wiring-intake rung already uses). The visual-first classifier doctrine is
  untouched: a caption never re-labels the IMAGE, it only decides which flow
  the technician explicitly invoked, and any print vocabulary in the caption
  vetoes both predicates.
- ``declares_not_a_print`` — the interpreter's own self-declared misroute.

No I/O, no imports beyond ``re``.
"""

from __future__ import annotations

import re

# --------------------------------------------------------------------------- #
# Caption intent
# --------------------------------------------------------------------------- #

# Print vocabulary in the caption VETOES both caption predicates below: the
# technician named the drawing, so this is a print question about equipment
# ("what's the part number on this schematic?") and the interpreter owns it.
_PRINT_CONTEXT_RE = re.compile(
    r"\b(prints?|schematics?|diagrams?|drawings?|blueprints?|ladder|rungs?|"
    r"one[- ]line|single[- ]line|elementary|wiring|circuits?|"
    r"schaltplan|stromlaufplan|zeichnung)\b"
)

# "Where is the paperwork for this thing?"
_DOCUMENT_RE = re.compile(
    r"\b(manuals?|handbooks?|datasheets?|data sheets?|spec sheets?|specsheets?|"
    r"cut sheets?|user'?s? guides?|owner'?s? manuals?|operating guides?|"
    r"installation guides?|instruction (?:sheet|book|manual)s?|"
    r"documentation|docs|pdfs?)\b"
)

# A printed identifier the plate carries — asking for one is asking about the
# plate, never about a drawing.
_IDENTIFIER_RE = re.compile(
    r"\b(part\s*(?:numbers?|nos?\.?|#)|p/n|"
    r"model\s*(?:numbers?|nos?\.?|#)|"
    r"catalog(?:ue)?\s*(?:numbers?|nos?\.?|#)|cat\.?\s*nos?\.?|"
    r"type\s*code|serial\s*(?:numbers?|nos?\.?|#)|s/n|"
    r"nameplates?|name plates?|data plates?|rating plates?)\b"
)

# "What am I even looking at?"
_IDENTITY_QUESTION_RE = re.compile(
    r"what(?:'s|s| is| are)?\s+(?:this|that|it)\b"
    r"|what\s+am\s+i\s+looking\s+at"
    r"|\bidentify\s+(?:this|that|it)\b"
    r"|what\s+(?:kind|type|make|model|brand)\s+of\b"
    r"|who\s+(?:makes|made)\s+(?:this|that|it)\b"
    r"|what\s+(?:drive|vfd|motor|plc|starter|breaker|unit|equipment)\s+is\s+(?:this|that|it)\b"
)


def _caption_text(caption: str | None) -> str:
    """Lowercased caption, or "" when there is nothing to read."""
    return (caption or "").strip().lower()


def asks_for_documentation(caption: str | None) -> bool:
    """The caption asks for the equipment's paperwork or a printed identifier.

    This is the narrow, unambiguous class: a technician who asks for a manual,
    a datasheet or a part number is never asking for a schematic
    interpretation. Vetoed by any print vocabulary in the same caption.
    """
    text = _caption_text(caption)
    if not text or _PRINT_CONTEXT_RE.search(text):
        return False
    return bool(_DOCUMENT_RE.search(text) or _IDENTIFIER_RE.search(text))


def asks_for_identity(caption: str | None) -> bool:
    """The caption asks WHAT the equipment is, or for its paperwork / identifier.

    A superset of :func:`asks_for_documentation` that also covers the bare
    identification question ("what is this?", "what kind of drive is this?").
    Vetoed by any print vocabulary in the same caption.
    """
    text = _caption_text(caption)
    if not text or _PRINT_CONTEXT_RE.search(text):
        return False
    return bool(
        _DOCUMENT_RE.search(text)
        or _IDENTIFIER_RE.search(text)
        or _IDENTITY_QUESTION_RE.search(text)
    )


# --------------------------------------------------------------------------- #
# Interpreter self-declared misroute
# --------------------------------------------------------------------------- #

# A misroute is declared up front — "This photograph is the equipment's factory
# nameplate, not a wiring schematic." Only the opening is scanned so a passing
# mention deep inside a long, legitimate interpretation can never trip it.
_MISROUTE_HEAD_CHARS = 600

# The artifact the interpretation says it is actually looking at.
_NON_PRINT_ARTIFACT_RE = re.compile(
    r"\b(nameplates?|name plates?|data plates?|rating plates?|id plates?|"
    r"identification plates?|equipment labels?|product labels?|motor labels?)\b"
)

# ...and its explicit denial that the photo is a drawing.
_NOT_A_PRINT_RE = re.compile(
    r"\b(?:not|isn'?t|rather than|instead of)\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,2}"
    r"(?:prints?|schematics?|diagrams?|drawings?|ladder logic)\b"
)


def declares_not_a_print(text: str | None) -> bool:
    """True when an interpretation's opening disowns the photo as a print.

    Requires BOTH a non-print artifact noun (nameplate / data plate) AND an
    explicit denial of print-hood, within the opening. Either signal alone is
    not enough, and requiring both is what keeps this from suppressing real
    print answers:

    - a legitimate interpretation routinely narrows the drawing type
      ("not a ladder diagram — this is a power schematic"): denial, no plate;
    - and it routinely reads the nameplate data block printed on a sheet:
      plate, no denial.
    """
    if not text:
        return False
    head = text[:_MISROUTE_HEAD_CHARS].lower()
    return bool(_NON_PRINT_ARTIFACT_RE.search(head) and _NOT_A_PRINT_RE.search(head))
