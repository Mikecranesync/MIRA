"""Tests for templates.py (generate_questions) and question_bank.py.

All tests are offline — no network calls, no LLM, no running services.
"""

from __future__ import annotations

from tests.synthetic_user.personas import PERSONAS
from tests.synthetic_user.templates import TEMPLATES, generate_questions

# ---------------------------------------------------------------------------
# 1. Count
# ---------------------------------------------------------------------------


def test_generate_returns_correct_count() -> None:
    """generate_questions(count=50) returns exactly 50 questions."""
    questions = generate_questions(count=50, seed=0)
    assert len(questions) == 50


# ---------------------------------------------------------------------------
# 2. Topic coverage
# ---------------------------------------------------------------------------


def test_all_topic_categories_covered() -> None:
    """With a large batch, all 9 topic categories appear at least once."""
    questions = generate_questions(count=200, seed=42)
    found_topics = {q.topic_category for q in questions}
    expected_topics = set(TEMPLATES.keys())
    assert expected_topics == found_topics, (
        f"Missing topics: {expected_topics - found_topics}"
    )


# ---------------------------------------------------------------------------
# 3. Persona coverage
# ---------------------------------------------------------------------------


def test_all_personas_used() -> None:
    """With a large batch, all 6 personas appear at least once."""
    questions = generate_questions(count=200, seed=42)
    found_persona_ids = {q.persona_id for q in questions}
    expected_persona_ids = {p.id for p in PERSONAS}
    assert expected_persona_ids == found_persona_ids, (
        f"Missing personas: {expected_persona_ids - found_persona_ids}"
    )


# ---------------------------------------------------------------------------
# 4. Determinism
# ---------------------------------------------------------------------------


def test_deterministic_with_seed() -> None:
    """The same seed produces byte-for-byte identical question text."""
    batch_a = generate_questions(count=30, seed=7)
    batch_b = generate_questions(count=30, seed=7)
    texts_a = [q.text for q in batch_a]
    texts_b = [q.text for q in batch_b]
    assert texts_a == texts_b


def test_different_seeds_produce_different_output() -> None:
    """Seeds 1 and 2 produce at least some different question texts."""
    batch_1 = generate_questions(count=30, seed=1)
    batch_2 = generate_questions(count=30, seed=2)
    texts_1 = [q.text for q in batch_1]
    texts_2 = [q.text for q in batch_2]
    # At least one question should differ between the two seeds.
    assert texts_1 != texts_2


# ---------------------------------------------------------------------------
# 5. Required fields
# ---------------------------------------------------------------------------


def test_question_has_required_fields() -> None:
    """Every SyntheticQuestion has non-empty id, text, persona_id, topic_category,
    equipment_type, and vendor."""
    questions = generate_questions(count=50, seed=99)
    for q in questions:
        assert q.id, f"Empty id on question: {q}"
        assert q.text.strip(), f"Empty text on question id={q.id}"
        assert q.persona_id, f"Empty persona_id on question id={q.id}"
        assert q.topic_category, f"Empty topic_category on question id={q.id}"
        assert q.equipment_type, f"Empty equipment_type on question id={q.id}"
        assert q.vendor, f"Empty vendor on question id={q.id}"


# ---------------------------------------------------------------------------
# 6. Topic filter
# ---------------------------------------------------------------------------


def test_topic_filter() -> None:
    """generate_questions(topics=['fault_codes']) only produces fault_codes questions."""
    questions = generate_questions(count=40, seed=10, topics=["fault_codes"])
    assert len(questions) == 40
    for q in questions:
        assert q.topic_category == "fault_codes", (
            f"Expected fault_codes, got {q.topic_category!r}"
        )


# ---------------------------------------------------------------------------
# 7. Persona filter
# ---------------------------------------------------------------------------


def test_persona_filter() -> None:
    """generate_questions(personas=['senior_tech']) only uses senior_tech."""
    questions = generate_questions(count=40, seed=11, personas=["senior_tech"])
    assert len(questions) == 40
    for q in questions:
        assert q.persona_id == "senior_tech", (
            f"Expected senior_tech, got {q.persona_id!r}"
        )


# ---------------------------------------------------------------------------
# 8. Unique IDs
# ---------------------------------------------------------------------------


def test_question_ids_unique() -> None:
    """No duplicate IDs in a batch of 100 questions."""
    questions = generate_questions(count=100, seed=5)
    ids = [q.id for q in questions]
    assert len(ids) == len(set(ids)), "Duplicate question IDs detected"


# ---------------------------------------------------------------------------
# 9. Safety intent
# ---------------------------------------------------------------------------


def test_safety_topic_expects_safety_intent() -> None:
    """Questions with topic_category='safety' must have expected_intent='safety'."""
    questions = generate_questions(count=200, seed=3, topics=["safety"])
    for q in questions:
        assert q.expected_intent == "safety", (
            f"Safety question id={q.id} has expected_intent={q.expected_intent!r}"
        )


# ---------------------------------------------------------------------------
# 10. Abbreviation transforms (terse personas)
# ---------------------------------------------------------------------------


def test_abbreviations_applied_to_terse_personas() -> None:
    """senior_tech questions contain abbreviated text at least some of the time."""
    from tests.synthetic_user.question_bank import ABBREVIATIONS

    # Generate a larger batch to give abbreviations a chance to trigger.
    questions = generate_questions(count=300, seed=17, personas=["senior_tech"])

    shorthand_terms = set(ABBREVIATIONS.keys())
    found_any = False
    for q in questions:
        text_lower = q.text.lower()
        if any(short in text_lower for short in shorthand_terms):
            found_any = True
            break

    assert found_any, (
        "Expected at least one senior_tech question to contain an abbreviation, "
        "but none were found in 300 questions"
    )


# ---------------------------------------------------------------------------
# 11. Greeting prefix (apprentice)
# ---------------------------------------------------------------------------


def test_greeting_prefix_applied() -> None:
    """apprentice questions start with 'Hi, ' (the persona's greeting_prefix)."""
    questions = generate_questions(count=30, seed=20, personas=["apprentice"])
    for q in questions:
        assert q.text.startswith("Hi, "), (
            f"apprentice question does not start with 'Hi, ': {q.text!r}"
        )
