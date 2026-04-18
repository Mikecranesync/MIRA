"""Fixtures for regime 7: Ignition Jython script tests.

These tests run under CPython 3.12 but mock the Jython/Ignition environment
so we can validate the Web Dev handlers and gateway scripts.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest


class MockQualifiedValue:
    """Mock for Ignition's QualifiedValue returned by readBlocking."""

    def __init__(self, value, quality="Good", timestamp_ms: int = 1000):
        self.value = value
        self.quality = MagicMock()
        self.quality.isGood.return_value = quality == "Good"
        self.quality.__str__ = lambda _self: quality
        self.timestamp = MagicMock()
        self.timestamp.getTime.return_value = timestamp_ms


class MockTagResult:
    """Mock for tag browse results."""

    def __init__(self, name: str, full_path: str, tag_type: str = "OpcTag"):
        self.name = name
        self.fullPath = full_path
        self.tagType = tag_type
        self.type = tag_type  # some scripts use .type instead of .tagType


class MockDataset:
    """Mock for Ignition Dataset returned by runPrepQuery/runQuery."""

    def __init__(self, rows: list[dict], columns: list[str] | None = None):
        self._rows = rows
        self._columns = columns or (list(rows[0].keys()) if rows else [])

    @property
    def rowCount(self):
        return len(self._rows)

    def getRowCount(self):
        return len(self._rows)

    @property
    def columnCount(self):
        return len(self._columns)

    def getColumnCount(self):
        return len(self._columns)

    def getColumnName(self, col_index):
        return self._columns[col_index]

    def getValueAt(self, row, col):
        if isinstance(col, int):
            col_name = self._columns[col]
        else:
            col_name = col
        return self._rows[row].get(col_name, None)

    def __iter__(self):
        return iter(self._rows)

    def __len__(self):
        return len(self._rows)


def _build_java_mocks():
    """Create mock Java modules needed by Jython scripts.

    Gateway scripts use java.io.FileInputStream, java.util.Properties,
    java.io.File, and java.util.Date. These don't exist in CPython.
    """
    # java module hierarchy
    java = types.ModuleType("java")
    java_io = types.ModuleType("java.io")
    java_util = types.ModuleType("java.util")

    # java.io.File mock
    mock_file = MagicMock()
    mock_file.return_value = MagicMock()
    mock_file.return_value.exists.return_value = False  # No properties file during test
    mock_file.return_value.mkdirs.return_value = True
    java_io.File = mock_file
    java_io.FileInputStream = MagicMock()
    java_io.FileOutputStream = MagicMock()

    # java.util.Properties mock
    mock_props = MagicMock()
    mock_props_instance = MagicMock()
    mock_props_instance.getProperty.return_value = ""
    mock_props.return_value = mock_props_instance
    java_util.Properties = mock_props

    # java.util.Date mock
    mock_date = MagicMock()
    mock_date_instance = MagicMock()
    mock_date_instance.getTime.return_value = 100000
    mock_date.return_value = mock_date_instance
    java_util.Date = mock_date

    java.io = java_io
    java.util = java_util

    return {
        "java": java,
        "java.io": java_io,
        "java.util": java_util,
        "java.io.FileInputStream": java_io.FileInputStream,
        "java.io.FileOutputStream": java_io.FileOutputStream,
        "java.util.Properties": java_util.Properties,
        "java.io.File": java_io.File,
        "java.util.Date": java_util.Date,
    }


@pytest.fixture(autouse=True)
def mock_ignition_system():
    """Create a mock Ignition `system` module and inject it into sys.modules.

    Also injects Java module mocks needed by gateway scripts.
    """
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
    system.tag.queryTagHistory = MagicMock(return_value=MockDataset([]))

    # system.db
    system.db = MagicMock()
    system.db.runScalarQuery = MagicMock(return_value=None)
    system.db.runQuery = MagicMock(return_value=MockDataset([]))
    system.db.runPrepQuery = MagicMock(return_value=MockDataset([]))
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
    system.net.getHostName = MagicMock(return_value="test-gateway")

    # Inject system into sys.modules
    sys.modules["system"] = system
    sys.modules["system.tag"] = system.tag
    sys.modules["system.db"] = system.db
    sys.modules["system.util"] = system.util
    sys.modules["system.perspective"] = system.perspective
    sys.modules["system.net"] = system.net

    # Inject Java mocks
    java_mocks = _build_java_mocks()
    for mod_name, mod in java_mocks.items():
        sys.modules[mod_name] = mod

    yield system

    # Cleanup
    for mod_name in [
        "system", "system.tag", "system.db", "system.util",
        "system.perspective", "system.net",
    ] + list(java_mocks.keys()):
        sys.modules.pop(mod_name, None)


@pytest.fixture(autouse=True)
def mock_urllib2():
    """Mock urllib2 for Jython HTTP calls."""
    urllib2 = types.ModuleType("urllib2")

    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps(
        {"status": "ok", "doc_count": 5, "version": "0.1.0",
         "answer": "Test answer about VFD faults.", "sources": []}
    ).encode()
    mock_response.getcode.return_value = 200

    urllib2.urlopen = MagicMock(return_value=mock_response)
    urllib2.Request = MagicMock(return_value=MagicMock())
    urllib2.URLError = type("URLError", (IOError,), {})

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
