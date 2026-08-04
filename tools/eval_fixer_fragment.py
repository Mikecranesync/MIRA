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
import sys
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", required=True, help="run date, YYYY-MM-DD")
    ap.add_argument(
        "--acquire", action="store_true", help="claim the host lock, then print the path"
    )
    ap.add_argument("--release", action="store_true", help="release the host lock")
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
