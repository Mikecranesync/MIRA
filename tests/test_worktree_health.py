"""Tests for tools/worktree-health.sh — the detection-only worktree report.

Everything runs against a THROWAWAY git repo built in a tmpdir, never the real
checkout. The script is copied into the fixture's tools/ dir because it derives
its repo root from its own location.

The contract under test (docs/tech-debt/2026-07-27-worktree-clutter-rca.md § 4):
  - it detects each catalogued failure mode, and
  - it NEVER removes anything, and
  - it exits 0 even with findings (so a cron `&&` chain is never broken).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "worktree-health.sh"


def sh(*args: str, cwd: Path, check: bool = True) -> str:
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise AssertionError(f"{args} failed in {cwd}: {r.stderr}")
    return r.stdout


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A throwaway repo with one commit on `main` and the script installed."""
    r = tmp_path / "repo"
    r.mkdir()
    sh("git", "init", "-q", "-b", "main", ".", cwd=r)
    sh("git", "config", "user.email", "t@example.com", cwd=r)
    sh("git", "config", "user.name", "t", cwd=r)
    (r / "f.txt").write_text("hello\n")
    sh("git", "add", "f.txt", cwd=r)
    sh("git", "commit", "-q", "-m", "init", cwd=r)
    (r / "tools").mkdir()
    shutil.copy2(SCRIPT, r / "tools" / "worktree-health.sh")
    os.chmod(r / "tools" / "worktree-health.sh", 0o755)
    return r


def run_report(repo: Path, *extra: str, env: dict | None = None):
    e = {**os.environ, "MIRA_WT_PARENT": str(repo / "no-such-parent")}
    if env:
        e.update(env)
    return subprocess.run(
        ["bash", "tools/worktree-health.sh", *extra],
        cwd=repo, capture_output=True, text=True, env=e,
    )


def test_healthy_repo_reports_no_findings(repo: Path):
    r = run_report(repo)
    assert r.returncode == 0
    assert "HEALTHY" in r.stdout
    assert "exactly one, and it is the canonical checkout" in r.stdout


def test_detects_second_worktree_holding_main(repo: Path, tmp_path: Path):
    """The RCA's highest-severity failure: two checkouts claiming `main`.

    Git refuses a second checkout of `main`, so reproduce the state the way it
    actually occurs — a linked worktree whose HEAD is the `main` ref.
    """
    other = tmp_path / "second"
    sh("git", "worktree", "add", "--detach", str(other), "main", cwd=repo)
    # point the linked worktree's HEAD at the branch, as a real stale worktree does
    (repo / ".git" / "worktrees" / "second" / "HEAD").write_text("ref: refs/heads/main\n")

    r = run_report(repo)
    assert r.returncode == 0
    assert "worktrees hold `main`" in r.stdout
    assert str(other) in r.stdout


def test_detects_missing_path(repo: Path, tmp_path: Path):
    gone = tmp_path / "gone"
    sh("git", "worktree", "add", "-q", "--detach", str(gone), "main", cwd=repo)
    shutil.rmtree(gone)  # registered but no longer on disk

    r = run_report(repo)
    assert r.returncode == 0
    assert "Registered but missing on disk" in r.stdout
    assert "missing (prunable)" in r.stdout


def test_missing_and_locked_is_called_out_as_prune_skipping(repo: Path, tmp_path: Path):
    """The exact state that let 19 dead entries survive: prune SKIPS locked ones."""
    gone = tmp_path / "lockedgone"
    sh("git", "worktree", "add", "-q", "--detach", str(gone), "main", cwd=repo)
    sh("git", "worktree", "lock", str(gone), cwd=repo)
    shutil.rmtree(gone)

    r = run_report(repo)
    assert r.returncode == 0
    assert "MISSING + LOCKED" in r.stdout
    assert "will SKIP" in r.stdout


def test_detects_deleted_branch_ref(repo: Path, tmp_path: Path):
    wt = tmp_path / "wt-branch"
    sh("git", "branch", "feature-x", cwd=repo)
    sh("git", "worktree", "add", "-q", str(wt), "feature-x", cwd=repo)
    # force-remove the ref out from under the worktree
    sh("git", "update-ref", "-d", "refs/heads/feature-x", cwd=repo)

    r = run_report(repo)
    assert r.returncode == 0
    assert "no longer exists but a worktree still claims it" in r.stdout
    assert "feature-x" in r.stdout


def test_detects_unreachable_detached_head(repo: Path, tmp_path: Path):
    """A detached worktree whose commits no ref reaches — removing it loses them."""
    wt = tmp_path / "wt-detached"
    sh("git", "worktree", "add", "-q", "--detach", str(wt), "main", cwd=repo)
    (wt / "orphan.txt").write_text("only here\n")
    sh("git", "add", "orphan.txt", cwd=wt)
    sh("git", "commit", "-q", "-m", "orphan work", cwd=wt)

    r = run_report(repo)
    assert r.returncode == 0
    assert "reachable from NO ref" in r.stdout


def test_detects_old_worktree_via_threshold(repo: Path, tmp_path: Path):
    wt = tmp_path / "wt-old"
    sh("git", "worktree", "add", "-q", "--detach", str(wt), "main", cwd=repo)
    # threshold 0 days makes any existing worktree "old" — deterministic, no clock games
    r = run_report(repo, env={"MIRA_WT_MAX_AGE_DAYS": "0"})
    assert r.returncode == 0
    assert "Older than 0 days" in r.stdout
    assert str(wt) in r.stdout


def test_detects_parent_dir_accumulation(repo: Path, tmp_path: Path):
    parent = tmp_path / "wt-parent"
    (parent / "a").mkdir(parents=True)
    (parent / "b").mkdir(parents=True)
    r = run_report(repo, env={"MIRA_WT_PARENT": str(parent)})
    assert r.returncode == 0
    assert "2 entries left under" in r.stdout


def test_reports_owner_and_branch_inventory(repo: Path, tmp_path: Path):
    wt = tmp_path / "wt-own"
    sh("git", "branch", "feat/thing", cwd=repo)
    sh("git", "worktree", "add", "-q", str(wt), "feat/thing", cwd=repo)
    r = run_report(repo)
    assert "Inventory with inferred owner" in r.stdout
    assert "canonical checkout" in r.stdout
    assert "feat/thing" in r.stdout


def test_never_deletes_anything(repo: Path, tmp_path: Path):
    """The core safety contract — the report is read-only."""
    kept, gone = tmp_path / "kept", tmp_path / "vanished"
    sh("git", "worktree", "add", "-q", "--detach", str(kept), "main", cwd=repo)
    sh("git", "worktree", "add", "-q", "--detach", str(gone), "main", cwd=repo)
    shutil.rmtree(gone)  # a finding the script must NOT "helpfully" prune

    before = sh("git", "worktree", "list", "--porcelain", cwd=repo)
    r = run_report(repo)
    after = sh("git", "worktree", "list", "--porcelain", cwd=repo)

    assert r.returncode == 0
    assert before == after, "worktree registry changed — the report must be read-only"
    assert kept.exists(), "an existing worktree directory was removed"


def test_strict_flag_exits_1_only_when_findings_exist(repo: Path, tmp_path: Path):
    clean = run_report(repo, "--strict")
    assert clean.returncode == 0, "no findings must still exit 0 under --strict"

    gone = tmp_path / "s-gone"
    sh("git", "worktree", "add", "-q", "--detach", str(gone), "main", cwd=repo)
    shutil.rmtree(gone)
    dirty = run_report(repo, "--strict")
    assert dirty.returncode == 1
    # and without --strict the same state must still exit 0
    assert run_report(repo).returncode == 0
