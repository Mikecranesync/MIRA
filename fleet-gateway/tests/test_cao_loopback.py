from __future__ import annotations

import inspect

import pytest
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient, assert_loopback_cao_url
from fleet_gateway.errors import CaoConfigError
from fleet_gateway.factory import cao_from_env, node_configs_from_env


def test_loopback_url_allows_127():
    url = assert_loopback_cao_url("http://127.0.0.1:18765/v1")
    assert url.startswith("http://127.0.0.1")


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.10:1",
        "http://10.0.0.5",
        "http://100.64.1.1",
        "http://0.0.0.0:80",
        "http://localhost:80",
        "http://[::1]/",
        "https://example.com",
        "http://user:pass@127.0.0.1/",
    ],
)
def test_loopback_url_rejects_non_loopback(url):
    with pytest.raises(CaoConfigError):
        LoopbackCAOClient(url)


def test_loopback_client_never_binds():
    src = inspect.getsource(LoopbackCAOClient)
    lowered = src.lower()
    assert "bind(" not in lowered
    assert "0.0.0.0" not in src
    assert "listen(" not in lowered
    # Client-only: urlopen / request, no socket server.
    assert "HTTPServer" not in src
    assert "socket.socket" not in src


def test_default_cao_is_fake(monkeypatch):
    monkeypatch.delenv("FLEET_GATEWAY_CAO_URL", raising=False)
    assert isinstance(cao_from_env(), FakeCAO)


def test_env_non_loopback_refused(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL", "http://192.168.0.2:1")
    with pytest.raises(CaoConfigError):
        cao_from_env()


def test_legacy_cao_url_configures_only_bravo(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL", "http://127.0.0.1:18765")
    monkeypatch.delenv("FLEET_GATEWAY_BRAVO_CAO_URL", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_CHARLIE_CAO_URL", raising=False)

    configs = node_configs_from_env()

    assert set(configs) == {"bravo"}
    assert isinstance(configs["bravo"].cao, LoopbackCAOClient)


def test_charlie_uses_only_charlie_specific_cao_url(monkeypatch):
    monkeypatch.setenv("FLEET_GATEWAY_CAO_URL", "http://127.0.0.1:18765")
    monkeypatch.setenv("FLEET_GATEWAY_CHARLIE_CAO_URL", "http://127.0.0.1:18766")

    configs = node_configs_from_env()

    assert set(configs) == {"bravo", "charlie"}
    assert configs["charlie"].repo.as_posix().startswith("/Users/charlienode/")
    assert configs["charlie"].worktree_parent.as_posix().startswith("/Users/charlienode/")
