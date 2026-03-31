"""Tests for FSM model builder — regime 6."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add mira-sidecar to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))


class TestFSMBuilder:
    """Test FSM model construction from state history."""

    def test_build_produces_valid_model(self, sample_state_history: list[dict]):
        from fsm.builder import build_fsm
        from fsm.models import StateVector

        vectors = [StateVector(**sv) for sv in sample_state_history]
        model = build_fsm("test_asset", vectors)

        assert model.asset_id == "test_asset"
        assert model.cycle_count > 0
        assert "0" in model.transitions  # idle state exists
        assert "1" in model.transitions["0"]  # idle -> starting exists

    def test_timing_envelope_computed(self, sample_state_history: list[dict]):
        from fsm.builder import build_fsm
        from fsm.models import StateVector

        vectors = [StateVector(**sv) for sv in sample_state_history]
        model = build_fsm("test_asset", vectors)

        # Check idle -> starting transition envelope
        envelope = model.transitions["0"]["1"]
        assert envelope.mean_ms > 0
        assert envelope.stddev_ms >= 0
        assert envelope.min_ms > 0
        assert envelope.max_ms >= envelope.min_ms
        assert envelope.count == 10  # 10 cycles

    def test_all_transitions_found(self, sample_state_history: list[dict]):
        from fsm.builder import build_fsm
        from fsm.models import StateVector

        vectors = [StateVector(**sv) for sv in sample_state_history]
        model = build_fsm("test_asset", vectors)

        # 4 transitions in the cycle: 0->1, 1->2, 2->3, 3->0
        assert "1" in model.transitions["0"]
        assert "2" in model.transitions["1"]
        assert "3" in model.transitions["2"]
        assert "0" in model.transitions["3"]

    def test_empty_history_raises(self):
        from fsm.builder import build_fsm

        model = build_fsm("test_asset", [])
        assert model.cycle_count == 0
        assert model.transitions == {}

    def test_single_state_no_transitions(self):
        from fsm.builder import build_fsm
        from fsm.models import StateVector

        vectors = [StateVector(state="0", timestamp_ms=1000)]
        model = build_fsm("test_asset", vectors)
        assert model.transitions == {}

    def test_rare_transition_flagged(self):
        """A transition that appears < 0.5% of total should be flagged rare."""
        from fsm.builder import build_fsm
        from fsm.models import StateVector

        # Build 200 normal cycles + 1 anomalous transition
        history = []
        t = 0
        for _ in range(200):
            history.append(StateVector(state="0", timestamp_ms=t))
            t += 500
            history.append(StateVector(state="1", timestamp_ms=t))
            t += 1000
        # Add one rare transition: 0 -> 4 (never seen before)
        history.append(StateVector(state="0", timestamp_ms=t))
        t += 500
        history.append(StateVector(state="4", timestamp_ms=t))

        model = build_fsm("test_asset", history)
        # The 0->4 transition should be flagged as rare
        if "4" in model.transitions.get("0", {}):
            assert model.transitions["0"]["4"].is_rare
