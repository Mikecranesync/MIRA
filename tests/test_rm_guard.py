"""Tests for the deterministic rm -rf safety floor (tools/hooks/rm_guard.py).

Covers the destructive-deletion attack surface the static `permissions.deny`
glob cannot reach: literal, variable-expanded, relative, symlinked, and quoted
repo-root deletions — plus proof that legitimate scoped cleanup still passes.

`tools/` is not a Python package, so the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "hooks" / "rm_guard.py"
_spec = importlib.util.spec_from_file_location("rm_guard", _MODULE_PATH)
assert _spec and _spec.loader
rm_guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rm_guard)


def _mkrepo(tmp_path: Path) -> Path:
    """A fake repo root under a fake HOME, with a .git dir and a scratch subdir."""
    home = tmp_path / "home"
    repo = home / "proj"
    (repo / ".git").mkdir(parents=True)
    (repo / ".audit-worktrees" / "wt").mkdir(parents=True)
    (repo / "node_modules").mkdir()
    return repo


def _ev(command: str, repo: Path, *, cwd=None, env=None):
    home = str(repo.parent)
    return rm_guard.evaluate(
        command,
        cwd=str(cwd or repo),
        env=env if env is not None else {"HOME": home},
        home=home,
        repo_root=str(repo),
    )


# --------------------------------------------------------------------------- #
# DENY — the catastrophic cases, across every path form.
# --------------------------------------------------------------------------- #


def test_literal_repo_root_absolute(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev(f"rm -rf {repo}", repo) is not None


def test_literal_git_admin_dir(tmp_path):
    repo = _mkrepo(tmp_path)
    reason = _ev(f"rm -rf {repo}/.git", repo)
    assert reason is not None and ".git" in reason


def test_variable_expanded_repo_root(tmp_path):
    repo = _mkrepo(tmp_path)
    env = {"HOME": str(repo.parent), "REPO": str(repo)}
    assert _ev('rm -rf "$REPO"', repo, env=env) is not None


def test_inline_variable_assignment_repo_root(tmp_path):
    repo = _mkrepo(tmp_path)
    # REPO set inline on the same simple command — resolved without executing.
    assert _ev(f'REPO={repo} rm -rf "$REPO"', repo) is not None


def test_relative_dot_at_repo_root(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf .", repo, cwd=repo) is not None


def test_relative_parent_climb_above_repo(tmp_path):
    repo = _mkrepo(tmp_path)
    # deleting the parent (which contains the repo) from inside the repo
    assert _ev("rm -rf ..", repo, cwd=repo) is not None


def test_symlinked_repo_root(tmp_path):
    repo = _mkrepo(tmp_path)
    link = tmp_path / "shortcut"
    os.symlink(repo, link)
    # rm -rf <symlink-to-repo> — realpath collapses it onto the repo root.
    assert _ev(f"rm -rf {link}", repo, cwd=tmp_path) is not None


def test_home_directory(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf ~", repo) is not None


def test_home_tilde_slash(tmp_path):
    repo = _mkrepo(tmp_path)
    # ~/ is an ancestor of the repo (repo lives under home) -> deny
    assert _ev("rm -rf ~/", repo) is not None


def test_root_filesystem(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf /", repo) is not None


def test_root_glob(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf /*", repo) is not None


def test_flag_orderings_all_caught(tmp_path):
    repo = _mkrepo(tmp_path)
    for cmd in (
        f"rm -fr {repo}",
        f"rm -Rf {repo}",
        f"rm -r -f {repo}",
        f"rm --recursive --force {repo}",
        f"rm -rf -- {repo}",
    ):
        assert _ev(cmd, repo) is not None, cmd


def test_dangerous_rm_in_compound_command(tmp_path):
    repo = _mkrepo(tmp_path)
    # second command in a && chain is the dangerous one
    assert _ev(f"cd /tmp && rm -rf {repo}/.git", repo) is not None


# --------------------------------------------------------------------------- #
# ALLOW — legitimate scoped cleanup must keep working (near-zero false positives).
# --------------------------------------------------------------------------- #


def test_allow_scoped_worktree_cleanup(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf .audit-worktrees/wt", repo, cwd=repo) is None


def test_allow_node_modules(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf node_modules", repo, cwd=repo) is None


def test_allow_subdir_glob(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf .audit-worktrees/*", repo, cwd=repo) is None


def test_allow_tmp_path(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf /tmp/some-scratch-dir", repo) is None


def test_allow_variable_to_scratch(tmp_path):
    repo = _mkrepo(tmp_path)
    env = {"HOME": str(repo.parent), "TMPDIR": "/tmp/build"}
    assert _ev('rm -rf "$TMPDIR/x"', repo, env=env) is None


def test_allow_non_recursive(tmp_path):
    repo = _mkrepo(tmp_path)
    # plain `rm -f` (no -r) is not the catastrophic signature this floor guards
    assert _ev(f"rm -f {repo}/.git", repo) is None


def test_allow_command_substitution_not_executed(tmp_path):
    repo = _mkrepo(tmp_path)
    # command substitution is never resolved/executed -> unresolvable -> allow
    # (the doctrine covers this judgment case; the hook must not run `$(...)`).
    assert _ev('rm -rf "$(cat somefile)"', repo) is None


def test_allow_no_rm_at_all(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev(f"git status && ls {repo}", repo) is None


# --------------------------------------------------------------------------- #
# Robustness — never wedge the session.
# --------------------------------------------------------------------------- #


def test_unparseable_fails_open(tmp_path):
    repo = _mkrepo(tmp_path)
    # unbalanced quote -> tokenizer returns None -> fail open (allow)
    assert _ev('rm -rf "unterminated', repo) is None
