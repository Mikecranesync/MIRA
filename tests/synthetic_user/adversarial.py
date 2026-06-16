"""Adversarial question generators for MIRA synthetic user testing.

Six generators that produce questions designed to expose specific weaknesses in
classify_intent(), RAG retrieval, abbreviation expansion, and hallucination
detection. Each generator imports and validates against actual guardrails code
at module load time so the adversarial properties are guaranteed — not assumed.

Categories
----------
A1 — Intent Guard Bypass   : greeting prefix + maintenance content near the
                              len(msg) < 20 boundary in classify_intent()
A2 — No-Keyword Queries    : pure colloquial descriptions with zero INTENT_KEYWORDS
A3 — Cross-Manufacturer    : fault code from model X asked about model Y
A4 — Out-of-KB Vendors     : brands not in MIRA's knowledge base
A5 — Misspelled/Abbreviated: abbreviations absent from MAINTENANCE_ABBREVIATIONS
A6 — Multi-Turn Vague      : vague opener followed by a specific follow-up
"""

from __future__ import annotations

import logging
import random
import sys
import uuid
from pathlib import Path

from tests.synthetic_user.question_bank import (
    EQUIPMENT,
    UNKNOWN_ABBREVIATIONS,
    VENDORS_OUT_OF_KB,
)
from tests.synthetic_user.templates import SyntheticQuestion

logger = logging.getLogger("mira-adversarial")

# ── Guardrails import (graceful fallback) ────────────────────────────────────

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots"))

try:
    from shared.guardrails import (
        GREETING_PATTERNS,
        INTENT_KEYWORDS,
        MAINTENANCE_ABBREVIATIONS,
    )

    logger.debug("Loaded guardrails from mira-bots/shared/guardrails.py")
    _GUARDRAILS_LOADED = True
except Exception as _err:  # pragma: no cover
    logger.warning("guardrails import failed (%s) — using hardcoded fallbacks", _err)
    _GUARDRAILS_LOADED = False

    # Minimal fallbacks that mirror the actual sets (kept deliberately small so
    # the fallback path is clearly separate from the authoritative source).
    GREETING_PATTERNS = {  # type: ignore[assignment]
        "hello", "hi", "hey", "howdy", "good morning", "good afternoon",
        "good evening", "what's up", "sup", "yo", "thanks", "thank you",
        "bye", "goodbye",
    }
    INTENT_KEYWORDS = {  # type: ignore[assignment]
        "fault", "error", "fail", "trip", "alarm", "down", "not working",
        "broken", "stopped", "issue", "warning", "vibration", "noise", "leak",
        "hot", "pressure", "temperature", "speed", "current", "voltage",
        "reset", "calibrate", "replace", "code", "showing", "display", "mean",
        "output", "input", "parameter", "setting", "configure", "stop", "start",
        "run", "frequency", "torque", "overload", "wire", "wiring", "install",
        "mount", "connect", "terminal", "cable", "ground", "maintenance",
        "inspect", "troubleshoot", "repair", "drive", "motor", "pump",
        "conveyor", "compressor", "sensor", "switch", "relay", "breaker",
        "fuse", "transformer", "contactor", "plc", "hmi", "vfd", "servo",
    }
    MAINTENANCE_ABBREVIATIONS = {  # type: ignore[assignment]
        "mtr": "motor", "vfd": "variable frequency drive", "oc": "overcurrent",
        "trpd": "tripped", "dwn": "down", "brk": "breaker", "xfmr": "transformer",
        "pnl": "panel", "sw": "switch", "cb": "circuit breaker", "ol": "overload",
        "uv": "undervoltage", "ov": "overvoltage", "gf": "ground fault",
        "plc": "programmable logic controller", "hmi": "human machine interface",
        "loto": "lockout tagout", "ppe": "personal protective equipment",
        "pwr": "power", "flt": "fault",
    }

# Pre-compute lower-cased INTENT_KEYWORDS once for fast membership testing.
_INTENT_KEYWORDS_LOWER: frozenset[str] = frozenset(kw.lower() for kw in INTENT_KEYWORDS)

# Pre-compute lower-cased MAINTENANCE_ABBREVIATIONS keys.
_MAINT_ABBREV_KEYS: frozenset[str] = frozenset(
    k.lower() for k in MAINTENANCE_ABBREVIATIONS
)

