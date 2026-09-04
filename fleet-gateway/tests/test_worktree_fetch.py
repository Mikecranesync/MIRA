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

    # Initialize bare repo with main as default branch (hermetic test)
    subprocess.run(
        ["git", "init", "--bare", "-b", "main"],
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
    # With the fix, this should succeed because _ensure_commit() fetches it by SHA
    path = prov.create(
        task_id="test-task",
        session_id="test-session",
        base_commit=unfetched_sha,
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

    # Use an abbreviated SHA so the SHA fetch fails and ref fetch is required
    abbreviated_sha = full_sha[:12]

    # Track which fetches are called via a wrapper
    fetch_calls = []

    def track_run(argv, *, timeout):
        if "fetch" in argv:
            fetch_calls.append(argv.copy())
        return subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )

    original_run = prov._run
    prov._run = track_run

    # Create worktree using abbreviated SHA + ref parameter
    # This forces the ref fetch to be used (SHA fetch will fail on abbreviated SHA)
    path = prov.create(
        task_id="test-task",
        session_id="test-session",
        base_commit=abbreviated_sha,
        ref="test-ref-branch",
    )

    prov._run = original_run

    assert path.exists(), "Worktree should be created via ref fallback"

    # Verify that ref fetch was actually called (not SHA fetch on abbreviated SHA)
    ref_fetches = [c for c in fetch_calls if "test-ref-branch" in c]
    assert len(ref_fetches) > 0, f"Ref fetch should be called, but got: {fetch_calls}"

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


def test_ref_injection_attack_rejected():
    """Option-like ref values ("--unshallow", "-b") are rejected before any git call.

    Regression test for round-2 finding M2: unsafe ref values must be validated
    and rejected BEFORE being passed to git, not by relying on git's error handling.
    """
    p = WorktreeProvisioner(repo=Path("/repo"), parent=Path("/wt"))

    # Track all calls to _run to ensure no git command is issued for unsafe refs
    calls = []

    def tracking_run(argv, *, timeout):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, returncode=0, stdout="", stderr="")

    p._run = tracking_run

    full_sha = "abcdef0123456789abcdef0123456789abcdef01"

    # Test cases: dangerous ref values that should be rejected
    dangerous_refs = [
        "--unshallow",
        "-b",
        "--depth=1",
        "-o",
        "--",
        "refs/heads/--unshallow",
        "/bad",
    ]

    for dangerous_ref in dangerous_refs:
        calls.clear()
        with pytest.raises(ContractViolation) as exc_info:
            p._ensure_commit(full_sha, dangerous_ref)

        # Verify the error is about invalid ref format, not a git error
        assert "not a valid ref name" in str(exc_info.value)

        # Verify NO git command was issued for this unsafe ref
        assert len(calls) == 0, (
            f"Unsafe ref '{dangerous_ref}' should be rejected before any git call, but got: {calls}"
        )


def test_ref_normalization_exact_prefix():
    """Refs are normalized with exact-prefix removal, not character-set lstrip.

    Regression test for round-2 finding M1: ref.lstrip("origin/") is unsafe
    because lstrip() removes characters from a SET, not a prefix.
    Verify refs like "release/v1" are NOT mangled to "elease/v1".
    """
    p = WorktreeProvisioner(repo=Path("/repo"), parent=Path("/wt"))

    fetch_log = []

    def tracking_run(argv, *, timeout):
        if "fetch" in argv:
            fetch_log.append(argv.copy())
            # First fetch (SHA) fails; second fetch (ref) succeeds
            # This forces the code to try the ref fetch for proper validation
            if len(fetch_log) == 1:
                # First fetch (SHA): fail so we proceed to ref fetch
                return subprocess.CompletedProcess(argv, returncode=1, stdout="", stderr="")
            else:
                # Subsequent fetches (ref): succeed
                return subprocess.CompletedProcess(argv, returncode=0, stdout="", stderr="")
        # cat-file checks: only the first one (before any fetches) returns NOT FOUND
        if "cat-file" in argv:
            if len(fetch_log) == 0:
                # First check: commit doesn't exist yet
                return subprocess.CompletedProcess(argv, returncode=1, stdout="", stderr="")
            else:
                # Post-fetch verification: commit now exists (ref fetch succeeded)
                return subprocess.CompletedProcess(argv, returncode=0, stdout="", stderr="")

    p._run = tracking_run

    full_sha = "abcdef0123456789abcdef0123456789abcdef01"

    test_cases = [
        # (input_ref, expected_normalized)
        ("release/v1", "release/v1"),
        ("refs/heads/release/v1", "release/v1"),
        ("origin/release/v1", "release/v1"),
        ("origin/refs/heads/main", "main"),
        ("integration", "integration"),
        ("refs/heads/integration", "integration"),
        # Edge case: starts with a letter (not stripped)
        ("main", "main"),
    ]

    for input_ref, expected_normalized in test_cases:
        fetch_log.clear()
        p._ensure_commit(full_sha, input_ref)

        # Extract the ref fetch (skip the SHA fetch which has the full SHA as the last arg)
        # Filter: keep fetches where last arg is NOT the SHA and is NOT a hex string
        ref_fetches = [
            c
            for c in fetch_log
            if len(c) > 5
            and c[-1] != full_sha
            and not (len(c[-1]) >= 7 and all(x in "0123456789abcdef" for x in c[-1]))
        ]
        assert len(ref_fetches) > 0, f"No ref fetch found for '{input_ref}'; got: {fetch_log}"

        actual_normalized = ref_fetches[-1][-1]
        assert actual_normalized == expected_normalized, (
            f"Ref '{input_ref}' normalized to '{actual_normalized}', "
            f"expected '{expected_normalized}'"
        )


