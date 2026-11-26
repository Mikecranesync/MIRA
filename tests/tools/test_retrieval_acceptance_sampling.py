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


# --- R1-C5 (review r1 of PR C, #6022/#6023): unknown token totals ---------------
#
# The route writes NULL packet token totals when a billed generation attempt's usage
# is unknown. The packet marks such an attempt with outcome "exception" (the
# USAGE_UNKNOWN constant pinned in
# mira-hub/src/capabilities/__tests__/semantic-redraft.route.test.ts; the two must
# agree). The reader accepts NULL totals ONLY when the packet shows such an attempt;
# otherwise an answered turn still needs integer counts.

USAGE_UNKNOWN = "exception"
# Draft 1's attempt on a turn whose redraft replaced it and was served (R1-C6): one served attempt.
DRAFT1_REPLACED = "generated_not_served"


def _answered_redraft_turn(attempts, input_tokens, output_tokens):
    d, w = _healthy(TRACE)
    g = d["packet"]["generation"]
    g["attempts"] = attempts
    g["input_tokens"] = input_tokens
    g["output_tokens"] = output_tokens
    return d, w


def _failed(row):
    return [c[0] for c in row.checks if not c[1]]


def test_null_totals_pass_when_the_packet_shows_a_billed_attempt_with_unknown_usage():
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED},
            {"provider": "OpenAI", "outcome": USAGE_UNKNOWN, "redraft": True},
            {"provider": "Groq", "outcome": "served", "redraft": True},
        ],
        None,
        None,
    )
    assert w["status"] == "answered"
    row = _run(TRACE, d, w)
    assert _failed(row) == []


def test_control_null_totals_fail_when_no_attempt_has_unknown_usage():
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED},
            {"provider": "Groq", "outcome": "served", "redraft": True},
        ],
        None,
        None,
    )
    assert _failed(_run(TRACE, d, w)) == ["token usage recorded"]


def test_control_null_totals_fail_when_the_only_failed_attempt_was_an_unbilled_rejection():
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED},
            {"provider": "OpenAI", "outcome": "http_error", "redraft": True},
            {"provider": "Groq", "outcome": "served", "redraft": True},
        ],
        None,
        None,
    )
    assert _failed(_run(TRACE, d, w)) == ["token usage recorded"]


def test_control_null_totals_fail_when_the_packet_has_no_attempts_list():
    d, w = _healthy(TRACE)
    d["packet"]["generation"]["input_tokens"] = None
    d["packet"]["generation"]["output_tokens"] = None
    assert "attempts" not in d["packet"]["generation"]
    assert _failed(_run(TRACE, d, w)) == ["token usage recorded"]


def test_control_integer_totals_with_an_unknown_usage_attempt_still_pass():
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": "served"},
            {"provider": "OpenAI", "outcome": USAGE_UNKNOWN, "redraft": True},
        ],
        62,
        27,
    )
    assert _failed(_run(TRACE, d, w)) == []


def test_control_a_non_integer_total_fails_even_with_an_unknown_usage_attempt():
    # Unknown means NULL; a float or string count is malformed, not unknown.
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": "served"},
            {"provider": "OpenAI", "outcome": USAGE_UNKNOWN, "redraft": True},
        ],
        62,
        "27",
    )
    assert _failed(_run(TRACE, d, w)) == ["token usage recorded"]


def test_one_null_total_passes_when_the_packet_shows_a_billed_attempt_with_unknown_usage():
    # The route's shape for a malformed output count on a billed redraft attempt
    # (semantic-redraft.route.test.ts, M2): input known, output unknown.
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED},
            {"provider": "OpenAI", "outcome": USAGE_UNKNOWN, "redraft": True},
            {"provider": "Groq", "outcome": "served", "redraft": True},
        ],
        112,
        None,
    )
    assert _failed(_run(TRACE, d, w)) == []


def test_null_totals_pass_when_a_generating_attempt_is_marked_usage_unknown():
    # The route's shape for a malformed draft-1 count under a served redraft: no attempt
    # is "exception"; draft 1's replaced attempt carries usage_unknown instead.
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED, "usage_unknown": True},
            {"provider": "OpenAI", "outcome": "served", "redraft": True},
        ],
        62,
        None,
    )
    assert _failed(_run(TRACE, d, w)) == []


def test_control_null_totals_fail_when_usage_unknown_is_false():
    d, w = _answered_redraft_turn(
        [
            {"provider": "OpenAI", "outcome": DRAFT1_REPLACED, "usage_unknown": False},
            {"provider": "OpenAI", "outcome": "served", "redraft": True},
        ],
        62,
        None,
    )
    assert _failed(_run(TRACE, d, w)) == ["token usage recorded"]
