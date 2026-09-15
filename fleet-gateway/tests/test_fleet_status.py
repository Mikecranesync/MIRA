from __future__ import annotations

from fleet_gateway.contract import FLEET_STATUS_FIELDS


def test_fleet_status_field_split(service, auth):
    result = service.invoke("fleet_status", {}, authorization=auth)
    for field in FLEET_STATUS_FIELDS:
        assert field in result, field
    # Separate Claude vs Codex, node vs CAO — not a single blended "health".
    assert result["node_health"] != result.get("unused")
    assert "claude_readiness" in result and "codex_readiness" in result
    assert "claude_auth" in result and "codex_auth" in result
    assert result["claude_readiness"] is not None
    assert result["codex_readiness"] is not None
    assert result["cao_health"] is not None
    assert result["node_health"] is not None
    assert "heartbeat" in result
    assert "context_used" in result
    assert "context_remaining" in result
    assert "current_session" in result
    assert "current_task" in result


def test_fleet_status_strips_topology_even_if_cao_leaks(service, cao, auth):
    original = cao.fleet_snapshot

    def leaky():
        snap = original()
        snap["ip"] = "100.64.1.23"
        snap["port"] = 12345
        snap["tailscale"] = "100.64.1.23"
        snap["cao_url"] = "http://127.0.0.1:9"
        snap["token"] = "should-never-appear"
        snap["node_health"] = "ok from 10.0.0.5"
        return snap

    cao.fleet_snapshot = leaky  # type: ignore[method-assign]
    result = service.invoke("fleet_status", {}, authorization=auth)
    blob = str(result)
    assert "100.64.1.23" not in blob
    assert "10.0.0.5" not in blob
    assert "127.0.0.1" not in blob
    assert "should-never-appear" not in blob
    assert "ip" not in result
    assert "port" not in result
    assert "token" not in result
    assert "cao_url" not in result
