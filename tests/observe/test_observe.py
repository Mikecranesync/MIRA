"""Tests for the observability + evaluation layer (simlab/observe).

Pure-function coverage of the trace assembly, approval registry, governance
gates, incident detectors, eval-pack validation, the mock harness, and the
end-to-end mock eval run. No engine, no network, no Doppler — deterministic.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from shared.observe.approval_registry import ApprovalRegistry, DocumentApproval
from shared.observe.checks import run_governance, run_incidents
from shared.observe.trace import (
    ALL_STEPS,
    AnswerTrace,
    Warning,
    citations_present_in,
    extract_citations,
    read_jsonl,
)
from simlab.observe.evalset import EvalPackError, load_pack, parse_pack
from simlab.observe.harness import AskContext, MockAnswerer, trace_answer

_PACK = (
    Path(__file__).resolve().parents[2] / "simlab" / "observe" / "evalpacks" / "conveyor_demo.yaml"
)
_APPROVALS = _PACK.parent / "approvals.example.json"

_ASSET = "enterprise.plant1.packaging.line2.conv_belt_01"


def _registry() -> ApprovalRegistry:
    return ApprovalRegistry.load(_APPROVALS)


# --- trace ------------------------------------------------------------------


class TestTrace:
    def test_citations_present_and_extract(self):
        assert citations_present_in("foo [Source: troubleshooting.md] bar")
        assert citations_present_in("see [1] for detail")
        assert not citations_present_in("no citation here")
        assert extract_citations("[Source: a.md] x [Source: a.md] [2]") == [
            "[Source: a.md]",
            "[2]",
        ]

    def test_step_timer_records_status_and_duration(self):
        t = AnswerTrace(trace_id="x", question="q")
        with t.step("s1", a=1) as s:
            s.output = {"ok": True}
        assert len(t.steps) == 1
        step = t.steps[0]
        assert step.name == "s1"
        assert step.status == "ok"
        assert step.duration_ms is not None
        assert step.input == {"a": 1}

    def test_step_timer_captures_exception(self):
        t = AnswerTrace(trace_id="x", question="q")
        with pytest.raises(ValueError):
            with t.step("boom"):
                raise ValueError("nope")
        assert t.steps[0].status == "error"
        assert "nope" in t.steps[0].error

    def test_jsonl_roundtrip(self, tmp_path: Path):
        t = AnswerTrace(trace_id="abc", question="why?", answer="because [1]")
        t.citations = extract_citations(t.answer)
        t.add_warning(Warning(code="missing_citation", message="m"))
        p = t.write_jsonl(tmp_path / "tr.jsonl")
        rows = read_jsonl(p)
        assert len(rows) == 1
        assert rows[0]["trace_id"] == "abc"
        assert rows[0]["warnings"][0]["code"] == "missing_citation"
        # serialises as valid JSON
        json.loads(t.to_json())


# --- approval registry ------------------------------------------------------


class TestApprovalRegistry:
    def test_asset_approved_by_path_and_bare_id(self):
        r = _registry()
        assert r.asset_approved(_ASSET)
        assert r.asset_approved("conv_belt_01")  # bare id tolerated
        assert not r.asset_approved("enterprise.other.asset")

    def test_document_approval_and_stale(self):
        r = _registry()
        assert r.document_approved("troubleshooting.md")
        # fault_code_table.md is updated AFTER embeddings refreshed → stale
        assert r.document("fault_code_table.md").is_stale()
        assert not r.document("troubleshooting.md").is_stale()

    def test_mapping_status(self):
        r = _registry()
        assert r.mapping_status(_ASSET, "troubleshooting.md") == "approved"
        assert r.mapping_status(_ASSET, "unmapped.md") == "proposed"

    def test_empty_registry_governs_closed(self):
        r = ApprovalRegistry.empty()
        assert not r.asset_approved(_ASSET)
        assert not r.document_approved("troubleshooting.md")

    def test_stale_logic_unit(self):
        fresh = DocumentApproval(
            "d",
            approved=True,
            updated_at="2026-01-01T00:00:00Z",
            embeddings_refreshed_at="2026-02-01T00:00:00Z",
        )
        stale = DocumentApproval(
            "d",
            approved=True,
            updated_at="2026-03-01T00:00:00Z",
            embeddings_refreshed_at="2026-02-01T00:00:00Z",
        )
        assert not fresh.is_stale()
        assert stale.is_stale()


# --- governance gates -------------------------------------------------------


def _trace(
    answer: str, *, asset: str = _ASSET, docs=None, confidence="medium", question="why?"
) -> AnswerTrace:
    t = AnswerTrace(trace_id="t", question=question)
    t.asset_uns_path = asset
    t.asset = asset.split(".")[-1]
    t.answer = answer
    t.confidence = confidence
    t.citations = extract_citations(answer)
    t.documents_retrieved = [{"doc": d} for d in (docs or [])]
    return t


class TestGovernance:
    def test_clean_answer_passes_all_gates(self):
        t = _trace("Inspect the belt. [Source: troubleshooting.md]", docs=["troubleshooting.md"])
        assert run_governance(t, _registry()) == []

    def test_unapproved_asset(self):
        t = _trace("ok [1]", asset="enterprise.nope.x")
        codes = [w.code for w in run_governance(t, _registry())]
        assert "unapproved_asset" in codes

    def test_missing_citation_gate(self):
        t = _trace("the belt is jammed", docs=["troubleshooting.md"])
        codes = [w.code for w in run_governance(t, _registry())]
        assert "missing_citation" in codes

    def test_unapproved_document(self):
        t = _trace("ok [1]", docs=["random_unapproved.md"])
        codes = [w.code for w in run_governance(t, _registry())]
        assert "unapproved_document" in codes

    def test_safety_review_missing(self):
        t = _trace("Just reach in while energized [1]", question="clear jam while energized?")
        codes = [w.code for w in run_governance(t, _registry())]
        assert "safety_review_missing" in codes

    def test_safety_with_review_warning_ok(self):
        t = _trace(
            "De-energize and apply lockout; a qualified tech must verify [1]",
            question="clear jam while energized?",
        )
        codes = [w.code for w in run_governance(t, _registry())]
        assert "safety_review_missing" not in codes


# --- incident detectors -----------------------------------------------------


class TestIncidents:
    def test_stale_document(self):
        t = _trace("ok [1]", docs=["fault_code_table.md"])
        codes = [w.code for w in run_incidents(t, _registry())]
        assert "stale_document" in codes

    def test_unsupported_maintenance_advice(self):
        t = _trace("Replace the photoeye now")  # advice, no citation
        codes = [w.code for w in run_incidents(t, _registry())]
        assert "unsupported_maintenance_advice" in codes
        assert "missing_citation" in codes

    def test_advice_with_citation_is_supported(self):
        t = _trace("Replace the photoeye [Source: troubleshooting.md]", docs=["troubleshooting.md"])
        codes = [w.code for w in run_incidents(t, _registry())]
        assert "unsupported_maintenance_advice" not in codes

    def test_low_confidence_presented_as_fact(self):
        t = _trace("Replace the drive board immediately. [1]", confidence="low")
        codes = [w.code for w in run_incidents(t, _registry())]
        assert "low_confidence_presented_as_fact" in codes

    def test_low_confidence_with_hedge_ok(self):
        t = _trace("You might want to inspect the belt; verify first. [1]", confidence="low")
        codes = [w.code for w in run_incidents(t, _registry())]
        assert "low_confidence_presented_as_fact" not in codes

    def test_wrong_asset_selected(self):
        t = _trace("ok [1]")
        codes = [
            w.code
            for w in run_incidents(t, _registry(), expected_asset="enterprise.x.y.other_asset")
        ]
        assert "wrong_asset_selected" in codes


# --- eval pack validation ---------------------------------------------------


class TestEvalSet:
    def test_load_demo_pack(self):
        items = load_pack(_PACK)
        assert len(items) == 9
        assert items[0].id == "conveyor_why_stopped"
        assert items[0].expected_asset == _ASSET

    def test_missing_required_key_raises(self):
        with pytest.raises(EvalPackError) as e:
            parse_pack([{"question": "q"}])  # missing id + expected_asset
        assert "expected_asset" in str(e.value)

    def test_bad_severity_raises(self):
        with pytest.raises(EvalPackError):
            parse_pack([{"id": "a", "question": "q", "expected_asset": "x", "severity": "bogus"}])

    def test_duplicate_id_raises(self):
        with pytest.raises(EvalPackError):
            parse_pack(
                [
                    {"id": "a", "question": "q", "expected_asset": "x"},
                    {"id": "a", "question": "q2", "expected_asset": "y"},
                ]
            )

    def test_safety_item_is_blocking(self):
        items = {i.id: i for i in load_pack(_PACK)}
        assert items["jam_clear_while_energized_negative"].is_blocking
        assert not items["conveyor_why_stopped"].is_blocking


# --- harness (mock) ---------------------------------------------------------


class TestHarness:
    def test_trace_answer_produces_seven_steps(self):
        ctx = AskContext(
            asset="conv_belt_01", asset_uns_path=_ASSET, documents=[{"doc": "troubleshooting.md"}]
        )
        answerer = MockAnswerer("Inspect the belt for a jam. [Source: troubleshooting.md]")
        t = trace_answer("why stopped?", ctx, answerer, _registry(), mode="mock")
        assert [s.name for s in t.steps] == ALL_STEPS
        assert t.answer.startswith("Inspect")
        assert t.used_approved_context_only is True
        assert t.warnings == []  # clean

    def test_generate_answer_marked_total_latency(self):
        ctx = AskContext(asset_uns_path=_ASSET)
        t = trace_answer("q", ctx, MockAnswerer("a [1]"), _registry())
        gen = next(s for s in t.steps if s.name == "generate_answer")
        assert gen.duration_is_total is True

    def test_unsafe_answer_flags_governance(self):
        ctx = AskContext(asset_uns_path=_ASSET)
        answerer = MockAnswerer("Yes, reach in while it's energized.")
        t = trace_answer("clear jam while energized?", ctx, answerer, _registry())
        assert t.has_warning("safety_review_missing")


# --- end-to-end mock eval ---------------------------------------------------


class TestRunEval:
    def test_demo_pack_runs_mock(self, tmp_path: Path):
        from simlab.observe.run_eval import run

        report = run("conveyor_demo", mode="mock", json_out=tmp_path / "report.json")
        s = report["summary"]
        assert s["total"] == 9
        assert s["passed"] == 7
        assert s["failed"] == 2
        assert s["asset_selection_accuracy"] == 1.0
        # the two negatives are localised
        failed = [i for i in report["items"] if i["status"] == "fail"]
        assert {i["id"] for i in failed} == {
            "conveyor_why_stopped_negative",
            "jam_clear_while_energized_negative",
        }
        assert (tmp_path / "report.json").exists()
