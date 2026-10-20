"""Codex F2 (#4550 r1 + r2): citation removal must never delete a real claim value."""

from run_sentence_scores import sentences


def test_bracketed_citations_keep_the_value():
    assert sentences("The error flag is bit 11 [1].") == ["The error flag is bit 11."]
    assert sentences("The error flag is bit 12 [1].") == ["The error flag is bit 12."]


def test_values_that_equal_citation_numbers_survive():
    # r2 reproduction: the real value equals (or concatenates) citation numbers.
    assert sentences("The error flag is bit 11 [1].") == ["The error flag is bit 11."]
    assert sentences("The error flag is bit 12 [1][2].") == ["The error flag is bit 12."]
    assert sentences("Use the terminal at pin 4 [4].") == ["Use the terminal at pin 4."]


def test_bit_11_and_12_stay_distinct_and_claim_eligible():
    a, b = sentences("The error flag is bit 11 [1]."), sentences("The error flag is bit 12 [2].")
    assert a != b and all(any(ch.isdigit() for ch in s) for s in a + b)


def test_bare_numbers_are_never_stripped():
    assert sentences("The default delay is 10.") == ["The default delay is 10."]
    assert sentences("The error flag is bit 11. Check the wiring first [1].") == [
        "The error flag is bit 11.",
        "Check the wiring first.",
    ]
