"""The designation metric must measure real fields, or say it did not measure.

Replaces a counter that read ``conductor["wire_number"]`` — a field the
PrintSynth schema does not define, so it summed to 0 on every graph ever
produced and rendered "not measured" as "no errors found".

All designations here are synthetic.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import designation_metrics as dm  # noqa: E402

RIGHT = "P9DI900-0"  # letter-I present
WRONG = "P9D900-0"  # the I-dropped misread


def _graph(conductors=(), cables=()):
    return {
        "conductors": [{"tag": t} for t in conductors],
        "cables": [{"tag": t} for t in cables],
    }


def _rubric(*expected):
    return {"categories": {"wire": {"expected": list(expected)}}}


# --- it reads fields that actually exist ------------------------------------


def test_reads_the_tag_field_not_a_phantom_wire_number():
    """The old counter keyed on `wire_number`, which no schema defines."""
    g = _graph(conductors=[RIGHT, "PW99+1A"])
    assert dm.observed_designations(g) == [RIGHT, "PW99+1A"]


def test_a_wire_number_field_is_not_consulted():
    """Even if something writes `wire_number`, the tag remains the source."""
    g = {"conductors": [{"tag": RIGHT, "wire_number": "IGNORED"}]}
    assert dm.observed_designations(g) == [RIGHT]


def test_cables_are_included():
    assert dm.observed_designations(_graph(cables=["-W5497"])) == ["-W5497"]


def test_unreadable_is_counted_separately_not_as_a_designation():
    g = _graph(conductors=[RIGHT, "UNREADABLE"])
    assert dm.observed_designations(g) == [RIGHT]
    assert dm.count_unreadable(g) == 1


# --- exact match -------------------------------------------------------------


def test_exact_match_counts():
    r = dm.measure(_graph(conductors=[RIGHT, "PW99+1A"]), _rubric(RIGHT, "PW99+1A"))
    assert r["measured"] is True
    assert r["expected"] == 2
    assert r["exact_matches"] == 2
    assert r["mismatches"] == []
    assert r["missing"] == []
    assert r["exact_match_rate"] == 1.0


def test_case_and_whitespace_normalize():
    """The only permitted normalization."""
    r = dm.measure(_graph(conductors=[" pw99+1a "]), _rubric("PW99+1A"))
    assert r["exact_matches"] == 1


# --- the homoglyph mismatch --------------------------------------------------


def test_homoglyph_difference_is_a_mismatch_not_a_match():
    """THE regression: P9D900-0 must never satisfy expected P9DI900-0."""
    r = dm.measure(_graph(conductors=[WRONG]), _rubric(RIGHT))
    assert r["exact_matches"] == 0
    assert r["mismatches"] == [{"expected": RIGHT, "observed": WRONG}]
    assert r["exact_match_rate"] == 0.0


@pytest.mark.parametrize("letter,digit", dm.HOMOGLYPH_PAIRS)
def test_each_homoglyph_pair_stays_distinct(letter, digit):
    r = dm.measure(_graph(conductors=[f"X{digit}Y"]), _rubric(f"X{letter}Y"))
    assert r["exact_matches"] == 0, f"{letter} and {digit} were treated as equal"
    assert r["mismatches"] == [{"expected": f"X{letter}Y", "observed": f"X{digit}Y"}]


def test_mismatch_carries_both_sides():
    """Expected vs observed together — that is what makes it actionable."""
    r = dm.measure(_graph(conductors=[WRONG]), _rubric(RIGHT))
    m = r["mismatches"][0]
    assert m["expected"] == RIGHT and m["observed"] == WRONG
    assert r["missing"] == [] and r["extra"] == []  # paired, not double-counted


# --- missing / extra ---------------------------------------------------------


def test_missing_designation_is_reported():
    r = dm.measure(_graph(conductors=["PW99+1A"]), _rubric("PW99+1A", "TB99COM3"))
    assert r["missing"] == ["TB99COM3"]
    assert r["exact_matches"] == 1


def test_unexpected_extra_is_reported():
    # _norm strips internal whitespace too, symmetrically on both sides.
    r = dm.measure(_graph(conductors=["PW99+1A", "BLK #8"]), _rubric("PW99+1A"))
    assert r["extra"] == ["BLK#8"]


def test_distant_strings_are_not_paired_as_a_mismatch():
    """Only a single-character edit pairs; unrelated tags stay separate."""
    r = dm.measure(_graph(conductors=["ZZZZZZ"]), _rubric("PW99+1A"))
    assert r["mismatches"] == []
    assert r["missing"] == ["PW99+1A"]
    assert r["extra"] == ["ZZZZZZ"]


# --- absence is never zero ---------------------------------------------------


def test_no_rubric_is_not_measured_not_zero_errors():
    """The exact defect: no ground truth must not read as a clean result."""
    r = dm.measure(_graph(conductors=[WRONG]), None)
    assert r["measured"] is False
    assert r["reason"] == "no_rubric"
    assert r["status"] == "not_measured"
    assert "mismatches" not in r, "an unmeasured result must not carry a zero count"


def test_rubric_without_wire_expectations_is_not_measured():
    r = dm.measure(
        _graph(conductors=[WRONG]), {"categories": {"device": {"expected": ["-21/A13"]}}}
    )
    assert r["measured"] is False
    assert r["reason"] == "no_expected_wire_designations"


def test_malformed_graph_is_not_measured():
    r = dm.measure(12345, _rubric(RIGHT))
    assert r["measured"] is False
    assert r["reason"] == "unsupported_graph_type"


def test_malformed_rubric_is_not_measured():
    r = dm.measure(_graph(conductors=[RIGHT]), ["not", "a", "dict"])
    assert r["measured"] is False
    assert r["reason"] == "unsupported_rubric_type"


def test_empty_graph_with_truth_is_all_missing_not_all_matched():
    r = dm.measure(_graph(), _rubric(RIGHT, "PW99+1A"))
    assert r["measured"] is True
    assert r["exact_matches"] == 0
    assert sorted(r["missing"]) == sorted([RIGHT, "PW99+1A"])


# --- corpus roll-up ----------------------------------------------------------


def test_summarize_excludes_unmeasured_cases_from_totals():
    results = [
        dm.measure(_graph(conductors=[RIGHT]), _rubric(RIGHT)),
        dm.measure(_graph(conductors=[WRONG]), _rubric(RIGHT)),
        dm.measure(_graph(conductors=[WRONG]), None),  # not measured
    ]
    s = dm.summarize(results)
    assert s["cases"] == 3
    assert s["cases_measured"] == 2
    assert s["cases_not_measured"] == 1
    assert s["not_measured_reasons"] == ["no_rubric"]
    assert s["expected"] == 2
    assert s["exact_matches"] == 1
    assert s["mismatches"] == 1
    assert s["exact_match_rate"] == 0.5


def test_summarize_of_all_unmeasured_reports_no_rate_not_perfect():
    s = dm.summarize([dm.measure(_graph(conductors=[WRONG]), None)])
    assert s["cases_measured"] == 0
    assert s["exact_match_rate"] is None, "no measurement must not render as a score"
    assert s["mismatches"] == 0 and s["expected"] == 0


# --- the guarantee holds on the edges too ------------------------------------
#
# Everything below is a hole the first version of this module left open: a path
# that reported a zero error count, or a fabricated one, without a real
# comparison behind it. Rule 1 of the module docstring is only true if these
# hold.


def test_present_but_empty_expected_list_is_not_measured():
    """`expected: []` is absence of ground truth, not a clean comparison.

    The guard used to test key presence, so an empty list fell through to the
    measured branch and returned zero mismatches with nothing compared.
    """
    r = dm.measure(_graph(conductors=[WRONG, "X911-A"]), _rubric())
    assert r["measured"] is False
    assert r["reason"] == "no_expected_wire_designations"
    assert "mismatches" not in r


def test_expected_entries_that_are_blank_or_null_do_not_create_a_comparison():
    r = dm.measure(_graph(conductors=[WRONG]), _rubric(None, "", "   "))
    assert r["measured"] is False
    assert r["reason"] == "no_expected_wire_designations"


def test_a_null_tag_is_not_a_designation():
    """`_norm(None)` stringifies to the literal "NONE" — it must never be counted."""
    g = {"conductors": [{"tag": None}, {"tag": RIGHT}], "cables": []}
    assert dm.observed_designations(g) == [RIGHT]
    assert dm.count_unreadable(g) == 0


def test_a_null_expectation_never_scores_as_an_exact_match():
    """Both sides stringified to "NONE" and matched each other for a perfect score."""
    r = dm.measure({"conductors": [{"tag": None}], "cables": []}, _rubric(None))
    assert r["measured"] is False, "nothing was asserted on either side"


def test_a_repeated_expectation_does_not_pin_a_perfect_extraction_below_one():
    """A wire number printed at both ends of a run may be listed twice.

    The denominator was the list length while the numerator was a set
    intersection, so a byte-perfect extraction could never reach 1.0.
    """
    r = dm.measure(_graph(conductors=[RIGHT, "PW99+1A"]), _rubric(RIGHT, "PW99+1A", RIGHT))
    assert r["exact_matches"] == 2
    assert r["expected"] == 2
    assert r["exact_match_rate"] == 1.0


@pytest.mark.parametrize(
    "expected,observed",
    [
        ((RIGHT, "PW99+1A", RIGHT), (RIGHT,)),
        ((RIGHT, "PW99+1A"), (WRONG, "X911-A")),
        ((RIGHT,), ()),
        ((RIGHT, "PW99+1A"), (RIGHT, "PW99+1A")),
    ],
)
def test_every_expectation_is_accounted_for(expected, observed):
    """`expected == exact + missing + mismatches`, with no expectation lost."""
    r = dm.measure(_graph(conductors=list(observed)), _rubric(*expected))
    assert r["expected"] == r["exact_matches"] + len(r["missing"]) + len(r["mismatches"])


# --- pairing must not fabricate a misread ------------------------------------


def test_sequential_wire_numbers_are_not_paired_as_a_misread():
    """`extra` is not an error set — a rubric lists only a subset of a sheet.

    W900 was read correctly but is not in the rubric; W901 was genuinely never
    extracted. Bare edit distance consumed the first as a corruption of the
    second, inventing a character error AND hiding that W900 was read right.
    """
    r = dm.measure(_graph(conductors=["W900"]), _rubric("W901"))
    assert r["mismatches"] == [], "a digit difference is numbering, not a homoglyph misread"
    assert r["missing"] == ["W901"]
    assert r["extra"] == ["W900"]


def test_the_real_error_class_still_pairs():
    """The defect this module measures: a letter dropped from a PLC I/O run."""
    r = dm.measure(_graph(conductors=[WRONG]), _rubric(RIGHT))
    assert r["mismatches"] == [{"expected": RIGHT, "observed": WRONG}]


@pytest.mark.parametrize("letter,digit", dm.HOMOGLYPH_PAIRS)
def test_a_homoglyph_substitution_pairs(letter, digit):
    want, got = f"X9{letter}7-C", f"X9{digit}7-C"
    r = dm.measure(_graph(conductors=[got]), _rubric(want))
    assert r["mismatches"] == [{"expected": want, "observed": got}]


@pytest.mark.parametrize("letter", [letter for letter, _digit in dm.HOMOGLYPH_PAIRS])
def test_a_dropped_homoglyph_letter_pairs(letter):
    want, got = f"P9{letter}900-0", "P9900-0"
    r = dm.measure(_graph(conductors=[got]), _rubric(want))
    assert r["mismatches"] == [{"expected": want, "observed": got}]


def test_a_dropped_non_homoglyph_letter_is_not_paired():
    """Only the homoglyph letter class is the measured error."""
    r = dm.measure(_graph(conductors=["P9900-0"]), _rubric("P9K900-0"))
    assert r["mismatches"] == []


def test_zero_and_one_are_not_a_homoglyph_pair():
    """Both are homoglyph *members*, but confusing them is not a homoglyph error."""
    assert dm.is_homoglyph_near_miss("W100", "W110") is False
    assert dm.is_homoglyph_near_miss("X9I7-C", "X917-C") is True


# --- a graph we cannot parse is unmeasured, not a crash ----------------------


def test_a_malformed_json_string_graph_is_not_measured():
    """A truncated or JSON-repaired response must not take the grade down."""
    r = dm.measure('{"conductors": [', _rubric(RIGHT))
    assert r["measured"] is False
    assert r["reason"] == "unsupported_graph_type"


def test_a_well_formed_json_string_graph_is_measured():
    import json

    r = dm.measure(json.dumps(_graph(conductors=[RIGHT])), _rubric(RIGHT))
    assert r["measured"] is True
    assert r["exact_matches"] == 1


# --- envelope integration ----------------------------------------------------


def test_grade_case_envelope_always_carries_designation_metrics():
    from printsense import grade_case

    assert "designation_metrics" in grade_case.ENVELOPE_KEYS


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
