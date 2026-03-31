"""Fixtures for regime 7: Ignition Jython script tests.

These tests run under CPython 3.12 but mock the Jython/Ignition environment
so we can validate the Web Dev handlers and gateway scripts.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class MockQualifiedValue:
    """Mock for Ignition's QualifiedValue returned by readBlocking."""

    def __init__(self, value, quality="Good", timestamp_ms: int = 1000):
        self.value = value
        self.quality = MagicMock()
        self.quality.isGood.return_value = quality == "Good"
        self.quality.__str__ = lambda self: quality
        self.timestamp = MagicMock()
        self.timestamp.getTime.return_value = timestamp_ms


class MockTagResult:
    """Mock for tag browse results."""

    def __init__(self, name: str, full_path: str, tag_type: str = "OpcTag"):
        self.name = name
        self.fullPath = full_path
        self.tagType = tag_type


@pytest.fixture
def mock_ignition_system():
    """Create a mock Ignition `system` module and inject it into sys.modules."""
    system = types.ModuleType("system")

    # system.tag
    system.tag = MagicMock()
    system.tag.readBlocking = MagicMock(
        return_value=[
            MockQualifiedValue(2, "Good", 1000),  # State = 2 (running)
            MockQualifiedValue(True, "Good"),  # Motor_Running
            MockQualifiedValue(False, "Good"),  # EStop_Active
        ]
    )
    system.tag.browseTags = MagicMock(
        return_value=[
            MockTagResult("conveyor_demo", "[default]Mira_Monitored/conveyor_demo", "Folder"),
        ]
    )
    system.tag.writeBlocking = MagicMock()

    # system.db
    system.db = MagicMock()
    system.db.runScalarQuery = MagicMock(return_value=None)
    system.db.runQuery = MagicMock(return_value=[])
    system.db.runPrepUpdate = MagicMock()

    # system.util
    system.util = MagicMock()
    logger = MagicMock()
    system.util.getLogger = MagicMock(return_value=logger)
    system.util.getProperty = MagicMock(return_value="C:/Ignition")

    # system.perspective
    system.perspective = MagicMock()

    # system.net
    system.net = MagicMock()

    # Inject into sys.modules
    sys.modules["system"] = system
    sys.modules["system.tag"] = system.tag
    sys.modules["system.db"] = system.db
    sys.modules["system.util"] = system.util
    sys.modules["system.perspective"] = system.perspective
    sys.modules["system.net"] = system.net

    yield system

    # Cleanup
    for mod in ["system", "system.tag", "system.db", "system.util", "system.perspective", "system.net"]:
        sys.modules.pop(mod, None)


@pytest.fixture
def mock_urllib2():
    """Mock urllib2 for Jython HTTP calls."""
    urllib2 = types.ModuleType("urllib2")

    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps(
        {"status": "ok", "doc_count": 5, "answer": "Test answer", "sources": []}
    ).encode()

    urllib2.urlopen = MagicMock(return_value=mock_response)
    urllib2.Request = MagicMock()
    urllib2.URLError = type("URLError", (Exception,), {})

    sys.modules["urllib2"] = urllib2
    yield urllib2
    sys.modules.pop("urllib2", None)


@pytest.fixture
def webdev_scripts_dir() -> Path:
    """Path to the Web Dev handler scripts."""
    return Path(__file__).parent.parent.parent / "ignition" / "webdev" / "FactoryLM"


@pytest.fixture
def gateway_scripts_dir() -> Path:
    """Path to the gateway event scripts."""
    return Path(__file__).parent.parent.parent / "ignition" / "gateway-scripts"
