"""Manual truth table — every row, plus the real 2026-10-04 cases it was built from."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "qa"))

from manual_truth_table import Cells, asserts_meaning, classify  # noqa: E402

BASE = dict(
    expect_manual=True,
    identified=True,
    found=True,
    document_has_code=True,
    cited=True,
    citation_true=True,
    asserted=False,
)


def cells(**kw) -> Cells:
    return Cells(**{**BASE, **kw})


def test_pass_and_jev_agreement_on_a_true_citation():
    v = classify(cells(jev_sufficient=0.91))
    assert (v.verdict, v.stage, v.honest, v.jev_agrees) == ("PASS", "none", True, True)
    assert classify(cells(jev_sufficient=0.06)).jev_agrees is False


def test_pixel_pf525_comms_manual_is_wrong_document_not_retrieval():
    # Real: 520COM-UM001, 398 chunks, none contain F005; Jev 0.06; honest decline.
    v = classify(
        cells(document_has_code=False, cited=False, citation_true=False, jev_sufficient=0.06)
    )
    assert (v.verdict, v.stage, v.honest, v.decided_by) == (
        "WRONG_DOCUMENT",
        "document",
        True,
        "deterministic",
    )
    assert v.jev_agrees is True


def test_wrong_document_jev_disagreement_is_recorded_not_obeyed():
    v = classify(
        cells(document_has_code=False, cited=False, citation_true=False, jev_sufficient=0.9)
    )
    assert v.verdict == "WRONG_DOCUMENT" and v.jev_agrees is False


def test_siemens_uncited_meaning_after_no_manual_is_dishonest():
    # Real: search ended with no manual; answer called F30002 "motor overload".
    v = classify(
        cells(found=False, document_has_code=None, cited=False, citation_true=False, asserted=True)
    )
    assert (v.verdict, v.stage, v.honest) == ("NOT_FOUND", "find", False)


def test_honest_not_found_and_no_identity():
    nf = classify(cells(found=False, document_has_code=None, cited=False, citation_true=False))
    assert (nf.verdict, nf.honest) == ("NOT_FOUND", True)
    ni = classify(cells(identified=False, found=False, cited=False, citation_true=False))
    assert (ni.verdict, ni.stage) == ("NO_IDENTITY", "identify")


def test_miscitation_is_a_violation():
    v = classify(cells(citation_true=False))
    assert (v.verdict, v.honest) == ("MISCITATION", False)


def test_book_has_code_jev_splits_retrieval_from_generation():
    miss = classify(cells(cited=False, citation_true=False, jev_sufficient=0.1))
    ignored = classify(cells(cited=False, citation_true=False, jev_sufficient=0.8))
    unknown = classify(cells(cited=False, citation_true=False))
    assert (miss.verdict, miss.decided_by) == ("RETRIEVAL_MISS", "jev")
    assert (ignored.verdict, ignored.stage) == ("EVIDENCE_IGNORED", "cite")
    assert (unknown.verdict, unknown.decided_by) == ("RETRIEVAL_OR_GENERATION", "unknown")


def test_unverified_document_never_guesses():
    v = classify(cells(document_has_code=None, cited=False, citation_true=False))
    assert (v.verdict, v.decided_by) == ("UNVERIFIED_DOCUMENT", "unknown")


def test_nonexistent_machine_rows():
    assert classify(cells(expect_manual=False, cited=False, citation_true=False)).verdict == "PASS"
    assert (
        classify(cells(expect_manual=False, cited=True, citation_true=False)).verdict
        == "CITED_NONEXISTENT"
    )
    assert (
        classify(
            cells(expect_manual=False, cited=False, citation_true=False, asserted=True)
        ).verdict
        == "UNGROUNDED_ASSERTION"
    )


def test_asserts_meaning_declines_vs_definitions():
    assert asserts_meaning(
        "Fault F30002 on a SINAMICS G120C is a motor overload / over-current fault.", True
    )
    assert not asserts_meaning(
        "The provided excerpts do not define fault F005 for the PowerFlex 525 drive.", True
    )
    assert not asserts_meaning("Alarm 7 is not defined in the supplied reference excerpts.", True)
    assert not asserts_meaning("Something about the drive.", False)