# Validate that every UNKNOWN_ABBREVIATION is truly absent from MAINTENANCE_ABBREVIATIONS.
_UNKNOWN_ABBREV_VALIDATED: dict[str, str] = {
    short: full
    for short, full in UNKNOWN_ABBREVIATIONS.items()
    if short.lower() not in _MAINT_ABBREV_KEYS
}
if len(_UNKNOWN_ABBREV_VALIDATED) < len(UNKNOWN_ABBREVIATIONS):
    _overlap = set(UNKNOWN_ABBREVIATIONS) - set(_UNKNOWN_ABBREV_VALIDATED)
    logger.warning(
        "A5: %d UNKNOWN_ABBREVIATIONS are now in MAINTENANCE_ABBREVIATIONS (%s) — "
        "update question_bank.py",
        len(_overlap),
        ", ".join(sorted(_overlap)),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_id(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _vfd_fault_map() -> dict[str, list[tuple[str, str]]]:
    """Return {model: [(code, source_model), ...]} for cross-manufacturer tests.

    Only includes models that have at least one fault code *and* at least one
    other model whose codes are different — so A3 can always produce a mismatch.
    """
    vfd = EQUIPMENT.get("VFD", {})
    codes: dict[str, list[str]] = vfd.get("fault_codes", {})
    result: dict[str, list[tuple[str, str]]] = {}
    model_list = list(codes.keys())
    for model in model_list:
        foreign: list[tuple[str, str]] = []
        for other_model, other_codes in codes.items():
            if other_model != model and other_codes:
                for c in other_codes:
                    foreign.append((c, other_model))
        if foreign:
            result[model] = foreign
    return result


_VFD_FAULT_MAP = _vfd_fault_map()


def _words_in_intent_keywords(text: str) -> set[str]:
    """Return which words (lower) in `text` match INTENT_KEYWORDS."""
    found: set[str] = set()
    words = text.lower().split()
    for word in words:
        # Strip punctuation tails
        clean = word.strip(".,!?;:()")
        if clean in _INTENT_KEYWORDS_LOWER:
            found.add(clean)
    # Also check multi-word phrases like "not working"
    text_lower = text.lower()
    for kw in _INTENT_KEYWORDS_LOWER:
        if " " in kw and kw in text_lower:
            found.add(kw)
    return found


# ── A1: Intent Guard Bypass ───────────────────────────────────────────────────

# Short greeting+maintenance phrases crafted to land in the 18-22 char range.
# The guardrail fires "greeting" when: (words & GREETING_PATTERNS AND len < 20)
# OR len < 4. These messages sit right at the boundary — some will be
# misclassified as "greeting" even though they contain maintenance content.
_A1_TEMPLATES: list[tuple[str, str]] = [
    # (template, note) — keep total length 15-25 to straddle the boundary
    ("hi, motor fault", "greeting word + 'motor' + 'fault'"),
    ("hey, drive fault", "greeting word + 'drive' + 'fault'"),
    ("hi motor tripped", "greeting + maintenance, exactly 16 chars"),
    ("hey pump alarm!", "greeting + equipment alarm — 15 chars"),
    ("hi VFD tripped", "greeting + known abbrev — 14 chars"),
    ("hello motor down", "hello + motor + down — 16 chars"),
    ("hey drive error", "hey + drive + error — 15 chars"),
    ("hi, fault code?", "hi + fault + code — 15 chars with punct"),
    ("hey, OC fault!", "greeting + fault code abbrev — 14 chars"),
    ("hi OV alarm now", "greeting + fault code + alarm — 15 chars"),
    ("hey VFD fault!", "greeting + VFD + fault — 14 chars"),
    ("hi plc fault now", "greeting + plc + fault — 16 chars"),
    ("hi motor alarm", "greeting + motor + alarm — 14 chars"),
    ("hey, breaker trip", "greeting + breaker + trip — 17 chars"),
    ("hi overload fault", "greeting + overload + fault — 17 chars"),
    ("hey, sensor fail", "greeting + sensor + fail — 16 chars"),
    ("hi relay tripped", "greeting + relay + tripped — 16 chars"),
    ("hey pump tripped", "greeting + pump + tripped — 16 chars"),
    ("hi drive tripped", "greeting + drive + tripped — 16 chars"),
    ("hey motor issue?", "greeting + motor + issue — 16 chars"),
]


def generate_adversarial_a1(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A1: Intent Guard Bypass — greeting prefix + maintenance content near len<20.

    Generates messages where MIRA's guardrail may incorrectly return "greeting"
    even though the message contains a real maintenance keyword. Expected intent
    is "industrial" because the content warrants a diagnostic response.
    """
    questions: list[SyntheticQuestion] = []
    pool = _A1_TEMPLATES.copy()

    for _ in range(count):
        if not pool:
            pool = _A1_TEMPLATES.copy()
        template, note = rng.choice(pool)

        # Measure actual boundary exposure
        msg_len = len(template)
        words = set(template.lower().split())
        has_greeting = bool(words & GREETING_PATTERNS)
        would_misclassify = has_greeting and msg_len < 20

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=template,
                persona_id="plant_operator",
                topic_category="fault_codes",
                adversarial_category="A1_intent_guard_bypass",
                equipment_type="VFD",
                vendor="unknown",
                fault_code=None,
                difficulty="adversarial",
                ground_truth={
                    "note": note,
                    "msg_len": msg_len,
                    "has_greeting_word": has_greeting,
                    "would_misclassify": would_misclassify,
                    "boundary": "len(msg) < 20",
                },
                expected_intent="industrial",
                expected_weakness="intent_guard_greeting_boundary",
            )
        )

    return questions


# ── A2: No-Keyword Queries ────────────────────────────────────────────────────

# Colloquial descriptions that contain ZERO INTENT_KEYWORDS words.
# Each candidate is validated at generation time — if any word leaks into
# INTENT_KEYWORDS the candidate is rejected.

_A2_CANDIDATES: list[str] = [
    "the big box on the wall is making a clicking sound",
    "that thing by the conveyor belt started flashing red",
    "the unit next to the air lines won't turn on anymore",
    "that box with the number display keeps going dark",
    "the machine with the green light is throwing sparks",
    "it just stopped and won't come back on",
    "the panel door is rattling and something inside smells funny",
    "whatever this thing is, it's hissing and I don't like it",
    "the unit by the loading dock stopped spinning this morning",
    "nothing on the touch screen responds to my tapping",
    "the big gray box is making a high-pitched whining sound",
    "something popped and now half the floor lost power",
    "the little round thing fell off and I don't know where it goes",
    "the light on the front just turned from green to red",
    "this thing is shaking way more than it ever did before",
    "the numbers on the readout keep changing on their own",
    "it got really hot and now it's just sitting there doing nothing",
    "the cabinet by the back wall keeps clicking every few seconds",
    "we had a brownout and now that unit won't do anything",
    "the thing that normally spins slowly is spinning way too fast",
]


def _validate_a2_candidate(text: str) -> tuple[bool, set[str]]:
    """Return (is_clean, leaked_keywords) for an A2 candidate."""
    leaked = _words_in_intent_keywords(text)
    return len(leaked) == 0, leaked


# Validate candidates at import time and warn about any that have drifted.
_A2_CLEAN: list[str] = []
for _cand in _A2_CANDIDATES:
    _ok, _leaked = _validate_a2_candidate(_cand)
    if _ok:
        _A2_CLEAN.append(_cand)
    else:
        logger.warning(
            "A2 candidate rejected (contains INTENT_KEYWORDS: %s): %r",
            ", ".join(sorted(_leaked)),
            _cand,
        )

if not _A2_CLEAN:
    logger.error(
        "A2: ALL candidates failed INTENT_KEYWORDS validation — "
        "A2 generator will produce no questions. Update _A2_CANDIDATES."
    )


def generate_adversarial_a2(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A2: No-Keyword Queries — pure colloquial descriptions with zero INTENT_KEYWORDS.

    Validated at generation time: each question is checked against the live
    INTENT_KEYWORDS set imported from guardrails.py. Intended to expose cases
    where MIRA falls through to the 'industrial' default or fails to retrieve
    relevant KB chunks because the query has no technical vocabulary.
    """
    questions: list[SyntheticQuestion] = []

    if not _A2_CLEAN:
        logger.error("A2: no clean candidates, skipping %d questions", count)
        return questions

    pool = _A2_CLEAN.copy()

    for _ in range(count):
        if not pool:
            pool = _A2_CLEAN.copy()
        text = rng.choice(pool)

        # Double-check at generation time (guard against runtime INTENT_KEYWORDS change)
        ok, leaked = _validate_a2_candidate(text)
        if not ok:
            logger.warning("A2: candidate leaked at generation time (%s): %r", leaked, text)

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=text,
                persona_id="plant_operator",
                topic_category="troubleshooting",
                adversarial_category="A2_no_keyword",
                equipment_type="unknown",
                vendor="unknown",
                fault_code=None,
                difficulty="adversarial",
                ground_truth={
                    "validated_clean": ok,
                    "leaked_keywords": sorted(leaked),
                },
                expected_intent="industrial",
                expected_weakness="no_intent_keywords_colloquial",
            )
        )

    return questions


# ── A3: Cross-Manufacturer Fault Codes ───────────────────────────────────────


def generate_adversarial_a3(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A3: Cross-Manufacturer — fault code from model X asked about model Y.

    E.g., 'What does F004 mean on my GS20?' when F004 is a PowerFlex code.
    Exposes hallucination if MIRA fabricates a plausible-sounding but incorrect
    explanation by mapping a code to the wrong model's documentation.
    """
    questions: list[SyntheticQuestion] = []

    if not _VFD_FAULT_MAP:
        logger.error("A3: VFD fault map is empty, cannot generate cross-manufacturer questions")
        return questions

    target_models = list(_VFD_FAULT_MAP.keys())

    templates = [
        "What does {code} mean on my {target}?",
        "How do I clear {code} on a {target}?",
        "{target} is showing {code}, what does that mean?",
        "Getting {code} fault on my {target}, is that serious?",
        "{code} keeps coming back on the {target}, any ideas?",
        "My {target} just threw {code} — what caused it?",
    ]

    for _ in range(count):
        target_model = rng.choice(target_models)
        foreign_code, source_model = rng.choice(_VFD_FAULT_MAP[target_model])
        template = rng.choice(templates)
        text = template.format(code=foreign_code, target=target_model)

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=text,
                persona_id="senior_tech",
                topic_category="fault_codes",
                adversarial_category="A3_cross_manufacturer",
                equipment_type="VFD",
                vendor="unknown",
                fault_code=foreign_code,
                difficulty="adversarial",
                ground_truth={
                    "target_model": target_model,
                    "asked_code": foreign_code,
                    "code_belongs_to": source_model,
                    "is_cross_manufacturer": True,
                    "expected_response": (
                        f"MIRA should note that {foreign_code} is not a documented "
                        f"{target_model} fault code, or ask for clarification."
                    ),
                },
                expected_intent="industrial",
                expected_weakness="cross_manufacturer_fault_code_confusion",
            )
        )

    return questions


# ── A4: Out-of-KB Vendors ─────────────────────────────────────────────────────

_A4_TEMPLATES: list[str] = [
    "What does fault code E001 mean on a {vendor} drive?",
    "My {vendor} VFD is showing an overcurrent fault, how do I clear it?",
    "How do I configure acceleration ramp on a {vendor} frequency converter?",
    "What are the fault codes for {vendor} variable speed drives?",
    "My {vendor} drive tripped on overload, steps to reset it?",
    "Parameter settings for {vendor} drive on a centrifugal pump application?",
    "Is {vendor} drive compatible with Allen-Bradley PLCs over Modbus?",
    "How do I set the motor nameplate data on a {vendor} VFD?",
    "What causes repeated overvoltage faults on a {vendor} regenerative drive?",
    "Recommended braking resistor sizing for a {vendor} drive?",
]


def generate_adversarial_a4(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A4: Out-of-KB Vendors — brands absent from MIRA's knowledge base.

    Intended to expose hallucination: MIRA may fabricate specific fault codes,
    parameter numbers, or procedures for vendors like Danfoss or Yaskawa that
    are not in the KB. A correct response acknowledges the knowledge gap.
    """
    questions: list[SyntheticQuestion] = []

    for _ in range(count):
        vendor = rng.choice(VENDORS_OUT_OF_KB)
        template = rng.choice(_A4_TEMPLATES)
        text = template.format(vendor=vendor)

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=text,
                persona_id="reliability_eng",
                topic_category="fault_codes",
                adversarial_category="A4_out_of_kb_vendor",
                equipment_type="VFD",
                vendor=vendor,
                fault_code=None,
                difficulty="adversarial",
                ground_truth={
                    "vendor": vendor,
                    "in_kb": False,
                    "expected_response": (
                        f"MIRA should acknowledge that {vendor} is not in its "
                        f"knowledge base and avoid fabricating specific codes or parameters."
                    ),
                },
                expected_intent="industrial",
                expected_weakness="out_of_kb_hallucination",
            )
        )

    return questions


