"""Tests for Ignition Web Dev handlers — regime 7.

These test the Jython 2.7 scripts by mocking the Ignition environment
and executing the handler functions under CPython.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path

import pytest


def load_handler(script_path: Path, handler_name: str = "doGet"):
    """Load a Jython handler script and return the handler function.

    Ignition scripts use `system` as a bare global (it's built-in in Jython).
    We inject it into builtins so it's available when the module executes.
    """
    import builtins

    # Ensure 'system' is available as a builtin global
    if "system" in sys.modules and not hasattr(builtins, "system"):
        builtins.system = sys.modules["system"]

    module_name = f"handler_{script_path.stem}_{handler_name}"
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, handler_name)


class TestStatusHandler:
    def test_returns_gateway_ok(self, webdev_scripts_dir):
        handler = load_handler(webdev_scripts_dir / "api" / "status" / "doGet.py", "doGet")
        result = handler({"params": {}}, {})

        assert "json" in result
        data = result["json"]
        assert data["gateway"] == "ok"
        assert "rag_sidecar" in data
        assert "monitored_assets" in data

    def test_sidecar_error_handled(self, mock_urllib2, webdev_scripts_dir):
        """When sidecar is down, should still return gateway=ok with sidecar=error."""
        mock_urllib2.urlopen.side_effect = IOError("Connection refused")

        handler = load_handler(webdev_scripts_dir / "api" / "status" / "doGet.py", "doGet")
        result = handler({"params": {}}, {})

        data = result["json"]
        assert data["gateway"] == "ok"
        assert data["rag_sidecar"] == "error"


class TestChatHandler:
    def test_chat_proxies_to_sidecar(self, webdev_scripts_dir):
        handler = load_handler(webdev_scripts_dir / "api" / "chat" / "doPost.py", "doPost")
        request = {
            "postData": {
                "query": "What does OC mean?",
                "asset_id": "conveyor_demo",
            }
        }
        result = handler(request, {})

        assert "json" in result
        data = result["json"]
        # Should have proxied to sidecar and got back mock answer
        assert "answer" in data or "error" not in data

    def test_chat_empty_query_rejected(self, webdev_scripts_dir):
        handler = load_handler(webdev_scripts_dir / "api" / "chat" / "doPost.py", "doPost")
        request = {"postData": {"query": "", "asset_id": ""}}
        result = handler(request, {})

        assert "json" in result
        data = result["json"]
        assert "error" in data


class TestAlertsHandler:
    def test_alerts_returns_list(self, webdev_scripts_dir):
        handler = load_handler(webdev_scripts_dir / "api" / "alerts" / "doGet.py", "doGet")
        request = {"params": {"asset": "conveyor_demo", "limit": "20"}}
        result = handler(request, {})

        assert "json" in result
        assert "alerts" in result["json"]


class TestTagsHandler:
    def test_tags_returns_list(self, webdev_scripts_dir):
        handler = load_handler(webdev_scripts_dir / "api" / "tags" / "doGet.py", "doGet")
        request = {"params": {"folder": "[default]Mira_Monitored"}}
        result = handler(request, {})

        assert "json" in result
        assert "tags" in result["json"]
