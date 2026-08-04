"""Tests for Ignition Web Dev handlers — regime 7.

These test the Jython 2.7 scripts by mocking the Ignition environment
and executing the handler functions under CPython.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path

def load_handler(script_path: Path, handler_name: str = "doGet"):
    """Load a Jython handler script and return the handler function.

    Ignition scripts use `system` as a bare global (it's built-in in Jython).
    We inject it into builtins so it's available when the module executes.
    """
    import builtins

    if "system" in sys.modules:
        builtins.system = sys.modules["system"]

    parent_name = script_path.parent.name
    module_name = f"handler_{parent_name}_{script_path.stem}_{handler_name}"
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

    def test_absent_tag_folder_is_diagnosable(self, mock_ignition_system, webdev_scripts_dir):
        """#3047: browsing an absent monitored folder raises Bad_NotFound. The gateway
        is still ok, but the empty asset list must be diagnosable (an explicit flag +
        echoed folder) instead of silently swallowed."""
        mock_ignition_system.tag.browseTags.side_effect = Exception(
            "Error in browse results: Bad_NotFound"
        )

        handler = load_handler(webdev_scripts_dir / "api" / "status" / "doGet.py", "doGet")
        result = handler({"params": {}}, {})

        # Health check stays 200 — the gateway itself is healthy.
        assert "status" not in result
        data = result["json"]
        assert data["gateway"] == "ok"
        assert data["monitored_assets"] == []
        assert data["asset_count"] == 0
        assert "tag_folder" in data
        assert data["tag_folder_not_found"] is True
        assert "tag_folder_error" in data


class TestChatHandler:
    def test_chat_proxies_to_sidecar(self, webdev_scripts_dir, mira_gateway_configured):
        """A configured gateway signs the request, proxies to the sidecar (mocked via
        the autouse `mock_urllib2`), and returns the sidecar's answer."""
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
        # Proxied successfully — no error, and the sidecar's mock answer came back
        # (mock_urllib2 returns {"answer": "Test answer about VFD faults.", ...}).
        assert "error" not in data, "handler returned an error: %s" % data
        assert data["answer"] == "Test answer about VFD faults."
        assert "sources" in data

    def test_chat_unconfigured_hmac_fails_closed(self, webdev_scripts_dir):
        """No HMAC key configured → fail closed with 503, never an unsigned proxy call.

        This is the security contract: doPost refuses to forward unsigned requests."""
        handler = load_handler(webdev_scripts_dir / "api" / "chat" / "doPost.py", "doPost")
        request = {"postData": {"query": "What does OC mean?", "asset_id": "conveyor_demo"}}
        result = handler(request, {})

        assert result["status"] == 503
        assert result["json"]["error"] == "MIRA HMAC key not configured"

    def test_chat_empty_query_rejected(self, webdev_scripts_dir, mira_gateway_configured):
        """A configured gateway still validates input: empty query → 400 'query is required'.

        (Requires the gateway-configured fixture; otherwise the handler fail-closes on the
        HMAC check before it ever reaches query validation.)"""
        handler = load_handler(webdev_scripts_dir / "api" / "chat" / "doPost.py", "doPost")
        request = {"postData": {"query": "", "asset_id": ""}}
        result = handler(request, {})

        assert "json" in result
        assert result["status"] == 400
        assert result["json"]["error"] == "query is required"


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

    def test_absent_folder_returns_structured_not_found(
        self, mock_ignition_system, webdev_scripts_dir
    ):
        """#3047: an absent folder (Bad_NotFound) must be a diagnosable 200 with an
        explicit flag + empty list — not a bare HTTP 500."""
        mock_ignition_system.tag.browseTags.side_effect = Exception(
            "Error in browse results: Bad_NotFound"
        )

        handler = load_handler(webdev_scripts_dir / "api" / "tags" / "doGet.py", "doGet")
        result = handler({"params": {"folder": "[default]Absent_Folder"}}, {})

        # Not a 500 — diagnosable success with an explicit flag.
        assert result.get("status") != 500
        data = result["json"]
        assert data["tag_folder_not_found"] is True
        assert data["tags"] == []
        assert data["count"] == 0
        assert data["folder"] == "[default]Absent_Folder"

    def test_generic_browse_error_still_500(
        self, mock_ignition_system, webdev_scripts_dir
    ):
        """#3047: a real browse error (not folder-absent) must still surface as a 500 —
        the not-found carve-out must not swallow genuine failures."""
        mock_ignition_system.tag.browseTags.side_effect = Exception(
            "Gateway communication timeout"
        )

        handler = load_handler(webdev_scripts_dir / "api" / "tags" / "doGet.py", "doGet")
        result = handler({"params": {"folder": "[default]Mira_Monitored"}}, {})

        assert result["status"] == 500
        assert result["json"]["error"] == "Tag browse failed"


class TestConnectActivationPersistence:
    """Activation must not report success unless config actually persisted
    (2026-08-01 adversarial review, finding 3).

    `_write_config()` used to no-op with a warning when no factorylm.properties
    existed, while `doPost()` returned "activated" anyway — a clean gateway
    accepted the code, persisted nothing, and showed no error anywhere.
    """

    def _activation_ok(self, mock_ignition_system):
        """Point the mocked HTTP client at a successful activation response."""
        import json as _json

        response = mock_ignition_system.net.httpClient.return_value.post.return_value
        response.statusCode = 200
        response.text = _json.dumps(
            {"tenant_id": "tenant-abc", "relay_url": "https://relay.factorylm.com/ingest"}
        )

    def test_clean_gateway_creates_the_properties_file(
        self, webdev_scripts_dir, mock_ignition_system
    ):
        """No properties file (conftest default: File.exists() is False) but an
        Ignition data dir exists (the getParentFile chain is truthy by default)
        -> the file is CREATED and activation succeeds."""
        self._activation_ok(mock_ignition_system)
        import java.io

        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": "ABC123"}}, {})

        assert result["json"].get("status") == "activated", result
        # the create path actually wrote (Properties().store over a stream)
        assert java.io.FileOutputStream.called

    def test_no_writable_location_fails_activation_loudly(
        self, webdev_scripts_dir, mock_ignition_system
    ):
        """No properties file AND no Ignition data dir -> activation must NOT
        report "activated"; it returns an explicit 500 carrying the tenant id
        so the operator can configure manually."""
        self._activation_ok(mock_ignition_system)
        import java.io

        file_mock = java.io.File.return_value
        file_mock.exists.return_value = False
        # the grandparent (the Ignition data dir) does not exist either
        file_mock.getParentFile.return_value.getParentFile.return_value.exists.return_value = False

        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": "ABC123"}}, {})

        assert result.get("status") == 500, result
        assert "persist" in result["json"]["error"]
        assert result["json"]["tenant_id"] == "tenant-abc"
        assert result["json"].get("status") != "activated"

    def test_existing_file_is_updated_in_place(
        self, webdev_scripts_dir, mock_ignition_system
    ):
        self._activation_ok(mock_ignition_system)
        import java.io
        import java.util

        java.io.File.return_value.exists.return_value = True
        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": "ABC123"}}, {})

        assert result["json"].get("status") == "activated", result
        props = java.util.Properties.return_value
        written = {c.args[0]: c.args[1] for c in props.setProperty.call_args_list}
        # both tenant spellings + the relay URL, and never the manual override
        assert written.get("MIRA_TENANT_ID") == "tenant-abc"
        assert written.get("TENANT_ID") == "tenant-abc"
        assert written.get("RELAY_URL") == "https://relay.factorylm.com/ingest"
        assert "INGEST_URL" not in written


class TestConnectGetHandler:
    def test_connect_status_not_connected(self, webdev_scripts_dir):
        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doGet.py", "doGet"
        )
        result = handler({"params": {}}, {})

        assert "json" in result
        data = result["json"]
        assert data["connected"] is False
        assert data["tenant_id"] == ""

    def test_connect_status_connected(self, webdev_scripts_dir, mock_ignition_system):
        """When properties file exists with TENANT_ID and RELAY_URL."""
        import java.io.File

        file_mock = java.io.File.return_value
        file_mock.exists.return_value = True

        import java.util.Properties

        props_mock = java.util.Properties.return_value
        props_mock.getProperty.side_effect = lambda key, default="": {
            "TENANT_ID": "test-tenant-123",
            "RELAY_URL": "https://connect.factorylm.com/ingest",
            "STREAM_TAG_FOLDER": "[default]Mira_Monitored",
        }.get(key, default)

        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doGet.py", "doGet"
        )
        result = handler({"params": {}}, {})

        data = result["json"]
        assert data["connected"] is True
        assert data["tenant_id"] == "test-tenant-123"
        assert data["relay_url"] == "https://connect.factorylm.com/ingest"


