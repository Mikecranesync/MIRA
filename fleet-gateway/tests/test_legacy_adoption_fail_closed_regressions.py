"""Regressions for fail-open holes in SAFE-LEGACY-SESSION-ADOPTION (#3568).

Each test here failed against 6b2b71e4acca192cc582ec640129a65bb6927779 and encodes
one confirmed way adoption could commit ownership it had not earned. The shared
invariant: **a refused adoption must leave no ownership mutation anywhere** —
not in the artifact store, not in CAO.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from fleet_gateway.errors import ContractViolation, OwnershipError
from fleet_gateway.legacy import FakeLegacySessionProbe, LegacySession, classify_name
from fleet_gateway.service import build_service
from fleet_gateway.worktree import WorktreeProvisioner
from helpers import AUTH_HEADER, TEST_BEARER


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
    bridge: str | None = None,
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


def _adopt(service, external_id, role="bravo"):
    return service.invoke(
        "adopt_legacy_session",
        {"role": role, "external_id": external_id},
        authorization=AUTH_HEADER,
        requester="test",
    )


# --- (b) ambiguity must consider ALL nodes, not just the requested one ------


def test_same_identifier_on_two_nodes_is_ambiguous(data_dir, cao, origin_repo, worktree_parent):
    """A shared identifier matching on bravo AND charlie must reject.

    Before the fix `elsewhere` was computed and then ignored whenever `on_node`
    was non-empty, so the bravo candidate was silently adopted.
    """
    shared = "shared-identifier"
    probe = FakeLegacySessionProbe(
        {
            "bravo": [_sess(node="bravo", local_id="bravo-session", tmux_name=shared)],
            "charlie": [_sess(node="charlie", local_id="charlie-session", tmux_name=shared)],
        }
    )
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    with pytest.raises(ContractViolation) as exc:
        _adopt(service, shared)

    assert "ambiguous" in str(exc.value).lower()
    assert not service.artifacts.is_fleet_owned("bravo-session")
    assert not service.artifacts.is_fleet_owned("charlie-session")
    assert cao.sessions == {}, "a refused adoption mutated CAO"


# --- (c) protected must survive case and unicode variants -------------------


@pytest.mark.parametrize(
    "name",
    [
        "Fleet-Gateway",
        "FLEET-GATEWAY",
        "fleet-gateway",
        "  fleet-gateway  ",
        "CAO-SERVER-1",
        "Cao-Server-x",
        "cao‐server",  # U+2010 HYPHEN, not ASCII '-'
        "fleet‑gateway",  # U+2011 NON-BREAKING HYPHEN
    ],
)
def test_protected_names_are_protected_under_variants(name):
    classification, adoptable = classify_name(name, running=True)
    assert classification == "protected", f"{name!r} classified {classification!r}"
    assert adoptable is False


def test_protected_variant_cannot_be_adopted(data_dir, cao, origin_repo, worktree_parent):
    probe = FakeLegacySessionProbe(
        {"bravo": [_sess(local_id="Fleet-Gateway", tmux_name="Fleet-Gateway")]}
    )
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    with pytest.raises(ContractViolation) as exc:
        _adopt(service, "Fleet-Gateway")

    assert "protected" in str(exc.value).lower()
    assert not service.artifacts.is_fleet_owned("Fleet-Gateway")
    assert cao.sessions == {}


# --- (d) dead / non-real process identities ---------------------------------


@pytest.mark.parametrize("pid", [0, -1, -1000])
def test_non_positive_pids_are_never_alive(pid):
    """`os.kill(0, 0)` signals the process GROUP and succeeds; `-1` targets every
    process. Neither is evidence that a specific session is alive."""
    from fleet_gateway.factory import _pid_alive

    assert _pid_alive(pid) is False


def test_filesystem_probe_ignores_pid_zero(tmp_path):
    from fleet_gateway.legacy import FilesystemClaudeProbe

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    (sessions / "0.json").write_text('{"sessionId": "s-zero", "name": "s-zero"}', encoding="utf-8")

    probe = FilesystemClaudeProbe(node="bravo", sessions_dir=sessions, pid_alive=lambda _pid: True)
    assert probe.list_sessions("bravo") == []


# --- (e)/(2) ownership must not be committed before the binding is proven ----


class _BindingRefusingCAO:
    """A CAO that cannot bind the session — adoption must not confer ownership."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.calls: list[tuple[str, dict]] = []

    def register_adopted_session(self, session_id, meta):
        self.calls.append(("register_adopted_session", {"session_id": session_id}))
        raise OwnershipError(f"refuse: cannot prove CAO binding for '{session_id}'")

    def get_session(self, session_id):
        return None

    def fleet_snapshot(self):
        return {}

    def task_snapshot(self, task_id):
        return None


