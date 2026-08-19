"""Real technician phrasing must reach the structured fault-code lookup (#3334).

`recall_knowledge` stage 2 is the only DETERMINISTIC, authoritative answer path
for a fault question: `_extract_fault_codes()` -> `recall_fault_code()` -> the
`fault_codes` table, which holds e.g. `('F013','PowerFlex 525','Ground Fault')`.
When it fires, the answer is rank 1 with `retrieval_streams=['structured_fault']`.

When it does NOT fire, the query falls through to prose ranking, where the
PowerFlex 520-series **spare-parts catalog** (front covers, finger guards, EMC
cores) outranks the fault table. MIRA then correctly refuses to answer a fault
question from finger-guard rows and tells the technician no documentation exists
— for a fault whose row is in the corpus.

So this function's recall is not a ranking nicety; it decides whether a grounded
answer is possible at all. Every query below is real phrasing from the
100-question live probe (`docs/testing/probe-100/`), and the MUST_EXTRACT block
is the set that measured 7/10 broken before the fix.

The false-positive block is the reason the old guard existed. It stays green:
the fix adds a licensing signal, it does not relax the shape rules.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.neon_recall import _extract_fault_codes  # noqa: E402

# Phrasings a technician actually types. Each must yield the code.
MUST_EXTRACT = [
    # the exact staging-gate question (tools/staging_questions.yaml:15)
    (
        "PowerFlex 525 throwing F004 after the conveyor jammed yesterday — what should I check?",
        "F004",
    ),
    # measured 1/5 and 0/5 cited respectively before the fix
    ("Got an F013 on a PowerFlex 525. What causes it?", "F013"),
    ("PowerFlex 525 showing F004. What does that fault mean and what do I check first?", "F004"),
    ("On a PowerFlex 525, what does fault F004 mean?", "F004"),
    ("What is F007 on a PowerFlex 525?", "F007"),
    ("PowerFlex 525 F005 — what is it?", "F005"),
    ("PowerFlex 525 is at F013 again", "F013"),
    ("GS10 showing CE10", "CE10"),
]

# The guard's original purpose. A product name in the query must NOT license
# these — the shape rules still have to reject them.
MUST_NOT_EXTRACT = [
    "the DRIVE in bay 12 is down",
    "re-do the VFD setup",
    "Can you check line 3?",
    "What is a Unified Namespace?",
    "Motor on the case packer is running hot",
    # with a product name present, which is what the fix newly admits
    "The PowerFlex 525 in bay 12 needs a re-do",
    "Swap the PowerFlex 525 on line 3",
    "Is the PowerFlex 525 a 480V unit?",
]


@pytest.mark.parametrize(("query", "code"), MUST_EXTRACT, ids=[q[:38] for q, _ in MUST_EXTRACT])
def test_real_technician_phrasing_extracts_the_code(query, code):
    got = _extract_fault_codes(query)
    assert code in got, (
        f"{query!r} -> {got}: the structured fault lookup is keyed on this, so a miss "
        "means the technician is told no documentation exists for a fault that is in "
        "the corpus"
    )


@pytest.mark.parametrize("query", MUST_NOT_EXTRACT, ids=[q[:38] for q in MUST_NOT_EXTRACT])
def test_non_fault_text_extracts_nothing(query):
    """The guard the fix must not break — including WITH a product name present."""
    assert _extract_fault_codes(query) == [], (
        f"{query!r} produced a spurious fault code; a false positive here sends a "
        "fabricated code to the structured lookup"
    )


def test_a_product_name_alone_licenses_extraction():
    """The mechanism, stated directly: no context word, product name only."""
    # "got"/"on"/"causes" are not in _FAULT_CONTEXT_RE
    assert _extract_fault_codes("Got an F013 on a PowerFlex 525. What causes it?") == ["F013"]
    # same sentence, product removed -> back to the old (correct) refusal
    assert _extract_fault_codes("Got an F013 on it. What causes it?") == []


def test_shape_rules_still_reject_bare_numbers_beside_a_product():
    """`525` and `820` must never be read as fault codes.

    They have no alpha prefix, so shape rule 1 rejects them — but this is the
    obvious way the fix could have gone wrong, so it is pinned.
    """
    assert _extract_fault_codes("PowerFlex 525 question") == []
    assert _extract_fault_codes("Micro820 controller question") == []


def test_the_pre_fix_behaviour_is_the_thing_being_fixed():
    """Negative control: reconstruct the old context-word-only gate and show it
    fails the queries above, so this suite cannot silently pass against it."""
    import re

    from shared.neon_recall import _FAULT_CONTEXT_RE, _FAULT_PROXIMITY, _normalise_fault_query

    def old_gate_would_extract(q: str) -> bool:
        tokens = _normalise_fault_query(q).split()
        ctx = [i for i, t in enumerate(tokens) if _FAULT_CONTEXT_RE.search(t)]
        if not ctx:
            return False
        return any(
            abs(i - c) <= _FAULT_PROXIMITY
            for i, t in enumerate(tokens)
            for c in ctx
            if re.match(r"^[A-Za-z]{1,2}-?\d", t)
        )

    broken = [q for q, _ in MUST_EXTRACT if not old_gate_would_extract(q)]
    assert len(broken) >= 4, (
        "the old gate no longer fails these, so this suite would pass without the fix"
    )


def test_a_model_number_is_not_a_fault_code_on_itself():
    """`GS10` is a model whose SHAPE is a valid code (2-char prefix + digits).

    Pre-fix, `"GS10 showing CE10"` extracted BOTH — the context word licensed the
    model number as a fault. That over-extraction pre-dates the product-licensing
    signal, but product licensing makes it reachable far more often, so it is
    fixed here: a token that names the equipment is never a fault on it.
    """
    assert _extract_fault_codes("GS10 showing CE10") == ["CE10"]
    assert _extract_fault_codes("gs10") == []
    # the real code is still found when the model shares its shape
    assert "F4" in _extract_fault_codes("Micro820 fault F4")


def test_product_token_exclusion_is_case_insensitive():
    """Regression on my own fix: `_normalise_fault_query` preserves case, so an
    upper-case model was compared against a lower-cased candidate and never
    matched — `GS10 showing CE10` still returned both until this was handled."""
    assert "GS10" not in _extract_fault_codes("GS10 showing CE10")
    assert "gs10" not in [c.lower() for c in _extract_fault_codes("gs10 showing ce10")]


NON_FAULT_IDENTIFIERS = [
    # a drive manual is full of code-shaped tokens that are not faults.
    # The first version of the product-licensing signal extracted all of these
    # (Codex #3337 F1) — a bogus code queries `fault_codes` and, on a hit,
    # promotes an unrelated machine's fault as authoritative evidence.
    "PowerFlex 525 parameter P031 controls motor voltage",
    "Check terminal T1 on the PowerFlex 525",
    "PowerFlex 525 IP20 enclosure",
    "PowerFlex 525 is installed at panel A1",
    "What is P041 on the PowerFlex 525?",
]


@pytest.mark.parametrize(
    "query", NON_FAULT_IDENTIFIERS, ids=[q[:38] for q in NON_FAULT_IDENTIFIERS]
)
def test_parameters_terminals_and_ratings_are_not_fault_codes(query):
    assert _extract_fault_codes(query) == [], (
        f"{query!r} produced a fault code; P/T/IP identifiers and panel labels "
        "share a fault code's shape but are not faults"
    )


def test_a_context_word_still_admits_anything():
    """The narrowing applies ONLY to the product-licensed path.

    "fault P031" is an explicit statement that P031 is a fault, and the pre-existing
    context-word behaviour is deliberately unchanged.
    """
    assert _extract_fault_codes("fault P031 on the PowerFlex 525") == ["P031"]


def test_real_alarm_codes_survive_the_narrowing():
    """`A501` is a real alarm; `panel A1` is not. Both share the A prefix, so a
    prefix rule alone cannot separate them — the nearby noun does."""
    assert _extract_fault_codes("PowerFlex 525 alarm A501") == ["A501"]
    assert _extract_fault_codes("PowerFlex 525 is installed at panel A1") == []
