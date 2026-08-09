"""The nightly eval-fixer writes one dated fragment, never the shared `wiki/hot.md`.

Why this test exists (#3076): the eval-fixer used to append its run summary to the tail
of `wiki/hot.md`. Every night edited the same lines of the same file, so each run's PR
collided with every other pending run and went CONFLICTING — and **a conflicting PR
receives no CI at all**, because GitHub cannot build the merge ref. Four runs piled up
that way (#2994, #3036, #3050, #3087); two of them read MERGEABLE against main while
*mutually* conflicting.

Two layers here:

1. `test_instructions_*` — the instruction file (the actual writer) tells the agent to
   write `wiki/hot.d/<date>-eval-fixer-<worker>.md` and never to touch `wiki/hot.md`.
2. `test_two_dated_runs_merge_cleanly` / `test_shared_tail_appends_conflict` — a real
   `git merge-tree` against throwaway repos, proving the fragment shape merges where the
   shared-tail shape does not. The second test is the control: without it, a green run
   could mean "merge-tree never conflicts here" rather than "the fix works".

The `<worker>` segment was added after a synthetic concurrency harness measured the
date-only name failing the same-date case (41 passed / 2 failed): two workers running on
the same date wrote the identical path and their branches conflicted. That is a real
exposure here — the repo is kept identical across CHARLIE/ALPHA/BRAVO by Ansible, so the
same nightly job can fire on more than one node. `test_same_date_workers_do_not_collide`
covers the fix and `test_same_date_date_only_names_do_collide` is its control.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
INSTRUCTIONS = REPO_ROOT / ".claude" / "agents" / "eval-fixer-instructions.md"
HOT_D = REPO_ROOT / "wiki" / "hot.d"
SCHEMA = REPO_ROOT / "wiki" / "SCHEMA.md"
HELPER = "tools/eval_fixer_fragment.py"

# Date + worker. The date ALONE is not a unique key — the repo is kept identical across
# CHARLIE/ALPHA/BRAVO by Ansible, so the same nightly job can fire on two nodes on the same
# date. Measured: on the date-only name, two same-date workers wrote the identical path and
# their branches conflicted. The SAME-host case (scheduled run + manual re-run) is not a
# naming problem at all — both resolve one hostname — and is handled by the helper's lock;
# see tests/test_eval_fixer_fragment_helper.py.
WORKER_ENV = "MIRA_EVAL_FIXER_WORKER"


# --------------------------------------------------------------------------
# Layer 1 — the instruction file is the writer; assert what it instructs.
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def instructions() -> str:
    assert INSTRUCTIONS.is_file(), f"missing writer instructions: {INSTRUCTIONS}"
    return INSTRUCTIONS.read_text(encoding="utf-8")


def test_instructions_call_the_helper_for_the_path(instructions: str) -> None:
    """The path must come from tested code, not a shell pipeline pasted into markdown.

    The old form inlined `hostname | tr | sed`. Nothing executed it, so a typo — or an
    override normalizing to empty — would have passed every test and shipped
    `wiki/hot.d/<date>-eval-fixer-.md`.
    """
    assert HELPER in instructions, (
        f"eval-fixer must resolve its fragment path via {HELPER}, not an inline snippet"
    )
    assert "--acquire" in instructions, (
        "the run must claim the host lock; without it a scheduled run and a manual re-run "
        "on ONE host resolve the same path and race"
    )


def test_instructions_stop_when_the_helper_rejects(instructions: str) -> None:
    """Exit 2 (another run owns today) must abort, not be worked around."""
    assert "exit 1" in instructions or "|| exit" in instructions, (
        "the helper's non-zero exit must abort the run"
    )
    assert "do not write a fragment" in instructions.lower()


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
    assert 'git add "$FRAGMENT"' in instructions, (
        "the fragment must be staged by its exact quoted path variable, so a shared working "
        "tree cannot pull another session's work into the eval-fixer commit"
    )


def test_instructions_document_the_override(instructions: str) -> None:
    """A deliberate second worker on one host needs a documented escape hatch."""
    assert WORKER_ENV in instructions, (
        f"the worker id must be overridable via {WORKER_ENV} so a second concurrent worker "
        "on one node can be given a distinct path"
    )


_BROAD_TARGETS = {"wiki/", "wiki", "-A", "."}


def _broad_staging_lines(text: str) -> list[str]:
    """Lines that INSTRUCT a broad `git add`. Prose *about* the forbidden form must not count."""
    out = []
    for raw in text.splitlines():
        line = raw.strip().lstrip("-*$ ").strip().strip("`").strip()
        if not line.startswith("git add"):
            continue  # prose like: Never `git add wiki/` here.
        rest = line[len("git add") :]
        for sep in ("&&", "#", "||", ";"):  # a trailing comment defeated the first version
            rest = rest.split(sep)[0]
        target = rest.strip().strip('"').strip("'")
        if target in _BROAD_TARGETS:
            out.append(line)
    return out


def test_wiki_protocol_does_not_recommend_broad_staging() -> None:
    """`wiki/SCHEMA.md` must not tell every session to `git add wiki/`.

    `wiki/hot.d/` now holds machine-written eval-fixer fragments, and this is a SHARED
    working tree. A broad `git add wiki/` sweeps another session's WIP — or a nightly
    fragment — into an unrelated human session commit, which is exactly the
    exact-path-staging rule this file's own Step 10 enforces.
    """
    assert not _broad_staging_lines(SCHEMA.read_text(encoding="utf-8")), (
        "wiki/SCHEMA.md must not recommend broad staging in a shared tree — found: "
        f"{_broad_staging_lines(SCHEMA.read_text(encoding='utf-8'))}"
    )


def test_broad_staging_detector_actually_detects() -> None:
    """The detector must survive the shapes these lines really take.

    A first version split on `&&` but not on a trailing `#` comment, so
    `git add wiki/   # name the paths` parsed as target `wiki/   # name the paths`
    and slipped through. Caught by mutation-testing the guard; pinned here.
    """
    assert _broad_staging_lines("git add wiki/")
    assert _broad_staging_lines("   git add wiki/         # name the paths YOU changed")
    assert _broad_staging_lines("`git add wiki/ && git commit -m x`")
    assert _broad_staging_lines("$ git add -A")
    assert _broad_staging_lines("- git add .")
    # legitimate, must NOT trip
    assert not _broad_staging_lines("git add wiki/hot.md wiki/log.md")
    assert not _broad_staging_lines("git add wiki/hot.md   # only what you changed")
    assert not _broad_staging_lines("Never `git add wiki/` here.")  # prose about it


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
    """Fixture setup only — builds the BASE commit of a throwaway repo.

    `-A` is fine here and only here: this is scaffolding for an empty scratch repo, not
    the worker's staging path. The worker always stages by exact path; the tests that
    matter assert that directly (see `test_run_does_not_sweep_foreign_wip`).
    """
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _commit_all_staged(repo: Path, message: str) -> str:
    """Commit ONLY what is already staged — the worker's real shape."""
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
        "wiki/hot.d/<date>-eval-fixer-<worker>.md"
    )


