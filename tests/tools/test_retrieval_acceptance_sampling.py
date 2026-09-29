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


def _trace_check(hdr, pkt, frame):
    row = mod.Row(scenario="s", trace_id=hdr)
    w = {"trace_frame": {"traceId": frame} if frame else {}, "kinds": ["trace"], "status": None}
    d = {"traceId": pkt, "packet": {"environment": "staging", "generation": {}}}
    try:
        mod.common_checks(row, d, w)
    except (KeyError, TypeError):
        pass  # later checks need a fuller packet; the trace check runs first
    return next(ok for name, ok, _ in row.checks if name.startswith("trace id on header"))


def test_unsampled_turn_passes_when_no_trace_id_exists_anywhere():
    assert _trace_check(None, None, None) is True


def test_sampled_turn_needs_one_matching_trace_id():
    assert _trace_check(TRACE, TRACE, TRACE) is True
    assert _trace_check(TRACE, None, TRACE) is False
    assert _trace_check(None, TRACE, None) is False
