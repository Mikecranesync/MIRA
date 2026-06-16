"""Template-based question generator — topic × persona × fill values.

Generates SyntheticQuestion objects deterministically (seed-controlled).
No LLM calls — pure template substitution + persona phrasing transforms.
"""

from __future__ import annotations

import random
import re
import uuid
from dataclasses import dataclass

from tests.synthetic_user.personas import PERSONAS, Persona
from tests.synthetic_user.question_bank import (
    ABBREVIATIONS,
    ACTIONS,
    ALARMS,
    CONCEPTS,
    EQUIPMENT,
    VENDORS_IN_KB,
)


@dataclass
class SyntheticQuestion:
    """A generated test question with full metadata."""

    id: str
    text: str
    persona_id: str
    topic_category: str
    adversarial_category: str | None
    equipment_type: str
    vendor: str
    fault_code: str | None
    difficulty: str  # easy | medium | hard | adversarial
    ground_truth: dict | None  # {root_cause, fix, keywords}
    expected_intent: str  # What classify_intent SHOULD return
    expected_weakness: str | None  # Which weakness this probes


# ── Topic templates ──────────────────────────────────────────────────────────

TEMPLATES: dict[str, list[str]] = {
    "fault_codes": [
        "What does fault code {fault_code} mean on a {model}?",
        "How do I clear fault {fault_code} on my {vendor} {equipment_type}?",
        "{vendor} {model} showing {fault_code}, what's wrong?",
        "Error {fault_code} keeps coming back on {model}, help",
        "Getting {fault_code} on {model} after power cycle, what should I check?",
    ],
    "troubleshooting": [
        "My {model} is {symptom}, what should I check first?",
        "{equipment_type} {symptom}, where do I start?",
        "How do I diagnose {symptom} on a {vendor} {equipment_type}?",
        "Intermittent {symptom} on {model}, hard to catch",
        "{model} started {symptom} yesterday, ran fine for months before",
    ],
    "repair_procedures": [
        "How do I replace the {component} on a {vendor} {model}?",
        "What's the procedure for {action} on a {model}?",
        "Need step-by-step to {action} {component} on {equipment_type}",
        "Tools needed for {component} replacement on {model}?",
    ],
    "alarms": [
        "{alarm} alarm on {model}, is it urgent?",
        "Getting repeated {alarm} alarms on {equipment_type}, why?",
        "How do I troubleshoot {alarm} on a {vendor} {model}?",
        "Priority of {alarm} alarm on {equipment_type}?",
    ],
    "predictive_maintenance": [
        "What are early warning signs for {component} failure on {equipment_type}?",
        "How often should I inspect the {component} on a {model}?",
        "Vibration trending up on {model}, should I be concerned?",
        "Predictive indicators for {component} failure?",
    ],
    "specifications": [
        "What is the rated voltage for a {model}?",
        "What are the parameter settings for {model} running a {component}?",
        "Max ambient operating temperature for {vendor} {model}?",
        "Wire size requirements for {model}?",
    ],
    "installation": [
        "How do I wire a {model} for a 3-phase {component}?",
        "What's the recommended cable distance from {model} to motor?",
        "Grounding requirements for {vendor} {model}?",
        "Can I run {model} on single-phase input?",
    ],
    "safety": [
        "What are the arc flash requirements for working on {equipment_type}?",
        "Lockout tagout procedure for {vendor} {model}?",
        "Is it safe to open the {equipment_type} panel while it's running?",
        "What PPE do I need for {action} on energized {equipment_type}?",
    ],
    "basics": [
        "What is a {concept}?",
        "How does a {equipment_type} work?",
        "Why do we need {concept} in industrial maintenance?",
        "Can you explain {concept} in simple terms?",
    ],
}

TOPIC_DIFFICULTIES: dict[str, str] = {
    "fault_codes": "easy",
    "troubleshooting": "medium",
    "repair_procedures": "medium",
    "alarms": "easy",
    "predictive_maintenance": "hard",
    "specifications": "easy",
    "installation": "medium",
    "safety": "easy",
    "basics": "easy",
}


# ── Fill-value selection ─────────────────────────────────────────────────────


def _pick_equipment(rng: random.Random) -> tuple[str, str, str]:
    """Return (equipment_type, vendor, model)."""
    eq_type = rng.choice(list(EQUIPMENT.keys()))
    eq = EQUIPMENT[eq_type]
    models_by_vendor = eq["models"]
    vendor = rng.choice(list(models_by_vendor.keys()))
    model = rng.choice(models_by_vendor[vendor])
    # Map 'general' vendor to a real vendor name for display
    if vendor == "general":
        vendor = rng.choice(VENDORS_IN_KB)
    return eq_type, vendor, model