def _same_date_two_worker_repo(tmp_path: Path, *, with_worker: bool) -> tuple[Path, str, str]:
    """Two workers, SAME date, on branches off a shared base.

    with_worker=False reproduces the pre-fix date-only name.
    """
    repo = tmp_path / ("worker" if with_worker else "dateonly")
    _init_repo(repo)
    hot_d = repo / "wiki" / "hot.d"
    hot_d.mkdir(parents=True)
    (hot_d / ".keep").write_text("", encoding="utf-8")
    (repo / "wiki" / "hot.md").write_text("# Hot Cache\n- human note\n", encoding="utf-8")
    base = _commit_all(repo, "base")

    date = "2026-08-04"
    heads: list[str] = []
    for i, worker in enumerate(("charlie", "alpha")):
        _git(repo, "checkout", "-q", "-b", f"node-{worker}", base)
        name = f"{date}-eval-fixer-{worker}.md" if with_worker else f"{date}-eval-fixer.md"
        (hot_d / name).write_text(
            f"# eval-fixer run — {date} ({worker})\n- Scorecard: 4{i}/57\n", encoding="utf-8"
        )
        _git(repo, "add", f"wiki/hot.d/{name}")
        heads.append(_commit_all(repo, f"docs(wiki): eval-fixer run {date} ({worker})"))
    return repo, heads[0], heads[1]


def _committed_paths(repo: Path, ref: str) -> list[str]:
    """Files added by `ref` — read from the COMMIT, not the working tree.

    Each worker lives on its own branch, so only the last checkout's file is on disk;
    asserting against the tree would measure checkout order, not path uniqueness.
    """
    return [f for f in _git(repo, "show", "--name-only", "--format=", ref).splitlines() if f]


def test_same_date_workers_do_not_collide(tmp_path: Path) -> None:
    """Two nodes running on the SAME date must write different files and merge cleanly."""
    repo, a, b = _same_date_two_worker_repo(tmp_path, with_worker=True)
    paths = _committed_paths(repo, a) + _committed_paths(repo, b)
    assert len(set(paths)) == 2, f"expected two distinct same-date fragments, got {paths}"
    assert _merges_cleanly(repo, a, b), (
        "two workers running on the same date must merge conflict-free — the <worker> "
        "segment is what makes the path unique when the date is not"
    )


