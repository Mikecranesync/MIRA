"""Tests for the deterministic rm -rf safety floor (tools/hooks/rm_guard.py).

Covers the destructive-deletion attack surface the static `permissions.deny`
glob cannot reach: literal, variable-expanded, relative, symlinked, and quoted
repo-root deletions — plus proof that legitimate scoped cleanup still passes.

`tools/` is not a Python package, so the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
import os

import pytest
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
    assert _ev(f'rm -rf "{repo}"', repo) is not None


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
    assert _ev(f'REPO="{repo}" rm -rf "$REPO"', repo) is not None


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
    try:
        os.symlink(repo, link)
    except (OSError, NotImplementedError) as exc:  # Windows without symlink privilege
        pytest.skip(f"symlink creation not permitted here: {exc}")
    # rm -rf <symlink-to-repo> — realpath collapses it onto the repo root.
    assert _ev(f'rm -rf "{link}"', repo, cwd=tmp_path) is not None


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
        f'rm -fr "{repo}"',
        f'rm -Rf "{repo}"',
        f'rm -r -f "{repo}"',
        f'rm --recursive --force "{repo}"',
        f'rm -rf -- "{repo}"',
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


def test_windows_drive_root_is_catastrophic():
    """A bare drive root names a whole filesystem, exactly like "/".

    Platform-independent so Linux CI pins it too: `_danger` is called directly
    with an already-resolved path rather than relying on this host resolving
    "/" to a drive. On Windows `os.path.realpath("/")` is a drive root, so
    before the separator/case normalisation fix `rm -rf /` and `rm -rf /*`
    were ALLOWED -- fail-open on the one guard whose job is to fail closed.
    """
    for path in ("C:/", "c:/", "C:", "D:/"):
        assert rm_guard._danger(path, "", "") is not None, path


def test_ancestor_check_is_separator_and_case_insensitive():
    """Containment must not depend on the path separator or on case.

    `_is_ancestor_or_equal` compared with a hardcoded "/", so on Windows --
    where `realpath` returns backslashes -- an ancestor never matched and the
    guard silently allowed deleting a parent of the repo or of home.
    """
    win_parent = r"C:\Users\bob"
    win_child = r"C:\Users\bob\proj"
    assert rm_guard._is_ancestor_or_equal(win_parent, win_child)
    # Mixed separators must still match.
    assert rm_guard._is_ancestor_or_equal("C:/Users/bob", win_child)
    # A sibling sharing a prefix is NOT an ancestor (the classic off-by-one).
    assert not rm_guard._is_ancestor_or_equal(r"C:\Users\bo", win_child)


# --------------------------------------------------------------------------- #
# MSYS/Git Bash drive paths (#3827) — the spelling `pwd` actually returns.
# --------------------------------------------------------------------------- #


def _msys(path) -> str:
    """`C:/Users/x` -> `/c/Users/x`, the form Git Bash `pwd` prints."""
    text = str(path).replace(chr(92), "/")
    if len(text) > 1 and text[1] == ":":
        return "/" + text[0].lower() + text[2:]
    return text


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_repo_root_is_blocked(tmp_path):
    """The live bypass: `/c/Users/.../proj` names the repo root to Git Bash.

    Before the decode, `realpath` produced `C:/c/Users/...` — a path that does
    not exist — so the guard compared a phantom against the repo root, found no
    match, and ALLOWED, while `rm` deleted the real directory.
    """
    repo = _mkrepo(tmp_path)
    assert _ev('rm -rf "{}"'.format(_msys(repo)), repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_repo_root_unquoted_is_blocked(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf {}".format(_msys(repo)), repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_uppercase_drive_is_blocked(tmp_path):
    """Windows drive letters are case-insensitive; `/C/...` must match too."""
    repo = _mkrepo(tmp_path)
    upper = _msys(repo)
    upper = "/" + upper[1].upper() + upper[2:]
    assert _ev('rm -rf "{}"'.format(upper), repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_cygdrive_repo_root_is_blocked(tmp_path):
    """Cygwin spells the same target `/cygdrive/c/...`."""
    repo = _mkrepo(tmp_path)
    assert _ev('rm -rf "/cygdrive{}"'.format(_msys(repo)), repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_home_is_blocked(tmp_path):
    repo = _mkrepo(tmp_path)
    assert _ev('rm -rf "{}"'.format(_msys(repo.parent)), repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_bare_drive_is_blocked(tmp_path):
    """`/c` is the whole drive — the MSYS spelling of a filesystem root."""
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf /c", repo) is not None


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_msys_scoped_cleanup_still_allowed(tmp_path):
    """The safe control, in MSYS form.

    A normalization fix that starts denying legitimate scoped cleanup has
    traded one failure mode for another; the guard's design goal is near-zero
    false positives.
    """
    repo = _mkrepo(tmp_path)
    assert _ev('rm -rf "{}/node_modules"'.format(_msys(repo)), repo) is None


def test_ordinary_posix_paths_are_not_treated_as_drives(tmp_path):
    """`/tmp/scratch` must never be rewritten to a drive.

    Platform-independent so Linux CI pins it too: only a SINGLE-character first
    segment is a drive spelling, so multi-character roots are left alone.
    """
    assert rm_guard._decode_msys_drive("/tmp/scratch") == "/tmp/scratch"
    assert rm_guard._decode_msys_drive("/usr/lib") == "/usr/lib"
    assert rm_guard._decode_msys_drive("/home/bob/proj") == "/home/bob/proj"


def test_decode_is_windows_only():
    """On Linux `/c/foo` is a legitimate absolute path and must stay one."""
    decoded = rm_guard._decode_msys_drive("/c/Users/bob/proj")
    if os.name == "nt":
        assert decoded == "C:/Users/bob/proj"
    else:
        assert decoded == "/c/Users/bob/proj"


@pytest.mark.skipif(os.name != "nt", reason="MSYS drive paths are a Windows/Git Bash spelling")
def test_relative_target_resolves_against_an_msys_cwd(tmp_path):
    """A relative target joined onto an MSYS-form cwd still lands on the repo.

    The hook's own cwd comes from `os.getcwd()` (a Windows path), so this
    branch is defensive — but an untested branch inside a safety guard is the
    exact thing `.claude/rules/prove-the-test-fails.md` (added by this PR) says
    not to ship, so it is pinned rather than assumed.
    """
    repo = _mkrepo(tmp_path)
    assert _ev("rm -rf .", repo, cwd=_msys(repo)) is not None
