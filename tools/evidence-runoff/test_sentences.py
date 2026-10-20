"""Codex F2 (#4550 r1): citation stripping must never remove a real claim value."""

from run_sentence_scores import sentences


def test_bracketed_citations_keep_the_value():
    assert sentences("The error flag is bit 11 [1].") == ["The error flag is bit 11."]
    assert sentences("The error flag is bit 12 [1].") == ["The error flag is bit 12."]


def test_bit_11_and_12_stay_distinct_and_claim_eligible():
    a, b = sentences("The error flag is bit 11 [1]."), sentences("The error flag is bit 12 [1].")
    assert a != b and all(any(ch.isdigit() for ch in s) for s in a + b)


def test_pins_keep_their_numbers():
    assert sentences("Use the terminal at pin 4 [2].") == ["Use the terminal at pin 4."]


def test_bare_walk_marker_stripped_only_when_it_is_a_known_citation():
    # Walk answers render [11] and [14] as bare digits: "… motor heating 11." / "range is 5…30 1114."
    assert sentences("Trip Class simulates motor heating 11.", markers=["11"]) == [
        "Trip Class simulates motor heating."
    ]
    assert sentences("Its range is 5…30 1114.", markers=["11", "14"]) == ["Its range is 5…30."]
    # Not a known marker → it is a value and stays.
    assert sentences("The default delay is 10.", markers=["2"]) == ["The default delay is 10."]
    assert sentences("The default delay is 10.") == ["The default delay is 10."]