# ── A5: Misspelled / Unknown Abbreviations ────────────────────────────────────

_A5_TEMPLATES: list[str] = [
    "the {abbrev} just {action}, what do I check?",
    "{abbrev} is {action} on startup, any ideas?",
    "my {abbrev} {action} again, third time this week",
    "{abbrev} {action}, need help fast",
    "why would a {abbrev} keep {action}?",
    "{abbrev} {action} under light load, checked connections",
    "intermittent {abbrev} {action}, hard to catch",
    "{abbrev} {action} after we moved it to a new panel",
]

_A5_ACTIONS: list[str] = [
    "fltd out",
    "trpd again",
    "wnt dwn",
    "seezd up",
    "went drk",
    "lost pwr",
    "stoopd running",
    "threw a flt",
]


def generate_adversarial_a5(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A5: Misspelled/Abbreviated — abbreviations absent from MAINTENANCE_ABBREVIATIONS.

    Each generated question uses abbreviations from UNKNOWN_ABBREVIATIONS that
    are validated at module load to not exist in MAINTENANCE_ABBREVIATIONS. This
    tests whether expand_abbreviations() passes unrecognised shorthand through
    unchanged, which can cause RAG retrieval to miss relevant chunks.

    Validation is enforced at both module load (see _UNKNOWN_ABBREV_VALIDATED)
    and generation time per question.
    """
    questions: list[SyntheticQuestion] = []

    if not _UNKNOWN_ABBREV_VALIDATED:
        logger.error(
            "A5: no validated unknown abbreviations — all UNKNOWN_ABBREVIATIONS "
            "may now be in MAINTENANCE_ABBREVIATIONS. Update question_bank.py."
        )
        return questions

    valid_abbrevs = list(_UNKNOWN_ABBREV_VALIDATED.items())

    for _ in range(count):
        short, full = rng.choice(valid_abbrevs)
        template = rng.choice(_A5_TEMPLATES)
        action = rng.choice(_A5_ACTIONS)
        text = template.format(abbrev=short, action=action)

        # Generation-time validation
        in_maint = short.lower() in _MAINT_ABBREV_KEYS
        if in_maint:
            logger.warning(
                "A5: '%s' now appears in MAINTENANCE_ABBREVIATIONS — question may not be adversarial",
                short,
            )

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=text,
                persona_id="night_shift",
                topic_category="troubleshooting",
                adversarial_category="A5_unknown_abbreviation",
                equipment_type="unknown",
                vendor="unknown",
                fault_code=None,
                difficulty="adversarial",
                ground_truth={
                    "abbreviation": short,
                    "intended_meaning": full,
                    "in_maintenance_abbreviations": in_maint,
                    "expand_abbreviations_will_expand": in_maint,
                    "expected_weakness": (
                        f"'{short}' is not in MAINTENANCE_ABBREVIATIONS so "
                        f"expand_abbreviations() will leave it as-is, potentially "
                        f"degrading RAG recall for '{full}' content."
                    ),
                },
                expected_intent="industrial",
                expected_weakness="unknown_abbreviation_expansion_gap",
            )
        )

    return questions


# ── A6: Multi-Turn Vague ──────────────────────────────────────────────────────

_A6_OPENERS: list[str] = [
    "something's wrong with the equipment",
    "we've got a problem on the floor",
    "one of the machines is acting up",
    "there's an issue with a unit in the plant",
    "a piece of equipment isn't behaving right",
    "we had something go wrong on the line",
    "one of the units is doing something weird",
    "got a situation here, not sure what it is",
    "something just happened to the machinery",
    "we need help with a piece of equipment",
]

_A6_FOLLOWUPS: list[tuple[str, str]] = [
    # (followup text, equipment context)
    ("it's the PowerFlex 525 on line 3, showing F004", "PowerFlex 525 / F004"),
    ("it's the GS20 on the cooling tower, OC fault, keeps coming back", "GS20 / OC"),
    ("the CompactLogix L33ER lost comms to remote I/O rack", "CompactLogix / comms loss"),
    ("the rotary screw compressor is short cycling, every 10 minutes", "compressor / short cycling"),
    ("belt conveyor on the east side is tracking hard to the left", "conveyor / belt tracking"),
    ("SINAMICS G120 on fan 4 is throwing F0002, it was fine all week", "SINAMICS G120 / F0002"),
    ("the hydraulic press cylinder is drifting down under load", "hydraulic / cylinder drift"),
    ("pressure transmitter on tank 2 reading zero even with product in it", "sensor / 4-20mA stuck"),
    ("GS3 drive on pump 6 tripped on OH, ambient is high today", "GS3 / OH overheating"),
    ("motor on conveyor 7 is drawing high current on one phase", "motor / phase imbalance"),
]


def generate_adversarial_a6(count: int, rng: random.Random) -> list[SyntheticQuestion]:
    """A6: Multi-Turn Vague — vague opener with follow-up stored in ground_truth.

    Generates pairs: a vague first message that gives MIRA nothing to work with,
    and a specific follow-up. The SyntheticQuestion carries the vague opener as
    `text` and stores the follow-up in `ground_truth['follow_up']`.

    Tests whether MIRA's FSM transitions correctly from IDLE through Q-states
    before the user provides actionable context, rather than hallucinating a
    diagnosis from the vague opener alone.
    """
    questions: list[SyntheticQuestion] = []

    for _ in range(count):
        opener = rng.choice(_A6_OPENERS)
        followup_text, followup_context = rng.choice(_A6_FOLLOWUPS)

        questions.append(
            SyntheticQuestion(
                id=_make_id(rng),
                text=opener,
                persona_id="plant_operator",
                topic_category="troubleshooting",
                adversarial_category="A6_multi_turn_vague",
                equipment_type="unknown",
                vendor="unknown",
                fault_code=None,
                difficulty="adversarial",
                ground_truth={
                    "follow_up": followup_text,
                    "follow_up_context": followup_context,
                    "expected_fsm_response": (
                        "MIRA should ask a clarifying question (Q1/Q2 state) "
                        "rather than attempting a diagnosis from the vague opener."
                    ),
                    "expected_vague_response": "clarifying_question",
                    "expected_followup_response": "diagnostic_or_fix",
                },
                expected_intent="industrial",
                expected_weakness="multi_turn_vague_opener_hallucination",
            )
        )

    return questions


# ── Dispatcher ────────────────────────────────────────────────────────────────

_GENERATORS = {
    "A1": generate_adversarial_a1,
    "A2": generate_adversarial_a2,
    "A3": generate_adversarial_a3,
    "A4": generate_adversarial_a4,
    "A5": generate_adversarial_a5,
    "A6": generate_adversarial_a6,
}

_ALL_CATEGORIES: list[str] = ["A1", "A2", "A3", "A4", "A5", "A6"]


def generate_adversarial(
    count: int,
    seed: int | None = None,
    categories: list[str] | None = None,
) -> list[SyntheticQuestion]:
    """Generate adversarial questions distributed across the requested categories.

    Args:
        count:      Total number of questions to generate.
        seed:       Random seed for reproducibility. None = random.
        categories: Which adversarial categories to include. Defaults to all
                    six (A1 through A6). Valid values: 'A1', 'A2', 'A3', 'A4',
                    'A5', 'A6'.

    Returns:
        List of SyntheticQuestion objects in shuffled order.

    Raises:
        ValueError: If an unknown category is requested.
    """
    rng = random.Random(seed)

    active = categories if categories is not None else _ALL_CATEGORIES
    unknown = set(active) - set(_GENERATORS)
    if unknown:
        raise ValueError(
            f"Unknown adversarial categories: {sorted(unknown)}. "
            f"Valid: {_ALL_CATEGORIES}"
        )

    n = len(active)
    if n == 0 or count == 0:
        return []

    # Distribute count across categories as evenly as possible.
    base, remainder = divmod(count, n)
    per_category: dict[str, int] = {}
    for i, cat in enumerate(active):
        per_category[cat] = base + (1 if i < remainder else 0)

    all_questions: list[SyntheticQuestion] = []
    for cat, cat_count in per_category.items():
        if cat_count > 0:
            fn = _GENERATORS[cat]
            batch = fn(cat_count, rng)
            all_questions.extend(batch)
            logger.debug("A%s generated %d questions (requested %d)", cat, len(batch), cat_count)

    rng.shuffle(all_questions)
    return all_questions
