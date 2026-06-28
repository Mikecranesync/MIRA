"""Tests for the engine→AnswerTrace bridge (Phase 1 tracing, Phase 3 checks).

Covers build_answer_trace shaping, the MIRA_LOCAL_TRACE gating/fail-open of
emit_local_trace, and the opt-in governance/incident checks. No engine, no
network — deterministic.
"""

from __future__ import annotations

from pathlib import Path

from shared.observe.approval_registry import ApprovalRegistry
from shared.observe.from_engine import build_answer_trace, emit_local_trace
from shared.observe.trace import (
    ALL_STEPS,
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_VALIDATE_ANSWER,
    read_jsonl,
)

_APPROVALS = (
    Path(__file__).resolve().parents[2]
    / "simlab"
    / "observe"
    / "evalpacks"
    / "approvals.example.json"
)

_UNS = {
    "uns_path": "enterprise.plant1.packaging.line2.conv_belt_01",
    "source": "direct_connection",
    "confidence": "certified",
    "asset": "conv_belt_01",
}


def _turn(**over):
    base = dict(
        question="Why did the conveyor stop?",
        reply="Physical jam on the belt. [Source: troubleshooting.md]",
        platform="ignition",
        tenant_id="t-123",
        uns_context=_UNS,
        tag_evidence=[
            {"uns_path": "conv_belt_01.running", "value": False},
            "vfd_gs20_01.output_amps",
        ],
        manual_sources=["troubleshooting.md chunk: clear the jam ...", {"doc": "fault_code_table.md"}],
        confidence="high",
        model_used="groq/llama",
        latency_ms=2300,
        outcome="resolved",
    )
    base.update(over)
    return base


class TestBuildAnswerTrace:
    def test_maps_core_fields(self):
        t = build_answer_trace(**_turn())
        assert t.mode == "live"
        assert t.tenant_id == "t-123"
        assert t.asset_uns_path == _UNS["uns_path"]
        assert t.uns_source == "direct_connection"
        assert t.confidence == "high"
        assert t.model_used == "groq/llama"
        assert t.total_latency_ms == 2300
        assert t.citations == ["[Source: troubleshooting.md]"]

    def test_seven_steps_in_canonical_order(self):
        t = build_answer_trace(**_turn())
        assert [s.name for s in t.steps] == ALL_STEPS

    def test_generate_answer_carries_total_latency(self):
        t = build_answer_trace(**_turn())
        gen = next(s for s in t.steps if s.name == STEP_GENERATE_ANSWER)
        assert gen.duration_is_total is True
        assert gen.duration_ms == 2300

    def test_steps_marked_reconstructed(self):
        t = build_answer_trace(**_turn())
        assert all(s.output.get("reconstructed") for s in t.steps)

    def test_tags_from_mixed_evidence(self):
        t = build_answer_trace(**_turn())
        assert "conv_belt_01.running" in t.tags_used
        assert "vfd_gs20_01.output_amps" in t.tags_used

    def test_documents_shaped_from_sources(self):
        t = build_answer_trace(**_turn())
        assert len(t.documents_retrieved) == 2
        assert t.documents_retrieved[1]["doc"] == "fault_code_table.md"

    def test_defensive_on_empty(self):
        t = build_answer_trace(question="q", reply="")
        assert [s.name for s in t.steps] == ALL_STEPS
        assert t.documents_retrieved == []
        assert t.tags_used == []


class TestEmitLocalTrace:
    def test_no_op_when_disabled(self, monkeypatch):
        monkeypatch.delenv("MIRA_LOCAL_TRACE", raising=False)
        assert emit_local_trace(**_turn()) is None

    def test_writes_jsonl_when_enabled(self, monkeypatch, tmp_path: Path):
        monkeypatch.setenv("MIRA_LOCAL_TRACE", "1")
        monkeypatch.setenv("MIRA_TRACE_DIR", str(tmp_path))
        path = emit_local_trace(**_turn())
        assert path is not None and path.exists()
        rows = read_jsonl(path)
        assert len(rows) == 1
        assert rows[0]["asset_uns_path"] == _UNS["uns_path"]
        assert rows[0]["mode"] == "live"

    def test_fail_open_on_bad_input(self, monkeypatch, tmp_path: Path):
        monkeypatch.setenv("MIRA_LOCAL_TRACE", "1")
        monkeypatch.setenv("MIRA_TRACE_DIR", str(tmp_path))
        # uns_context of the wrong type would break naive .get() — must not raise.
        result = emit_local_trace(question="q", reply="r", uns_context="not-a-dict")
        # Either it wrote nothing (None) or wrote a row — but it never raises.
        assert result is None or result.exists()


