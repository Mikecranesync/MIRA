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

import os
import re

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

# Broader "question about the print" phrases: device/component inventory,
# wiring/tracing, and "what is this <print/schematic/…>". Together with
# THEORY_INTENT_PHRASES these route an electrical-print photo to the GROUNDED
# interpreter instead of the free-form vision LLM (which fabricated a generic
# "ladder logic / timers / counters" device taxonomy on a real field print).
# Still conservative — must NOT match the wiring-intake caption ("add this
# wiring") or a nameplate/drive caption; the ELECTRICAL_PRINT classification is
# the real filter, so this is a cheap pre-reject to skip the vision call for
# obviously-unrelated captions.
PRINT_QUESTION_PHRASES = THEORY_INTENT_PHRASES + (
    "what device",
    "what devices",
    "what component",
    "what parts",
    "what is on this print",
    "what's on this print",
    "what is in this print",
    "what's in this print",
    "what is shown",
    "list the device",
    "list the component",
    "identify the",
    "what is this print",
    "what is this schematic",
    "what is this diagram",
    "what is this drawing",
    "trace this",
    "trace the",
    "where does this",
    "what feeds",
    "what connects",
    "what terminal",
    "which terminal",
    "which plc",
    "what plc",
    "what protects",
    "how is this wired",
    "how is it wired",
    # Canonical technician single-photo questions (testing-program Phase 2).
    # Designation meaning, contact conventions, next-page guidance, and
    # why-won't-it-energize troubleshooting are print questions by this gate's
    # own docstring — ELECTRICAL_PRINT classification stays the real filter.
    "what does -",
    " mean?",
    "normally open",
    "normally closed",
    "contact",
    "coil",
    "photograph next",
    "photo next",
    "next page",
    "which page",
    "which sheet",
    "what sheet",
    "energize",
    "energise",
    "won't start",
    "wont start",
    "why would this",
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

Safety and honesty rules (always apply, especially when answering a specific \
question):
- Terminal and contact numbers (13/14, 21/22, A1/A2, 95/96) are NAMING \
conventions. They never tell you the contact's present position or whether \
anything is energized. When asked about a contact, state the convention and \
add that the print cannot show its current state — verify with a meter \
before relying on it.
- If a cross-reference points to a sheet or page that is NOT visible in this \
photo, say so explicitly ("sheet 89 is not in view") and suggest \
photographing that sheet — never describe what the unseen sheet contains.
- For any troubleshooting question ("why would this not energize?"), finish \
with the concrete next verification step (what to measure, where) and never \
assert that something IS energized or de-energized — the print cannot prove \
live state.
- IEC letter designations name the DEVICE CLASS: when asked what a \
designation like K1, Q2, S3 or F4 means, name its device class (K = \
contactor or relay, Q = circuit breaker or disconnect, S = switch or \
selector, F = protective device such as a fuse or overload) plus the \
instance number.
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


# ── messy-English question routing (owner direction, 2026-07-17) ─────────────
# Technicians caption photos in normal, often terrible English — typos,
# fragments, no punctuation, voice-to-text. The exact-phrase whitelist measured
# 34% recall on a realistic messy-caption corpus
# (printsense/benchmarks/messy_captions.py), silently sending two-thirds of
# real questions to the generic engine. Routing is now SIGNAL logic:
#
#   route = QUESTION-signal AND (DOMAIN-signal OR DEICTIC-signal)
#           OR "?" AND DOMAIN-signal
#           OR TROUBLE-signal AND (DOMAIN-signal OR tag/pair)
#           OR STRONG-DOMAIN alone ("normally open", a device tag, "X or Y"
#              contact-state choice)
#           OR any legacy PRINT_QUESTION_PHRASES hit (no regressions)
#
# Recall matters more than caption precision here: the ELECTRICAL_PRINT vision
# classification (checked by the caller) is the real filter — a false-routed
# caption on a non-print photo falls through unchanged. Negative controls
# (small talk, scheduling, part requests) are pinned in the messy corpus.
_Q_SIGNAL_RE = re.compile(
    r"\b(what|whats|wat|why|where|were|how|which|when|explain|show me|trace|"
    r"walk me|can (?:you|u)|could (?:you|u)|tell me|meaning|mean|help)\b"
)
_Q_LEAD_AUX_RE = re.compile(r"^(is|are|does|do|did|can|could|will|would|should)\b")
_TROUBLE_RE = re.compile(
    r"\b(wont|won't|not working|doesnt|doesn't|isnt|isn't|broken|stuck|"
    r"tripped|faulted|no power|not energizing)\b"
)
_DEICTIC_RE = re.compile(r"\b(this|these|here|it)\b")
_DOMAIN_RE = re.compile(
    r"\b(print|schematic|diagram|drawing|circuit|wire|wiring|contact\w*|coil|"
    r"terminal\w*|energiz\w*|sheet|page|photo|picture|relay|see|send)\b"
)
_TAG_RE = re.compile(r"(-?\d{1,3}/[a-z]\d{1,3}\b|\b[kqfsmxu]\d{1,3}\b)")
_PAIR_RE = re.compile(r"\b\d{1,2}\s*[/\- ]\s*\d{1,2}\b")
_STRONG_DOMAIN_RE = re.compile(
    r"(normally\s+(open|closed)|\b(open|closed|no|nc)\s+or\s+(open|closed|no|nc)\b)"
)
# Equipment-identification questions ("what drive is this?") belong to the
# nameplate -> drive-pack flow, not the print path — unless the caption ALSO
# carries print context (a tag, a pair, a print-domain word), in which case it
# is a print question about that equipment. Legacy phrases are checked before
# this exclusion, so pre-existing routes ("what plc", "which plc") are untouched.
_EQUIPMENT_ID_RE = re.compile(
    r"\b(drive|vfd|plc|motor|nameplate|model|serial|part number|breaker|"
    r"starter|overload|hmi|sensor)\b"
)
# ── German print-question routing (UNSEEN-2) ─────────────────────────────────
# The unseen-print benchmark: "Welche Klemme ist belegt?" never routed — the
# signal logic above is English-only while plants and prints are frequently
# German. Additive German signal sets; every English negative control is
# untouched (German small talk carries none of these). "was" is gated to
# German usage ("was ist/bedeutet/macht/für") because it is also an English
# past-tense verb.
_Q_SIGNAL_DE_RE = re.compile(
    r"\b(welche[rs]?|wo|wie|warum|wieso|zeig(?:e|en)?|erkl(?:ä|ae)r\w*|bedeutet)\b"
    r"|\bwas\b(?=\s+(?:ist|bedeutet|macht|f(?:ü|ue)r)\b)"
)
_Q_LEAD_AUX_DE_RE = re.compile(r"^(ist|sind|hat|haben|kann|k(?:ö|oe)nnen|wird)\b")
_DOMAIN_DE_RE = re.compile(
    r"\b(klemme\w*|belegt|schaltplan|stromlaufplan|zeichnung|verdrahtung|"
    r"leitung\w*|draht\w*|spule|kontakt\w*|versorgung|querverweis\w*|blatt|"
    r"sicherung\w*|sch(?:ü|ue)tz\w*|relais)\b"
)


def is_print_question(text: str) -> bool:
    """True if the caption is any question/request about an electrical print.

    This is what routes a print photo to the GROUNDED interpreter instead of
    the free-form vision LLM. Signal-based (see block comment above) so plain,
    messy technician English routes — the ELECTRICAL_PRINT classification
    (checked by the caller) remains the real is-it-a-print filter; this gate
    only answers "is the tech asking something about the photo?".
    """
    if not text:
        return False
    lowered = text.lower()
    if any(phrase in lowered for phrase in PRINT_QUESTION_PHRASES):
        return True  # legacy whitelist — everything that routed before still routes
    domain = bool(
        _DOMAIN_RE.search(lowered)
        or _DOMAIN_DE_RE.search(lowered)
        or _TAG_RE.search(lowered)
        or _PAIR_RE.search(lowered)
    )
    if _STRONG_DOMAIN_RE.search(lowered):
        return True
    if _EQUIPMENT_ID_RE.search(lowered) and not domain:
        return False  # nameplate/drive-pack flow owns bare identification questions
    question = bool(
        _Q_SIGNAL_RE.search(lowered)
        or _Q_LEAD_AUX_RE.search(lowered)
        or _Q_SIGNAL_DE_RE.search(lowered)
        or _Q_LEAD_AUX_DE_RE.search(lowered)
    )
    if question and (domain or _DEICTIC_RE.search(lowered)):
        return True
    if "?" in lowered and domain:
        return True
    return bool(_TROUBLE_RE.search(lowered) and domain)


SLIM_THEORY_SYSTEM_PROMPT = """\
You are answering a maintenance technician's question about the electrical \
print in the photo. Answer ONLY from what is printed on the sheet; quote \
printed text and device tags exactly as shown. If the sheet does not contain \
the answer, say so plainly and name the sheet or document that would. \
A print never shows live machine state — if the question touches present \
state (energized, contact open/closed), say the technician must verify with \
a meter. Do not describe schematic-software UI chrome. Be direct and \
concise: answer the question first, and add nothing beyond what the \
question needs — no filler sections, no component inventories."""


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


def build_theory_messages(
    photo_b64: str, vision_data: dict, question: str | None = None
) -> list[dict]:
    """Build the ``[system, user(image+text)]`` messages for ``router.complete``.

    ``user`` text = ``"Drawing type: <drawing_type or 'electrical drawing'>"``
    followed by the OCR ground-truth block from ``_ocr_block``, then the
    always-present evidence-contract clause (quote OCR evidence verbatim;
    treat garbled tokens as unverified artifacts, not real tags; never claim
    a label is absent without checking the OCR block first — distinct from
    the honest sheet-not-visible case). When ``question`` is given (a
    specific technician question about the print), it is appended so the
    grounded reply answers it directly — still ONLY from the OCR labels + the
    visible image, never inventing a device/tag/connection.
    """
    drawing_type = (vision_data or {}).get("drawing_type") or "electrical drawing"
    # PRINT_THEORY_STYLE=slim (default "full", or-form): the R5 loop
    # (2026-07-19, ROUND5 report) measured the full template — OCR block +
    # evidence contract + six-section format — actively degrading strong
    # vision models: fabricating verbosity around correct direct answers
    # (21-26 invented-tag entries vs ~0 raw) and reasoning burned past the
    # router's retry cap, while the raw 3-sentence instruction scored the
    # series-best 8.54. Slim reproduces the raw conditions through the
    # production path; the deterministic autoeval still audits every reply
    # post-hoc, and format_theory_reply's contact-state caveat still applies.
    style = (os.environ.get("PRINT_THEORY_STYLE") or "full").strip().lower()
    if style == "slim":
        parts = [f"Drawing type: {drawing_type}"]
        det_lines = (vision_data or {}).get("deterministic_evidence") or []
        if det_lines:
            parts.append(
                "Deterministic decoded evidence (from cited code — trust these "
                "over your own reading of the image):\n"
                + "\n".join(f"- {line}" for line in det_lines)
            )
        q = (question or "").strip()
        parts.append(f"QUESTION: {q}" if q else "Explain what this print shows, briefly.")
        return [
            {"role": "system", "content": SLIM_THEORY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                    },
                    {"type": "text", "text": "\n\n".join(parts)},
                ],
            },
        ]
    user_text = f"Drawing type: {drawing_type}\n\n{_ocr_block(vision_data)}"
    # Evidence contract (Task E1, from the Tower OP re-bench): always present
    # so it binds even without a question. Attacks three observed failures —
    # (c05) a reply asserted part numbers "not explicitly labeled in this
    # view" while its own ocr_items held a garbled fragment of them; (c03/c09)
    # garbled OCR strings imported into replies as if they were real tags;
    # (general) answers never said which OCR evidence they used.
    user_text += (
        "\n\nEvidence discipline: whenever your answer relies on an OCR "
        "label, quote it verbatim from the OCR block above (e.g. "
        "\"Evidence: 'K10 contactor'\") so the technician can verify the "
        "source token. Treat any OCR token that does not parse as a "
        "plausible device tag or value as an unverified artifact — never "
        "present a garbled OCR fragment as if it were a real device tag. "
        "If a label you need is present only as a garbled fragment, say it "
        "is present but not cleanly legible in THIS photo and suggest a "
        "closer, straighter photo — never say it is not labeled. Never "
        "claim a label or value is not labeled, not specified, not "
        "indicated, or not marked on this print without first checking "
        "whether it is present (even garbled) in the OCR block above — "
        "that is different from the print depending on a sheet not "
        "visible in this photo, which you should still say plainly when "
        "true, naming the sheet to photograph next."
    )
    # UNSEEN-1: deterministic evidence extracted by printsense.deterministic_qa
    # (contact conventions, decoded designations, xref/wire tokens). Injected as
    # grounding when the fast-path could not fully answer — these lines come
    # from cited code, so they outrank the model's own reading of the image.
    det_lines = (vision_data or {}).get("deterministic_evidence") or []
    if det_lines:
        user_text += (
            "\n\nDeterministic decoded evidence (from cited code — trust these "
            "over your own reading of the image):\n" + "\n".join(f"- {line}" for line in det_lines)
        )
    if question and question.strip():
        user_text += (
            f"\n\nThe technician specifically asked: {question.strip()}\n"
            "Answer that question directly, grounded ONLY in the OCR labels above "
            "and what is visibly in the image — never invent a device, tag, or "
            "connection that isn't there. Your direct answer MUST apply the "
            "safety and honesty rules: if the question involves a contact or "
            "terminal number, state the naming convention AND that the print "
            "cannot show its present state — tell the technician to verify with "
            "a meter; if it asks what a designation means (like -20/K5: sheet "
            "20, device K5), you MUST name the device class for its class "
            "letter — K = contactor or relay, Q = breaker or disconnect, S = "
            "switch, F = fuse or overload; if the answer depends on a sheet not "
            "visible in this photo, say so plainly and name the sheet to "
            "photograph next; if it is a why/troubleshooting question, end with "
            "the concrete next measurement (what to measure and where). "
            "Then give the six-section explanation."
        )

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


