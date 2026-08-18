"""Persistent machine context — the deterministic, zero-token half.

Live defect (2026-08-16). A technician sends one nameplate photo. The chat
workspace stores it perfectly — ``EQUIPMENT_WORKSPACE_PERSISTED … fields=9`` —
and then turn 2 answers as if no machine had ever been identified:

* the reply never says WHICH machine it is talking about, and
* it asks for a field that is already on file ("What's the model number on the
  drive?"), which is the single most irritating thing an assistant can do to
  someone who just showed it the plate.

Persistence without recall is not memory. This module is the pure text
transform that closes it: given the nameplate fields the workspace already
holds, it (1) leads the reply with the resolved asset and (2) deletes any
request for a field MIRA can already answer, answering it instead.

Deliberately pure — no I/O, no model call, no imports beyond ``re``. Stable
reasoning exported as a text artifact rather than re-argued at inference time
(``.claude/rules/zero-token-architecture.md``); same shape as
``shared/reply_voice.py``, which is applied to the same reply.

The caller supplies the fields (``print_workspace.latest_equipment_fields``)
and decides when the transform is appropriate — a safety STOP, a greeting or
an FSM confirmation must not be prefixed with a nameplate header.
"""

from __future__ import annotations

import re

# --------------------------------------------------------------------------- #
# Field vocabulary
# --------------------------------------------------------------------------- #

# Display labels, keyed on ``workers/nameplate_worker.NAMEPLATE_FIELDS``. Kept
# here rather than imported from the bot because the bot's tables answer a
# different question — what the TECHNICIAN asked for — while these describe
# what MIRA already knows.
FIELD_LABELS: dict[str, str] = {
    "manufacturer": "Manufacturer",
    "model": "Model",
    "catalog": "Catalog / type code",
    "serial": "Serial number",
    "voltage": "Voltage",
    "fla": "Full-load amps",
    "hp": "Horsepower",
    "kw": "Kilowatts",
    "frequency": "Frequency",
    "rpm": "RPM",
}

# Phrases that mean "this sentence is talking about <field>". Matched against a
# space-normalized, space-padded lowercase sentence, so punctuation and hyphens
# never hide a match ("serial?" → " serial ", "full-load" → "full load").
_FIELD_MENTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "catalog",
        (
            "catalog number",
            "catalogue number",
            "catalog no",
            "cat no",
            "type code",
            "part number",
            "part no",
        ),
    ),
    ("serial", ("serial number", "serial no", "serial tag", " serial ")),
    ("model", ("model number", "model no", "model designation", " model ")),
    ("manufacturer", ("manufacturer", "who makes", "who made", " make ", " brand ")),
    ("voltage", ("voltage", " volts ", "volt rating")),
    (
        "fla",
        ("full load amps", " fla ", "amp rating", "amperage", "nameplate amps", "rated amps"),
    ),
    ("hp", ("horsepower", " hp ", "hp rating")),
    ("kw", ("kilowatt", " kw ", "kw rating")),
    ("frequency", ("frequency", " hertz ", " hz ")),
    ("rpm", (" rpm ", "rated speed", "nameplate speed")),
)

_NON_WORD_RE = re.compile(r"[^a-z0-9]+")


def _normalized(text: str) -> str:
    """Lowercase, punctuation-flattened, space-padded — the matching form."""
    return f" {_NON_WORD_RE.sub(' ', text.lower()).strip()} "


# --------------------------------------------------------------------------- #
# The asset lead
# --------------------------------------------------------------------------- #

# Size fields, in the order a lead prefers them, with the unit to append when
# the plate value was bare ("15" → "15 kW").
_LEAD_SIZE_FIELDS: tuple[tuple[str, str], ...] = (("kw", "kW"), ("hp", "HP"))

# Below this, a reply is an ack or a one-line confirmation — prefixing it with
# a nameplate header reads as noise, not context.
_LEAD_MIN_REPLY_CHARS = 40

_LEAD_SEP = " · "


def format_asset_lead(fields: dict[str, str] | None) -> str | None:
    """``"Danfoss FC-202 · 15 kW"`` — the one-line asset identity, or ``None``.

    Built only from what the plate actually carried; a missing part is simply
    absent, never guessed. Returns ``None`` when nothing identifying was read
    (a plate that yielded only a voltage does not identify a machine).
    """
    known = _known(fields)
    maker = known.get("manufacturer")
    ident = known.get("model") or known.get("catalog")
    if not (maker or ident):
        return None
    head = " ".join(part for part in (maker, ident) if part)
    for name, unit in _LEAD_SIZE_FIELDS:
        value = known.get(name)
        if value:
            return f"{head}{_LEAD_SEP}{_with_unit(value, unit)}"
    return head


def _with_unit(value: str, unit: str) -> str:
    """Append the unit only when the plate value was a bare number."""
    return value if any(ch.isalpha() for ch in value) else f"{value} {unit}"


# --------------------------------------------------------------------------- #
# Never re-ask for a field already on file
# --------------------------------------------------------------------------- #

