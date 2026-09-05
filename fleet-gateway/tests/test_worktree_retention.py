"""Bounded retention for Gateway-created worktrees (#3546).

Every `launch_worker` used to strand ~561 MB forever — `worktree.py` created
`fleet-e2e-*` directories that nothing ever removed. On 2026-09-04 that filled
Charlie's disk to 100% (283 MB free of 228 GB) and a `git worktree add` failed
with "No space left on device", blocking a PR review.

Teardown-on-stop is not available: `delete_worktree` is hard-denied in the tool
contract and `_stop_worker` raises `ContractViolation` on it. So the bound is
applied at create time instead, and it must never destroy real work.
"""

from __future__ import annotations

import subprocess

import pytest
from fleet_gateway.worktree import (
    DEFAULT_RETAIN,
    RETAIN_ENV,
    WORKTREE_PREFIX,
    WorktreeProvisioner,
    retain_from_env,
)


def _git(*args: str, cwd) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    """A real git repo with one commit — the source for worktrees."""
    r = tmp_path / "repo"
    r.mkdir()
    _git("init", "-q", "-b", "main", cwd=r)
    _git("config", "user.email", "t@example.com", cwd=r)
    _git("config", "user.name", "t", cwd=r)
    (r / "README.md").write_text("hello\n", encoding="utf-8")
    _git("add", "README.md", cwd=r)
    _git("commit", "-qm", "init", cwd=r)
    return r


@pytest.fixture
def head(repo):
    out = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(repo), capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def _provisioner(repo, tmp_path):
    return WorktreeProvisioner(repo=repo, parent=tmp_path / "wt")


def _make(prov, head, n):
    """Create n worktrees, oldest first."""
    made = []
    for i in range(n):
        made.append(prov.create(task_id=f"T{i}", session_id=f"sess{i:04d}", base_commit=head))
    return made


# --- env bound --------------------------------------------------------------


def test_retain_defaults(monkeypatch):
    monkeypatch.delenv(RETAIN_ENV, raising=False)
    assert retain_from_env() == DEFAULT_RETAIN


@pytest.mark.parametrize("raw,expected", [("3", 3), ("0", 0), ("-5", 0), ("junk", DEFAULT_RETAIN)])
def test_retain_parsing(monkeypatch, raw, expected):
    monkeypatch.setenv(RETAIN_ENV, raw)
    assert retain_from_env() == expected


def test_zero_disables_the_sweep(repo, head, tmp_path):
    prov = _provisioner(repo, tmp_path)
    _make(prov, head, 3)
    assert prov.reap(retain=0) == []
    assert len(list((tmp_path / "wt").glob(f"{WORKTREE_PREFIX}*"))) == 3


# --- the bound actually bounds ---------------------------------------------


def test_reap_keeps_newest_and_removes_the_rest(repo, head, tmp_path):
    prov = _provisioner(repo, tmp_path)
    _make(prov, head, 5)
    assert len(list((tmp_path / "wt").glob(f"{WORKTREE_PREFIX}*"))) == 5

    removed = prov.reap(retain=2)

    assert len(removed) == 3
    remaining = list((tmp_path / "wt").glob(f"{WORKTREE_PREFIX}*"))
    assert len(remaining) == 2, "retention bound not enforced — this is the #3546 leak"


def test_create_bounds_accumulation(repo, head, tmp_path, monkeypatch):
    """The regression: N launches must not leave N worktrees on disk."""
    monkeypatch.setenv(RETAIN_ENV, "3")
    prov = _provisioner(repo, tmp_path)
    for i in range(8):
        prov.create(task_id="SAME-REVIEW-TASK", session_id=f"s{i:04d}", base_commit=head)

    on_disk = list((tmp_path / "wt").glob(f"{WORKTREE_PREFIX}*"))
    assert len(on_disk) <= 4, f"8 launches left {len(on_disk)} worktrees — unbounded"


def test_under_the_bound_nothing_is_removed(repo, head, tmp_path):
    prov = _provisioner(repo, tmp_path)
    _make(prov, head, 2)
    assert prov.reap(retain=12) == []
    assert len(list((tmp_path / "wt").glob(f"{WORKTREE_PREFIX}*"))) == 2


# --- safety: real work must survive ----------------------------------------


def test_gateway_artifacts_do_not_block_reaping(repo, head, tmp_path):
    """Its own proof files must not wedge the sweep (they blocked plain remove)."""
    prov = _provisioner(repo, tmp_path)
    made = _make(prov, head, 3)
    for w in made:
        (w / "FOREMAN-GATEWAY-PROOF.txt").write_text("FOREMAN-GATEWAY-PROOF", encoding="utf-8")
        (w / ".enum-drift-allowlist.txt").write_text("x", encoding="utf-8")

    removed = prov.reap(retain=1)
    assert len(removed) == 2


def test_untracked_human_work_is_never_destroyed(repo, head, tmp_path):
    """A hand-written .fleet/*.md handoff must survive — 3 real ones existed on
    Charlie and a blanket sweep would have destroyed them."""
    prov = _provisioner(repo, tmp_path)
    made = _make(prov, head, 3)
    victim = made[0]  # oldest -> first reap candidate
    (victim / ".fleet").mkdir(parents=True, exist_ok=True)
    (victim / ".fleet" / "HANDOFF.md").write_text("real work\n", encoding="utf-8")

    prov.reap(retain=1)

    assert victim.exists(), "a worktree holding a human handoff was destroyed"
    assert (victim / ".fleet" / "HANDOFF.md").read_text() == "real work\n"


def test_tracked_modifications_are_never_destroyed(repo, head, tmp_path):
    prov = _provisioner(repo, tmp_path)
    made = _make(prov, head, 3)
    victim = made[0]
    (victim / "README.md").write_text("EDITED — uncommitted\n", encoding="utf-8")

    prov.reap(retain=1)

    assert victim.exists(), "a worktree with uncommitted tracked changes was destroyed"
    assert "EDITED" in (victim / "README.md").read_text()


def test_non_gateway_siblings_are_never_candidates(repo, head, tmp_path):
    """A CAO session's own working directory lives beside these and must be
    untouchable — on Charlie, `fleet-001-review` backs 3 protected sessions."""
    prov = _provisioner(repo, tmp_path)
    _make(prov, head, 3)
    parent = tmp_path / "wt"
    protected = parent / "fleet-001-review"
    protected.mkdir()
    (protected / "keep.txt").write_text("protected\n", encoding="utf-8")

    prov.reap(retain=1)

    assert protected.exists(), "a non-fleet-e2e sibling was reaped"
    assert (protected / "keep.txt").read_text() == "protected\n"


def test_reap_never_raises_on_a_broken_parent(repo, tmp_path):
    """A sweep failure must never break a launch."""
    prov = WorktreeProvisioner(repo=repo, parent=tmp_path / "does-not-exist")
    assert prov.reap(retain=1) == []
