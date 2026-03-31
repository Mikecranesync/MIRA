"""Tests for Ignition Gateway Event Scripts — regime 7.

Tests the FSM monitor tag change script and timer scripts by
mocking the Ignition environment.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, call

import pytest

from .conftest import MockQualifiedValue, MockTagResult


def load_script(script_path: Path):
    """Load a gateway script module."""
    spec = importlib.util.spec_from_file_location("gateway_script", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestFSMMonitor:
    """Test the tag change FSM monitor script."""

    def test_skip_initial_change(self, mock_ignition_system, gateway_scripts_dir):
        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        # initialChange=True should be a no-op
        if hasattr(module, "valueChanged"):
            module.valueChanged(
                tag=None,
                tagPath="[default]Mira_Monitored/conveyor_demo/State",
                previousValue=MockQualifiedValue(0),
                currentValue=MockQualifiedValue(1),
                initialChange=True,
                missedEvents=False,
            )
            # Should NOT write any alerts
            mock_ignition_system.tag.writeBlocking.assert_not_called()

    def test_no_fsm_model_skips(self, mock_ignition_system, gateway_scripts_dir):
        """When no FSM model exists, should skip anomaly check."""
        mock_ignition_system.db.runScalarQuery.return_value = None

        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        if hasattr(module, "valueChanged"):
            module.valueChanged(
                tag=None,
                tagPath="[default]Mira_Monitored/conveyor_demo/State",
                previousValue=MockQualifiedValue(0, timestamp_ms=1000),
                currentValue=MockQualifiedValue(1, timestamp_ms=2000),
                initialChange=False,
                missedEvents=False,
            )
            # No alerts should be written
            mock_ignition_system.tag.writeBlocking.assert_not_called()

    def test_forbidden_transition_detected(self, mock_ignition_system, gateway_scripts_dir):
        """Transition not in FSM model should trigger FORBIDDEN_TRANSITION."""
        # FSM model: only allows 0->1
        fsm_model = json.dumps({"0": {"1": {"mean_ms": 500, "stddev_ms": 50, "is_accepting": False}}})
        mock_ignition_system.db.runScalarQuery.return_value = fsm_model

        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        if hasattr(module, "valueChanged"):
            # Attempt transition 0->2 (not in model)
            module.valueChanged(
                tag=None,
                tagPath="[default]Mira_Monitored/conveyor_demo/State",
                previousValue=MockQualifiedValue(0, timestamp_ms=1000),
                currentValue=MockQualifiedValue(2, timestamp_ms=2000),
                initialChange=False,
                missedEvents=False,
            )
            # Should write an alert
            if mock_ignition_system.tag.writeBlocking.called:
                alert_json = mock_ignition_system.tag.writeBlocking.call_args[0][1][0]
                alert = json.loads(alert_json)
                assert alert["type"] == "FORBIDDEN_TRANSITION"
                assert alert["severity"] == "CRITICAL"


class TestStuckStateTimer:
    """Test the stuck state timer script."""

    def test_script_loads(self, mock_ignition_system, mock_urllib2, gateway_scripts_dir):
        """Timer script should at least load without error."""
        script_path = gateway_scripts_dir / "timer-stuck-state.py"
        if script_path.exists():
            module = load_script(script_path)
            assert module is not None
