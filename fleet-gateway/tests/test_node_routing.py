"""Physical-node routing regression tests (#3533 / #3552).

#3552 was: the Gateway accepted ``role=charlie`` but the session physically ran
on Bravo (Bravo hostname, Bravo worktree path). Root cause: one CAO client and a
Bravo-hardcoded worktree provisioner. These tests pin the fix so it cannot recur.

The seven proofs required by the task:
  1. Bravo launch selects the Bravo CAO (and not Charlie's).
  2. Charlie launch selects the Charlie CAO (and not Bravo's).
  3. Bravo worktree path is under /Users/bravonode/... (local, no SSH).
  4. Charlie worktree path is under /Users/charlienode/... AND ops use SSH.
  5. A Charlie session's follow-up (status/message/stop) routes back to Charlie.
  6. Unknown/unsupported node fails closed with NO CAO/worktree side effect.
  7. Legacy single-CAO Bravo behavior stays compatible (+ node ≠ provider).

All hermetic: no real SSH, no network. Charlie's SSH filesystem ops are driven
through a stateful fake `subprocess.run` so the REAL WorktreeProvisioner code
(ssh argv construction, charlie paths) is exercised, just not a real host.
"""

from __future__ import annotations

import shlex
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from fleet_gateway.cao import FakeCAO
from fleet_gateway.errors import ContractViolation
from fleet_gateway.router import NodeRouter, NodeTarget
from fleet_gateway.service import build_service
from fleet_gateway.worktree import (
    ALPHA_PARENT,
    ALPHA_REPO,
    WorktreeProvisioner,
    alpha_worktrees_from_env,
    bravo_worktrees_from_env,
    charlie_worktrees_from_env,
)
from helpers import AUTH_HEADER, TEST_BEARER

CHARLIE_REPO = "/Users/charlienode/MIRA"
CHARLIE_PARENT = "/Users/charlienode/MIRA-worktrees"


# ── hermetic remote FS: a stateful fake subprocess.run for the Charlie path ──
class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _make_fake_run(existing: set[str], seen: list[list[str]]):
    """Simulate a remote filesystem over SSH. ``existing`` seeds dirs that exist
    (e.g. the Charlie repo); ``seen`` records every dispatched command for asserts."""

    def fake_run(full_argv: list[str], **_kw: Any) -> _FakeProc:
        seen.append(list(full_argv))
        # Unwrap `ssh -o BatchMode=yes <host> "<remote cmd>"` into the remote tokens.
        if full_argv and full_argv[0] == "ssh":
            toks = shlex.split(full_argv[-1])
        else:
            toks = list(full_argv)
        if not toks:
            return _FakeProc(0)
        if toks[0] == "test" and len(toks) >= 3 and toks[1] == "-d":
            return _FakeProc(0 if toks[2] in existing else 1)
        if toks[0] == "mkdir":
            existing.add(toks[-1])
            return _FakeProc(0)
        if toks[0] == "git" and "worktree" in toks and "add" in toks:
            # `git -C <repo> worktree add --detach <path> <commit>`
            path = toks[toks.index("--detach") + 1]
            existing.add(path)
            return _FakeProc(0)
        return _FakeProc(0)

    return fake_run


def _init_git_repo(repo: Path) -> str:
    repo.mkdir(parents=True, exist_ok=True)
    run = lambda *a: subprocess.run(a, cwd=repo, check=True, capture_output=True)  # noqa: E731
    run("git", "init", "-b", "main")
    run("git", "config", "user.email", "t@localhost")
    run("git", "config", "user.name", "T")
    run("git", "config", "commit.gpgsign", "false")
    (repo / "README.md").write_text("x\n", encoding="utf-8")
    run("git", "add", "README.md")
    run("git", "commit", "-m", "init")
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()


