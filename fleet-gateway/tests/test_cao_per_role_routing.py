"""Per-node CAO routing (#3552).

The v1 gateway resolved exactly ONE CAO client, so ``role`` was only an
agent-profile label and ``role=charlie`` still landed on Bravo's CAO. These tests
lock the fix: a role selects a node, an unmapped role fails closed, and the
single-URL and no-URL configurations keep their exact v1 behavior.
"""

from __future__ import annotations

import pytest
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient, RoutingCAOClient
from fleet_gateway.errors import CaoConfigError
from fleet_gateway.factory import cao_from_env, cao_urls_from_env

BRAVO_URL = "http://127.0.0.1:9889"
CHARLIE_URL = "http://127.0.0.1:19889"

_ENV_KEYS = (
    "FLEET_GATEWAY_CAO_URL",
    "FLEET_GATEWAY_CAO_URL_BRAVO",
    "FLEET_GATEWAY_CAO_URL_CHARLIE",
)


@pytest.fixture(autouse=True)
def _clear_cao_env(monkeypatch):
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _spec(role: str, task_id: str = "T-1") -> dict:
    return {
        "role": role,
        "provider": "claude",
        "task_id": task_id,
        "github_ref": "refs/heads/main",
        "base_commit": "abc123",
        "acceptance_criteria": ["it works"],
    }


# --- backward compatibility: the two v1 shapes must not move ----------------


def test_no_url_still_yields_fake_cao():
    assert isinstance(cao_from_env(), FakeCAO)


def test_single_url_still_yields_single_loopback_client(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL", BRAVO_URL)
    client = cao_from_env()
    assert isinstance(client, LoopbackCAOClient)
    assert not isinstance(client, RoutingCAOClient)


# --- env resolution ---------------------------------------------------------


def test_cao_urls_from_env_reads_per_role(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_BRAVO", BRAVO_URL)
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_CHARLIE", CHARLIE_URL)
    per_role, default = cao_urls_from_env()
    assert per_role == {"bravo": BRAVO_URL, "charlie": CHARLIE_URL}
    assert default == ""


def test_any_per_role_url_yields_router(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_CHARLIE", CHARLIE_URL)
    assert isinstance(cao_from_env(), RoutingCAOClient)


def test_per_role_url_must_be_loopback(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_CHARLIE", "http://100.70.49.126:9889")
    with pytest.raises(CaoConfigError):
        cao_from_env()


def test_router_targets_expected_ports(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_BRAVO", BRAVO_URL)
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL_CHARLIE", CHARLIE_URL)
    router = cao_from_env()
    assert router.client_for_role("bravo").base_url == BRAVO_URL
    assert router.client_for_role("charlie").base_url == CHARLIE_URL


# --- the #3552 regression ---------------------------------------------------


def test_role_charlie_reaches_the_charlie_node():
    """THE regression: role=charlie must not land on Bravo's CAO."""
    bravo, charlie = FakeCAO(), FakeCAO()
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})

    router.launch_worker(_spec("charlie"))

    assert [c[0] for c in charlie.calls] == ["launch_worker"]
    assert bravo.calls == [], "role=charlie leaked to Bravo's CAO (#3552)"


def test_role_bravo_reaches_the_bravo_node():
    bravo, charlie = FakeCAO(), FakeCAO()
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})

    router.launch_worker(_spec("bravo"))

    assert [c[0] for c in bravo.calls] == ["launch_worker"]
    assert charlie.calls == []


def test_roles_are_case_insensitive():
    bravo, charlie = FakeCAO(), FakeCAO()
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})
    router.launch_worker(_spec("CHARLIE"))
    assert charlie.calls and not bravo.calls


# --- fail-closed ------------------------------------------------------------


def test_unmapped_role_without_default_fails_closed():
    """Silently falling back to another node's CAO is the defect, not the fix."""
    router = RoutingCAOClient({"bravo": FakeCAO()})
    with pytest.raises(CaoConfigError) as exc:
        router.launch_worker(_spec("charlie"))
    assert "FLEET_GATEWAY_CAO_URL_CHARLIE" in str(exc.value)


def test_unmapped_role_uses_explicit_default_when_present():
    default = FakeCAO()
    router = RoutingCAOClient({"bravo": FakeCAO()}, default=default)
    router.launch_worker(_spec("charlie"))
    assert [c[0] for c in default.calls] == ["launch_worker"]


# --- session-keyed calls follow the owning node -----------------------------


def test_session_keyed_calls_route_to_the_owning_node():
    bravo, charlie = FakeCAO(), FakeCAO()
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})

    launched = router.launch_worker(_spec("charlie"))
    session_id = launched["session_id"]
    router.message_worker(session_id, "hello")
    router.stop_worker(session_id)

    assert [c[0] for c in charlie.calls] == [
        "launch_worker",
        "message_worker",
        "stop_worker",
    ]
    assert bravo.calls == [], "session-keyed call leaked to the wrong node"


def test_unknown_session_is_discovered_by_probing_backends():
    """Ownership is rebuilt after a gateway restart, not lost."""
    bravo, charlie = FakeCAO(), FakeCAO()
    launched = charlie.launch_worker(_spec("charlie"))
    session_id = launched["session_id"]

    # Fresh router: no in-process ownership for that session.
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})
    assert router.get_session(session_id) is not None
    router.message_worker(session_id, "still yours")

    assert "message_worker" in [c[0] for c in charlie.calls]
    assert bravo.calls == []


def test_two_nodes_keep_independent_session_state():
    bravo, charlie = FakeCAO(), FakeCAO()
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie})

    b = router.launch_worker(_spec("bravo", task_id="T-B"))["session_id"]
    c = router.launch_worker(_spec("charlie", task_id="T-C"))["session_id"]

    assert b in bravo.sessions and b not in charlie.sessions
    assert c in charlie.sessions and c not in bravo.sessions


def test_fleet_snapshot_reads_the_default_node():
    bravo, charlie, default = FakeCAO(), FakeCAO(), FakeCAO()
    default.node_health = "default-node"
    router = RoutingCAOClient({"bravo": bravo, "charlie": charlie}, default=default)
    assert router.fleet_snapshot()["node_health"] == "default-node"


def test_router_exposes_configured_roles():
    router = RoutingCAOClient({"charlie": FakeCAO(), "bravo": FakeCAO()})
    assert router.roles == ["bravo", "charlie"]