# The shapes MIRA uses to ask a technician for something. A sentence must carry
# one of these AND name a field we already hold before it is dropped — a
# sentence that merely mentions the model ("the model is rated for 480 V")
# survives untouched.
_REQUEST_CUE_RE = re.compile(
    r"\b(?:"
    r"what(?:'s| is| are)\s+the"
    r"|which\s+(?:model|manufacturer|make|catalog|part|serial)"
    r"|(?:can|could|would)\s+you\s+(?:tell|give|share|provide|confirm|send)"
    r"|please\s+(?:tell|give|share|provide|confirm|send|check|read)"
    r"|(?:send|share|provide|give|tell)\s+me"
    r"|let\s+me\s+know"
    r"|i(?:'ll)?\s+need\s+(?:the|a|to\s+know)"
    r"|i\s+(?:would|'d)\s+need"
    r"|do\s+you\s+(?:know|have)\s+the"
    r"|confirm\s+the"
    r"|(?:check|look\s+at|read)\s+the\s+nameplate"
    r")\b",
    re.IGNORECASE,
)

# Sentence splitter that keeps the terminator with the sentence.
_SENTENCE_RE = re.compile(r"[^.!?\n]+(?:[.!?]+|\n|$)")


def _known(fields: dict[str, str] | None) -> dict[str, str]:
    """Non-empty, known-vocabulary fields only (``raw_text`` is not a field)."""
    out: dict[str, str] = {}
    for name, value in (fields or {}).items():
        if name in FIELD_LABELS and isinstance(value, str) and value.strip():
            out[name] = value.strip()
    return out


def _fields_mentioned(sentence: str, known: dict[str, str]) -> list[str]:
    padded = _normalized(sentence)
    return [
        name
        for name, phrases in _FIELD_MENTIONS
        if name in known and any(phrase in padded for phrase in phrases)
    ]


def strip_known_field_requests(reply: str, fields: dict[str, str] | None) -> tuple[str, list[str]]:
    """Drop every sentence that asks for a field we already hold.

    Returns ``(cleaned_reply, dropped_field_names)``. Order-preserving and
    conservative: only whole sentences carrying an explicit request cue AND
    naming a known field are removed.
    """
    known = _known(fields)
    if not known or not reply:
        return reply, []
    dropped: list[str] = []
    kept: list[str] = []
    for match in _SENTENCE_RE.finditer(reply):
        sentence = match.group(0)
        if sentence.strip() and _REQUEST_CUE_RE.search(sentence):
            mentioned = _fields_mentioned(sentence, known)
            if mentioned:
                dropped.extend(name for name in mentioned if name not in dropped)
                continue
        kept.append(sentence)
    cleaned = "".join(kept)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, dropped


def format_known_fields(fields: dict[str, str] | None, names: list[str] | None = None) -> str:
    """``"Model: FC-202; Full-load amps: 32 A"`` for the named fields."""
    known = _known(fields)
    parts: list[str] = []
    seen: set[str] = set()
    for name in names if names is not None else list(known):
        if name in known and name not in seen:
            seen.add(name)
            parts.append(f"{FIELD_LABELS[name]}: {known[name]}")
    return "; ".join(parts)


# --------------------------------------------------------------------------- #
# The one entry point
# --------------------------------------------------------------------------- #

ANSWERED_PREFIX = "From the nameplate you already sent — "


def apply_asset_memory(reply: str, fields: dict[str, str] | None) -> str:
    """Rewrite ``reply`` so it knows which machine this chat is working on.

    1. Any request for a field the workspace already holds is deleted and
       answered instead (MIRA never asks twice for the same plate).
    2. The reply leads with the resolved asset —
       ``"Danfoss FC-202 · 15 kW — …"`` — unless it already names the machine
       or is too short to need it.

    Pure. With no known fields, or a reply that neither asks nor needs a lead,
    the input is returned unchanged.
    """
    known = _known(fields)
    if not known or not reply or not reply.strip():
        return reply

    # `core` is what the engine actually said once its re-asks are gone; the
    # answered line is ours. The lead decision is made on `core` alone — our
    # own "Model: FC-202" must not be mistaken for the reply naming the
    # machine, or the lead would silently disappear whenever it fired.
    core, dropped = strip_known_field_requests(reply, known)
    body = core
    if dropped:
        answered = format_known_fields(known, dropped)
        if answered:
            stated = f"{ANSWERED_PREFIX}{answered}."
            body = f"{core}\n\n{stated}" if core else stated

    lead = format_asset_lead(known)
    if not lead or not core or _already_named(core, known):
        return body
    if len(body) < _LEAD_MIN_REPLY_CHARS:
        return body
    return f"{lead} — {body}"


def _already_named(reply: str, known: dict[str, str]) -> bool:
    """True when the reply already tells the technician which machine it is."""
    lowered = reply.lower()
    return any(
        (known.get(name) or "").lower() in lowered
        for name in ("model", "catalog")
        if known.get(name)
    )