def _two_node_service(tmp_path: Path):
    """Service with a REAL two-node router: distinct Bravo/Charlie FakeCAOs, a
    real local Bravo provisioner (temp repo), and the real Charlie SSH provisioner."""
    bravo_repo = tmp_path / "bravo-origin"
    sha = _init_git_repo(bravo_repo)
    bravo_cao = FakeCAO()
    charlie_cao = FakeCAO()
    bravo_wt = WorktreeProvisioner(repo=bravo_repo, parent=tmp_path / "bravo-wt")
    charlie_wt = WorktreeProvisioner(
        repo=Path(CHARLIE_REPO), parent=Path(CHARLIE_PARENT), ssh_host="charlie"
    )
    router = NodeRouter(
        {
            "bravo": NodeTarget("bravo", bravo_cao, bravo_wt),
            "charlie": NodeTarget("charlie", charlie_cao, charlie_wt),
        }
    )
    service = build_service(
        bearer_token=TEST_BEARER,
        router=router,
        data_dir=tmp_path / "gw",
        requester="routing-test",
    )
    return service, bravo_cao, charlie_cao, sha


def _launch(service, *, role: str, sha: str, provider: str = "claude", task: str = "t-1") -> dict:
    return service.invoke(
        "launch_worker",
        {
            "role": role,
            "provider": provider,
            "task_id": task,
            "github_ref": "feat/x",
            "base_commit": sha,
            "acceptance_criteria": "prove routing",
            "isolated_worktree": True,
        },
        authorization=AUTH_HEADER,
    )


def _tools_called(cao: FakeCAO) -> list[str]:
    return [name for name, _ in cao.calls]


