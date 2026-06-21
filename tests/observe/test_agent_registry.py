"""Tests for the preformatted industrial agent template registry.

Covers: manifest load + validation, the read-only invariant (a write-capable
manifest is rejected at load), keyword routing, the observational output-contract
check, and the end-to-end landing of agent_id/version/risk on a live AnswerTrace
via build_answer_trace.
"""

from __future__ import annotations

import pytest

from shared.observe.agent_checks import run_agent_contract
from shared.observe.agent_registry import (
    DEFAULT_AGENT_ID,
    AgentManifest,
    AgentManifestError,
    all_manifests,
    get_manifest,
    is_write_tool,
    load_registry,
    route_agent,
)
from shared.observe.from_engine import build_answer_trace
from shared.observe.trace import AnswerTrace


# --- manifest loading + validation -----------------------------------------


def test_registry_loads_the_three_starter_agents():
    reg = load_registry()
    assert DEFAULT_AGENT_ID in reg
    assert "root_cause_analysis" in reg
    assert "manual_qa" in reg
    assert {m.id for m in all_manifests()} >= {
        "maintenance_troubleshooter",
        "root_cause_analysis",
        "manual_qa",
    }


def test_every_loaded_manifest_is_read_only():
    for m in all_manifests():
        assert all(not is_write_tool(t) for t in m.allowed_tools), m.id


@pytest.mark.parametrize(
    "tool,expected",
    [
        ("plc.write", True),
        ("tag.write", True),
        ("machine.reset", True),
        ("work_order.submit_without_review", True),
        ("cmms.close_work_order", True),
        ("safety_bypass", True),
        ("documents.search", False),
        ("tags.read_current", False),
        ("context_graph.query", False),
        ("historian.query_window", False),
    ],
)
def test_is_write_tool(tool, expected):
    assert is_write_tool(tool) is expected


def test_manifest_allowing_a_write_tool_is_rejected():
    with pytest.raises(AgentManifestError):
        AgentManifest.from_dict(
            {
                "id": "rogue",
                "name": "Rogue",
                "version": "0.1.0",
                "scope": "writes things",
                "allowed_tools": ["documents.search", "plc.write"],
            }
        )


def test_manifest_requires_core_fields():
    with pytest.raises(AgentManifestError):
        AgentManifest.from_dict({"id": "x", "name": "X", "version": "0.1.0"})


def test_manifest_rejects_unknown_risk_level():
    with pytest.raises(AgentManifestError):
        AgentManifest.from_dict(
            {"id": "x", "name": "X", "version": "0.1.0", "scope": "s", "risk_level": "extreme"}
        )


# --- routing ---------------------------------------------------------------


def test_routing_defaults_to_troubleshooter():
    m = route_agent("the conveyor is stopped, what's wrong?")
    assert m is not None
    assert m.id == DEFAULT_AGENT_ID


def test_routing_to_rca_on_causal_question():
    m = route_agent("why did the conveyor fail this morning?")
    assert m is not None
    assert m.id == "root_cause_analysis"


def test_routing_to_manual_qa_on_doc_lookup():
    m = route_agent("what does the manual say is the rated torque?")
    assert m is not None
    assert m.id == "manual_qa"


def test_routing_handles_empty_question():
    m = route_agent("")
    assert m is not None  # falls back to default, never crashes


# --- output-contract check (observational) ---------------------------------


def test_contract_flags_missing_citations_and_human_review():
    manifest = get_manifest("maintenance_troubleshooter")
    trace = AnswerTrace(trace_id="t1", question="q", answer="Replace the motor now.", confidence="high")
    codes = {w.code for w in run_agent_contract(trace, manifest)}
    assert "agent_output_missing_citations" in codes
    assert "agent_output_missing_human_review" in codes


def test_contract_satisfied_when_outputs_present():
    manifest = get_manifest("manual_qa")  # risk=low, requires answer+citations
    trace = AnswerTrace(
        trace_id="t2",
        question="q",
        answer="The rated torque is 12 Nm [Source: manual.pdf p4].",
        confidence="high",
    )
    codes = {w.code for w in run_agent_contract(trace, manifest)}
    assert "agent_output_missing_citations" not in codes


def test_contract_records_unverifiable_outputs_for_rca():
    manifest = get_manifest("root_cause_analysis")
    trace = AnswerTrace(trace_id="t3", question="q", answer="[Source: x] verify with supervisor", confidence="low")
    codes = {w.code for w in run_agent_contract(trace, manifest)}
    # RCA declares timeline/ranked_hypotheses/etc — not free-text-verifiable.
    assert "agent_output_declared_unverified" in codes


# --- end-to-end: agent label lands on a live trace -------------------------


def test_build_answer_trace_tags_agent_fields():
    trace = build_answer_trace(
        question="why did the line go down?",
        reply="The evidence suggests a blocked photoeye [Source: io_map.pdf].",
        platform="telegram",
        confidence="medium",
    )
    assert trace.agent_id == "root_cause_analysis"
    assert trace.agent_version == "0.1.0"
    assert trace.agent_risk_level == "medium"
    assert "documents.search" in trace.agent_allowed_tools


def test_build_answer_trace_default_agent_for_plain_status_question():
    trace = build_answer_trace(
        question="is the conveyor running?",
        reply="It appears stopped.",
        platform="slack",
    )
    assert trace.agent_id == DEFAULT_AGENT_ID
