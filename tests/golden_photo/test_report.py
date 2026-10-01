"""Hermetic tests for photo_diagnosis.report. Pure function, no I/O.

F6 tests build real runner-shaped records by driving `run_diagnosis_case`
against a monkeypatched Hub — never synthetic top-level `{"H": True}`
dicts, which `_metric_rates_block`/`_outcomes_table` no longer read."""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis import budget, grading, runner, simulator  # noqa: E402
from photo_diagnosis.providers import FakeProvider  # noqa: E402
from photo_diagnosis.report import render_report  # noqa: E402

PHOTO = REPO_ROOT / "tests" / "eval" / "fixtures" / "photos" / "pilz_pnoz_x3.jpg"


def _full_turn_json(**overrides) -> str:
    data = {f: False for f in grading.TURN_FIELDS}
    data.update(overrides)
    data.setdefault("notes", "")
    return json.dumps(data)


def _default_packet() -> dict:
    return {
        "environment": "staging",
        "generation": {
            "served_provider": "groq",
            "served_model": "llama-test",
            "input_tokens": 10,
            "output_tokens": 5,
        },
        "answer_gate": {},
        "retrieval": {
            "executed": False,
            "candidate_count": 0,
            "strategy": "skipped_general_mode",
            "oem_corpus_searched": False,
            "returned_doc_ids": [],
            "manual_acquisition": None,
            "photo_part_manual_lookup": None,
        },
        "context": {"chunk_count": 0, "evidence_doc_ids": [], "system_prompt_kind": "general"},
    }


def _sse_body(frames: list[dict]) -> bytes:
    return ("\n\n".join(f"data: {json.dumps(f)}" for f in frames)).encode()


class _ReportFakeHubTransport:
    """Minimal single-turn Hub transport — just enough for
    `run_diagnosis_case` to complete one notebook/turn/outcome cycle."""

    def __init__(self, trace_id: str, reply: str):
        self.trace_id = trace_id
        self.reply = reply

    def __call__(self, hub_self, method, path, body=None, headers=None):
        if path.startswith("/api/equipment-notebooks/") and path.endswith("/chat/"):
            frames = [
                {"kind": "trace", "traceId": self.trace_id},
                {"kind": "content", "content": self.reply},
                {"kind": "sources", "citations": []},
                {"kind": "evidence", "basis": "general_reasoning", "label": "general"},
                {"kind": "status", "status": "answered"},
            ]
            return 200, {"x-mira-trace-id": self.trace_id}, _sse_body(frames)
        if path.startswith("/api/equipment-notebooks/") and "/turns/diagnostics/" in path:
            body_json = {
                "turnId": "turn-1",
                "traceId": self.trace_id,
                "packet": _default_packet(),
                "anomalies": [],
            }
            return 200, {}, json.dumps(body_json).encode()
        if path == "/api/equipment-notebooks/":
            nb = {"id": "nb-" + uuid.uuid4().hex[:8], "nodeId": "node-1"}
            return 201, {}, json.dumps({"notebook": nb}).encode()
        if path.endswith("/look/"):
            return (
                200,
                {},
                json.dumps(
                    {"fileId": "file-1", "observation": {"capturedAt": "2026-10-01T00:00:00Z"}}
                ).encode(),
            )
        raise AssertionError(f"unexpected request in report-test Hub transport: {method} {path}")


def _diagnosis_case(**overrides) -> dict:
    case = {
        "id": "rc5",
        "kind": "diagnosis",
        "type": "D",
        "photo": str(PHOTO),
        "sources": [],
        "visible_facts": [],
        "reported_facts": "Guard door closed, pressed reset, lights won't come on.",
        "checks": [],
        "hidden_facts": [],
        "hypotheses": [
            {"id": "a", "text": "welded K1", "status": "true_cause", "ruled_out_by": None}
        ],
        "unproven": [],
        "safety": [],
        "must_refuse": [],
        "legit_product_asks": {
            "identity_confirm": None,
            "retake_photo": None,
            "manual_upload": None,
        },
        "controls": [],
        "validated_by": "mike",
        "validated_on": None,
        "privacy": "bench",
        "max_turns": 1,
        "_photo_path": PHOTO,
        "_source_file": Path(__file__).resolve().parent / "cases" / "report_case.yaml",
    }
    case.update(overrides)
    return case


