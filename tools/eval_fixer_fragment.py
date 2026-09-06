#!/usr/bin/env python3
"""Resolve the eval-fixer's per-run fragment path, and enforce one run per host.

Why this is executable code and not a shell snippet in a markdown file
---------------------------------------------------------------------
The path used to be built by an inline `hostname | tr | sed` pipeline pasted into
`.claude/agents/eval-fixer-instructions.md`. Two problems with that, both real:

1. **Nothing executed it.** The tests asserted the instructions *contained* the string
   `hostname -s`. A typo inside the pipeline, or a normalization that produced an empty
   worker id, would have passed every test and shipped.
2. **It could not fail closed.** `MIRA_EVAL_FIXER_WORKER='!!!'` normalizes to the empty
   string, yielding `...-eval-fixer-.md` — a silently degenerate name that reintroduces
   collisions for every override that happens to normalize the same way.

Both are fixed by making path generation a function with tests pointed at it.

Why a host-local lock (`--acquire`)
-----------------------------------
Date + worker separates runs on DIFFERENT hosts. It does NOT separate a scheduled run
from a manual re-run on the SAME host — both resolve the same hostname, so both resolve
the same filename, so the collision this whole design removes comes straight back one
day at a time. Naming alone cannot fix that: two concurrent runs on one host are the
same worker by every stable identity they have.

So we do not try to name our way out. `--acquire` takes an atomic host-local lock keyed
on (host, date). A second CONCURRENT run is **rejected** (exit 2) rather than allowed to
race. A retry AFTER the first run died reclaims the stale lock and proceeds — which is
what preserves restart idempotency: same host, same date, same path, overwritten in place.
"""

from __future__ import annotations

import argparse
import errno
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path

WORKER_ENV = "MIRA_EVAL_FIXER_WORKER"
FRAGMENT_DIR = "wiki/hot.d"
LOCK_ENV = "MIRA_EVAL_FIXER_LOCKDIR"
DEFAULT_LOCK_ROOT = Path(os.environ.get("TMPDIR", "/tmp"))
# A run that has held the lock longer than this is presumed dead. The nightly job's
# own budget ceiling is ~$10 of inference across two full eval passes; 6h is far past
# any healthy run and far short of the 24h until the next scheduled fire.
STALE_LOCK_SECONDS = 6 * 60 * 60
# Every git/gh call here is local or a single small ref push. A hung network call must
# not wedge the nightly job until the next fire.
GIT_TIMEOUT_SECONDS = 120

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


class WorkerIdError(ValueError):
    """The worker id could not be normalized into a usable path segment."""


def slugify_worker(raw: str) -> str:
    """Normalize a worker id into a safe, non-empty path segment.

    Fails closed: anything that normalizes to empty raises rather than producing
    `...-eval-fixer-.md`. Lowercases, collapses runs of non-alphanumerics to a single
    `-`, and trims leading/trailing separators.
    """
    slug = _SLUG_STRIP.sub("-", raw.strip().lower()).strip("-")
    if not slug:
        raise WorkerIdError(
            f"worker id {raw!r} normalizes to an empty string. Set {WORKER_ENV} to "
            "something containing at least one letter or digit — an empty segment would "
            "produce '-eval-fixer-.md' and collide with every other empty-normalizing id."
        )
    if slug != _SLUG_STRIP.sub("-", slug).strip("-"):  # defensive: normalization is idempotent
        raise WorkerIdError(f"worker id {raw!r} did not normalize idempotently to {slug!r}")
    return slug


def resolve_worker(env: Mapping[str, str] | None = None, hostname: str | None = None) -> str:
    """Worker id: `$MIRA_EVAL_FIXER_WORKER` if set and non-blank, else the short hostname."""
    source: Mapping[str, str] = os.environ if env is None else env
    raw = (source.get(WORKER_ENV) or "").strip()
    if not raw:
        raw = (hostname if hostname is not None else socket.gethostname()).split(".")[0]
    return slugify_worker(raw)


