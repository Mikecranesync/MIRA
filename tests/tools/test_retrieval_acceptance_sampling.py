"""retrieval_acceptance under turn sampling (#4107 review F5). No network."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "retrieval_acceptance", ROOT / "tools/qa/retrieval_acceptance.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

CRID = "11111111-2222-4333-8444-555555555555"
TRACE = "0af7651916cd43dd8448eb211c80319c"


def _hub(monkeypatch, packet_trace):
    hub = mod.Hub("https://stg.example", "cookie")
    calls = []

    def fake_json(method, path, body=None):
        calls.append(path)
        return 200, {}, {"traceId": packet_trace, "packet": {"environment": "staging"}}

    monkeypatch.setattr(hub, "json", fake_json)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    return hub, calls


@pytest.mark.parametrize("packet_trace", [TRACE, None])
def test_packet_is_found_by_client_request_id_sampled_or_not(monkeypatch, packet_trace):
    hub, calls = _hub(monkeypatch, packet_trace)
    d = hub.diagnostics("nb-1", CRID)
    assert d["packet"]["environment"] == "staging"
    assert calls == [f"/api/equipment-notebooks/nb-1/turns/diagnostics/?client_request_id={CRID}"]


def _healthy(trace_id):
    """A complete healthy general-mode answer, packet + wire, as the route emits it.

    A sampled turn leads with a trace frame; an unsampled one has no trace id,
    no header and no trace frame at all (chat/route.ts emits it only when
    rootTraceId is set).
    """
    kinds = (["trace"] if trace_id else []) + ["sources", "content", "evidence", "done"]
    w = {
        "trace_frame": {"kind": "trace", "traceId": trace_id} if trace_id else {},
        "kinds": kinds,
        "status": "answered",
        "content": "A VFD varies motor speed by changing the supply frequency.",
        "basis": "general_reasoning",
        "citations": 0,
    }
    d = {
        "traceId": trace_id,
        "packet": {
            "environment": "staging",
            "generation": {
                "served_provider": "Groq",
                "served_model": "m",
                "input_tokens": 3,
                "output_tokens": 2,
            },
            "retrieval": {"executed": False, "candidate_count": 0},
            "context": {"chunk_count": 0, "evidence_doc_ids": [], "system_prompt_kind": "general"},
        },
    }
    return d, w


def _run(hdr, d, w):
    row = mod.Row(scenario="s", trace_id=hdr)
    mod.common_checks(row, d, w)
    return row


def test_healthy_sampled_and_unsampled_turns_pass_every_common_check():
    for trace in (TRACE, None):
        d, w = _healthy(trace)
        row = _run(trace, d, w)
        assert row.passed, [c for c in row.checks if not c[1]]


def test_sampled_turn_with_a_missing_misplaced_or_mismatched_trace_frame_fails():
    d, w = _healthy(TRACE)
    w["kinds"] = ["sources", "content"]
    w["trace_frame"] = {}
    assert not _run(TRACE, d, w).passed  # missing

    d, w = _healthy(TRACE)
    w["kinds"] = ["sources", "trace", "content"]
    assert not _run(TRACE, d, w).passed  # misplaced

    d, w = _healthy(TRACE)
    w["trace_frame"] = {"kind": "trace", "traceId": "f" * 32}
    assert not _run(TRACE, d, w).passed  # mismatched


def test_trace_ids_that_disagree_fail_either_way():
    d, w = _healthy(TRACE)
    d["traceId"] = None
    assert not _run(TRACE, d, w).passed
    d, w = _healthy(None)
    d["traceId"] = TRACE
    assert not _run(None, d, w).passed


def test_an_unsampled_turn_that_still_sends_a_trace_frame_fails():
    d, w = _healthy(None)
    w["kinds"] = ["trace"] + w["kinds"]
    assert not _run(None, d, w).passed