# ── deterministic contact-state caveat (UNSEEN-4) ────────────────────────────
# The unseen-print benchmark showed verdict-correct model answers dropping the
# verify/measure caveat on novel phrasings. The caveat is a safety duty, not
# content — appended deterministically whenever a contact-convention verdict
# ships without any uncertainty/verification language.
_CONTACT_VERDICT_RE = re.compile(r"normally\s+(open|closed)", re.IGNORECASE)
_CAVEAT_MARKERS = ("verify", "measure", "meter", "convention only")
CONTACT_STATE_CAVEAT = (
    "⚠️ Convention only — a print never shows live state. Verify with the "
    "circuit made safe and a meter before relying on it."
)


def format_theory_reply(raw: str, drawing_type: str | None = None) -> str:
    """Post-process the model's reply for Telegram.

    If ``raw`` is empty (all providers failed) return ``FALLBACK_REPLY``.
    Otherwise return ``raw`` unchanged — the prompt already enforces the
    6-section format + hedged framing. Do NOT append generic prose, do NOT
    fabricate content. The single sanctioned append is the deterministic
    SAFETY caveat: a contact-convention verdict (\"normally open/closed\")
    shipping without any verification language gets ``CONTACT_STATE_CAVEAT``
    (UNSEEN-4) — a safety duty, not content.
    """
    if not raw:
        return FALLBACK_REPLY
    if _CONTACT_VERDICT_RE.search(raw) and not any(
        marker in raw.lower() for marker in _CAVEAT_MARKERS
    ):
        return raw + "\n\n" + CONTACT_STATE_CAVEAT
    return raw
