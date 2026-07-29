"""CI gate: the synthetic homoglyph corpus + the deterministic metric path.

No live inference — this grades committed expected-result fixtures through
``designation_metrics.measure``, so a regression in the metric, the corpus
truth, or the exact-character rule fails CI without spending anything.

The corpus is fully synthetic (fictional panel PNL-99 / sheet 99). It exists to
lock the error class measured on a real acceptance corpus: an alphanumeric
designation losing a letter to its look-alike digit.
"""

from __future__ import annotations

import re
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


# --- the second case is graded too -------------------------------------------
#
# Every grading test above pins `CASE` to the first case, so `na_rockwell_addressing`
# was committed with truth no assertion ever touched. It is also the case that
# makes the empty-`expected` hole reachable: its `wire_designations` is `[]`, so
# `expected_wire_rubric` produces a present-but-empty expectation list.

SECOND_CASE = "na_rockwell_addressing"


def test_every_committed_case_is_exercised_by_this_gate():
    """A case nobody grades is a fixture that cannot fail."""
    assert {c["case_id"] for c in hc.CASES} == {CASE, SECOND_CASE}


def test_a_case_with_no_wire_truth_is_not_measured_not_clean():
    """The reachable form of the dead metric, locked against the real fixture.

    `expected_wire_rubric(SECOND_CASE)` carries `expected: []`. Before the guard
    tested content, this returned `measured: true` with zero mismatches — a clean
    result over a comparison that never happened.
    """
    rubric = hc.expected_wire_rubric(SECOND_CASE)
    assert rubric["categories"]["wire"]["expected"] == [], "fixture shape changed"

    r = dm.measure(_graph(["P9D900-0", "X911-A"]), rubric)
    assert r["measured"] is False
    assert r["reason"] == "no_expected_wire_designations"
    assert "mismatches" not in r, "an unmeasured case must not carry a zero error count"

    s = dm.summarize([r])
    assert s["cases_measured"] == 0
    assert s["cases_not_measured"] == 1
    assert s["exact_match_rate"] is None


def test_second_case_tokens_actually_print_its_device_designations():
    """Its truth must be on its sheet — otherwise the fixture asserts nothing."""
    texts = {t["text"] for t in hc.get_case(SECOND_CASE)["tokens"]}
    for want in hc.get_case(SECOND_CASE)["truth"]["device_designations"]:
        assert want in texts, f"{want} is claimed as truth but never printed"


def test_second_case_known_misreads_are_not_also_correct_answers():
    """A misread that is also a valid designation would make the case unfalsifiable."""
    truth = hc.get_case(SECOND_CASE)["truth"]
    overlap = set(truth["known_misreads"]) & set(truth["device_designations"])
    assert not overlap, f"{overlap} are listed as both correct and as misreads"


# --- privacy -----------------------------------------------------------------


#: Every designation must sit in the fictional 9-series namespace. This is a
#: POSITIVE allowlist on purpose: a denylist of real project names would have to
#: spell those names out in the repo, which is the leak it claims to prevent.
#:
#: The `9` is MANDATORY in every branch. An earlier version made it optional
#: (`[IOBNT]9?\d*:`) and left `[A-Z]` unbounded after the colon, so ordinary real
#: Allen-Bradley addresses (`N7:20`, `B3:0/1`, `T4:1.DN`) and even
#: `N7:CUSTOMERNAME` passed the "fictional namespace" check. An allowlist that
#: admits the real namespace is not an allowlist.
_FICTIONAL_TOKEN = re.compile(
    r"""^(
        [XP]9[A-Z0-9]{0,6}(-[A-Z0-9]{1,4})*        # X9…/P9… wire numbers + cross-refs
      | [IO]:9/[0-9O]                              # 9-series discrete I/O points
      | [BNT]9[0-9]*:[0-9O]+([./][0-9A-Z]{1,3})?   # 9-series file addresses
      | (MTR|CR|PB|LS|SOL)-?9[0-9]*                # 99-series devices
          (-(?:[0-9]{1,3}|START|STOP|RUN|FAULT|RESET))?[A-Z]?
      | (BLU|WHT|BLK|GRN|YEL|RED)(/[A-Z]+)?        # wire colours
      | \#\d{1,2}                                  # gauges
      | PLC
    )$""",
    re.X,
)

#: Letter runs allowed to exceed the cap below — protocol and function
#: vocabulary, never a name. Anything else long and alphabetic is how a customer
#: or project name would actually enter the corpus.
_ALLOWED_WORDS = frozenset(
    """PLC DI DO AI AO MTR CR PB LS SOL START STOP RUN FAULT RESET
       BLU WHT BLK GRN YEL RED DN EN TT ON""".split()
)

