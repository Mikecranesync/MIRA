"""The independent-provider grader and the priced OpenAI client (no network)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from answer_radar import model_grader
from answer_radar.openai_direct import BudgetExceeded, OpenAIDirect
from answer_radar.schema import IndependenceClass
from answer_radar.score import _independence

GOOD = {
    "correctness": 36,
    "evidence": 18,
    "safety": 20,
    "actionability": 8,
    "uncertainty": 8,
    "verdict": "pass",
    "critical_unsupported_claim": False,
    "unsafe_specificity": False,
    "failure_class": None,
    "factual_errors": [],
    "notes": "ok",
}

PACKET = {
    "S1__machine_selected": {
        "seed_id": "S1",
        "condition": "machine_selected",
        "question": "q1",
        "mira_answer": "a1",
        "answer_sha256": "h-s1-ms",
    },
    "S2__machine_selected": {
        "seed_id": "S2",
        "condition": "machine_selected",
        "question": "q2",
        "mira_answer": "a2",
        "answer_sha256": "h-s2-ms",
    },
    "S1__new_chat": {
        "seed_id": "S1",
        "condition": "new_chat",
        "question": "q1",
        "mira_answer": "a3",
        "answer_sha256": "h-s1-nc",
    },
}


def _transport(replies: list[str], usage=(1000, 1000)):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": replies[len(calls) - 1]}}],
                "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
            },
        )

    return httpx.MockTransport(handler), calls


def test_client_refuses_unpriced_model_and_missing_budget():
    with pytest.raises(ValueError, match="no price"):
        OpenAIDirect("gpt-4.1", 1.0, api_key="k")
    with pytest.raises(ValueError, match="budget"):
        OpenAIDirect("gpt-5.5", 0, api_key="k")


def test_client_prices_usage_and_reserves_the_worst_case():
    transport, calls = _transport(["x", "y"], usage=(1000, 2000))  # $0.005 + $0.06
    c = OpenAIDirect("gpt-5.5", 0.15, api_key="k")
    with httpx.Client(transport=transport) as http:
        c.complete(http, "s", "u", max_completion_tokens=4000)  # worst case $0.12 fits
        assert c.spent_usd == pytest.approx(0.065)
        with pytest.raises(BudgetExceeded):  # 0.065 + 0.12 > 0.15 → never sent
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert len(calls) == 1
    assert calls[0]["max_completion_tokens"] > 0 and "temperature" not in calls[0]


def test_budget_must_be_finite():
    with pytest.raises(ValueError, match="finite"):
        OpenAIDirect("gpt-5.5", float("nan"), api_key="k")
    with pytest.raises(ValueError, match="finite"):
        OpenAIDirect("gpt-5.5", float("inf"), api_key="k")


def test_missing_usage_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(BudgetExceeded, match="unparseable"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12  # charged the worst case, not zero


@pytest.mark.parametrize(
    "patch",
    [
        {"correctness": 41},
        {"safety": -1},
        {"evidence": "18"},
        {"correctness": True},
        {"verdict": "MAYBE"},
        {"critical_unsupported_claim": "no"},
        {"failure_class": "made_up_class"},
        {"verdict": "FAIL"},  # scores meet every threshold: a FAIL contradicts them
        {"correctness": 20},  # PASS with correctness below 34
        {"unsafe_specificity": True},  # PASS with an unsafe flag
    ],
)
def test_malformed_grade_is_rejected(patch):
    with pytest.raises(ValueError):
        model_grader.validate_grade({**GOOD, **patch})


def test_grade_packet_stamps_identity_and_proves_independence(tmp_path: Path):
    # The model claims to be someone else; the written record must ignore it.
    lying = {**GOOD, "grader_provider": "anthropic", "grader_model": "claude-sonnet-5"}
    transport, calls = _transport([json.dumps(lying), json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert failures == [] and len(calls) == 2  # new_chat entry not graded
    rec = json.loads((tmp_path / "grade-B-S1.json").read_text())
    assert (rec["grader_provider"], rec["grader_model"], rec["verdict"]) == (
        "openai",
        "gpt-5.5",
        "PASS",
    )
    assert "a3" not in calls[0]["messages"][1]["content"]

    # Bind A the same way the packet bound B; score() always passes the hash
    # (#4092 post-cap r5: the unhashed call skipped the binding check).
    bound = rec["answer_sha256"]
    (tmp_path / "grade-A-S1.json").write_text(
        json.dumps(
            {
                **GOOD,
                "grader_provider": "anthropic",
                "grader_model": "claude-sonnet-5",
                "answer_sha256": bound,
            }
        )
    )
    assert _independence(tmp_path, "S1", bound) is IndependenceClass.INDEPENDENT_PROVIDER_MODEL
    # A legacy A grade with no hash cannot join a promoting pair.
    (tmp_path / "grade-A-S1.json").write_text(
        json.dumps({**GOOD, "grader_provider": "anthropic", "grader_model": "claude-sonnet-5"})
    )
    assert _independence(tmp_path, "S1", bound) is IndependenceClass.SAME_MODEL_DIFFERENT_RUN


def test_malformed_reply_is_missing_not_guessed(tmp_path: Path):
    transport, _ = _transport(["not json", json.dumps({**GOOD, "safety": 25})])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert len(failures) == 2
    assert list(tmp_path.glob("grade-*.json")) == []


def test_failed_attempt_removes_a_stale_grade(tmp_path: Path):
    stale = tmp_path / "grade-B-S1.json"
    stale.write_text(json.dumps({**GOOD, "grader_provider": "openai", "grader_model": "gpt-5.5"}))
    transport, _ = _transport(["not json", json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert [f.split(":")[0] for f in failures] == ["S1"]
    assert not stale.exists()


def test_two_agreeing_fail_verdicts_never_verify():
    from answer_radar.rubric import evaluate
    from answer_radar.schema import (
        AnswerStatus,
        EvaluationRecord,
        EvidenceTier,
        GraderVerdict,
        SafetyClass,
    )

    def verdict(gid: str) -> GraderVerdict:
        return GraderVerdict(
            grader_id=gid,
            independence_class=IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
            correctness=38,
            evidence=18,
            safety=20,
            actionability=9,
            uncertainty=9,
            verdict="FAIL",
            critical_unsupported_claim=False,
            unsafe_specificity=False,
            failure_class="incomplete_answer",
            notes="",
        )

    rec = EvaluationRecord(
        question_id="S1",
        mira_run_id="r",
        mira_version="v",
        prompt_version="p",
        retrieval_version="r",
        answer_text="a",
        answer_status=AnswerStatus.ANSWERED,
        retrieved_chunk_count=1,
        citations=["c"],
        best_evidence_tier=EvidenceTier.OEM_MANUAL,
        total_answer_time_ms=1,
    )
    rec.grader_verdicts = [verdict("A"), verdict("B")]
    assert evaluate(rec, safety_class=SafetyClass.NONE).verified_correct is False


def test_budget_stop_clears_every_selected_target(tmp_path: Path):
    # Codex #4092 r2 F1: S2 is never reached (budget stop at S1), yet its old
    # grade must not survive to be scored against the new answer.
    for sid in ("S1", "S2"):
        (tmp_path / f"grade-B-{sid}.json").write_text("{}")
    keep = tmp_path / "grade-A-S2.json"
    keep.write_text("{}")
    grader = OpenAIDirect("gpt-5.5", 0.0001, api_key="k")  # below one call's worst case
    transport, calls = _transport([])
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert calls == [] and "budget stop" in failures[0]
    assert not (tmp_path / "grade-B-S1.json").exists()
    assert not (tmp_path / "grade-B-S2.json").exists()
    assert keep.exists()  # the other slot is untouched


def test_input_bound_covers_multibyte_text():
    from answer_radar.openai_direct import FRAMING_TOKENS, input_token_upper_bound

    dense = "°Ω≥≤µ" * 100  # 5 chars, 12 UTF-8 bytes per repeat
    assert input_token_upper_bound(dense, "") == len(dense.encode("utf-8")) + FRAMING_TOKENS
    assert input_token_upper_bound(dense, "") > len(dense)


def test_truncated_exam_is_marked_incomplete(tmp_path: Path, monkeypatch):
    import importlib.util
    import sys as _sys

    spec = importlib.util.spec_from_file_location(
        "mira_eval", Path(__file__).resolve().parents[1] / "mira_eval.py"
    )
    mod = importlib.util.module_from_spec(spec)
    _sys.modules["mira_eval"] = mod
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "RESULTS_DIR", tmp_path)
    row = {
        "id": 1,
        "domain": "d",
        "difficulty": "easy",
        "type": "recall",
        "stem": "s",
        "correct_answer": "A",
        "model_answer": "A",
        "is_correct": True,
        "response_raw": "A",
        "response_time_ms": 1,
        "rag_chunks": False,
        "error": None,
    }
    mod.write_results([row], "gpt-5.5", "t", requested=100)
    out = json.loads((tmp_path / "mcq_eval_results.json").read_text())
    assert (out["complete"], out["requested"], out["total"]) == (False, 100, 1)
    assert (tmp_path / "mcq_eval_report.txt").read_text().startswith("INCOMPLETE RUN: 1 of 100")


def test_transport_failure_charges_the_worst_case_and_stops():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(BudgetExceeded, match="transport"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12


def test_written_grade_is_bound_to_the_answer(tmp_path: Path):
    transport, _ = _transport([json.dumps(GOOD), json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    rec = json.loads((tmp_path / "grade-B-S1.json").read_text())
    assert rec["answer_sha256"] == "h-s1-ms"  # copied from the packet, not recomputed
    assert rec["condition"] == "machine_selected"


def _row(**over):
    row = {
        "question": {
            "question_id": "S1",
            "normalized_question": "q1",
            "manufacturer": "Acme",
            "model": "X1",
        },
        "evaluation": {"answer_text": "a", "citations": ["p.72"], "source_documents": ["doc"]},
        "hub": {"condition": "machine_selected", "retrieval": {"candidate_count": 6}},
    }
    for path, value in over.items():
        part, key = path.split(".")
        row[part] = {**row[part], key: value}
    return row


@pytest.mark.parametrize(
    "change",
    [
        {"evaluation.answer_text": "b"},
        {"evaluation.citations": []},
        {"evaluation.source_documents": ["other"]},
        {"question.normalized_question": "q2"},
        {"question.manufacturer": "Other"},  # Codex post-cap r3 F1
        {"question.model": "X2"},  # Codex post-cap r3 F1
        {"hub.condition": "new_chat"},
        {"hub.retrieval": {"candidate_count": 0}},
        {"hub.turn_status": "declined"},  # Codex post-cap r4 F1
        {"hub.basis": "general_knowledge"},  # Codex post-cap r4 F1
    ],
)
def test_any_graded_field_changes_the_identity(change):
    from answer_radar.score import answer_identity

    assert answer_identity(_row(**change)) != answer_identity(_row())


def test_another_conditions_grade_is_never_overwritten(tmp_path: Path):
    other = tmp_path / "grade-B-S1.json"
    other.write_text(json.dumps({**GOOD, "condition": "new_chat"}))
    transport, calls = _transport([])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http, pytest.raises(SystemExit, match="new_chat"):
        model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert calls == [] and json.loads(other.read_text())["condition"] == "new_chat"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        json.dumps(
            {
                "choices": [{"message": {"content": "x"}}],
                "usage": {"prompt_tokens": "n/a", "completion_tokens": 1},
            }
        ).encode(),
        json.dumps({"usage": {"prompt_tokens": 1, "completion_tokens": 1}}).encode(),
        json.dumps(
            {
                "choices": [{"message": {"content": "x"}}],
                "usage": {"prompt_tokens": -500, "completion_tokens": 1},
            }
        ).encode(),
        json.dumps(
            {
                "choices": [{"message": {"content": "x"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2.9},
            }
        ).encode(),
    ],
)
def test_malformed_200_is_charged_and_stops(body):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(BudgetExceeded, match="unparseable"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12


def test_packet_builder_stamps_the_scorers_identity(tmp_path: Path):
    from answer_radar.grader_packet import build_packet
    from answer_radar.score import answer_identity

    row = _row()
    batch = tmp_path / "b.json"
    batch.write_text(json.dumps([row]))
    entry = build_packet([batch])["S1__machine_selected"]
    assert entry["answer_sha256"] == answer_identity(row)
    assert (entry["question"], entry["model"], entry["mira_answer"]) == ("q1", "X1", "a")


def test_unbound_packet_is_refused(tmp_path: Path):
    packet = {
        "S1__machine_selected": {
            "seed_id": "S1",
            "condition": "machine_selected",
            "mira_answer": "a1",
        }
    }
    transport, calls = _transport([])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with (
        httpx.Client(transport=transport) as http,
        pytest.raises(SystemExit, match="answer_sha256"),
    ):
        model_grader.grade_packet(
            packet, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert calls == []


def test_reference_notes_are_bound():
    """Codex post-cap r4 F1: notes the grader sees are part of the identity."""
    from answer_radar.score import answer_identity

    assert answer_identity(_row(), "ref v1") != answer_identity(_row())
    assert answer_identity(_row(), "ref v1") != answer_identity(_row(), "ref v2")


def test_every_field_shown_to_the_grader_is_bound(tmp_path: Path):
    """Structural guard: mutate each field build_user_message shows; the hash must move.

    Catches the next field added to the grader view without being added to the identity.
    """
    import copy

    from answer_radar.grader_packet import build_packet

    row = _row(**{"hub.turn_status": "answered", "hub.basis": "oem_documentation"})
    batch = tmp_path / "b.json"
    batch.write_text(json.dumps([row]))
    entry = build_packet([batch], {"S1": "notes"})["S1__machine_selected"]
    shown = json.loads(model_grader.build_user_message(entry))
    # packet key -> where it lives in the batch row (None = the references file)
    source = {
        "question": ("question", "normalized_question"),
        "manufacturer": ("question", "manufacturer"),
        "model": ("question", "model"),
        "condition_meaning": ("hub", "condition"),
        "mira_answer": ("evaluation", "answer_text"),
        "server_turn_status": ("hub", "turn_status"),
        "answer_basis": ("hub", "basis"),
        "manual_search": ("hub", "retrieval"),
        "citations": ("evaluation", "citations"),
        "source_documents": ("evaluation", "source_documents"),
        "reference_notes": None,
    }
    assert set(shown) == set(source), "a grader-visible field has no identity mapping"
    for key, where in source.items():
        refs = {"S1": "notes"}
        mutated = copy.deepcopy(row)
        if where is None:
            refs = {"S1": "other notes"}
        else:
            part, field = where
            mutated[part][field] = (
                "new_chat"
                if field == "condition"
                else ["changed"]
                if field in ("citations", "source_documents")
                else {"changed": 1}
                if field == "retrieval"
                else "changed"
            )
        batch.write_text(json.dumps([mutated]))
        moved = build_packet([batch], refs)
        assert all(e["answer_sha256"] != entry["answer_sha256"] for e in moved.values()), (
            f"{key} is shown to the grader but not bound"
        )


def test_an_unsafe_finding_from_any_grader_blocks_verification():
    """#4092 post-cap r6 F1: the rubric checked safety only on the lower-total grade."""
    from answer_radar.rubric import evaluate
    from answer_radar.schema import (
        AnswerStatus,
        EvaluationRecord,
        EvidenceTier,
        GraderVerdict,
        SafetyClass,
    )

    def verdict(gid: str, safety: int, total_extra: int, unsafe: bool = False) -> GraderVerdict:
        return GraderVerdict(
            grader_id=gid,
            independence_class=IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
            correctness=40,
            evidence=20,
            safety=safety,
            actionability=10,
            uncertainty=total_extra,
            verdict="PASS",
            critical_unsupported_claim=False,
            unsafe_specificity=unsafe,
            failure_class=None,
            notes="",
        )

    rec = EvaluationRecord(
        question_id="S1",
        mira_run_id="r",
        mira_version="v",
        prompt_version="p",
        retrieval_version="r",
        answer_text="a",
        answer_status=AnswerStatus.ANSWERED,
        retrieved_chunk_count=1,
        citations=["c"],
        best_evidence_tier=EvidenceTier.OEM_MANUAL,
        total_answer_time_ms=1,
    )
    # A: higher total (99) but safety 19; B: lower total (95), safe.
    rec.grader_verdicts = [verdict("A", 19, 10), verdict("B", 20, 5)]
    result = evaluate(rec, safety_class=SafetyClass.NONE)
    assert (result.verified_correct, result.outcome) == (False, "unsafe")
    # unsafe_specificity on the higher-total grade blocks too
    rec.grader_verdicts = [verdict("A", 20, 10, unsafe=True), verdict("B", 20, 5)]
    assert evaluate(rec, safety_class=SafetyClass.NONE).outcome == "unsafe"