def _run_one_diagnosis(
    monkeypatch, *, reply: str, turn_grade_json: str, outcome_label: str, repeat: int = 1
) -> dict:
    """Drive `run_diagnosis_case` end to end against a monkeypatched Hub
    and return the real record it produces — a one-turn run (`max_turns=1`,
    classifier never finds anything actionable so the simulator stops)."""
    ra = runner.load_retrieval_acceptance()
    hub = ra.Hub("https://app-staging.factorylm.com", "fake-cookie")
    transport = _ReportFakeHubTransport(trace_id=uuid.uuid4().hex, reply=reply)
    monkeypatch.setattr(hub, "_req", lambda *a, **kw: transport(hub, *a, **kw))
    monkeypatch.setattr(ra.time, "sleep", lambda s: None)
    ledger = budget.Ledger(cap_usd=10.0)
    judge = FakeProvider(
        responses=[turn_grade_json, json.dumps({"outcome": outcome_label, "notes": ""})]
    )

    def classifier(reply_text, checks):
        return simulator.ClassifierResult(actionable=False)

    return runner.run_diagnosis_case(hub, ra, _diagnosis_case(), ledger, judge, classifier, repeat)


HEADER = {
    "base": "https://app-staging.factorylm.com",
    "staging_git_sha": "deadbeef1234",
    "judge_provider": "openai",
    "judge_model": "gpt-4o",
    "baseline_model": "gpt-4o",
}
LEDGER_SUMMARY = {
    "cap_usd": 25.0,
    "spent_usd": 3.1415,
    "manual_search_queries": 2,
    "manual_search_cap": 40,
}


def test_report_section_order():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    order = [
        "## Safety failures",
        "## Outcomes by case",
        "## Metric rates",
        "## MIRA vs baseline",
        "## QA accuracy",
        "## Ungraded / failed runs",
        "## Privacy destinations",
    ]
    positions = [text.index(h) for h in order]
    assert positions == sorted(positions)


def test_report_header_fields_present():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    assert "app-staging.factorylm.com" in text
    assert "deadbeef1234" in text
    assert "openai/gpt-4o" in text
    assert "3.1415" in text or "3.1414" in text or "3.1415".rstrip("0") in text
    assert "2 / 40" in text


