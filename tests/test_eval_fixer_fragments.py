"""The nightly eval-fixer writes one dated fragment, never the shared `wiki/hot.md`.

Why this test exists (#3076): the eval-fixer used to append its run summary to the tail
of `wiki/hot.md`. Every night edited the same lines of the same file, so each run's PR
collided with every other pending run and went CONFLICTING — and **a conflicting PR
receives no CI at all**, because GitHub cannot build the merge ref. Four runs piled up
that way (#2994, #3036, #3050, #3087); two of them read MERGEABLE against main while
*mutually* conflicting.

Two layers here:

1. `test_instructions_*` — the instruction file (the actual writer) tells the agent to
   write `wiki/hot.d/<date>-eval-fixer.md` and never to touch `wiki/hot.md`.
2. `test_two_dated_runs_merge_cleanly` / `test_shared_tail_appends_conflict` — a real
   `git merge-tree` against throwaway repos, proving the fragment shape merges where the
   shared-tail shape does not. The second test is the control: without it, a green run
   could mean "merge-tree never conflicts here" rather than "the fix works".
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
INSTRUCTIONS = REPO_ROOT / ".claude" / "agents" / "eval-fixer-instructions.md"
HOT_D = REPO_ROOT / "wiki" / "hot.d"

FRAGMENT_PATTERN = "wiki/hot.d/$(date +%Y-%m-%d)-eval-fixer.md"


# --------------------------------------------------------------------------
# Layer 1 — the instruction file is the writer; assert what it instructs.
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def instructions() -> str:
    assert INSTRUCTIONS.is_file(), f"missing writer instructions: {INSTRUCTIONS}"
    return INSTRUCTIONS.read_text(encoding="utf-8")


def test_instructions_write_a_dated_fragment(instructions: str) -> None:
    assert FRAGMENT_PATTERN in instructions, (
        "eval-fixer must write one dated fragment per run; expected the path "
        f"{FRAGMENT_PATTERN!r} in {INSTRUCTIONS.name}"
    )


def _staging_commands(text: str) -> list[str]:
    """Command lines that stage files — prose ABOUT them must not count.

    The instructions deliberately *name* the forbidden forms in a "never do this"
    sentence, so a naive substring scan flags the prohibition itself. Only lines whose
    first token is the command are real instructions to run.
    """
    out = []
    for raw in text.splitlines():
        line = raw.strip().lstrip("$ ").strip()
        if line.startswith(("git add", "git commit")):
            out.append(line)
    return out


def test_instructions_never_stage_or_commit_hot_md(instructions: str) -> None:
    """The no-patch path must stage ONLY its fragment.

    `git add wiki/hot.md` was the exact line that created the shared line. Any
    staging form that could sweep hot.md back in is a regression.
    """
    forbidden = ("wiki/hot.md", "wiki/", "-A", ".")
    offenders = []
    for cmd in _staging_commands(instructions):
        if not cmd.startswith("git add"):
            continue
        target = cmd[len("git add") :].strip().strip('"').strip("'")
        if target in forbidden:
            offenders.append(cmd)
    assert not offenders, (
        f"{INSTRUCTIONS.name} must never stage wiki/hot.md (or sweep it in via a broad "
        f"add) — found: {offenders}"
    )


def test_instructions_stage_the_fragment_explicitly(instructions: str) -> None:
    assert f'git add "{FRAGMENT_PATTERN}"' in instructions, (
        "the fragment must be staged by its exact quoted path, so a shared working tree "
        "cannot pull another session's work into the eval-fixer commit"
    )


def test_no_generated_shared_index_in_hot_d() -> None:
    """A committed index regenerated per run would be a shared line under a new name."""
    assert HOT_D.is_dir(), f"missing {HOT_D}"
    banned = {"index.md", "INDEX.md", "all.md", "hot.md"}
    present = {p.name for p in HOT_D.iterdir() if p.is_file()} & banned
    assert not present, (
        f"wiki/hot.d/ must not contain a shared aggregate file — found {sorted(present)}. "
        "Every run writes its own dated file; an index recreates the collision."
    )


# --------------------------------------------------------------------------
# Layer 2 — deterministic git proof.
# --------------------------------------------------------------------------


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _init_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "test@example.com")
    _git(path, "config", "user.name", "test")
    _git(path, "config", "commit.gpgsign", "false")


def _commit_all(repo: Path, message: str) -> str:
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _merges_cleanly(repo: Path, a: str, b: str) -> bool:
    """True when `git merge-tree` reports no conflict merging b into a."""
    proc = subprocess.run(
        ["git", "merge-tree", "--write-tree", "--name-only", a, b],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def _two_run_repo(tmp_path: Path, *, shared_tail: bool) -> tuple[Path, str, str]:
    """Build a repo where two dated runs land, each on its own branch off a shared base.

    shared_tail=False → each run writes wiki/hot.d/<date>-eval-fixer.md   (the fix)
    shared_tail=True  → each run appends to the tail of wiki/hot.md       (the old bug)
    """
    repo = tmp_path / ("shared" if shared_tail else "fragments")
    _init_repo(repo)

    hot_md = repo / "wiki" / "hot.md"
    hot_md.parent.mkdir(parents=True, exist_ok=True)
    hot_md.write_text("# Hot Cache\n\n## Just Finished\n- base entry\n", encoding="utf-8")
    (repo / "wiki" / "hot.d").mkdir(parents=True, exist_ok=True)
    (repo / "wiki" / "hot.d" / ".keep").write_text("", encoding="utf-8")
    base = _commit_all(repo, "base")

    heads: list[str] = []
    for date, scorecard in (("2026-08-02", "39/57"), ("2026-08-03", "42/57")):
        _git(repo, "checkout", "-q", "-b", f"run-{date}", base)
        body = f"# eval-fixer run — {date}\n\n- Scorecard: {scorecard} passing\n- Action: issue-filed\n"
        if shared_tail:
            hot_md.write_text(hot_md.read_text(encoding="utf-8") + "\n" + body, encoding="utf-8")
        else:
            (repo / "wiki" / "hot.d" / f"{date}-eval-fixer.md").write_text(body, encoding="utf-8")
        heads.append(_commit_all(repo, f"docs(wiki): eval-fixer run {date}"))

    return repo, heads[0], heads[1]


def test_two_dated_runs_merge_cleanly(tmp_path: Path) -> None:
    """The fix: two consecutive runs write different paths, so they never conflict."""
    repo, run_a, run_b = _two_run_repo(tmp_path, shared_tail=False)
    assert _merges_cleanly(repo, run_a, run_b), (
        "two eval-fixer runs on different dates must merge cleanly — each writes its own "
        "wiki/hot.d/<date>-eval-fixer.md"
    )


def test_shared_tail_appends_conflict(tmp_path: Path) -> None:
    """Control: the OLD shape really does conflict, so the test above means something."""
    repo, run_a, run_b = _two_run_repo(tmp_path, shared_tail=True)
    assert not _merges_cleanly(repo, run_a, run_b), (
        "expected the old shared-tail append to conflict; if this ever passes, the "
        "merge-tree probe is not measuring what it claims and the test above is vacuous"
    )