#: Longest alphabetic run permitted outside `_ALLOWED_WORDS`. Real designation
#: prefixes are short (`X`, `P`, `DI`); customer and project names are not.
_MAX_NAME_RUN = 2


def _namespace_violations(text: str) -> list[str]:
    """Why ``text`` is not a fictional designation — empty list when it is fine."""
    problems = []
    if not _FICTIONAL_TOKEN.match(text):
        problems.append("does not match the fictional-namespace grammar")
    for run in re.findall(r"[A-Z]+", text.upper()):
        if len(run) > _MAX_NAME_RUN and run not in _ALLOWED_WORDS:
            problems.append(f"letter run {run!r} is long enough to be a name")
    return problems


def _every_designation() -> list[tuple[str, str, str]]:
    """(case_id, field, text) for every designation the corpus commits.

    Covers the printed tokens AND the truth block. `known_misreads` is the
    highest-risk field in the file — it is where a real observed misread would be
    pasted in from an acceptance run — and it was not checked at all.
    """
    out = []
    for case in hc.CASES:
        for tok in case["tokens"]:
            out.append((case["case_id"], "tokens", tok["text"]))
        for field in ("wire_designations", "device_designations", "known_misreads"):
            for text in case["truth"].get(field) or []:
                out.append((case["case_id"], field, text))
    return out


def test_every_token_is_in_the_fictional_namespace():
    """No designation may fall outside the synthetic 9-series namespace.

    A positive check catches an unanticipated real designation; a denylist only
    catches the ones someone remembered to ban.
    """
    for case_id, field, text in _every_designation():
        problems = _namespace_violations(text)
        assert not problems, f"{case_id}.{field}: {text!r} — {'; '.join(problems)}"


def test_the_truth_block_is_checked_not_just_the_tokens():
    """Guard the guard: the checked set must include the truth fields."""
    checked = {field for _cid, field, _t in _every_designation()}
    assert {"tokens", "wire_designations", "device_designations", "known_misreads"} <= checked


@pytest.mark.parametrize(
    "real",
    [
        "N7:20",  # ordinary Allen-Bradley file addresses
        "B3:0/1",
        "T4:1.DN",
        "I:1/0",
        "O:2/7",
        "N7:CUSTOMERNAME",  # a name smuggled through the unbounded [A-Z] run
        "X9ACMECORP",  # a name behind a fictional prefix
        "P9CONFIDENTIAL",
        "A7DI200-0",  # a real-shaped PLC I/O wire number
        "-W5497",
        "MTR-01",
        "PB1-ACMEPLANT",
    ],
)
def test_the_fictional_namespace_check_has_teeth(real):
    """The allowlist must REJECT the real namespace, not merely accept the fake one.

    Without this the guard passes vacuously, and it would have admitted every
    string listed here — including two that are literally customer names.
    """
    assert _namespace_violations(real), f"{real!r} was accepted as fictional"


def test_sheet_and_page_numbers_are_fictional():
    for case in hc.CASES:
        assert case["page"] == 99, f"{case['case_id']} must use the fictional sheet 99"


#: Capitalized words permitted in case prose — conventions and protocol terms.
_ALLOWED_PROSE = frozenset(
    """Fictional NA PLC DI DO AI AO I/O Rockwell American North Both""".split()
)


def test_descriptions_name_no_project_or_customer():
    """Prose must stay generic — 'fictional NA panel', never a real project.

    The earlier version skipped word 0 and filtered on `.isalpha()`, so a
    description reading "Sheet 12345-E-001 pattern, fictional NA panel" passed
    with no CI signal at all: `Sheet` was sliced off and the drawing number is
    not alphabetic. Every word is now examined, and a digit-bearing word must sit
    in the fictional namespace.
    """
    for case in hc.CASES:
        for raw in case["description"].split():
            word = raw.strip(".,;:—-()")
            if not word:
                continue
            if any(ch.isdigit() for ch in word):
                assert not _namespace_violations(word.upper()), (
                    f"{case['case_id']}: {word!r} carries digits and is outside the "
                    f"fictional namespace — a drawing or job number looks like this"
                )
                continue
            if word[:1].isupper():
                assert word in _ALLOWED_PROSE, (
                    f"{case['case_id']}: unexpected proper noun {word!r} in the description"
                )


def test_case_ids_and_kinds_are_generic():
    for case in hc.CASES:
        for field in ("case_id", "kind"):
            value = str(case.get(field, ""))
            assert re.fullmatch(r"[a-z0-9_]*", value), (
                f"{case['case_id']}: {field}={value!r} must be generic lower_snake_case"
            )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
