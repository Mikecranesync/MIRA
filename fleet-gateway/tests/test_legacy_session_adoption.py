"""SAFE-LEGACY-SESSION-ADOPTION — hermetic discover/map/adopt fail-closed tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from fleet_gateway.errors import ContractViolation, OwnershipError
from fleet_gateway.legacy import (
    FakeLegacySessionProbe,
    FilesystemClaudeProbe,
    LegacySession,
    classify_name,
)
from fleet_gateway.service import build_service
from fleet_gateway.worktree import WorktreeProvisioner
from helpers import AUTH_HEADER, TEST_BEARER

RC_ID = "session_01Cu9kgi8xjCVQuJGYrmZxFR"


def _sess(
    *,
    node: str = "bravo",
    local_id: str = "cao-legacy-claude-1",
    provider: str = "claude",
    classification: str = "legacy",
    adoptable: bool = True,
    cwd: str = "/Users/bravonode/MIRA",
    pid: int = 4242,
    tmux_name: str | None = None,
    bridge: str | None = RC_ID,
) -> LegacySession:
    return LegacySession(
        node=node,
        provider=provider,
        local_session_id=local_id,
        cwd=cwd,
        pid=pid,
        tmux_name=tmux_name or local_id,
        bridge_session_id=bridge,
        classification=classification,
        adoptable=adoptable,
    )


def _service(data_dir: Path, cao, origin_repo, worktree_parent, probe):
    repo, _sha = origin_repo
    return build_service(
        bearer_token=TEST_BEARER,
        cao=cao,
        data_dir=data_dir,
        requester="foreman-test",
        worktrees=WorktreeProvisioner(repo=repo, parent=worktree_parent),
        probe=probe,
    )


def test_list_legacy_sessions_is_read_only(data_dir, cao, origin_repo, worktree_parent):
    live = _sess()
    probe = FakeLegacySessionProbe({"bravo": [live]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    result = service.invoke(
        "list_legacy_sessions",
        {"role": "bravo"},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert result["ok"] is True
    assert result["sessions"][0]["bridge_session_id"] == RC_ID
    assert result["sessions"][0]["adoptable"] is True
    assert not service.artifacts.is_fleet_owned(live.local_session_id)
    assert cao.sessions == {}


def test_adopt_wrong_node(data_dir, cao, origin_repo, worktree_parent):
    probe = FakeLegacySessionProbe({"bravo": [_sess(node="bravo")]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    with pytest.raises(ContractViolation, match="wrong-node"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "charlie", "external_id": RC_ID},
            authorization=AUTH_HEADER,
            requester="test",
        )
    assert not service.artifacts.is_fleet_owned("cao-legacy-claude-1")


def test_adopt_ambiguous(data_dir, cao, origin_repo, worktree_parent):
    probe = FakeLegacySessionProbe(
        {
            "bravo": [
                _sess(local_id="cao-a", pid=11),
                _sess(local_id="cao-b", pid=12),
            ]
        }
    )
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    with pytest.raises(ContractViolation, match="ambiguous"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": RC_ID},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_adopt_protected(data_dir, cao, origin_repo, worktree_parent):
    protected = _sess(
        local_id="fleet-gateway",
        tmux_name="fleet-gateway",
        classification="protected",
        adoptable=False,
        bridge="session_01protected",
    )
    probe = FakeLegacySessionProbe({"bravo": [protected]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    with pytest.raises(ContractViolation, match="protected"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": "session_01protected"},
            authorization=AUTH_HEADER,
            requester="test",
        )
    assert not service.artifacts.is_fleet_owned("fleet-gateway")


def test_adopt_stale(data_dir, cao, origin_repo, worktree_parent):
    stale = _sess(
        local_id="cao-dead",
        classification="stale",
        adoptable=False,
        bridge="session_01stale",
    )
    probe = FakeLegacySessionProbe({"bravo": [stale]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    with pytest.raises(ContractViolation, match="stale"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": "session_01stale"},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_adopt_already_owned(data_dir, cao, origin_repo, worktree_parent):
    live = _sess()
    probe = FakeLegacySessionProbe({"bravo": [live]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    first = service.invoke(
        "adopt_legacy_session",
        {"role": "bravo", "external_id": RC_ID},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert first["ok"] is True
    with pytest.raises(ContractViolation, match="already-owned"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": RC_ID},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_unique_remote_control_adopt_then_message_worker(
    data_dir, cao, origin_repo, worktree_parent
):
    live = _sess()
    probe = FakeLegacySessionProbe({"bravo": [live]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    adopted = service.invoke(
        "adopt_legacy_session",
        {"role": "bravo", "external_id": RC_ID},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert adopted["session_id"] == live.local_session_id
    assert adopted["provider"] == "claude"
    assert adopted["cwd"] == live.cwd
    assert adopted["pid"] == live.pid
    assert adopted["provenance"]["external_id"] == RC_ID
    assert adopted["provenance"]["match_field"] == "bridge_session_id"
    assert service.artifacts.is_fleet_owned(live.local_session_id)
    artifact = service.artifacts.read_task(adopted["task_id"])
    assert artifact["fleet_owned"] is True
    assert artifact["node"] == "bravo"
    assert artifact["local_session_id"] == live.local_session_id

    messaged = service.invoke(
        "message_worker",
        {"session_id": live.local_session_id, "text": "hostname; whoami"},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert messaged["accepted"] is True
    assert any(
        call[0] == "message_worker" and call[1].get("session_id") == live.local_session_id
        for call in cao.calls
    )

    with pytest.raises(OwnershipError):
        service.invoke(
            "stop_worker",
            {"session_id": "synthetic-unowned-other"},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_adopt_does_not_call_launch_worker(data_dir, cao, origin_repo, worktree_parent):
    probe = FakeLegacySessionProbe({"bravo": [_sess()]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    service.invoke(
        "adopt_legacy_session",
        {"role": "bravo", "external_id": RC_ID},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert not any(call[0] == "launch_worker" for call in cao.calls)
    assert any(call[0] == "register_adopted_session" for call in cao.calls)


def test_filesystem_probe_maps_bridge_id(tmp_path: Path):
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "4242.json").write_text(
        '{"sessionId":"local-abc","cwd":"/tmp/proj","bridgeSessionId":"%s","name":"legacy-cli"}\n'
        % RC_ID,
        encoding="utf-8",
    )
    probe = FilesystemClaudeProbe(
        node="bravo",
        sessions_dir=sessions_dir,
        pid_alive=lambda pid: pid == 4242,
    )
    found = probe.list_sessions("bravo")
    assert len(found) == 1
    assert found[0].matches(RC_ID)
    assert found[0].local_session_id == "local-abc"
    assert found[0].classification == "legacy"
    assert probe.list_sessions("charlie") == []


def test_classify_name_protects_gateway_and_cao_server():
    assert classify_name("fleet-gateway", running=True) == ("protected", False)
    assert classify_name("cao-server", running=True) == ("protected", False)
    assert classify_name("cao-server-bravo", running=True) == ("protected", False)
    assert classify_name("cao-legacy-claude-1", running=True) == ("legacy", True)
    assert classify_name("cao-legacy-claude-1", running=False) == ("stale", False)


def test_filesystem_probe_stale_pid_not_adoptable(tmp_path: Path):
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "99.json").write_text(
        '{"sessionId":"dead-local","cwd":"/tmp/gone","bridgeSessionId":"session_01stale"}\n',
        encoding="utf-8",
    )
    probe = FilesystemClaudeProbe(
        node="bravo",
        sessions_dir=sessions_dir,
        pid_alive=lambda _pid: False,
    )
    found = probe.list_sessions("bravo")
    assert len(found) == 1
    assert found[0].classification == "stale"
    assert found[0].adoptable is False
