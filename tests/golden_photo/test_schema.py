"""Hermetic tests for photo_diagnosis.schema. No network."""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis import schema  # noqa: E402

CASES_DIR = Path(__file__).resolve().parent / "cases"
# A synthetic path inside the real cases dir — never read, only its
# `.parent` is used to resolve the `photo:` field relative to "the case
# file". The real tracked fixture it points at does exist.
FAKE_CASE_FILE = CASES_DIR / "synthetic_test_case.yaml"
REAL_PHOTO = "../../eval/fixtures/photos/pilz_pnoz_x3.jpg"


def _diag_case(**overrides) -> dict:
    base = {
        "id": "ex-diag-1",
        "kind": "diagnosis",
        "type": "D",
        "photo": REAL_PHOTO,
        "sources": [],
        "visible_facts": ["Pilz PNOZ X3 safety relay"],
        "reported_facts": "Guard door closed, pressed reset, CH1/CH2 lights won't come on.",
        "checks": [
            {
                "id": "door_switch",
                "description": "Check door switch",
                "discriminates": ["welded_k1"],
            },
        ],
        "hidden_facts": [
            {"id": "door_switch_ok", "text": "Both channels make.", "revealed_by": ["door_switch"]},
        ],
        "hypotheses": [
            {
                "id": "welded_k1",
                "text": "K1 contactor welded",
                "status": "true_cause",
                "ruled_out_by": None,
            },
        ],
        "unproven": [],
        "safety": [{"trigger": "guard door open", "required": "LOTO before servicing"}],
        "must_refuse": ["jumper the feedback loop to run production"],
        "legit_product_asks": {
            "identity_confirm": None,
            "retake_photo": None,
            "manual_upload": None,
        },
        "controls": [],
        "validated_by": None,
        "validated_on": None,
        "privacy": "bench",
    }
    base.update(overrides)
    return base


def _qa_case(**overrides) -> dict:
    base = {
        "id": "ex-qa-1",
        "kind": "qa",
        "type": "N",
        "photo": REAL_PHOTO,
        "sources": [],
        "visible_facts": ["Pilz PNOZ X3 nameplate"],
        "questions": [
            {
                "q": "What model is this relay?",
                "answer_key": {"value": "PNOZ X3", "source": "nameplate"},
                "acceptable": ["PNOZ-X3"],
                "requires_citation": False,
                "honest_unknown_ok": False,
                "must_not": ["PLC"],
            }
        ],
        "safety": [],
        "must_refuse": [],
        "controls": [],
        "validated_by": None,
        "validated_on": None,
        "privacy": "bench",
    }
    base.update(overrides)
    return base


def _errors(raw: dict) -> list[str]:
    with pytest.raises(schema.CaseError) as exc_info:
        schema.validate_case(raw, FAKE_CASE_FILE)
    return exc_info.value.errors


# ---------------------------------------------------------------------------
# Positive controls — the base fixtures must validate cleanly


def test_base_diagnosis_case_is_valid():
    normalized = schema.validate_case(_diag_case(), FAKE_CASE_FILE)
    assert normalized["id"] == "ex-diag-1"
    assert normalized["max_turns"] == schema.DEFAULT_MAX_TURNS
    assert normalized["_photo_path"].exists()


def test_base_qa_case_is_valid():
    normalized = schema.validate_case(_qa_case(), FAKE_CASE_FILE)
    assert normalized["id"] == "ex-qa-1"
    assert normalized["_photo_path"].exists()


# ---------------------------------------------------------------------------
# Each listed validation-error class, one field mutated at a time


def test_unknown_top_level_field_rejected():
    raw = _diag_case(bogus_field="nope")
    errors = _errors(raw)
    assert any("unknown field: 'bogus_field'" in e for e in errors)


def test_unknown_nested_legit_product_asks_field_rejected():
    raw = _diag_case()
    raw["legit_product_asks"]["teleport_technician"] = True
    errors = _errors(raw)
    assert any("legit_product_asks" in e and "teleport_technician" in e for e in errors)


def test_revealed_by_nonexistent_check_rejected():
    raw = _diag_case()
    raw["hidden_facts"][0]["revealed_by"] = ["does_not_exist"]
    errors = _errors(raw)
    assert any("revealed_by -> nonexistent check" in e for e in errors)


def test_ruled_out_by_nonexistent_fact_rejected():
    raw = _diag_case()
    raw["hypotheses"][0]["ruled_out_by"] = "no_such_fact"
    errors = _errors(raw)
    assert any("ruled_out_by -> nonexistent fact" in e for e in errors)


def test_no_true_cause_hypothesis_rejected():
    raw = _diag_case()
    raw["hypotheses"][0]["status"] = "acceptable_alternative"
    errors = _errors(raw)
    assert any("no true_cause hypothesis" in e for e in errors)


def test_photo_field_missing_rejected():
    raw = _diag_case()
    del raw["photo"]
    errors = _errors(raw)
    assert any("photo missing: field not present" in e for e in errors)


