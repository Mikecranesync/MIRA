"""Repeat agreement must never promote a character-level designation.

The defect this locks out: ``verify.verify`` promoted a finding to
``machine_verified`` whenever a second full-page pass asserted the same
designation. The second pass is the SAME model, prompt family, preprocessing
path and source image, and measured self-consistency showed extraction is
near-deterministic (byte-identical graphs across four runs). So a systematic
misread reproduces perfectly, both passes "agree", and a confident error is
promoted to machine_verified.

Measured on a customer acceptance corpus: 16 of 16 PLC I/O wire numbers lost a
character (`P9DI900-0` -> `P9D900-0`). Under the old rule every one of those
would have been promoted.

Hermetic — no API, no network. All designations here are synthetic.
"""

from __future__ import annotations

import io

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from PIL import Image  # noqa: E402

from printsense import verify  # noqa: E402
from printsense.models import PrintSynthGraph, TrustState  # noqa: E402


def _img_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, format="JPEG")
    return buf.getvalue()


def _pass(graph_dict):
    """A canned second pass returning ``graph_dict`` + usage."""

    def _bp(image_bytes):
        return PrintSynthGraph.model_validate(graph_dict), {
            "input_tokens": 10,
            "output_tokens": 5,
        }

    return _bp


# --- the independence policy itself -----------------------------------------


def test_primary_class_is_not_independent():
    assert not verify.is_independent(verify.PRIMARY_EVIDENCE_CLASS)


@pytest.mark.parametrize(
    "cls",
    ["deterministic_ocr", "human_annotation", "authoritative_source", "trusted_structured_source"],
)
def test_declared_independent_classes(cls):
    assert verify.is_independent(cls)


@pytest.mark.parametrize("cls", [None, "", "model_vision", "run_2", "second_pass", "unknown"])
def test_unknown_classes_fail_closed(cls):
    """A label is not independence. Anything undeclared is refused."""
    assert not verify.is_independent(cls)


def test_primary_class_not_in_independent_set():
    """Guards against someone quietly adding the primary class to the set."""
    assert verify.PRIMARY_EVIDENCE_CLASS not in verify.INDEPENDENT_EVIDENCE_CLASSES


# --- the measured failure shape ------------------------------------------------


_WRONG = "P9D900-0"  # the I-dropped misread
_RIGHT = "P9DI900-0"  # what the drawing actually shows


def test_two_agreeing_deterministic_passes_do_not_verify_a_wrong_designation():
    """THE regression: both passes reproduce the same wrong tag -> stays proposed."""
    graph = PrintSynthGraph.model_validate(
        {"conductors": [{"tag": _WRONG, "confidence": 0.95, "trust": "proposed"}]}
    )
    # a deterministic model reproduces its own misread exactly
    out = verify.verify(_img_bytes(), graph, blind_pass=_pass({"conductors": [{"tag": _WRONG}]}))

    e = out["graph"].conductors[0]
    assert e.trust == TrustState.proposed, "a reproduced misread must not be machine_verified"
    assert out["decisions"][0]["decision"] == "agree_same_evidence_class"
    assert out["decisions"][0]["action"] == "kept_proposed_not_independent"
    assert out["independent"] is False


def test_reproducibility_is_still_reported():
    """Agreement is not discarded — it is recorded as a stability signal."""
    graph = PrintSynthGraph.model_validate({"conductors": [{"tag": _WRONG, "trust": "proposed"}]})
    out = verify.verify(_img_bytes(), graph, blind_pass=_pass({"conductors": [{"tag": _WRONG}]}))

    assert out["reproducibility"] == {"reproduced": 1, "checked": 1, "promoted": 0}
    assert out["decisions"][0]["agreed"] is True


def test_reproducibility_note_does_not_claim_verification():
    """The evidence string must not read as corroboration."""
    graph = PrintSynthGraph.model_validate(
        {"conductors": [{"tag": _WRONG, "trust": "proposed", "evidence": "orig"}]}
    )
    out = verify.verify(_img_bytes(), graph, blind_pass=_pass({"conductors": [{"tag": _WRONG}]}))

    ev = out["graph"].conductors[0].evidence
    assert "reproducibility only" in ev
    assert "not independent corroboration" in ev
    assert "orig" in ev, "original evidence must be preserved"


def test_independent_evidence_promotes_the_correct_designation():
    """The other half of the contract: real independence still works."""
    graph = PrintSynthGraph.model_validate(
        {"conductors": [{"tag": _RIGHT, "confidence": 0.9, "trust": "proposed"}]}
    )
    out = verify.verify(
        _img_bytes(),
        graph,
        blind_pass=_pass({"conductors": [{"tag": _RIGHT}]}),
        evidence_class="deterministic_ocr",
    )

    assert out["graph"].conductors[0].trust == TrustState.machine_verified
    assert out["independent"] is True
    assert out["reproducibility"]["promoted"] == 1


def test_independent_evidence_disagreeing_does_not_promote():
    """Independent OCR reading the CORRECT tag cannot verify the WRONG one."""
    graph = PrintSynthGraph.model_validate({"conductors": [{"tag": _WRONG, "trust": "proposed"}]})
    out = verify.verify(
        _img_bytes(),
        graph,
        blind_pass=_pass({"conductors": [{"tag": _RIGHT}]}),
        evidence_class="deterministic_ocr",
    )

    assert out["graph"].conductors[0].trust == TrustState.proposed
    assert out["decisions"][0]["decision"] == "no_second_witness"


def test_homoglyph_difference_is_not_normalized_away():
    """`P9D900-0` and `P9DI900-0` must never compare equal."""
    graph = PrintSynthGraph.model_validate({"conductors": [{"tag": _WRONG, "trust": "proposed"}]})
    out = verify.verify(
        _img_bytes(),
        graph,
        blind_pass=_pass({"conductors": [{"tag": _RIGHT}]}),
        evidence_class="human_annotation",
    )
    assert out["graph"].conductors[0].trust == TrustState.proposed


# --- the machine never signs off for a human --------------------------------


def test_machine_never_writes_human_verified():
    graph = PrintSynthGraph.model_validate({"conductors": [{"tag": _RIGHT, "trust": "proposed"}]})
    for cls in (verify.PRIMARY_EVIDENCE_CLASS, "deterministic_ocr", "human_annotation"):
        out = verify.verify(
            _img_bytes(),
            graph,
            blind_pass=_pass({"conductors": [{"tag": _RIGHT}]}),
            evidence_class=cls,
        )
        assert out["graph"].conductors[0].trust != TrustState.human_verified


def test_unreadable_is_never_promoted():
    graph = PrintSynthGraph.model_validate(
        {"conductors": [{"tag": "UNREADABLE", "trust": "proposed"}]}
    )
    out = verify.verify(
        _img_bytes(),
        graph,
        blind_pass=_pass({"conductors": [{"tag": "UNREADABLE"}]}),
        evidence_class="deterministic_ocr",
    )
    assert out["graph"].conductors[0].trust == TrustState.proposed
    assert out["decisions"] == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