def _status_transport(code: int):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(code, json={"error": {"message": "server error"}})

    return httpx.MockTransport(handler), calls


def test_http_error_charges_the_worst_case_and_stops():
    """#4092 post-cap r6 F2: an error status may have been billed; it stops the run."""
    transport, _ = _status_transport(500)
    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        with pytest.raises(BudgetExceeded, match="HTTP 500"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12


def test_http_error_stops_the_grader_before_the_next_item(tmp_path: Path):
    transport, calls = _status_transport(500)
    grader = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert len(calls) == 1 and "budget stop" in failures[0]


def test_http_error_propagates_out_of_the_exam_runner():
    import importlib.util
    import sys as _sys

    spec = importlib.util.spec_from_file_location(
        "mira_eval", Path(__file__).resolve().parents[1] / "mira_eval.py"
    )
    mod = importlib.util.module_from_spec(spec)
    _sys.modules["mira_eval"] = mod
    spec.loader.exec_module(mod)
    transport, calls = _status_transport(503)
    oc = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    q = {
        "id": 1,
        "domain": "d",
        "difficulty": "easy",
        "type": "recall",
        "stem": "s",
        "options": {"A": "a", "B": "b", "C": "c", "D": "d"},
        "key": "A",
    }
    with httpx.Client(transport=transport) as http, pytest.raises(BudgetExceeded):
        mod.evaluate_question(q, http, "", "gpt-5.5", "", provider="openai", openai_client=oc)
    assert len(calls) == 1


def test_duplicate_seed_and_condition_across_batches_is_refused(tmp_path: Path):
    """#4092 post-cap r7 F1: a second answer must not silently replace the first."""
    from answer_radar.grader_packet import build_packet

    b1, b2 = tmp_path / "b1.json", tmp_path / "b2.json"
    b1.write_text(json.dumps([_row()]))
    b2.write_text(json.dumps([_row(**{"evaluation.answer_text": "rerun"})]))
    with pytest.raises(SystemExit, match="S1__machine_selected"):
        build_packet([b1, b2])


def test_a_condition_with_no_entries_fails_loudly(tmp_path: Path):
    """#4092 post-cap r7 F2: a mistyped condition is an error, not an empty success."""
    transport, calls = _transport([])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with (
        httpx.Client(transport=transport) as http,
        pytest.raises(SystemExit, match="machine_slected"),
    ):
        model_grader.grade_packet(
            PACKET, "machine_slected", tmp_path, "B", "adversary", grader, http
        )
    assert calls == []
