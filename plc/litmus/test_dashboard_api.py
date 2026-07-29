"""
Tests for the CV-101 bench-local dashboard adapter (plc/litmus/dashboard_api.py).

Exercises the pure route() function (no socket bind), proving the Perspective dashboard can
consume the SAME context/capability contract: honest trend availability, grounded Ask MIRA
answer + claim boundary. Read-only; no Litmus :8094; no PLC write path.

Run:  pytest plc/litmus/test_dashboard_api.py -q
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dashboard_api as api  # noqa: E402


def _get(path, **q):
    status, ctype, body = api.route("GET", path, {k: [v] for k, v in q.items()})
    return status, ctype, body


def _json_get(path, **q):
    status, ctype, body = _get(path, **q)
    return status, json.loads(body)


def test_health_ok():
    status, body = _json_get("/health")
    assert status == 200 and body["ok"] is True
    assert "replay" in body["sources"]


def test_context_route_returns_full_contract():
    status, c = _json_get("/api/demo/cv101/context")
    assert status == 200
    for key in ("asset_id", "mapped_signals", "declined_signals", "trend_signals",
                "capability_matrix", "generated_tests", "skipped_tests", "claim_boundary", "answer"):
        assert key in c, "context contract missing %s" % key
    assert c["asset_id"] == "CV-101"


def test_capabilities_route_has_matrix_and_trends():
    status, c = _json_get("/api/demo/cv101/capabilities")
    assert status == 200
    assert c["capability_matrix"] and c["trend_signals"]["unavailable"]
    unavail = {t["signal"] for t in c["trend_signals"]["unavailable"]}
    assert {"torque", "motor RPM", "output power"} <= unavail


def test_ask_route_has_answer_evidence_and_boundary():
    status, c = _json_get("/api/demo/cv101/ask")
    assert status == 200
    assert "not being commanded to run" in c["answer"]["summary"].lower()
    assert c["mapped_signals"] and c["declined_signals"]
    assert any("torque" in b.lower() for b in c["claim_boundary"])


def test_trends_html_shows_available_and_unavailable_not_hidden():
    status, ctype, body = _get("/trends")
    assert status == 200 and "html" in ctype
    assert "Available" in body and "Unavailable" in body
    # unavailable signals must be explicitly visible, not silently dropped
    assert "torque" in body and "unavailable / not mapped" in body
    assert "vfd_dc_bus" in body  # a real available signal is shown


def test_ask_html_served():
    status, ctype, body = _get("/ask")
    assert status == 200 and "html" in ctype
    assert "Ask MIRA" in body and "/api/demo/cv101/ask" in body


def test_unknown_route_404():
    status, body = _json_get("/nope")
    assert status == 404


def test_plc_source_unreachable_returns_503_not_crash(monkeypatch):
    def _boom(*a, **k):
        raise OSError("PLC not reachable")
    monkeypatch.setattr(api.demo, "run_demo", _boom)
    status, body = _json_get("/api/demo/cv101/context", source="plc")
    assert status == 503
    assert body["error"] == "source_unreachable"


def test_adapter_is_read_only_and_no_internal_litmus():
    src_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard_api.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    # The docstring may *mention* :8094 to document the non-dependency; what must be absent is
    # any functional use of the internal read route / credential, and any direct PLC access.
    assert "by-device" not in src, "adapter must not call the blocked loopedge-access read route"
    assert "/api/tags/by-device" not in src
    assert "pymodbus" not in src  # adapter reads through the CLI, never opens its own PLC socket
    assert "x-api-key" not in src and "apiKey" not in src
    # no Modbus write function codes anywhere
    for fc in ("write_register", "write_coil"):
        assert fc not in src


def test_perspective_views_wired_to_adapter():
    """Structural safety net (cannot test on a live gateway): the two Perspective views still
    parse as JSON and their webBrowser sources point at the bench-local adapter, not the dead
    WebDev/cloud path."""
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    views = os.path.join(root, "ignition", "project",
                         "com.inductiveautomation.perspective", "views")
    mira = os.path.join(views, "Mira", "MiraPanel", "resource.json")
    trend = os.path.join(views, "Trends", "TrendPanel", "resource.json")
    for path in (mira, trend):
        with open(path, "r", encoding="utf-8") as f:
            json.load(f)  # must still be valid JSON
    with open(mira, "r", encoding="utf-8") as f:
        mira_src = f.read()
    with open(trend, "r", encoding="utf-8") as f:
        trend_src = f.read()
    assert "127.0.0.1:8770/ask" in mira_src, "Ask MIRA panel not repointed to the adapter"
    assert "/system/webdev/FactoryLM/mira" not in mira_src, "dead WebDev source still present"
    assert "127.0.0.1:8770/trends" in trend_src, "Trends panel not repointed to the adapter"
