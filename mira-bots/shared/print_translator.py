"""Print Translator — Telegram print photo -> plain-English theory of operation.

**IS:** a read-only, LLM-generation feature. A Telegram photo of an
electrical print + an "explain this / theory of operation" caption produces
a senior-technician plain-English explanation, grounded ONLY in the visible
print (OCR/vision).

**IS NOT** the wiring DB lane. This module makes **no `wiring_connections`
writes, no proposed rows, no new table/migration, no Hub review, no graph
ingestion, no control/PLC writes.** It persists nothing. It reuses the
existing vision classifier (`engine.vision`) and inference cascade
(`engine.router`) and replies — that's the whole feature.

## Grounding doctrine (non-negotiable, tested)

- Ground ONLY in the vision worker's ``ocr_items`` (used verbatim) plus the
  image itself. Never invent a wire number, terminal, or device tag that
  isn't in ``ocr_items``. An unreadable/unclear label is flagged, not
  guessed.
- Hedged framing: "According to this print...", "This appears to show...".
  The reply explains the *drawing*, never asserts the installed machine is
  actually wired this way.
- This module is pure prompt/intent logic — no I/O, no DB, no network. The
  Telegram fast-path (``bot.py::_try_print_translator_reply``) owns the
  vision call and the LLM call; this module only builds the messages and
  formats the reply.
"""

from __future__ import annotations

# no I/O, no DB, no network in this module — pure prompt/intent logic.

# Print-explanation intent phrases (substring match on lowercased caption).
# Conservative: an explain/describe verb about the drawing. Must NOT match the
# wiring-intake phrases ("add this wiring", "add to documentation") or a plain
# nameplate/equipment photo caption.
THEORY_INTENT_PHRASES = (
    "explain this print",
    "explain this wiring",
    "explain this circuit",
    "explain this schematic",
    "explain this diagram",
    "explain the circuit",
    "what does this circuit do",
    "what does this print",
    "what does this show",
    "what does this do",
    "how does this work",
    "how does this circuit work",
    "theory of operation",
    "intended operation",
    "sequence of operation",
    "describe the circuit",
    "describe this print",
    "walk me through this print",
    "walk me through this circuit",
    "what is this circuit",
)

# Cap on OCR items fed into the prompt — mirrors
# `engine.py::_analyze_schematic_with_question`'s `ocr_items[:80]`.
OCR_ITEM_CAP = 80

THEORY_SYSTEM_PROMPT = """\
You are MIRA, a senior maintenance electrician and controls technician with \
30 years of experience reading electrical prints, wiring diagrams, PLC \
ladder logic, and control-circuit schematics.

A technician has sent a photo of a print and asked you to explain it. \
Ground everything you say ONLY in the OCR labels provided (ground truth) and \
what is visibly in the image. NEVER invent wire numbers, terminal \
designations, or device tags that are not in the OCR data or clearly visible \
in the image. Use the OCR designations verbatim. If a label, region, or \
connection is unreadable or unclear, say so explicitly instead of guessing.

Do NOT read or describe schematic-software UI chrome — menus, toolbars, \
title bars, or file names. Only describe the drawing content itself.

Use hedged framing throughout: "According to this print...", "This appears \
to show...", "The drawing indicates...". You are explaining what the DRAWING \
shows, not asserting how the actual, installed machine is wired today — \
never claim the real equipment matches the print without qualification.

Respond in plain English a maintenance technician can act on. Keep it \
readable on a phone: well under 600 words, bullets are fine. Use EXACTLY \
these six section headings, in this order:

1. **What this appears to be**
2. **Main visible components**
3. **Plain-English theory of operation**
4. **What must be true for it to work**
5. **What would stop it from working**
6. **Unclear or unreadable items**

Section guidance:
- Section 3 is the intended sequence of operation, step by step, in plain \
language (e.g. "the start button, once pressed, appears to energize the \
conveyor motor starter coil provided the e-stop is released").
- Section 4 lists the permissives, interlocks, and feedback signals that \
must be satisfied according to the print.
- Section 5 lists the likely failure points visible in the print (open \
contacts, missing feedback, single points of failure).
- Section 6 explicitly lists any labels or regions you could not read with \
confidence. If nothing is unreadable, say "nothing major unreadable."
"""


def is_theory_request(text: str) -> bool:
    """True if the caption asks for a print/theory-of-operation explanation.

    Pure substring match on the lowercased text against
    ``THEORY_INTENT_PHRASES``. Deliberately conservative so it does not
    steal captions the nameplate/drive-pack flow or the wiring-intake flow
    own.
    """
    if not text:
        return False
    lowered = text.lower()
    return any(phrase in lowered for phrase in THEORY_INTENT_PHRASES)


def _ocr_block(vision_data: dict) -> str:
    """The OCR ground-truth block.

    Uses ``ocr_items`` verbatim, capped at ``OCR_ITEM_CAP`` (mirrors
    ``_analyze_schematic_with_question``). Never adds a label that isn't in
    ``ocr_items``. If there are none, an honest fallback line so the model
    still knows to flag unreadable content instead of guessing.
    """
    ocr_items = (vision_data or {}).get("ocr_items") or []
    if not ocr_items:
        return "No OCR labels were extracted; rely on the image."
    lines = "\n".join(f"- {item}" for item in ocr_items[:OCR_ITEM_CAP])
    return (
        "OCR labels extracted from the drawing (ground truth — use these "
        "verbatim, do not invent new labels):\n" + lines
    )


def build_theory_messages(photo_b64: str, vision_data: dict) -> list[dict]:
    """Build the ``[system, user(image+text)]`` messages for ``router.complete``.

    ``user`` text = ``"Drawing type: <drawing_type or 'electrical drawing'>"``
    followed by the OCR ground-truth block from ``_ocr_block``.
    """
    drawing_type = (vision_data or {}).get("drawing_type") or "electrical drawing"
    user_text = f"Drawing type: {drawing_type}\n\n{_ocr_block(vision_data)}"

    return [
        {"role": "system", "content": THEORY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                },
                {"type": "text", "text": user_text},
            ],
        },
    ]


FALLBACK_REPLY = (
    "I couldn't generate an explanation right now. Try again, or send a clearer photo of the print."
)


def format_theory_reply(raw: str, drawing_type: str | None = None) -> str:
    """Post-process the model's reply for Telegram.

    If ``raw`` is empty (all providers failed) return ``FALLBACK_REPLY``.
    Otherwise return ``raw`` unchanged — the prompt already enforces the
    6-section format + hedged framing. Do NOT append a generic sentence, do
    NOT fabricate content.
    """
    if not raw:
        return FALLBACK_REPLY
    return raw