def _pick_fault_code(
    eq_type: str, model: str, rng: random.Random
) -> str | None:
    """Return a fault code for the model, or None if not available."""
    codes = EQUIPMENT.get(eq_type, {}).get("fault_codes", {})
    model_codes = codes.get(model, [])
    if model_codes:
        return rng.choice(model_codes)
    return None


def _pick_fill(eq_type: str, key: str, rng: random.Random) -> str:
    """Pick a random fill value from the equipment's list."""
    values = EQUIPMENT.get(eq_type, {}).get(key, [])
    if values:
        return rng.choice(values)
    return ""


# ── Persona phrasing transforms ─────────────────────────────────────────────


def _apply_abbreviations(text: str, rng: random.Random) -> str:
    """Replace full words with abbreviations (for terse personas)."""
    # Reverse the abbreviation map: full form → shorthand
    for short, full in ABBREVIATIONS.items():
        if full.lower() in text.lower():
            text = re.sub(re.escape(full), short, text, flags=re.IGNORECASE)
            if rng.random() > 0.5:
                break  # Don't abbreviate everything, just a few
    return text


def _apply_typos(text: str, probability: float, rng: random.Random) -> str:
    """Inject random typos into text."""
    if probability <= 0:
        return text
    words = text.split()
    result = []
    for word in words:
        if len(word) > 3 and rng.random() < probability:
            # Swap two adjacent characters
            i = rng.randint(1, len(word) - 2)
            word = word[:i] + word[i + 1] + word[i] + word[i + 2 :]
        result.append(word)
    return " ".join(result)


def _apply_persona(text: str, persona: Persona, rng: random.Random) -> str:
    """Apply persona-specific transforms to the question text."""
    # Greeting prefix
    if persona.greeting_prefix:
        text = persona.greeting_prefix + text[0].lower() + text[1:]

    # Abbreviations for terse personas
    if persona.uses_abbreviations:
        text = _apply_abbreviations(text, rng)

    # Typos
    if persona.typo_probability > 0:
        text = _apply_typos(text, persona.typo_probability, rng)

    # Casual lowercase for casual personas
    if persona.phrasing_style == "casual" and rng.random() > 0.5:
        text = text.lower()

    return text


# ── Main generator ───────────────────────────────────────────────────────────


def generate_questions(
    count: int = 100,
    seed: int | None = None,
    topics: list[str] | None = None,
    personas: list[str] | None = None,
) -> list[SyntheticQuestion]:
    """Generate a batch of synthetic maintenance questions.

    Args:
        count: Number of questions to generate.
        seed: Random seed for reproducibility. None = random.
        topics: Filter to specific topic categories. None = all.
        personas: Filter to specific persona IDs. None = all.

    Returns:
        List of SyntheticQuestion objects.
    """
    rng = random.Random(seed)

    available_topics = list(TEMPLATES.keys()) if topics is None else topics
    available_personas = (
        PERSONAS if personas is None else [p for p in PERSONAS if p.id in personas]
    )

    questions: list[SyntheticQuestion] = []

    for _ in range(count):
        topic = rng.choice(available_topics)
        persona = rng.choice(available_personas)
        template = rng.choice(TEMPLATES[topic])
        eq_type, vendor, model = _pick_equipment(rng)
        fault_code = _pick_fault_code(eq_type, model, rng)

        # Build fill values
        fills = {
            "equipment_type": eq_type,
            "vendor": vendor,
            "model": model,
            "fault_code": fault_code or "ERR",
            "symptom": _pick_fill(eq_type, "symptoms", rng) or "not working",
            "component": _pick_fill(eq_type, "components", rng) or "part",
            "action": rng.choice(ACTIONS),
            "alarm": rng.choice(ALARMS),
            "concept": rng.choice(CONCEPTS),
        }

        # Fill template
        text = template.format(**fills)

        # Apply persona transforms
        text = _apply_persona(text, persona, rng)

        expected_intent = "safety" if topic == "safety" else "industrial"

        questions.append(
            SyntheticQuestion(
                id=str(uuid.UUID(int=rng.getrandbits(128), version=4)),
                text=text,
                persona_id=persona.id,
                topic_category=topic,
                adversarial_category=None,
                equipment_type=eq_type,
                vendor=vendor,
                fault_code=fault_code,
                difficulty=TOPIC_DIFFICULTIES.get(topic, "medium"),
                ground_truth=None,
                expected_intent=expected_intent,
                expected_weakness=None,
            )
        )

    return questions
