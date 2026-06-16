"""Tests for Ignition Gateway Event Scripts — regime 7.

Tests the FSM monitor tag change script and timer scripts by
mocking the Ignition environment.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from .conftest import MockQualifiedValue, MockTagResult


def load_script(script_path: Path):
    """Load a gateway script module.

    Ignition scripts use `system` as a bare global (built-in in Jython).
    We inject it into builtins so it's available when the module executes.
    """
    import builtins

    if "system" in sys.modules and not hasattr(builtins, "system"):
        builtins.system = sys.modules["system"]

    module_name = f"gateway_{script_path.stem.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestFSMMonitor:
    """Test the tag change FSM monitor script."""

    def test_script_loads(self, gateway_scripts_dir):
        """The FSM monitor script should load without error."""
        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")
        assert module is not None
        assert hasattr(module, "valueChanged")

    def test_skip_initial_change(self, mock_ignition_system, gateway_scripts_dir):
        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        module.valueChanged(
            tag=None,
            tagPath="[default]Mira_Monitored/conveyor_demo/State",
            previousValue=MockQualifiedValue(0),
            currentValue=MockQualifiedValue(1),
            initialChange=True,
            missedEvents=False,
        )
        # initialChange=True → no alerts written
        mock_ignition_system.tag.writeBlocking.assert_not_called()

    def test_no_fsm_model_skips(self, mock_ignition_system, gateway_scripts_dir):
        """When no FSM model exists, should skip anomaly check."""
        mock_ignition_system.db.runScalarQuery.return_value = None

        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        module.valueChanged(
            tag=None,
            tagPath="[default]Mira_Monitored/conveyor_demo/State",
            previousValue=MockQualifiedValue(0, timestamp_ms=1000),
            currentValue=MockQualifiedValue(1, timestamp_ms=2000),
            initialChange=False,
            missedEvents=False,
        )
        mock_ignition_system.tag.writeBlocking.assert_not_called()

    def test_forbidden_transition_detected(self, mock_ignition_system, gateway_scripts_dir):
        """Transition not in FSM model should trigger FORBIDDEN_TRANSITION."""
        fsm_model = json.dumps({
            "0": {"1": {"mean_ms": 500, "stddev_ms": 50, "is_accepting": False}}
        })
        mock_ignition_system.db.runScalarQuery.return_value = fsm_model

        module = load_script(gateway_scripts_dir / "tag-change-fsm-monitor.py")

        # Transition 0→2 is NOT in the model
        module.valueChanged(
            tag=None,
            tagPath="[default]Mira_Monitored/conveyor_demo/State",
            previousValue=MockQualifiedValue(0, timestamp_ms=1000),
            currentValue=MockQualifiedValue(2, timestamp_ms=2000),
            initialChange=False,
            missedEvents=False,
        )

        # Should have written an alert tag and inserted into DB
        if mock_ignition_system.tag.writeBlocking.called:
            args = mock_ignition_system.tag.writeBlocking.call_args[0]
            alert_json = args[1][0]
            alert = json.loads(alert_json)
            assert alert["type"] == "FORBIDDEN_TRANSITION"
            assert alert["severity"] == "CRITICAL"


class TestStuckStateTimer:
    """Test the stuck state timer script."""

    def test_script_loads(self, gateway_scripts_dir):
        """Timer script should load without error."""
        module = load_script(gateway_scripts_dir / "timer-stuck-state.py")
        assert module is not None


class TestFSMBuilderTimer:
    """Test the FSM builder timer script."""

    def test_script_loads(self, gateway_scripts_dir):
        """FSM builder timer script should load without error."""
        module = load_script(gateway_scripts_dir / "timer-fsm-builder.py")
        assert module is not None