# ── 1. Bravo launch selects the Bravo CAO ────────────────────────────────────
def test_bravo_launch_selects_bravo_cao(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    _launch(service, role="bravo", sha=sha)
    assert "launch_worker" in _tools_called(bravo_cao)
    assert charlie_cao.calls == []  # Charlie CAO untouched


# ── 2. Charlie launch selects the Charlie CAO ────────────────────────────────
def test_charlie_launch_selects_charlie_cao(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    existing = {CHARLIE_REPO}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        _launch(service, role="charlie", sha=sha)
    assert "launch_worker" in _tools_called(charlie_cao)
    assert bravo_cao.calls == []  # Bravo CAO untouched — the #3552 failure


# ── 3. Bravo worktree path is local under /Users/bravonode/... ───────────────
def test_bravo_worktree_is_bravo_local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Config truth: the env constructor points at the real Bravo paths, no SSH.
    monkeypatch.delenv("FLEET_GATEWAY_REPO", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_WORKTREE_PARENT", raising=False)
    bravo = bravo_worktrees_from_env()
    assert bravo.repo == Path("/Users/bravonode/Mira")
    assert bravo.parent == Path("/Users/bravonode/Mira-worktrees")
    assert bravo.ssh_host is None  # local, never SSH

    # Functional truth: a real local create lands under the configured parent and
    # never under a Charlie path (no cross-node bleed).
    repo = tmp_path / "b-origin"
    sha = _init_git_repo(repo)
    local = WorktreeProvisioner(repo=repo, parent=tmp_path / "b-wt")
    path = local.create(task_id="t", session_id="s1", base_commit=sha)
    assert str(path).startswith(str(tmp_path / "b-wt"))
    assert "/Users/charlienode/" not in str(path)


# ── 4. Charlie worktree path is /Users/charlienode/... AND ops go over SSH ────
def test_charlie_worktree_is_charlie_local_over_ssh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FLEET_GATEWAY_CHARLIE_REPO", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_CHARLIE_WORKTREE_PARENT", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_CHARLIE_SSH_HOST", raising=False)
    charlie = charlie_worktrees_from_env()
    assert charlie.repo == Path("/Users/charlienode/MIRA")
    assert charlie.parent == Path("/Users/charlienode/MIRA-worktrees")
    assert charlie.ssh_host == "charlie"

    existing = {CHARLIE_REPO}
    seen: list[list[str]] = []
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, seen)):
        path = charlie.create(task_id="t", session_id="sess", base_commit="deadbeef")
    # Path lives on Charlie.
    assert str(path).startswith("/Users/charlienode/MIRA-worktrees/")
    # The git worktree add was dispatched OVER SSH to Charlie, targeting Charlie's repo.
    git_cmds = [c for c in seen if c and c[0] == "ssh" and "worktree add" in c[-1]]
    assert git_cmds, f"no ssh git worktree command seen: {seen}"
    remote = git_cmds[0]
    assert remote[1:4] == ["-o", "BatchMode=yes", "charlie"] or "charlie" in remote[:5]
    assert "git -C /Users/charlienode/MIRA worktree add --detach" in remote[-1]
    # NOTHING ran locally against a Charlie path (every op was an ssh invocation).
    assert all(c[0] == "ssh" for c in seen), f"a non-ssh op touched a Charlie path: {seen}"


# ── 5. Charlie session follow-up routes back to the Charlie CAO ───────────────
def test_charlie_followup_routes_to_charlie(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    existing = {CHARLIE_REPO}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        launched = _launch(service, role="charlie", sha=sha)
    session_id = launched["session_id"]

    # message → Charlie CAO only
    service.invoke(
        "message_worker",
        {"session_id": session_id, "text": "status?"},
        authorization=AUTH_HEADER,
    )
    assert session_id in charlie_cao.messages
    assert bravo_cao.messages == {}

    # stop → Charlie CAO only
    service.invoke("stop_worker", {"session_id": session_id}, authorization=AUTH_HEADER)
    assert ("stop_worker", {"session_id": session_id}) in charlie_cao.calls
    assert "stop_worker" not in _tools_called(bravo_cao)


# ── 6. Unknown node fails closed with NO side effect ─────────────────────────
def test_unknown_node_fails_closed(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    with pytest.raises(ContractViolation):
        _launch(service, role="delta", sha=sha)
    # No CAO session on EITHER node, no worktree.
    assert bravo_cao.calls == []
    assert charlie_cao.calls == []

    # The router itself also fails closed (defense in depth), never defaults to Bravo.
    router = service.router
    with pytest.raises(ContractViolation):
        router.target("delta")
    with pytest.raises(ContractViolation):
        router.target(None)


# ── 7a. Legacy single-CAO Bravo behavior stays compatible ────────────────────
def test_legacy_single_cao_still_works(tmp_path: Path) -> None:
    repo = tmp_path / "legacy-origin"
    sha = _init_git_repo(repo)
    cao = FakeCAO()
    service = build_service(
        bearer_token=TEST_BEARER,
        cao=cao,  # legacy path: no router
        data_dir=tmp_path / "gw",
        requester="legacy",
        worktrees=WorktreeProvisioner(repo=repo, parent=tmp_path / "wt"),
    )
    assert service.router.is_single()  # wrapped into a single-node router
    out = _launch(service, role="bravo", sha=sha)
    assert out["ok"] is True
    assert "launch_worker" in _tools_called(cao)


# ── 7b. Node identity is separate from provider (node ≠ provider/profile) ─────
def test_node_is_separate_from_provider(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    existing = {CHARLIE_REPO}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        _launch(service, role="charlie", provider="codex", sha=sha, task="t-codex")
    # Node selected the CAO (Charlie); provider passed through untouched (codex),
    # independent of the node. Bravo CAO never saw it.
    _, spec = next((c for c in charlie_cao.calls if c[0] == "launch_worker"))
    assert spec["role"] == "charlie"
    assert spec["provider"] == "codex"
    assert bravo_cao.calls == []


# ── #3552 cannot recur: charlie launch NEVER lands on Bravo (CAO or worktree) ─
def test_3552_charlie_never_lands_on_bravo(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, sha = _two_node_service(tmp_path)
    existing = {CHARLIE_REPO}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        out = _launch(service, role="charlie", sha=sha, task="charlie-routing")
    # (a) Charlie CAO got the launch; Bravo CAO got nothing.
    assert "launch_worker" in _tools_called(charlie_cao)
    assert bravo_cao.calls == []
    # (b) The working directory handed to CAO is a CHARLIE path, not Bravo's.
    _, spec = next((c for c in charlie_cao.calls if c[0] == "launch_worker"))
    assert spec["working_directory"].startswith("/Users/charlienode/")
    assert "/Users/bravonode/" not in spec["working_directory"]
    # (c) The advertised worktree in the result is Charlie-local too.
    assert out["worktree"].startswith("/Users/charlienode/")


# ── 8. Alpha is a real third node (same guarantees as Charlie, its own machine) ─


def _three_node_service(tmp_path: Path):
    """Bravo (local) + Charlie (SSH) + Alpha (SSH), each with its own FakeCAO."""
    bravo_repo = tmp_path / "bravo-origin"
    sha = _init_git_repo(bravo_repo)
    bravo_cao, charlie_cao, alpha_cao = FakeCAO(), FakeCAO(), FakeCAO()
    router = NodeRouter(
        {
            "bravo": NodeTarget(
                "bravo",
                bravo_cao,
                WorktreeProvisioner(repo=bravo_repo, parent=tmp_path / "bravo-wt"),
            ),
            "charlie": NodeTarget(
                "charlie",
                charlie_cao,
                WorktreeProvisioner(
                    repo=Path(CHARLIE_REPO), parent=Path(CHARLIE_PARENT), ssh_host="charlie"
                ),
            ),
            "alpha": NodeTarget(
                "alpha",
                alpha_cao,
                WorktreeProvisioner(
                    repo=Path(ALPHA_REPO), parent=Path(ALPHA_PARENT), ssh_host="alpha"
                ),
            ),
        }
    )
    service = build_service(
        bearer_token=TEST_BEARER,
        router=router,
        data_dir=tmp_path / "gw",
        requester="routing-test",
    )
    return service, bravo_cao, charlie_cao, alpha_cao, sha


def test_alpha_launch_selects_alpha_cao(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, alpha_cao, sha = _three_node_service(tmp_path)
    existing = {str(ALPHA_REPO)}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        _launch(service, role="alpha", sha=sha, task="t-alpha")
    assert "launch_worker" in _tools_called(alpha_cao)
    # Neither of the OTHER nodes' CAOs saw it — no silent default to Bravo.
    assert bravo_cao.calls == []
    assert charlie_cao.calls == []


def test_alpha_worktree_is_alpha_local_over_ssh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FLEET_GATEWAY_ALPHA_REPO", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_ALPHA_WORKTREE_PARENT", raising=False)
    monkeypatch.delenv("FLEET_GATEWAY_ALPHA_SSH_HOST", raising=False)
    alpha = alpha_worktrees_from_env()
    assert alpha.repo == Path("/Users/factorylm/MIRA")
    assert alpha.parent == Path("/Users/factorylm/MIRA-worktrees")
    assert alpha.ssh_host == "alpha"

    existing = {str(ALPHA_REPO)}
    seen: list[list[str]] = []
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, seen)):
        path = alpha.create(task_id="t", session_id="sess", base_commit="deadbeef")
    assert str(path).startswith("/Users/factorylm/MIRA-worktrees/")
    git_cmds = [c for c in seen if c and c[0] == "ssh" and "worktree add" in c[-1]]
    assert git_cmds, f"no ssh git worktree command seen: {seen}"
    remote = git_cmds[0]
    assert "alpha" in remote[:5]
    assert "git -C /Users/factorylm/MIRA worktree add --detach" in remote[-1]
    # Every op went over SSH — nothing touched a local /Users/factorylm path.
    assert all(c[0] == "ssh" for c in seen), f"a non-ssh op touched an Alpha path: {seen}"


def test_alpha_followup_routes_to_alpha(tmp_path: Path) -> None:
    service, bravo_cao, charlie_cao, alpha_cao, sha = _three_node_service(tmp_path)
    existing = {str(ALPHA_REPO)}
    with patch("fleet_gateway.worktree.subprocess.run", _make_fake_run(existing, [])):
        launched = _launch(service, role="alpha", sha=sha, task="t-alpha")
    session_id = launched["session_id"]
    service.invoke(
        "message_worker",
        {"session_id": session_id, "text": "status?"},
        authorization=AUTH_HEADER,
    )
    assert session_id in alpha_cao.messages
    assert bravo_cao.messages == {}
    assert charlie_cao.messages == {}
