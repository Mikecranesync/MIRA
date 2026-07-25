"""CI gate: the synthetic homoglyph corpus + the deterministic metric path.

No live inference — this grades committed expected-result fixtures through
``designation_metrics.measure``, so a regression in the metric, the corpus
truth, or the exact-character rule fails CI without spending anything.

The corpus is fully synthetic (fictional panel PNL-99 / sheet 99). It exists to
lock the error class measured on a real acceptance corpus: an alphanumeric
designation losing a letter to its look-alike digit.
"""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from printsense import designation_metrics as dm  # noqa: E402
from printsense.benchmarks import homoglyph_corpus as hc  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SHA_FILE = REPO / "printsense/benchmarks/homoglyph_corpus.sha256"

CASE = "na_homoglyph_wire_numbers"


def _graph(tags):
    return {"conductors": [{"tag": t} for t in tags], "cables": []}


# --- determinism / freeze ----------------------------------------------------


def test_truth_digest_matches_committed_sha():
    """Truth is frozen — editing it must be a loud, deliberate two-file diff."""
    assert SHA_FILE.exists(), "committed digest missing"
    assert SHA_FILE.read_text().strip() == hc.truth_digest()


def test_truth_digest_is_stable_across_calls():
    assert hc.truth_digest() == hc.truth_digest()


def test_corpus_is_declared_synthetic():
    for case in hc.CASES:
        assert case["truth_status"] == "synthetic", case["case_id"]


def test_tokens_are_deterministic():
    """Re-deriving the token stream yields identical bboxes."""
    a = hc.get_case(CASE)["tokens"]
    b = hc.get_case(CASE)["tokens"]
    assert a == b


# --- every required homoglyph pair is present, BOTH members ------------------


@pytest.mark.parametrize("letter_form,digit_form", hc.REQUIRED_PAIRS)
def test_both_members_of_each_pair_are_on_the_sheet(letter_form, digit_form):
    """A one-sided fixture could be passed by a model that always guesses one way."""
    expected = hc.expected_wire_rubric(CASE)["categories"]["wire"]["expected"]
    assert letter_form in expected
    assert digit_form in expected


def test_all_five_directive_pairs_covered():
    assert len(hc.REQUIRED_PAIRS) == 5
    letters = {p[0] for p in hc.REQUIRED_PAIRS}
    assert len(letters) == 5


def test_case_tokens_actually_print_the_designations():
    """Truth must be readable off the page, not asserted out of thin air."""
    texts = {t["text"] for t in hc.get_case(CASE)["tokens"]}
    for want in hc.expected_wire_rubric(CASE)["categories"]["wire"]["expected"]:
        assert want in texts, f"{want} is claimed as truth but never printed"


# --- the metric path, graded on committed expected results -------------------


def test_perfect_extraction_scores_clean():
    rubric = hc.expected_wire_rubric(CASE)
    perfect = rubric["categories"]["wire"]["expected"]
    r = dm.measure(_graph(perfect), rubric)
    assert r["measured"] is True
    assert r["exact_match_rate"] == 1.0
    assert r["mismatches"] == []
    assert r["missing"] == []


@pytest.mark.parametrize("letter_form,digit_form", hc.REQUIRED_PAIRS)
def test_collapsing_a_letter_into_its_digit_is_caught(letter_form, digit_form):
    """The forward error: X9I1-A read as X911-A."""
    rubric = hc.expected_wire_rubric(CASE)
    expected = rubric["categories"]["wire"]["expected"]
    collapsed = letter_form.replace(letter_form[2], digit_form[2], 1)
    observed = [collapsed if t == letter_form else t for t in expected]

    r = dm.measure(_graph(observed), rubric)
    assert r["exact_match_rate"] < 1.0
    assert {"expected": letter_form, "observed": collapsed} in r["mismatches"]


def test_expanding_a_digit_into_its_letter_is_also_caught():
    """The reverse error: X911-F 'corrected' to X9I1-F. The fix must not be
    'always prefer letters'."""
    rubric = hc.expected_wire_rubric(CASE)
    expected = rubric["categories"]["wire"]["expected"]
    observed = ["X9I1-F" if t == "X911-F" else t for t in expected]

    r = dm.measure(_graph(observed), rubric)
    assert {"expected": "X911-F", "observed": "X9I1-F"} in r["mismatches"]


def test_the_di_run_collapse_is_caught():
    """The exact measured defect shape, on fictional numbers."""
    rubric = hc.expected_wire_rubric(CASE)
    expected = rubric["categories"]["wire"]["expected"]
    observed = ["P9D900-0" if t == "P9DI900-0" else t for t in expected]

    r = dm.measure(_graph(observed), rubric)
    assert {"expected": "P9DI900-0", "observed": "P9D900-0"} in r["mismatches"]
    assert r["exact_matches"] == len(expected) - 1


def test_every_known_misread_is_rejected_if_asserted():
    """No known_misread may ever satisfy its expected form."""
    rubric = hc.expected_wire_rubric(CASE)
    expected = set(rubric["categories"]["wire"]["expected"])
    for bad in rubric["categories"]["wire"]["known_misreads"]:
        assert bad not in expected, f"{bad} is listed as both truth and misread"
        r = dm.measure(_graph([bad]), rubric)
        assert r["exact_matches"] == 0, f"{bad} wrongly counted as a match"


def test_no_rubric_on_this_corpus_is_still_not_measured():
    """Even with a rich fixture, absent truth is never a clean score."""
    r = dm.measure(_graph(["X9I1-A"]), None)
    assert r["measured"] is False
    assert r["reason"] == "no_rubric"


# --- privacy -----------------------------------------------------------------


#: Every designation token must sit in the fictional 9-series namespace. This is
#: a POSITIVE allowlist on purpose: a denylist of real project names would have
#: to spell those names out in the repo, which is the leak it claims to prevent.
_FICTIONAL_TOKEN = __import__("re").compile(
    r"""^(
        [XP]9[A-Z0-9]*(-[A-Z0-9]+)*      # X9…/P9… wire numbers + cross-refs
      | [IOBNT]9?\d*:[\d/.A-Z]+          # Rockwell addresses, 9-series file numbers
      | (MTR|CR|PB|LS|SOL)-?9[A-Z0-9-]*  # 99-series devices
      | (BLU|WHT|BLK|GRN|YEL|RED)(/[A-Z]+)?  # wire colours
      | \#\d{1,2}                        # gauges
      | PLC
    )$""",
    __import__("re").X,
)


def test_every_token_is_in_the_fictional_namespace():
    """No token may fall outside the synthetic 9-series namespace.

    A positive check catches an unanticipated real designation; a denylist only
    catches the ones someone remembered to ban.
    """
    for case in hc.CASES:
        for tok in case["tokens"]:
            assert _FICTIONAL_TOKEN.match(tok["text"]), (
                f"{case['case_id']}: token {tok['text']!r} is outside the fictional namespace"
            )


def test_sheet_and_page_numbers_are_fictional():
    for case in hc.CASES:
        assert case["page"] == 99, f"{case['case_id']} must use the fictional sheet 99"


def test_descriptions_name_no_project_or_customer():
    """Prose must stay generic — 'fictional NA panel', never a real project."""
    for case in hc.CASES:
        words = case["description"].split()
        capitalized = [w for w in words[1:] if w[:1].isupper() and w.isalpha()]
        allowed = {"NA", "PLC", "DI", "Rockwell", "American", "North", "Both"}
        assert not (set(capitalized) - allowed), (
            f"{case['case_id']}: unexpected proper noun(s) {set(capitalized) - allowed}"
        )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
