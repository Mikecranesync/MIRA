"""Tests for the shared-root-file ownership floor (tools/hooks/shared_root_file_guard.py).

The scenario being pinned is the real near-miss from PR #3815: an overnight run
follows the `autonomous-run` skill literally ("PLAN.md exists at branch root",
"write HANDOFF.md") and writes over the *previous* run's tracked plan and
handoff. Merging that branch would then delete the other run's work from `main`.

Every test builds a real scratch git repository, because the guard's whole
decision is a git question -- tracked or not, and whether THIS branch has ever
touched the file. A mocked git would prove nothing about the thing that failed.

`tools/` is not a Python package, so the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "hooks" / "shared_root_file_guard.py"
_spec = importlib.util.spec_from_file_location("shared_root_file_guard", _MODULE_PATH)
assert _spec and _spec.loader
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)


def _run(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=str(repo), check=True, capture_output=True, text=True)


def _make_repo(tmp_path: Path, committed: list[str]) -> Path:
    """Build origin (owned by run A) plus a clone (run B), with `committed` at the root.

    `origin/main` must be a real remote-tracking ref: `branch_owns` compares
    against it, and a missing base makes the guard fail open -- which would
    silently pass every blocking test below.
    """
    origin = tmp_path / "origin"
    origin.mkdir()
    _run(origin, "init", "-q", "-b", "main")
    _run(origin, "config", "user.email", "run-a@example.com")
    _run(origin, "config", "user.name", "Run A")
    for name in committed:
        (origin / name).write_text(
            "Run A wrote " + name + " and still owns it.\n", encoding="utf-8"
        )
    _run(origin, "add", *committed)
    _run(origin, "commit", "-q", "-m", "docs: run A files")

    work = tmp_path / "work"
    _run(tmp_path, "clone", "-q", str(origin), str(work))
    _run(work, "config", "user.email", "run-b@example.com")
    _run(work, "config", "user.name", "Run B")
    return work


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """Run A owns a committed root PLAN.md and HANDOFF.md; the clone is run B."""
    return _make_repo(tmp_path, ["PLAN.md", "HANDOFF.md"])


def test_blocks_a_second_run_overwriting_the_first_runs_plan(repo: Path) -> None:
    """The near-miss itself: a fresh branch writing the tracked root PLAN.md."""
    _run(repo, "checkout", "-q", "-b", "feat/run-b")

    message = guard.verdict(str(repo / "PLAN.md"), env={})

    assert message is not None
    assert "TRACKED, SHARED file" in message
    # The denial must name the way out, or it only teaches people to reach for
    # the override.
    assert "PLAN.run-b.md" in message
    assert "MIRA_ALLOW_SHARED_ROOT=1" in message


def test_blocks_the_handoff_too(repo: Path) -> None:
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    assert guard.verdict(str(repo / "HANDOFF.md"), env={}) is not None


def test_allows_a_branch_that_already_owns_the_file(repo: Path) -> None:
    """Continuing your own work is not overwriting anybody."""
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    (repo / "PLAN.md").write_text("Run B's plan, committed on Run B's branch.\n", encoding="utf-8")
    _run(repo, "add", "PLAN.md")
    _run(repo, "commit", "-q", "-m", "docs: run B plan")

    assert guard.verdict(str(repo / "PLAN.md"), env={}) is None


def test_allows_an_untracked_root_file(repo: Path) -> None:
    """Nothing committed means nothing to destroy."""
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    # NOTES.md is a guarded BASENAME, but is not committed in this fixture.
    assert guard.verdict(str(repo / "NOTES.md"), env={}) is None


def test_allows_a_branch_scoped_name(repo: Path) -> None:
    """The prescribed fix must actually pass the guard."""
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    assert guard.verdict(str(repo / "PLAN.run-b.md"), env={}) is None
    assert guard.verdict(str(repo / "HANDOFF.run-b.md"), env={}) is None


def test_allows_the_same_basename_in_a_subdirectory(repo: Path) -> None:
    """`docs/plans/PLAN.md` is a document, not a shared line."""
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    nested = repo / "docs" / "plans"
    nested.mkdir(parents=True)
    (nested / "PLAN.md").write_text("a plan document\n", encoding="utf-8")
    _run(repo, "add", "docs/plans/PLAN.md")
    _run(repo, "commit", "-q", "-m", "docs: a nested plan")

    assert guard.verdict(str(nested / "PLAN.md"), env={}) is None


def test_allows_unrelated_root_files(repo: Path) -> None:
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    for name in ("README.md", "CLAUDE.md", "NORTH_STAR.md"):
        assert guard.verdict(str(repo / name), env={}) is None


def test_the_override_allows_it(repo: Path) -> None:
    _run(repo, "checkout", "-q", "-b", "feat/run-b")
    assert guard.verdict(str(repo / "PLAN.md"), env={"MIRA_ALLOW_SHARED_ROOT": "1"}) is None


def test_allows_outside_a_git_repo(tmp_path: Path) -> None:
    """A PLAN.md in a scratch directory is nobody's shared line."""
    loose = tmp_path / "scratch"
    loose.mkdir()
    (loose / "PLAN.md").write_text("scratch\n", encoding="utf-8")
    assert guard.verdict(str(loose / "PLAN.md"), env={}) is None


def test_fails_open_when_there_is_no_base_to_compare_against(tmp_path: Path) -> None:
    """No `origin/main` means ownership is unknowable -- allow, never block blindly.

    A guard that blocked when it could not tell would wedge every repo without a
    remote, which is a worse failure than the one it prevents.
    """
    solo = tmp_path / "solo"
    solo.mkdir()
    _run(solo, "init", "-q", "-b", "main")
    _run(solo, "config", "user.email", "solo@example.com")
    _run(solo, "config", "user.name", "Solo")
    (solo / "PLAN.md").write_text("plan\n", encoding="utf-8")
    _run(solo, "add", "PLAN.md")
    _run(solo, "commit", "-q", "-m", "docs: plan")

    assert guard.verdict(str(solo / "PLAN.md"), env={}) is None


def test_every_guarded_basename_is_actually_guarded(tmp_path: Path) -> None:
    """The allowlist and the behaviour must not drift apart.

    A name can sit in SHARED_ROOT_FILENAMES and be silently unreachable. This
    asserts the Python half; `test_wrapper_cheap_reject_covers_every_name`
    asserts the shell half, which is a second hand-maintained copy of the list.
    """
    names = sorted(guard.SHARED_ROOT_FILENAMES)
    work = _make_repo(tmp_path, names)
    _run(work, "checkout", "-q", "-b", "feat/run-b")
    for name in names:
        assert guard.verdict(str(work / name), env={}) is not None, (
            name + " is listed but not guarded"
        )


def test_wrapper_cheap_reject_covers_every_name() -> None:
    """The shell wrapper's `case` must list every guarded basename.

    It is an optimisation that skips python entirely, so a name missing from it
    is a guard that never runs -- invisible, and exactly the dead-hook failure
    mode this repo has been bitten by before (2026-08-09).
    """
    wrapper = (_MODULE_PATH.parent / "shared-root-file-guard.sh").read_text(encoding="utf-8")
    case_line = next(line for line in wrapper.splitlines() if line.strip().startswith("*PLAN.md*"))
    for name in sorted(guard.SHARED_ROOT_FILENAMES):
        assert "*" + name + "*" in case_line, (
            name + " is guarded in python but skipped by the wrapper"
        )
