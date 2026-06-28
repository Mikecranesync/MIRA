"""Regression tests for the self-healer's removed-container recovery and the
Telegram alert fallback.

Locks in the fixes for the 2026-06-04 / 2026-06-06 app.factorylm.com 502
incidents:

  * `container_missing` must RECREATE (`docker compose up -d`), not `docker
    restart` — a removed container can't be restarted.
  * `restart_container` must fall back to a recreate when the container is
    absent.
  * recreate success must be gated on the container going *healthy*, not just
    on `compose up` exiting 0.
  * a Telegram alert rejected for bad Markdown must retry as plain text so the
    outage notification still lands (it had been silently 400-ing for days).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
AGENTS_DIR = REPO_ROOT / "mira-crawler" / "agents"
REPORTING_DIR = REPO_ROOT / "mira-crawler" / "reporting"
for _p in (str(REPO_ROOT), str(AGENTS_DIR), str(REPORTING_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register so dataclasses can resolve __module__
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def healer():
    return _load("self_healer", AGENTS_DIR / "self_healer.py")


@pytest.fixture(scope="module")
def tg():
    return _load("telegram_notify", REPORTING_DIR / "telegram_notify.py")


# ── healer: routing ──────────────────────────────────────────────────────────


def test_container_missing_recreates_not_restarts(healer):
    """The whole point: a missing container goes to recreate, never restart."""
    assert healer.PLAYBOOKS["container_missing"] is healer.recreate_container


# ── healer: recreate playbook ────────────────────────────────────────────────


def test_recreate_runs_compose_up_and_succeeds_when_healthy(healer, monkeypatch):
    calls = {}

    def fake_compose_up(service):
        calls["service"] = service
        return (0, "Container mira-hub Started", "")

    monkeypatch.setattr(healer, "_compose_up", fake_compose_up)
    monkeypatch.setattr(healer, "_await_container_health", lambda s: healer.hb.STATUS_HEALTHY)

    action = healer.recreate_container("mira-hub", "container_missing")

    assert calls["service"] == "mira-hub"
    assert action.succeeded is True
    assert "compose up" in action.action
    assert "healthy" in action.details


def test_recreate_fails_when_container_never_goes_healthy(healer, monkeypatch):
    """compose up exiting 0 is NOT enough — the app must actually serve."""
    monkeypatch.setattr(healer, "_compose_up", lambda s: (0, "", ""))
    monkeypatch.setattr(healer, "_await_container_health", lambda s: "degraded")

    action = healer.recreate_container("mira-hub", "container_missing")

    assert action.succeeded is False


def test_recreate_fails_on_compose_error(healer, monkeypatch):
    monkeypatch.setattr(healer, "_compose_up", lambda s: (1, "", "no such service: mira-hub"))

    action = healer.recreate_container("mira-hub", "container_missing")

    assert action.succeeded is False
    assert "no such service" in action.details


# ── healer: restart fallback ─────────────────────────────────────────────────


def test_restart_falls_back_to_recreate_when_absent(healer, monkeypatch):
    monkeypatch.setattr(healer, "_container_exists", lambda s: False)
    sentinel = healer.HealAction("mira-hub", "h", "recreated", True, "via recreate")
    monkeypatch.setattr(healer, "recreate_container", lambda s, h: sentinel)

    action = healer.restart_container("mira-hub", "container_exited")

    assert action is sentinel


def test_restart_uses_docker_restart_when_present(healer, monkeypatch):
    monkeypatch.setattr(healer, "_container_exists", lambda s: True)
    monkeypatch.setattr(healer, "_run", lambda cmd, timeout=60: (0, "mira-hub", ""))

    action = healer.restart_container("mira-hub", "container_unhealthy")

    assert action.succeeded is True
    assert action.action == "docker restart mira-hub"


def test_restart_recovers_on_no_such_container_race(healer, monkeypatch):
    monkeypatch.setattr(healer, "_container_exists", lambda s: True)
    monkeypatch.setattr(
        healer, "_run", lambda cmd, timeout=60: (1, "", "No such container: mira-hub")
    )
    sentinel = healer.HealAction("mira-hub", "h", "recreated", True, "via recreate")
    monkeypatch.setattr(healer, "recreate_container", lambda s, h: sentinel)

    action = healer.restart_container("mira-hub", "container_exited")

    assert action is sentinel


# ── telegram: plain-text fallback ────────────────────────────────────────────


def test_send_retries_plain_text_on_parse_error(tg, monkeypatch):
    posted = []

    class FakeResp:
        def __init__(self, code, text):
            self.status_code = code
            self.text = text

    def fake_post(url, json, timeout):
        posted.append(json)
        if "parse_mode" in json:
            return FakeResp(400, '{"ok":false,"description":"Bad Request: can\'t parse entities"}')
        return FakeResp(200, '{"ok":true}')

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)

    ok = tg._send("tok", "chat", "broken `markdown", "Markdown", label="system")

    assert ok is True
    # First attempt with Markdown (rejected), second as plain text (no parse_mode).
    assert len(posted) == 2
    assert "parse_mode" in posted[0]
    assert "parse_mode" not in posted[1]


def test_send_no_retry_on_success(tg, monkeypatch):
    posted = []

    class FakeResp:
        status_code = 200
        text = '{"ok":true}'

    def fake_post(url, json, timeout):
        posted.append(json)
        return FakeResp()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)

    ok = tg._send("tok", "chat", "clean message", "Markdown")

    assert ok is True
    assert len(posted) == 1