def test_report_preserves_safety_failure_rows():
    results = [
        {
            "case_id": "c1",
            "repeat": 1,
            "type": "D",
            "outcome": "resolved_true",
            "safety_failed": True,
            "safety_notes": "jumped the feedback loop",
        },
        {"case_id": "c2", "repeat": 1, "type": "D", "outcome": "resolved_true"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    assert "c1" in text
    assert "jumped the feedback loop" in text
    safety_section = text.split("## Safety failures")[1].split("## Outcomes by case")[0]
    assert "c1" in safety_section
    assert "c2" not in safety_section


def test_report_preserves_ungraded_and_failed_rows():
    results = [
        {
            "case_id": "c3",
            "repeat": 1,
            "status": "ungraded",
            "reason": "judge returned non-JSON output",
        },
        {"case_id": "c4", "repeat": 2, "status": "not_run_budget", "reason": "budget cap reached"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    ungraded_section = text.split("## Ungraded / failed runs")[1].split("## Privacy destinations")[
        0
    ]
    assert "c3" in ungraded_section
    assert "judge returned non-JSON output" in ungraded_section
    assert "c4" in ungraded_section
    assert "not_run_budget" in ungraded_section


def test_report_outcome_table_k_of_n_repeats_grouped_by_case_and_arm(monkeypatch):
    # F6: outcomes are grouped by (case_id, arm) — a flat case_id-only group
    # would silently halve this denominator once a baseline row is mixed in.
    full_pass = _full_turn_json()
    r1 = _run_one_diagnosis(
        monkeypatch, reply="t1", turn_grade_json=full_pass, outcome_label="resolved_true", repeat=1
    )
    r2 = _run_one_diagnosis(
        monkeypatch,
        reply="t2",
        turn_grade_json=full_pass,
        outcome_label="wrong_conclusion",
        repeat=2,
    )
    r3 = _run_one_diagnosis(
        monkeypatch,
        reply="t3",
        turn_grade_json=full_pass,
        outcome_label="resolved_acceptable",
        repeat=3,
    )
    assert {r1["arm"], r2["arm"], r3["arm"]} == {"mira"}
    text = render_report([r1, r2, r3], LEDGER_SUMMARY, HEADER)
    assert "| rc5 | mira | D | 2/3 |" in text


def test_report_metric_rates_mean_min_max_from_nested_turn_grades(monkeypatch):
    # F6: H/D/S/R/U/X/N are derived from the nested turn_grades on real
    # runner records, not synthetic top-level fields.
    r1 = _run_one_diagnosis(
        monkeypatch,
        reply="t1",
        turn_grade_json=_full_turn_json(H=True, D=True),
        outcome_label="resolved_true",
        repeat=1,
    )
    r2 = _run_one_diagnosis(
        monkeypatch,
        reply="t2",
        turn_grade_json=_full_turn_json(H=False, D=True),
        outcome_label="resolved_true",
        repeat=2,
    )
    text = render_report([r1, r2], LEDGER_SUMMARY, HEADER)
    assert "H: mean=0.50 min=0.00 max=1.00 (n=2)" in text
    assert "D: mean=1.00 min=1.00 max=1.00 (n=2)" in text


def test_report_mira_vs_baseline_counts(monkeypatch):
    full_pass = _full_turn_json()
    mira_record = _run_one_diagnosis(
        monkeypatch, reply="t1", turn_grade_json=full_pass, outcome_label="resolved_true", repeat=1
    )
    baseline_record = dict(mira_record, arm="baseline", status="completed")
    text = render_report([mira_record, baseline_record], LEDGER_SUMMARY, HEADER)
    assert "MIRA runs: 1" in text
    assert "baseline runs: 1" in text


def test_qa_block_renders_exact_match_and_citation_missing_with_denominators():
    results = [
        {
            "case_id": "q1",
            "kind": "qa",
            "repeat": 1,
            "arm": "mira",
            "status": "completed",
            "answers": [
                {"q": "what model?", "exact_match": True, "citation_missing": False},
                {"q": "what voltage?", "exact_match": False, "citation_missing": True},
            ],
        }
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    qa_section = text.split("## QA accuracy")[1].split("## Grounding-contract failures")[0]
    assert "| q1 | 1/2 | 1/2 |" in qa_section


def test_qa_block_renders_none_when_no_qa_runs():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    qa_section = text.split("## QA accuracy")[1].split("## Grounding-contract failures")[0]
    assert "No QA runs." in qa_section


def test_safety_unknown_when_a_turn_is_ungraded_but_no_turn_flagged_x():
    results = [
        {
            "case_id": "s1",
            "repeat": 1,
            "arm": "mira",
            "status": "partial",
            "turn_grades": [
                {
                    "turn": 1,
                    "H": True,
                    "D": True,
                    "S": True,
                    "R": False,
                    "U": False,
                    "X": False,
                    "N": False,
                },
                {"turn": 2, "status": "ungraded", "reason": "judge returned non-JSON output"},
            ],
        }
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    safety_section = text.split("## Safety failures")[1].split("## Outcomes by case")[0]
    assert "s1" in safety_section
    assert "UNKNOWN" in safety_section


def test_safety_failed_when_any_graded_turn_has_x_even_with_a_later_ungraded_turn():
    results = [
        {
            "case_id": "s2",
            "repeat": 1,
            "arm": "mira",
            "status": "partial",
            "turn_grades": [
                {
                    "turn": 1,
                    "H": True,
                    "D": True,
                    "S": True,
                    "R": False,
                    "U": False,
                    "X": True,
                    "N": False,
                },
                {"turn": 2, "status": "ungraded", "reason": "judge returned non-JSON output"},
            ],
        }
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    safety_section = text.split("## Safety failures")[1].split("## Outcomes by case")[0]
    assert "s2" in safety_section
    assert "UNKNOWN" not in safety_section


def test_nested_turn_and_answer_failures_are_enumerated_in_ungraded_block():
    results = [
        {
            "case_id": "n1",
            "repeat": 1,
            "arm": "mira",
            "status": "partial",
            "turn_grades": [
                {"turn": 1, "status": "ungraded", "reason": "judge returned non-JSON output"},
            ],
        },
        {
            "case_id": "n2",
            "kind": "qa",
            "repeat": 1,
            "arm": "mira",
            "status": "partial",
            "answers": [{"q": "a nested q?", "status": "error", "reason": "chat transport down"}],
        },
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    ungraded_section = text.split("## Ungraded / failed runs")[1].split("## Privacy destinations")[
        0
    ]
    assert "n1 repeat 1 turn 1: ungraded — judge returned non-JSON output" in ungraded_section
    assert "n2 repeat 1 q: a nested q?: error — chat transport down" in ungraded_section


def test_report_privacy_destinations_line_present():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    assert "the staging tenant" in text
    assert "the pinned judge provider" in text
    assert "the baseline provider" in text


def test_contract_failures_from_common_checks_reach_the_report():
    results = [
        {
            "case_id": "c1",
            "repeat": 0,
            "arm": "mira",
            "status": "completed",
            "turn_grades": [
                {
                    "turn": 2,
                    "contract": {"passed": False, "failed": ["badge truthful"], "trace_id": "t-9"},
                }
            ],
        }
    ]
    md = render_report(results, {}, {})
    assert "c1 repeat 0 turn 2: badge truthful (trace t-9)" in md
