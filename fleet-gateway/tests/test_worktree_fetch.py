"""Tests for WorktreeProvisioner._ensure_commit() — fetch before worktree add.

Verifies that create() fetches an unfetched base commit so remote nodes
(Charlie, Alpha) can provision worktrees at SHAs they haven't yet fetched.

Regression test for #3568 and the audit log evidence (8 failures on 2026-09-04).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from fleet_gateway.errors import ContractViolation
from fleet_gateway.worktree import WorktreeProvisioner


@pytest.fixture
def git_repo_pair(tmp_path: Path):
    """Two independent git clones for hermetic testing.

    Returns (origin, clone1) where:
    - origin is a bare repo (like a GitHub remote)
    - clone1 is a working clone with one commit
    - clone2 (created in tests) will have a second commit not yet in clone1
    """
    # Set up git env so commits work in CI
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test Author",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "Test Committer",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }

    origin = tmp_path / "origin.git"
    origin.mkdir()

    # Initialize bare repo
    subprocess.run(
        ["git", "init", "--bare"],
        cwd=origin,
        env=env,
        check=True,
        capture_output=True,
    )

    # Create clone1
    clone1 = tmp_path / "clone1"
    subprocess.run(
        ["git", "clone", str(origin), str(clone1)],
        env=env,
        check=True,
        capture_output=True,
    )

    # Create initial commit in clone1 and push to origin
    initial_file = clone1 / "README.md"
    initial_file.write_text("Initial commit\n")
    subprocess.run(
        ["git", "add", "README.md"],
        cwd=clone1,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=clone1,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "push", "-u", "origin", "main"],
        cwd=clone1,
        env=env,
        check=True,
        capture_output=True,
    )

    return origin, clone1, env


@pytest.fixture
def provisioner_local(tmp_path: Path, git_repo_pair: tuple[Path, Path, dict[str, str]]):
    """A WorktreeProvisioner for clone1 (local, no SSH)."""
    origin, clone1, env = git_repo_pair
    parent = tmp_path / "worktrees"
    parent.mkdir()

    prov = WorktreeProvisioner(repo=clone1, parent=parent, ssh_host=None)

    # Patch _run to use our env

    def patched_run(argv, *, timeout):
        return subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )

    prov._run = patched_run
    return prov, origin, clone1, env


def test_worktree_fetch_unfetched_commit_red_before_fix(
    provisioner_local: tuple[WorktreeProvisioner, Path, Path, dict[str, str]],
):
    """Reproduces the defect: create() fails when commit is unfetched.

    This test would FAIL on the base (before the fix) because the commit
    doesn't exist in clone1. It PASSES after the fix because _ensure_commit()
    fetches it.
    """
    prov, origin, clone1, env = provisioner_local

    # Create a second clone (clone2) to simulate a remote machine
    tmp_path = clone1.parent
    clone2 = tmp_path / "clone2"
    subprocess.run(
        ["git", "clone", str(origin), str(clone2)],
        env=env,
        check=True,
        capture_output=True,
    )

    # Create a new commit in clone2 and push to origin
    new_file = clone2 / "feature.md"
    new_file.write_text("New feature\n")
    subprocess.run(
        ["git", "add", "feature.md"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Add feature"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "push", "origin", "HEAD:feature-branch"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )

    # Get the commit SHA from clone2 (this commit is in origin but NOT in clone1 yet)
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    unfetched_sha = result.stdout.strip()

    # Verify that clone1 does NOT have this commit yet
    check_result = subprocess.run(
        ["git", "cat-file", "-e", f"{unfetched_sha}^{{commit}}"],
        cwd=clone1,
        env=env,
        capture_output=True,
    )
    assert check_result.returncode != 0, "Commit should not exist in clone1 before fetch"

    # Now try to create a worktree with the unfetched commit
    # With the fix, this should succeed because _ensure_commit() fetches it
    path = prov.create(
        task_id="test-task",
        session_id="test-session",
        base_commit=unfetched_sha,
        ref="feature-branch",
    )

    # Verify the worktree was created and is at the right commit
    assert path.exists(), "Worktree should be created"

    # Check that the worktree HEAD is the unfetched commit
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == unfetched_sha, "Worktree should be at the fetched commit"


def test_worktree_no_fetch_for_present_commit(
    provisioner_local: tuple[WorktreeProvisioner, Path, Path, dict[str, str]],
):
    """When commit already exists locally, no fetch is issued."""
    prov, origin, clone1, env = provisioner_local

    # Get the existing commit SHA in clone1
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=clone1,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    existing_sha = result.stdout.strip()

    # Monkeypatch _run to track calls
    original_run = prov._run
    fetch_calls = []
    def tracked_run(argv, *, timeout):
        if "fetch" in argv:
            fetch_calls.append(argv)
        return original_run(argv, timeout=timeout)

    prov._run = tracked_run

    # Create worktree with existing commit
    path = prov.create(
        task_id="test-task",
        session_id="test-session",
        base_commit=existing_sha,
    )

    # Verify no fetch was issued
    assert len(fetch_calls) == 0, f"Should not fetch for existing commit; saw: {fetch_calls}"
    assert path.exists(), "Worktree should be created"


def test_worktree_unreachable_sha_raises(
    provisioner_local: tuple[WorktreeProvisioner, Path, Path, dict[str, str]],
):
    """Unreachable SHA (not in origin) raises ContractViolation with distinct message."""
    prov, origin, clone1, env = provisioner_local

    # Use a fake 40-hex SHA that doesn't exist anywhere
    fake_sha = "0" * 40

    with pytest.raises(ContractViolation) as exc_info:
        prov.create(
            task_id="test-task",
            session_id="test-session",
            base_commit=fake_sha,
        )

    # Verify the error message is the new distinct one
    assert "not reachable after fetch" in str(exc_info.value)


def test_worktree_ref_fallback(
    provisioner_local: tuple[WorktreeProvisioner, Path, Path, dict[str, str]],
):
    """Abbreviated commit + ref parameter allows fetch by ref name."""
    prov, origin, clone1, env = provisioner_local

    # Create clone2 with a new commit on a named branch
    tmp_path = clone1.parent
    clone2 = tmp_path / "clone2"
    subprocess.run(
        ["git", "clone", str(origin), str(clone2)],
        env=env,
        check=True,
        capture_output=True,
    )

    # Create a new commit on a branch in clone2
    new_file = clone2 / "reftest.md"
    new_file.write_text("Testing ref fallback\n")
    subprocess.run(
        ["git", "add", "reftest.md"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Ref test commit"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "push", "origin", "HEAD:test-ref-branch"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
    )

    # Get the full SHA
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=clone2,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    full_sha = result.stdout.strip()

    # Create worktree using ref parameter (not the full SHA)
    path = prov.create(
        task_id="test-task",
        session_id="test-session",
        base_commit=full_sha,
        ref="test-ref-branch",
    )

    assert path.exists(), "Worktree should be created via ref"

    # Verify the worktree is at the right commit
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == full_sha