def test_timeout_expiration_wrapped():
    """TimeoutExpired during git calls is wrapped in ContractViolation.

    Regression test for round-2 m2: exception type checking and graceful failure.
    """
    p = WorktreeProvisioner(repo=Path("/repo"), parent=Path("/wt"))

    def timeout_run(argv, *, timeout):
        raise subprocess.TimeoutExpired("git", timeout)

    p._run = timeout_run

    full_sha = "abcdef0123456789abcdef0123456789abcdef01"

    with pytest.raises(ContractViolation) as exc_info:
        p._ensure_commit(full_sha, "some-branch")

    assert "base_commit fetch failed" in str(exc_info.value)


def test_oserror_wrapped():
    """OSError during git calls (e.g., process not found) is wrapped."""
    p = WorktreeProvisioner(repo=Path("/repo"), parent=Path("/wt"))

    def oserror_run(argv, *, timeout):
        raise OSError("git not found")

    p._run = oserror_run

    full_sha = "abcdef0123456789abcdef0123456789abcdef01"

    with pytest.raises(ContractViolation) as exc_info:
        p._ensure_commit(full_sha, "some-branch")

    assert "base_commit fetch failed" in str(exc_info.value)


def test_no_fallback_to_fetch_all():
    """After bounded attempts fail, no unbounded "fetch all branches" fallback is issued.

    Regression test for round-2 finding: the bounded strategy must NOT have a fallback
    to `git fetch origin` (no refspec), as that would be unbounded.
    Audit evidence: /Users/bravonode/Mira-worktrees/fleet-gateway-mcp-v1/fleet-gateway/var/audit.jsonl
    """
    p = WorktreeProvisioner(repo=Path("/repo"), parent=Path("/wt"))

    fetch_log = []

    def tracking_run(argv, *, timeout):
        if "fetch" in argv:
            fetch_log.append(argv.copy())
        # All git operations fail to simulate unreachable commit
        return subprocess.CompletedProcess(argv, returncode=1, stdout="", stderr="")

    p._run = tracking_run

    full_sha = "abcdef0123456789abcdef0123456789abcdef01"

    with pytest.raises(ContractViolation) as exc_info:
        p._ensure_commit(full_sha, "some-branch")

    # Verify the correct error message
    assert "not reachable after fetch" in str(exc_info.value)

    # Verify NO unbounded fetch-all was issued
    # (an unbounded fetch would be: ["git", "-C", repo, "fetch", "--quiet", "--no-tags", "origin"])
    for fetch_cmd in fetch_log:
        # The fetch should have a refspec (SHA or ref name) as the last argument
        assert len(fetch_cmd) >= 6, f"Fetch should have a refspec: {fetch_cmd}"
        # Specifically: the last element should be the refspec (SHA or ref)
        last_arg = fetch_cmd[-1]
        assert last_arg in (
            full_sha,
            "some-branch",
        ), f"Fetch refspec should be SHA or ref, got: {last_arg}"