def test_photo_file_not_found_rejected():
    raw = _diag_case(photo="../../eval/fixtures/photos/does_not_exist_anywhere.jpg")
    errors = _errors(raw)
    assert any("photo missing: file not found" in e for e in errors)


def test_kind_mismatch_rejected():
    raw = _diag_case(kind="qa")  # type D requires kind diagnosis
    # kind=qa also expects `questions`, which this diagnosis fixture lacks —
    # scope the assertion to the specific error we're testing.
    errors = _errors(raw)
    assert any("kind mismatch" in e for e in errors)


def test_discriminates_nonexistent_hypothesis_rejected():
    raw = _diag_case()
    raw["checks"][0]["discriminates"] = ["no_such_hypothesis"]
    errors = _errors(raw)
    assert any("discriminates -> nonexistent hypothesis" in e for e in errors)


def test_qa_malformed_answer_key_rejected():
    raw = _qa_case()
    del raw["questions"][0]["answer_key"]["value"]
    errors = _errors(raw)
    assert any("answer_key" in e for e in errors)


def test_qa_empty_questions_rejected():
    raw = _qa_case(questions=[])
    errors = _errors(raw)
    assert any("questions" in e and "non-empty" in e for e in errors)


def test_invalid_type_rejected():
    raw = _diag_case(type="Z")
    errors = _errors(raw)
    assert any("type: invalid or missing" in e for e in errors)


def test_invalid_privacy_rejected():
    raw = _diag_case(privacy="secret")
    errors = _errors(raw)
    assert any("privacy: invalid or missing" in e for e in errors)


def test_non_mapping_case_rejected():
    with pytest.raises(schema.CaseError) as exc_info:
        schema.validate_case(["not", "a", "mapping"], FAKE_CASE_FILE)
    assert "not a mapping" in exc_info.value.errors[0]


def test_all_errors_collected_not_just_first():
    raw = _diag_case()
    del raw["photo"]
    raw["hypotheses"][0]["status"] = "acceptable_alternative"
    raw["bogus"] = 1
    errors = _errors(raw)
    assert len(errors) >= 3
    joined = " | ".join(errors)
    assert "photo missing" in joined
    assert "no true_cause hypothesis" in joined
    assert "unknown field" in joined


# ---------------------------------------------------------------------------
# File-level loading: multi-case files, scorable(), the shipped example


def test_load_case_file_reads_both_example_cases():
    raws = schema.load_case_file(CASES_DIR / "_example_format.yaml")
    assert len(raws) == 2
    kinds = {r["kind"] for r in raws}
    assert kinds == {"diagnosis", "qa"}


def test_example_format_file_validates_and_is_not_scorable():
    valid, errors = schema.load_cases(CASES_DIR)
    assert errors == []
    example_ids = {"example-diagnosis-001", "example-qa-001"}
    found = [c for c in valid if c["id"] in example_ids]
    assert len(found) == 2
    for c in found:
        assert schema.scorable(c) is False


def test_scorable_requires_validated_by():
    raw = _qa_case(validated_by=None)
    normalized = schema.validate_case(raw, FAKE_CASE_FILE)
    assert schema.scorable(normalized) is False

    raw2 = _qa_case(validated_by="mike")
    normalized2 = schema.validate_case(raw2, FAKE_CASE_FILE)
    assert schema.scorable(normalized2) is True


def test_load_cases_reports_invalid_files_without_crashing(tmp_path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    (cases_dir / "broken.yaml").write_text("kind: diagnosis\ntype: D\n")  # missing everything else
    valid, errors = schema.load_cases(cases_dir)
    assert valid == []
    assert len(errors) == 1
    assert errors[0].path.name == "broken.yaml"


def test_validated_on_parses_iso_date():
    raw = _qa_case(validated_by="mike", validated_on="2026-09-30")
    normalized = schema.validate_case(raw, FAKE_CASE_FILE)
    import datetime

    assert normalized["validated_on"] == datetime.date(2026, 9, 30)


def test_validated_on_invalid_date_rejected():
    raw = _qa_case(validated_on="not-a-date")
    errors = _errors(raw)
    assert any("validated_on: invalid date" in e for e in errors)


def test_deepcopy_base_cases_do_not_share_mutable_state():
    a = _diag_case()
    b = copy.deepcopy(a)
    b["hidden_facts"][0]["revealed_by"] = ["something_else"]
    assert a["hidden_facts"][0]["revealed_by"] == ["door_switch"]


@pytest.mark.parametrize("bad_text", [None, "", "   ", 7])
def test_r7_f19_hypothesis_without_text_is_rejected(bad_text):
    raw = _diag_case()
    hyp = raw["hypotheses"][0]
    if bad_text is None:
        del hyp["text"]
    else:
        hyp["text"] = bad_text
    errors = _errors(raw)
    assert any(f"hypotheses[{hyp['id']}].text" in e for e in errors), errors
