"""interpret_print dense-sheet recovery + budget-escalation integration tests.

Hermetic: mocks the generate layer (no network, no paid call) to feed canned
``(raw, finish_reason)`` sequences and asserts the density-aware escalation,
bounded recovery, fail-closed behavior, and the persisted recovery provenance
(requested max tokens / finish reason / raw sha256 / repair attempted / method /
validation result).
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

import printsense.interpret as I  # noqa: E402
from factorylm_ai.capability_codes import CapabilityError  # noqa: E402

CLEAN = '{"package": {"drawing_no": "31971"}, "devices": []}'
MISSING_DELIM = '{"package": {"drawing_no": "31971" "sheet": 6}, "devices": []}'
TRUNCATED = '{"package": {"drawing_no": "31971"}, "devices": [{"tag": "-5/A101"'
UNRECOVERABLE = (
    "REASONING: this sheet is too dense to encode; no JSON emitted before the token cap."
)


def _wire(monkeypatch, responses, *, base=100, ceiling=400):
    """Mock the generate layer + availability gates; return a call recorder."""
    calls = {"n": 0, "budgets": []}

    def fake_gen(provider, model, pages, prompt, client=None, max_tokens=None):
        calls["budgets"].append(max_tokens)
        r = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        return r

    monkeypatch.setattr(I, "_generate_with_provider", fake_gen)
    monkeypatch.setattr(I, "_client", lambda c: None)
    monkeypatch.setattr(I, "_network_gate_check", lambda c: None)
    monkeypatch.setattr(I, "_check_model_approved", lambda *a, **k: True)
    monkeypatch.setattr(I, "MAX_TOKENS", base)
    monkeypatch.setattr(I, "MAX_TOKENS_CEILING", ceiling)
    monkeypatch.setenv("PRINT_VISION_PROVIDER", "together")
    monkeypatch.setenv("PRINT_PROVIDER_POLICY", "strict")
    return calls


def _run():
    return I.interpret_print([(b"x" * 10, "image/jpeg")], preprocess=False)


def test_clean_output_no_repair(monkeypatch) -> None:
    calls = _wire(monkeypatch, [(CLEAN, "stop")])
    graph = _run()
    assert graph.package["drawing_no"] == "31971"
    rec = I.pop_last_recovery()
    assert rec["repair_attempted"] is False
    assert rec["repair_method"] == "none"
    assert rec["finish_reason"] == "stop"
    assert rec["requested_max_tokens"] == 100
    assert rec["validation_result"] == "valid"
    assert rec["raw_sha256"] == hashlib.sha256(CLEAN.encode()).hexdigest()
    assert calls["budgets"] == [100]  # one call, base budget — no blind bump


def test_missing_delimiter_recovered_and_flagged_degraded(monkeypatch) -> None:
    _wire(monkeypatch, [(MISSING_DELIM, "stop")])
    graph = _run()
    assert graph.package["drawing_no"] == "31971"
    assert graph.package["sheet"] == 6
    rec = I.pop_last_recovery()
    assert rec["repair_attempted"] is True
    assert rec["repair_method"] == "insert_delimiter"


def test_truncation_escalates_to_complete_result(monkeypatch) -> None:
    # rung 1 truncates (finish=length); rung 2 (bigger budget) returns clean.
    calls = _wire(monkeypatch, [(TRUNCATED, "length"), (CLEAN, "stop")])
    graph = _run()
    assert graph.package["drawing_no"] == "31971"
    rec = I.pop_last_recovery()
    # accepted the COMPLETE result from the escalated budget, not the truncated one
    assert rec["repair_attempted"] is False
    assert rec["requested_max_tokens"] == 160  # escalated rung (100 * 1.6)
    assert calls["budgets"] == [100, 160]


def test_truncation_unrecoverable_at_ceiling_fails_closed(monkeypatch) -> None:
    calls = _wire(monkeypatch, [(UNRECOVERABLE, "length")])
    with pytest.raises(CapabilityError) as ei:
        _run()
    assert ei.value.code == "INVALID_MODEL_JSON"
    # it escalated all the way to the ceiling before failing closed (bounded)
    assert calls["budgets"][0] == 100
    assert calls["budgets"][-1] == 400
    assert calls["budgets"] == sorted(set(calls["budgets"]))  # strictly increasing


def test_truncated_but_recoverable_kept_if_ceiling_reached(monkeypatch) -> None:
    # every rung truncates but IS recoverable → at the ceiling, accept the
    # degraded (truncated) repaired result rather than fail.
    _wire(monkeypatch, [(TRUNCATED, "length")])
    graph = _run()
    assert graph.package["drawing_no"] == "31971"
    rec = I.pop_last_recovery()
    assert rec["truncated"] is True
    assert rec["repair_attempted"] is True
    assert rec["repair_method"] == "close_truncated"
    assert rec["requested_max_tokens"] == 400  # reached the ceiling


def test_wellformed_but_wrong_schema_does_not_escalate(monkeypatch) -> None:
    # valid JSON, wrong shape → PRINTSYNTH_VALIDATION_FAILED immediately (a bigger
    # budget cannot fix a shape error); must NOT burn escalation calls.
    calls = _wire(monkeypatch, [('{"devices": "not-a-list"}', "stop")])
    with pytest.raises(CapabilityError) as ei:
        _run()
    assert ei.value.code == "PRINTSYNTH_VALIDATION_FAILED"
    assert calls["budgets"] == [100]  # no escalation on a shape error