def test_failed_binding_leaves_no_ownership(data_dir, origin_repo, worktree_parent):
    """The artifact must not be written when CAO cannot prove the binding.

    Before the fix `write_task` ran BEFORE `register_adopted_session`, so a
    failed bind left a durable fleet-owned artifact behind.
    """
    cao = _BindingRefusingCAO()
    probe = FakeLegacySessionProbe({"bravo": [_sess(local_id="legacy-1")]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    with pytest.raises(OwnershipError):
        _adopt(service, "legacy-1")

    assert not service.artifacts.is_fleet_owned("legacy-1"), (
        "ownership artifact survived a failed adoption"
    )


def test_cao_side_existing_owner_is_not_overwritten(data_dir, cao, origin_repo, worktree_parent):
    """A session CAO already reports as claimed by another task must reject,
    even with no local artifact."""
    cao.sessions["legacy-1"] = {
        "session_id": "legacy-1",
        "task_id": "someone-elses-task",
        "role": "charlie",
        "claimed": True,
        "status": "running",
    }
    probe = FakeLegacySessionProbe({"bravo": [_sess(local_id="legacy-1")]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    with pytest.raises(ContractViolation) as exc:
        _adopt(service, "legacy-1")

    assert "already-owned" in str(exc.value).lower()
    assert not service.artifacts.is_fleet_owned("legacy-1")
    assert cao.sessions["legacy-1"]["task_id"] == "someone-elses-task", "CAO owner overwritten"


# --- handoff must prove task_id owns THIS session ---------------------------


def test_handoff_rejects_task_session_mismatch(data_dir, cao, origin_repo, worktree_parent):
    """`_require_fleet_ownership` only proved the session was owned by SOME task.

    A mismatched (task_id, session_id) pair could hand off session A while
    overwriting task B's artifact.
    """
    probe = FakeLegacySessionProbe({"bravo": [_sess(local_id="legacy-1")]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)
    adopted = _adopt(service, "legacy-1")
    real_task = adopted["task_id"]

    service.artifacts.write_task({"task_id": "unrelated-task", "session_id": "other-session"})

    with pytest.raises(OwnershipError) as exc:
        service.invoke(
            "request_handoff",
            {"session_id": "legacy-1", "task_id": "unrelated-task"},
            authorization=AUTH_HEADER,
            requester="test",
        )

    assert "own" in str(exc.value).lower()
    still = service.artifacts.read_task("unrelated-task") or {}
    assert still.get("session_id") == "other-session", "mismatched handoff rewrote another task"
    assert real_task != "unrelated-task"


# --- the happy path must still work ----------------------------------------


def test_valid_unique_legacy_session_is_still_adoptable(
    data_dir, cao, origin_repo, worktree_parent
):
    probe = FakeLegacySessionProbe({"bravo": [_sess(local_id="legacy-ok")]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    result = _adopt(service, "legacy-ok")

    assert result["ok"] is True
    assert result["session_id"] == "legacy-ok"
    assert service.artifacts.is_fleet_owned("legacy-ok")
    # never launched: no POST /sessions equivalent
    assert [c[0] for c in cao.calls] == ["register_adopted_session"]
