"""Direct tests of `tools/eval_fixer_fragment.py` — the code that actually builds the path.

Why these exist: the previous tests asserted the *instruction file* contained the string
`hostname -s`. Nothing executed the pipeline, so a typo in it — or an override that
normalized to the empty string — would have passed every test and shipped a degenerate
`wiki/hot.d/<date>-eval-fixer-.md`. These point at the function instead.

They also cover the case naming alone cannot solve: two CONCURRENT runs on the SAME host.
Both resolve the same hostname, therefore the same worker id, therefore the same path.
The helper rejects the second rather than letting it race — see `acquire_lock`.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

_HELPER = Path(__file__).resolve().parents[1] / "tools" / "eval_fixer_fragment.py"
_spec = importlib.util.spec_from_file_location("eval_fixer_fragment", _HELPER)
assert _spec and _spec.loader
efp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(efp)


# --------------------------------------------------------------------------
# Worker-id normalization — fails closed.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("CharlieNodes-Mac-mini", "charlienodes-mac-mini"),  # uppercase
        ("ALPHA node #2!", "alpha-node-2"),  # punctuation + space
        ("  bravo  ", "bravo"),  # surrounding whitespace
        ("a---b", "a-b"),  # duplicate separators collapse
        ("--lead-and-trail--", "lead-and-trail"),  # trimmed
        ("node.local", "node-local"),  # dots are separators, not path parts
        ("worker/../etc", "worker-etc"),  # traversal cannot survive
        ("héllo wörld", "h-llo-w-rld"),  # non-ascii dropped, not passed through
        ("7", "7"),  # a single digit is a valid id
    ],
)
def test_slugify_normalizes(raw: str, expected: str) -> None:
    assert efp.slugify_worker(raw) == expected


@pytest.mark.parametrize("raw", ["!!!", "   ", "---", "", "###-###", "\t\n"])
def test_slugify_fails_closed_on_empty_normalization(raw: str) -> None:
    """`MIRA_EVAL_FIXER_WORKER='!!!'` must NOT silently yield `-eval-fixer-.md`."""
    with pytest.raises(efp.WorkerIdError):
        efp.slugify_worker(raw)


def test_slug_output_is_a_safe_path_segment() -> None:
    for raw in ("ALPHA node #2!", "worker/../etc", "node.local", "  bravo  "):
        slug = efp.slugify_worker(raw)
        assert slug, "must be non-empty"
        assert "/" not in slug and ".." not in slug
        assert slug == slug.strip("-")


def test_distinct_inputs_that_normalize_alike_are_a_known_collision() -> None:
    """Different overrides CAN collapse to one slug — document it, don't pretend otherwise.

    `alpha node` and `ALPHA-NODE` are the same worker as far as the path is concerned.
    That is acceptable (they are meant to name the same node) but an operator choosing
    deliberately-distinct concurrent ids must pick ids that differ AFTER normalization.
    """
    assert efp.slugify_worker("alpha node") == efp.slugify_worker("ALPHA-NODE") == "alpha-node"
    assert efp.slugify_worker("alpha-node-2") != efp.slugify_worker("alpha-node")


# --------------------------------------------------------------------------
# Resolution + path.
# --------------------------------------------------------------------------


def test_env_override_wins_over_hostname() -> None:
    assert efp.resolve_worker({efp.WORKER_ENV: "Alpha Node"}, hostname="charlie") == "alpha-node"


def test_blank_override_falls_back_to_hostname() -> None:
    assert efp.resolve_worker({efp.WORKER_ENV: "   "}, hostname="CharlieNodes-Mac-mini.local") == (
        "charlienodes-mac-mini"
    )


def test_hostname_is_shortened_before_slugging() -> None:
    """FQDN must not become part of the filename."""
    assert efp.resolve_worker({}, hostname="bravo.factorylm.internal") == "bravo"


def test_bad_override_raises_rather_than_falling_back() -> None:
    """An explicitly-set-but-unusable id is an error, not a silent hostname fallback."""
    with pytest.raises(efp.WorkerIdError):
        efp.resolve_worker({efp.WORKER_ENV: "!!!"}, hostname="charlie")


def test_fragment_path_shape() -> None:
    assert efp.fragment_path("2026-08-04", "charlie") == (
        "wiki/hot.d/2026-08-04-eval-fixer-charlie.md"
    )


def test_fragment_path_is_never_hot_md() -> None:
    p = efp.fragment_path("2026-08-04", "charlie")
    assert p.startswith("wiki/hot.d/") and not p.endswith("/hot.md")


@pytest.mark.parametrize("date", ["2026-8-4", "20260804", "", "2026-08-04-extra", "yyyy-mm-dd"])
def test_fragment_path_rejects_malformed_dates(date: str) -> None:
    with pytest.raises(ValueError):
        efp.fragment_path(date, "charlie")


def test_two_workers_same_date_get_distinct_paths() -> None:
    a = efp.fragment_path("2026-08-04", efp.resolve_worker({}, hostname="charlie"))
    b = efp.fragment_path("2026-08-04", efp.resolve_worker({}, hostname="alpha"))
    assert a != b


# --------------------------------------------------------------------------
# Host-local lock — the same-host concurrency case naming cannot solve.
# --------------------------------------------------------------------------


def test_same_host_same_date_concurrent_second_run_is_rejected(tmp_path: Path) -> None:
    """THE P1 case: scheduled run + manual re-run on ONE host, same date.

    Both resolve the same hostname → same worker → same path. The second must be
    rejected, not allowed to race into the same file.
    """
    worker = efp.resolve_worker({}, hostname="charlie")
    first_ok, _ = efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path, pid=os.getpid())
    assert first_ok, "first run must acquire"

    second_ok, reason = efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path, pid=os.getpid())
    assert not second_ok, "a second CONCURRENT run on the same host must be rejected"
    assert "already active" in reason
    assert efp.WORKER_ENV in reason, "the rejection must say how to run a second worker on purpose"


def test_same_host_distinct_override_runs_concurrently(tmp_path: Path) -> None:
    """A deliberate second worker on one host is allowed — with a distinct id."""
    a = efp.resolve_worker({}, hostname="charlie")
    b = efp.resolve_worker({efp.WORKER_ENV: "charlie-manual"}, hostname="charlie")
    assert a != b
    assert efp.acquire_lock("2026-08-04", a, lock_root=tmp_path)[0]
    assert efp.acquire_lock("2026-08-04", b, lock_root=tmp_path)[0]
    assert efp.fragment_path("2026-08-04", a) != efp.fragment_path("2026-08-04", b)


def test_retry_after_release_reuses_the_same_path(tmp_path: Path) -> None:
    """Restart idempotency: same host + same date → same file, overwritten in place."""
    worker = efp.resolve_worker({}, hostname="charlie")
    assert efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path)[0]
    first_path = efp.fragment_path("2026-08-04", worker)
    assert efp.release_lock("2026-08-04", worker, lock_root=tmp_path)

    ok, _ = efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path)
    assert ok, "a retry after a clean release must be able to run"
    assert efp.fragment_path("2026-08-04", worker) == first_path, "one file, not two"


def test_stale_lock_from_a_dead_run_is_reclaimed(tmp_path: Path) -> None:
    """A crashed run must not block the retry forever."""
    worker = efp.resolve_worker({}, hostname="charlie")
    # held far longer than any healthy run
    assert efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path, now=1000.0, pid=os.getpid())[
        0
    ]
    ok, reason = efp.acquire_lock(
        "2026-08-04", worker, lock_root=tmp_path, now=1000.0 + efp.STALE_LOCK_SECONDS + 1
    )
    assert ok and "stale" in reason


def test_lock_held_by_a_live_pid_within_the_window_is_not_reclaimed(tmp_path: Path) -> None:
    """The stale check must not be a rubber stamp that defeats the lock."""
    worker = efp.resolve_worker({}, hostname="charlie")
    assert efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path, now=1000.0)[0]
    ok, _ = efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path, now=1000.0 + 60)
    assert not ok


def test_different_dates_do_not_block_each_other(tmp_path: Path) -> None:
    worker = efp.resolve_worker({}, hostname="charlie")
    assert efp.acquire_lock("2026-08-04", worker, lock_root=tmp_path)[0]
    assert efp.acquire_lock("2026-08-05", worker, lock_root=tmp_path)[0]


# --------------------------------------------------------------------------
# CLI — the surface the instructions actually invoke.
# --------------------------------------------------------------------------


def test_cli_prints_the_path(capsys: pytest.CaptureFixture[str], monkeypatch) -> None:
    monkeypatch.setenv(efp.WORKER_ENV, "charlie")
    assert efp.main(["--date", "2026-08-04"]) == 0
    assert capsys.readouterr().out.strip() == "wiki/hot.d/2026-08-04-eval-fixer-charlie.md"


def test_cli_fails_closed_on_unusable_worker(
    capsys: pytest.CaptureFixture[str], monkeypatch
) -> None:
    monkeypatch.setenv(efp.WORKER_ENV, "!!!")
    assert efp.main(["--date", "2026-08-04"]) == 3
    assert "empty" in capsys.readouterr().err


def test_cli_rejects_a_concurrent_second_acquire(
    capsys: pytest.CaptureFixture[str], monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(efp.WORKER_ENV, "charlie")
    monkeypatch.setenv(efp.LOCK_ENV, str(tmp_path))
    assert efp.main(["--date", "2026-08-04", "--acquire"]) == 0
    capsys.readouterr()
    assert efp.main(["--date", "2026-08-04", "--acquire"]) == 2, "second concurrent run must exit 2"
    assert "already active" in capsys.readouterr().err


# --------------------------------------------------------------------------
# Publishing — the fragment has to actually reach the remote.
#
# The defect these cover: on a no-patch night the agent committed the fragment to local
# `main`, which is protected, so the push never happened and the run's output sat in an
# unpushable local commit until a human rescued it (#3134, #3255, #3473, #3574). The fix
# is deterministic code, so these point at that code — not at the instruction prose,
# which already forbade the behaviour through all four incidents.
# --------------------------------------------------------------------------


def _run(*args: str, cwd: Path, **kw) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True, **kw)


@pytest.fixture
def origin_and_clone(tmp_path: Path) -> tuple[Path, Path]:
    """A bare 'origin' with a `main`, plus a clone standing in for the shared checkout."""
    origin = tmp_path / "origin.git"
    _run("git", "init", "--bare", "-b", "main", str(origin), cwd=tmp_path)

    seed = tmp_path / "seed"
    _run("git", "clone", str(origin), str(seed), cwd=tmp_path)
    for k, v in (("user.email", "t@t.local"), ("user.name", "T"), ("commit.gpgsign", "false")):
        _run("git", "config", k, v, cwd=seed)
    (seed / "README.md").write_text("seed\n", encoding="utf-8")
    _run("git", "add", "README.md", cwd=seed)
    _run("git", "commit", "-m", "seed", cwd=seed)
    _run("git", "push", "origin", "main", cwd=seed)

    clone = tmp_path / "clone"
    _run("git", "clone", str(origin), str(clone), cwd=tmp_path)
    for k, v in (("user.email", "t@t.local"), ("user.name", "T"), ("commit.gpgsign", "false")):
        _run("git", "config", k, v, cwd=clone)
    return origin, clone


def _write_fragment(clone: Path, date: str, worker: str, body: str = "# run\n") -> Path:
    path = clone / efp.fragment_path(date, worker)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def _branch_sha(origin: Path, branch: str) -> str:
    got = subprocess.run(
        ["git", "-C", str(origin), "rev-parse", f"refs/heads/{branch}"],
        capture_output=True,
        text=True,
    )
    return got.stdout.strip() if got.returncode == 0 else ""


def test_publish_branch_is_keyed_like_the_fragment() -> None:
    assert efp.publish_branch("2026-08-30", "charlie") == "docs/eval-fixer-2026-08-30-charlie"


def test_publish_pushes_the_fragment_to_its_own_branch(origin_and_clone) -> None:
    origin, clone = origin_and_clone
    _write_fragment(clone, "2026-08-30", "charlie", "# eval-fixer run\n- 56/65\n")

    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert ok, reason
    branch = efp.publish_branch("2026-08-30", "charlie")
    assert _branch_sha(origin, branch), f"branch {branch} not on origin: {reason}"
    shown = _run(
        "git",
        "-C",
        str(origin),
        "show",
        f"refs/heads/{branch}:{efp.fragment_path('2026-08-30', 'charlie')}",
        cwd=origin,
    )
    assert "56/65" in shown.stdout


def test_publish_never_moves_head_or_dirties_the_shared_tree(origin_and_clone) -> None:
    """The whole reason this uses plumbing: it runs at 05:00 into a SHARED checkout."""
    _, clone = origin_and_clone
    _run("git", "checkout", "-b", "someone-elses-wip", cwd=clone)
    (clone / "their_work.py").write_text("# uncommitted\n", encoding="utf-8")
    head_before = _run("git", "rev-parse", "HEAD", cwd=clone).stdout.strip()
    branch_before = _run("git", "rev-parse", "--abbrev-ref", "HEAD", cwd=clone).stdout.strip()

    _write_fragment(clone, "2026-08-30", "charlie")
    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert ok, reason
    assert _run("git", "rev-parse", "HEAD", cwd=clone).stdout.strip() == head_before
    assert (
        _run("git", "rev-parse", "--abbrev-ref", "HEAD", cwd=clone).stdout.strip() == branch_before
    )
    assert (clone / "their_work.py").read_text(encoding="utf-8") == "# uncommitted\n"


def test_publish_rescues_a_fragment_stranded_in_a_local_main_commit(origin_and_clone) -> None:
    """The exact four-time incident: committed to protected `main`, so never pushed."""
    origin, clone = origin_and_clone
    frag = _write_fragment(clone, "2026-08-30", "charlie", "# stranded\n")
    _run("git", "add", str(frag.relative_to(clone)), cwd=clone)
    _run("git", "commit", "-m", "docs(wiki): eval-fixer run 2026-08-30 (charlie)", cwd=clone)
    assert frag.is_file()
    frag.unlink()  # committed and gone from the tree — recoverable only from the commit

    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert ok, reason
    branch = efp.publish_branch("2026-08-30", "charlie")
    shown = _run(
        "git",
        "-C",
        str(origin),
        "show",
        f"refs/heads/{branch}:{efp.fragment_path('2026-08-30', 'charlie')}",
        cwd=origin,
    )
    assert "stranded" in shown.stdout


def test_publish_is_idempotent_across_a_rerun(origin_and_clone) -> None:
    origin, clone = origin_and_clone
    _write_fragment(clone, "2026-08-30", "charlie", "# first\n")
    assert efp.publish_fragment("2026-08-30", "charlie", repo=clone)[0]
    first = _branch_sha(origin, efp.publish_branch("2026-08-30", "charlie"))

    _write_fragment(clone, "2026-08-30", "charlie", "# corrected\n")
    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert ok, reason
    second = _branch_sha(origin, efp.publish_branch("2026-08-30", "charlie"))
    assert second and second != first, "a restart must update its own branch in place"
    shown = _run(
        "git",
        "-C",
        str(origin),
        "show",
        f"refs/heads/{efp.publish_branch('2026-08-30', 'charlie')}:"
        f"{efp.fragment_path('2026-08-30', 'charlie')}",
        cwd=origin,
    )
    assert "corrected" in shown.stdout


def test_publish_reports_nothing_to_do_once_the_fragment_is_on_main(origin_and_clone) -> None:
    origin, clone = origin_and_clone
    frag = _write_fragment(clone, "2026-08-30", "charlie", "# merged already\n")
    _run("git", "add", str(frag.relative_to(clone)), cwd=clone)
    _run("git", "commit", "-m", "docs(wiki): fragment", cwd=clone)
    _run("git", "push", "origin", "main", cwd=clone)

    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert ok
    assert "already on" in reason
    assert not _branch_sha(origin, efp.publish_branch("2026-08-30", "charlie"))


def test_publish_fails_loudly_when_there_is_no_fragment(origin_and_clone) -> None:
    _, clone = origin_and_clone
    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)
    assert not ok
    assert "no fragment to publish" in reason


def test_wrapper_publishes_after_the_agent_exits() -> None:
    """The publish must be in the wrapper, not the prose the agent already ignored."""
    wrapper = (
        Path(__file__).resolve().parents[1] / ".claude" / "agents" / "run-eval-fixer.sh"
    ).read_text(encoding="utf-8")
    assert "--publish" in wrapper, "wrapper must run the publish step itself"
    # Match the invocation, not the prose above it — the canary comment names `--publish` too.
    invocation = wrapper.index('--date "$(date +%Y-%m-%d)" --publish')
    assert wrapper.index("claude \\") < invocation, "publish must run after the agent exits"
    assert "origin/main..main" in wrapper, "wrapper must carry the stranded-commit canary"


def test_instructions_no_longer_tell_the_agent_to_commit_to_main() -> None:
    """The line that caused four strandings: 'or main if no patch was made'."""
    text = (
        Path(__file__).resolve().parents[1] / ".claude" / "agents" / "eval-fixer-instructions.md"
    ).read_text(encoding="utf-8")
    assert "or main if no patch was made" not in text


def test_failed_push_keeps_the_commit_on_a_local_ref(origin_and_clone) -> None:
    """A failed push must not leave the run's only copy as an untracked file.

    That would be strictly WORSE than the stranded-commit bug this replaced: an untracked
    file in the shared checkout dies to the next `git clean -fd`. The commit object already
    exists, so it gets anchored to a local ref instead — durable, and findable by the
    wrapper's canary.
    """
    origin, clone = origin_and_clone
    _write_fragment(clone, "2026-08-30", "charlie", "# undelivered\n")
    _run("git", "remote", "set-url", "--push", "origin", "/nonexistent/unreachable.git", cwd=clone)

    ok, reason = efp.publish_fragment("2026-08-30", "charlie", repo=clone)

    assert not ok
    assert "kept locally" in reason
    branch = efp.publish_branch("2026-08-30", "charlie")
    local = _run("git", "rev-parse", "--verify", f"refs/heads/{branch}", cwd=clone).stdout.strip()
    assert local, "the commit must survive on a local ref"
    shown = _run("git", "show", f"{branch}:{efp.fragment_path('2026-08-30', 'charlie')}", cwd=clone)
    assert "undelivered" in shown.stdout
    assert not _branch_sha(origin, branch), "nothing should have reached origin"


def test_cli_uses_a_distinct_code_for_no_fragment_vs_a_real_failure(
    capsys: pytest.CaptureFixture[str], monkeypatch, origin_and_clone
) -> None:
    """Clean-eval nights write no fragment. That is normal, not a delivery failure."""
    _, clone = origin_and_clone
    monkeypatch.setenv(efp.WORKER_ENV, "charlie")

    assert efp.main(["--date", "2026-08-30", "--publish", "--repo", str(clone)]) == 5
    assert "no fragment to publish" in capsys.readouterr().err

    _write_fragment(clone, "2026-08-30", "charlie")
    _run("git", "remote", "set-url", "--push", "origin", "/nonexistent/unreachable.git", cwd=clone)
    assert efp.main(["--date", "2026-08-30", "--publish", "--repo", str(clone)]) == 4


def test_wrapper_canary_detects_an_unpushed_local_eval_fixer_branch() -> None:
    """The canary must watch the failure mode that can actually happen now."""
    wrapper = (
        Path(__file__).resolve().parents[1] / ".claude" / "agents" / "run-eval-fixer.sh"
    ).read_text(encoding="utf-8")
    assert "refs/heads/docs/eval-fixer-*" in wrapper, "canary must look for unpushed run branches"
    assert "refs/remotes/origin/" in wrapper, "canary must compare against what reached origin"