class TestConnectPostHandler:
    def test_connect_activate_missing_code(self, webdev_scripts_dir):
        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": ""}}, {})

        assert result["status"] == 400
        assert "code is required" in result["json"]["error"]

    def test_connect_activate_success(self, webdev_scripts_dir, mock_ignition_system):
        from unittest.mock import MagicMock
        import json as json_mod

        mock_response = MagicMock()
        mock_response.statusCode = 200
        mock_response.text = json_mod.dumps({
            "status": "activated",
            "tenant_id": "abc-123",
            "relay_url": "https://connect.factorylm.com/ingest",
        })

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_ignition_system.net.httpClient.return_value = mock_client

        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": "MIRA-TEST-1234-5678"}}, {})

        data = result["json"]
        assert data["status"] == "activated"
        assert data["tenant_id"] == "abc-123"

    def test_connect_activate_invalid_code(self, webdev_scripts_dir, mock_ignition_system):
        from unittest.mock import MagicMock
        import json as json_mod

        mock_response = MagicMock()
        mock_response.statusCode = 404
        mock_response.text = json_mod.dumps({"error": "Invalid, expired, or already used code"})

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_ignition_system.net.httpClient.return_value = mock_client

        handler = load_handler(
            webdev_scripts_dir / "api" / "connect" / "doPost.py", "doPost"
        )
        result = handler({"postData": {"code": "MIRA-XXXX-XXXX-XXXX"}}, {})

        assert result["status"] == 404