def test_same_date_date_only_names_do_collide(tmp_path: Path) -> None:
    """Control: the pre-fix date-only name really does collide.

    Without this, `test_same_date_workers_do_not_collide` could pass for the wrong reason
    (e.g. merge-tree never conflicting in this fixture) and would be vacuous.
    """
    repo, a, b = _same_date_two_worker_repo(tmp_path, with_worker=False)
    paths = _committed_paths(repo, a) + _committed_paths(repo, b)
    assert set(paths) == {"wiki/hot.d/2026-08-04-eval-fixer.md"}, (
        f"the date-only name should produce ONE shared path, got {paths}"
    )
    assert not _merges_cleanly(repo, a, b), (
        "expected the date-only name to conflict across two same-date workers; if this "
        "passes, the probe is not measuring what it claims"
    )


def test_shared_tail_appends_conflict(tmp_path: Path) -> None:
    """Control: the OLD shape really does conflict, so the test above means something."""
    repo, run_a, run_b = _two_run_repo(tmp_path, shared_tail=True)
    assert not _merges_cleanly(repo, run_a, run_b), (
        "expected the old shared-tail append to conflict; if this ever passes, the "
        "merge-tree probe is not measuring what it claims and the test above is vacuous"
    )


def test_run_does_not_sweep_foreign_wip(tmp_path: Path) -> None:
    """A run in a dirty SHARED tree commits its fragment and nothing else.

    This is the shape of the real checkout: other sessions' uncommitted edits, another
    writer's fragment already in `wiki/hot.d/`, and an uncommitted human edit to
    `wiki/hot.md`. Staging by exact path must leave all of it alone.
    """
    repo = tmp_path / "dirty"
    _init_repo(repo)
    (repo / "wiki" / "hot.d").mkdir(parents=True)
    (repo / "wiki" / "hot.md").write_text("# Hot Cache\n- human note\n", encoding="utf-8")
    (repo / "wiki" / "hot.d" / ".keep").write_text("", encoding="utf-8")
    base = _commit_all(repo, "base")

    # foreign WIP appears AFTER the base commit
    (repo / "wiki" / "log.md").write_text("# log\n- another session\n", encoding="utf-8")
    (repo / "wiki" / "hot.d" / "2026-07-01-eval-fixer-other.md").write_text("# other\n", "utf-8")
    (repo / "wiki" / "hot.md").write_text(
        "# Hot Cache\n- human note\n- UNCOMMITTED human edit\n", encoding="utf-8"
    )

    frag = "wiki/hot.d/2026-08-04-eval-fixer-charlie.md"
    (repo / frag).write_text("# eval-fixer run — 2026-08-04 (charlie)\n", encoding="utf-8")
    _git(repo, "add", frag)  # exact path — never `git add wiki/`
    assert _git(repo, "diff", "--cached", "--name-only").splitlines() == [frag]
    sha = _commit_all_staged(repo, "docs(wiki): eval-fixer run 2026-08-04 (charlie)")

    assert _committed_paths(repo, sha) == [frag], "the commit must contain exactly one file"
    assert _git(repo, "diff", "--name-only", f"{base}...{sha}", "--", "wiki/hot.md") == "", (
        "wiki/hot.md must not appear in the run's commit"
    )
    still_dirty = _git(repo, "status", "--porcelain")
    assert "wiki/log.md" in still_dirty and "wiki/hot.md" in still_dirty, (
        f"foreign WIP must remain uncommitted, got: {still_dirty!r}"
    )
    assert (repo / "wiki" / "hot.d" / "2026-07-01-eval-fixer-other.md").read_text() == "# other\n"


def test_midnight_boundary_runs_do_not_collide(tmp_path: Path) -> None:
    """23:59:59Z and 00:00:01Z are different dates → different files, clean merge."""
    repo = tmp_path / "midnight"
    _init_repo(repo)
    (repo / "wiki" / "hot.d").mkdir(parents=True)
    (repo / "wiki" / "hot.md").write_text("# Hot Cache\n", encoding="utf-8")
    (repo / "wiki" / "hot.d" / ".keep").write_text("", encoding="utf-8")
    base = _commit_all(repo, "base")

    heads, paths = [], []
    for date, label in (("2026-08-03", "23:59:59Z"), ("2026-08-04", "00:00:01Z")):
        _git(repo, "checkout", "-q", "-B", f"at-{date}", base)
        rel = f"wiki/hot.d/{date}-eval-fixer-charlie.md"
        (repo / rel).write_text(f"# eval-fixer run — {date} ({label})\n", encoding="utf-8")
        _git(repo, "add", rel)
        paths.append(rel)
        heads.append(_commit_all_staged(repo, f"docs(wiki): eval-fixer run {date}"))

    assert paths[0] != paths[1]
    assert _merges_cleanly(repo, heads[0], heads[1])