class TestPhase3Checks:
    """Governance + incident checks run only when a registry is supplied."""

    def test_no_registry_defers_checks(self):
        t = build_answer_trace(**_turn())
        gov = next(s for s in t.steps if s.name == STEP_CHECK_GOVERNANCE)
        assert gov.status == "skipped"
        assert gov.output.get("checks") == "deferred_to_phase_3"
        assert t.warnings == []

    def test_registry_runs_checks_clean(self):
        # asset + docs approved → no governance warnings, approved-context-only true.
        reg = ApprovalRegistry.load(_APPROVALS)
        turn = _turn(
            reply="Physical jam on the belt. [Source: troubleshooting.md]",
            manual_sources=[{"doc": "troubleshooting.md"}],
        )
        t = build_answer_trace(registry=reg, **turn)
        gov = next(s for s in t.steps if s.name == STEP_CHECK_GOVERNANCE)
        assert gov.status == "ok"
        assert t.used_approved_context_only is True
        # fault_code_table not retrieved here → no stale warning
        assert "unapproved_asset" not in t.warning_codes()

    def test_registry_flags_unapproved_asset(self):
        reg = ApprovalRegistry.load(_APPROVALS)
        turn = _turn(uns_context={"uns_path": "enterprise.evil.unknown", "source": "x"})
        t = build_answer_trace(registry=reg, **turn)
        assert "unapproved_asset" in t.warning_codes()
        gov = next(s for s in t.steps if s.name == STEP_CHECK_GOVERNANCE)
        assert gov.status == "warn"

    def test_registry_flags_stale_document(self):
        reg = ApprovalRegistry.load(_APPROVALS)
        # fault_code_table.md is intentionally stale in the example approvals.
        turn = _turn(manual_sources=[{"doc": "fault_code_table.md"}])
        t = build_answer_trace(registry=reg, **turn)
        assert "stale_document" in t.warning_codes()
        val = next(s for s in t.steps if s.name == STEP_VALIDATE_ANSWER)
        assert "stale_document" in val.output.get("incidents", [])

    def test_empty_registry_governs_closed(self):
        reg = ApprovalRegistry.empty()
        t = build_answer_trace(registry=reg, **_turn())
        assert "unapproved_asset" in t.warning_codes()
        assert t.used_approved_context_only is False


class TestApprovalSources:
    def test_registry_or_none_disabled(self, monkeypatch):
        from shared.observe import approval_sources

        monkeypatch.delenv("MIRA_TRACE_CHECKS", raising=False)
        assert approval_sources.registry_or_none() is None

    def test_registry_or_none_enabled_loads_path(self, monkeypatch):
        from shared.observe import approval_sources

        approval_sources._clear_cache()
        monkeypatch.setenv("MIRA_TRACE_CHECKS", "1")
        monkeypatch.setenv("MIRA_APPROVALS_PATH", str(_APPROVALS))
        reg = approval_sources.registry_or_none()
        assert reg is not None
        assert reg.asset_approved(_UNS["uns_path"])

    def test_registry_or_none_enabled_no_path_is_empty(self, monkeypatch):
        from shared.observe import approval_sources

        monkeypatch.setenv("MIRA_TRACE_CHECKS", "1")
        monkeypatch.delenv("MIRA_APPROVALS_PATH", raising=False)
        reg = approval_sources.registry_or_none()
        assert reg is not None
        assert not reg.asset_approved(_UNS["uns_path"])