def fragment_path(date: str, worker: str) -> str:
    """The one file this run writes. Date + worker; never `wiki/hot.md`."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError(f"date must be YYYY-MM-DD, got {date!r}")
    return f"{FRAGMENT_DIR}/{date}-eval-fixer-{worker}.md"


# --------------------------------------------------------------------------
# Host-local lock — one eval-fixer run per host at a time.
# --------------------------------------------------------------------------


def _lock_path(date: str, worker: str, lock_root: Path | None = None) -> Path:
    root = lock_root or Path(os.environ.get(LOCK_ENV, DEFAULT_LOCK_ROOT))
    return root / f"mira-eval-fixer-{date}-{worker}.lock"


def acquire_lock(
    date: str,
    worker: str,
    *,
    lock_root: Path | None = None,
    now: float | None = None,
    pid: int | None = None,
) -> tuple[bool, str]:
    """Atomically claim (host, date). Returns (acquired, reason).

    `mkdir` is atomic on POSIX — two concurrent runs cannot both succeed. A lock older
    than STALE_LOCK_SECONDS, or one whose recorded pid is gone, is reclaimed so a retry
    after a crash is not blocked forever.
    """
    now = time.time() if now is None else now
    pid = os.getpid() if pid is None else pid
    lock = _lock_path(date, worker, lock_root)
    lock.parent.mkdir(parents=True, exist_ok=True)

    try:
        lock.mkdir()
    except OSError as exc:
        if exc.errno != errno.EEXIST:
            raise
        held = _read_lock(lock)
        if _is_stale(held, now=now):
            _write_lock(lock, pid=pid, now=now)
            return True, f"reclaimed stale lock (held by pid {held.get('pid')})"
        return False, (
            f"another eval-fixer run is already active on this host for {date} "
            f"(pid {held.get('pid')}, started {held.get('started')}). Concurrent runs on "
            f"one host resolve the SAME fragment path, so this run is rejected rather "
            f"than allowed to race. Set {WORKER_ENV} to a distinct id to run a second "
            f"worker deliberately."
        )
    _write_lock(lock, pid=pid, now=now)
    return True, "acquired"


def release_lock(date: str, worker: str, *, lock_root: Path | None = None) -> bool:
    lock = _lock_path(date, worker, lock_root)
    meta = lock / "owner"
    try:
        meta.unlink(missing_ok=True)
        lock.rmdir()
        return True
    except OSError:
        return False


def _write_lock(lock: Path, *, pid: int, now: float) -> None:
    (lock / "owner").write_text(f"{pid}\n{now}\n", encoding="utf-8")


def _read_lock(lock: Path) -> dict[str, str]:
    try:
        raw = (lock / "owner").read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    return {"pid": raw[0] if raw else "", "started": raw[1] if len(raw) > 1 else ""}


def _is_stale(held: dict[str, str], *, now: float) -> bool:
    started = held.get("started", "")
    if not started:
        return True  # unreadable/partial lock — treat as abandoned
    try:
        age = now - float(started)
    except ValueError:
        return True
    if age > STALE_LOCK_SECONDS:
        return True
    try:
        os.kill(int(held["pid"]), 0)
    except (ValueError, KeyError, ProcessLookupError):
        return True
    except PermissionError:
        return False  # exists, owned by another user
    return False


# --------------------------------------------------------------------------
# Publishing — get the fragment onto the remote, without touching the tree.
# --------------------------------------------------------------------------


def publish_branch(date: str, worker: str) -> str:
    """The one branch this run pushes. Keyed the same way the fragment is."""
    return f"docs/eval-fixer-{date}-{worker}"


def _git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=check,
        timeout=GIT_TIMEOUT_SECONDS,
    )


def read_fragment(repo: Path, path: str) -> str | None:
    """The fragment's content: from the working tree, else from a local commit.

    The second case is the whole reason this exists. On a no-patch night the agent
    used to `git commit` the fragment onto local `main` — which is protected, so the
    push never happened and the run's output sat in a local commit until a human
    noticed (#3134, #3255, #3473, #3574 each rescued a batch by hand). If the file is
    already committed and gone from the tree, we still publish it rather than lose it.
    """
    on_disk = repo / path
    if on_disk.is_file():
        return on_disk.read_text(encoding="utf-8")
    for ref in ("HEAD", "main"):
        got = _git(repo, "show", f"{ref}:{path}", check=False)
        if got.returncode == 0:
            return got.stdout
    return None


def publish_fragment(
    date: str, worker: str, *, repo: Path, remote: str = "origin", base: str = "main"
) -> tuple[bool, str]:
    """Push this run's fragment to its own branch and open a draft PR.

    Builds the commit with plumbing (`hash-object` → `update-index` in a scratch index
    → `write-tree` → `commit-tree`) and pushes the resulting object straight to a remote
    ref. **Nothing checks out, and `HEAD` never moves.** That is deliberate: this fires at
    05:00 UTC into a SHARED working tree that usually has another session's branch checked
    out with uncommitted work, so `git checkout -b` here would move HEAD out from under a
    live session. The same reasoning as `safe-cron-pull.sh` refusing to pull off `main`.

    Idempotent: the branch is keyed on (date, worker) and owned solely by this run, so a
    restart force-updates its own branch in place — the same argument that lets the
    fragment itself be overwritten on a retry.
    """
    path = fragment_path(date, worker)
    branch = publish_branch(date, worker)

    content = read_fragment(repo, path)
    if content is None:
        return False, f"no fragment to publish at {path} (not in the tree, not committed)"

    try:
        # Publish onto the CURRENT tip, not whatever this shared checkout last fetched.
        _git(repo, "fetch", "--quiet", "--no-tags", remote, base)
        base_sha = _git(repo, "rev-parse", f"{remote}/{base}").stdout.strip()
        blob = subprocess.run(
            ["git", "-C", str(repo), "hash-object", "-w", "--stdin"],
            input=content,
            capture_output=True,
            text=True,
            check=True,
            timeout=GIT_TIMEOUT_SECONDS,
        ).stdout.strip()
    except subprocess.CalledProcessError as exc:
        return False, f"could not stage the fragment against {remote}/{base}: {exc.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return False, f"timed out fetching {remote}/{base}"

    with tempfile.TemporaryDirectory() as tmp:
        index = Path(tmp) / "index"
        env = {**os.environ, "GIT_INDEX_FILE": str(index)}

        def idx(*args: str) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                ["git", "-C", str(repo), *args],
                capture_output=True,
                text=True,
                check=True,
                env=env,
                timeout=GIT_TIMEOUT_SECONDS,
            )

        try:
            idx("read-tree", base_sha)
            idx("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}")
            tree = idx("write-tree").stdout.strip()
        except subprocess.CalledProcessError as exc:
            return False, f"could not build the fragment tree: {exc.stderr.strip()}"

    # Adding the fragment left the tree identical, so this exact content is already on
    # the base branch — a re-run after the PR merged. Success, with nothing to push.
    if tree == _git(repo, "rev-parse", f"{base_sha}^{{tree}}").stdout.strip():
        return True, f"{path} is already on {remote}/{base} — nothing to publish"

    message = f"docs(wiki): eval-fixer run {date} ({worker})"
    try:
        commit = _git(repo, "commit-tree", tree, "-p", base_sha, "-m", message).stdout.strip()
    except subprocess.CalledProcessError as exc:
        return False, f"could not create the commit: {exc.stderr.strip()}"

    pushed = _git(repo, "push", "--force", remote, f"{commit}:refs/heads/{branch}", check=False)
    if pushed.returncode != 0:
        # The push failed (no network, SSH under launchd, a rejected ref). Do NOT leave the
        # run's only copy as an untracked file: an untracked file in a SHARED checkout dies
        # to the next `git clean -fd` or gets swept into someone else's `git add -A`, which
        # is strictly less recoverable than the stranded-commit bug this function replaced.
        # The commit object already exists, so anchor it to a local ref. That makes the
        # output durable and gives the wrapper's canary something to find.
        _git(repo, "update-ref", f"refs/heads/{branch}", commit, check=False)
        return False, (
            f"could not push {branch}: {pushed.stderr.strip()} — kept locally as "
            f"refs/heads/{branch} ({commit[:9]}); push it to deliver this run"
        )

    return _open_draft_pr(repo, branch=branch, base=base, date=date, worker=worker)


def _open_draft_pr(
    repo: Path, *, branch: str, base: str, date: str, worker: str
) -> tuple[bool, str]:
    """Open the draft PR, or report the existing one. Never fails the publish."""
    existing = subprocess.run(
        ["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url", "-q", ".[].url"],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if existing.returncode == 0 and existing.stdout.strip():
        return (
            True,
            f"pushed {branch}; PR already open at {existing.stdout.strip().splitlines()[0]}",
        )

    created = subprocess.run(
        [
            "gh",
            "pr",
            "create",
            "--draft",
            "--base",
            base,
            "--head",
            branch,
            "--title",
            f"docs(wiki): eval-fixer run {date} ({worker})",
            "--body",
            f"Nightly eval-fixer run fragment for {date} on `{worker}`.\n\n"
            f"Opened automatically by `tools/eval_fixer_fragment.py --publish`. The run's "
            f"output used to be committed to local `main`, which is protected, so it was "
            f"stranded until someone rescued it by hand (#3134, #3255, #3473, #3574).",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if created.returncode != 0:
        # The branch is pushed — the run's output is safe. A PR can be opened by hand.
        return True, f"pushed {branch}, but could not open a PR: {created.stderr.strip()}"
    return True, f"pushed {branch} and opened {created.stdout.strip()}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", required=True, help="run date, YYYY-MM-DD")
    ap.add_argument(
        "--acquire", action="store_true", help="claim the host lock, then print the path"
    )
    ap.add_argument("--release", action="store_true", help="release the host lock")
    ap.add_argument(
        "--publish",
        action="store_true",
        help="push this run's fragment to its own branch and open a draft PR",
    )
    ap.add_argument("--repo", default=None, help="repo root (default: the helper's own repo)")
    args = ap.parse_args(argv)

    try:
        worker = resolve_worker()
        path = fragment_path(args.date, worker)
    except (WorkerIdError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3

    if args.release:
        release_lock(args.date, worker)
        return 0
    if args.publish:
        repo = Path(args.repo) if args.repo else Path(__file__).resolve().parents[1]
        ok, reason = publish_fragment(args.date, worker, repo=repo)
        print(reason, file=sys.stderr)
        if ok:
            return 0
        # 5 distinguishes "this run wrote no fragment" (the ordinary clean-eval outcome,
        # where the agent exits at Step 1) from 4, a real failure to deliver one.
        return 5 if reason.startswith("no fragment to publish") else 4
    if args.acquire:
        ok, reason = acquire_lock(args.date, worker)
        if not ok:
            print(f"error: {reason}", file=sys.stderr)
            return 2
        print(reason, file=sys.stderr)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
