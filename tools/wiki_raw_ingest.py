#!/usr/bin/env python3
"""Move .md files from a drop folder into wiki/raw/<YYYY-MM-DD>/ and commit.

Triggered by a launchd WatchPaths agent. SHA-256 dedupes against everything
already under wiki/raw/. Refuses to run if the repo is not on an allowed
branch (default: main) — defends against the obsidian-git wrong-branch
footgun where auto-commits ended up on feat/comic-pipeline-v2 in 2026-04-25.

Logs to ~/Library/Logs/wiki-raw-ingest.log; never auto-pushes.

Usage:
    python tools/wiki_raw_ingest.py
    MIRA_DROP_DIR=/tmp/x REPO_ROOT=/tmp/repo python tools/wiki_raw_ingest.py

Env:
    MIRA_DROP_DIR              default ~/MiraDrop
    REPO_ROOT                  default = git toplevel of this script's dir
    MIRA_WIKI_ALLOWED_BRANCHES default "main"; comma-separated list
    MIRA_WIKI_INGEST_LOG       default ~/Library/Logs/wiki-raw-ingest.log
"""

from __future__ import annotations

import datetime as dt
import fcntl
import hashlib
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

LOCK_PATH = Path("/tmp/wiki-raw-ingest.lock")
SKIP_PREFIXES = (".", "~")
SKIP_SUFFIXES = (".swp", ".swo", ".tmp", ".part")


def repo_root() -> Path:
    if env := os.environ.get("REPO_ROOT"):
        return Path(env).resolve()
    here = Path(__file__).resolve().parent
    out = subprocess.run(
        ["git", "-C", str(here), "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(out.stdout.strip())


def setup_logging() -> logging.Logger:
    log_path = Path(os.environ.get(
        "MIRA_WIKI_INGEST_LOG",
        str(Path.home() / "Library/Logs/wiki-raw-ingest.log"),
    ))
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("wiki-raw-ingest")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(log_path)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


def current_branch(repo: Path) -> str:
    out = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def existing_hashes(raw_root: Path) -> set[str]:
    hashes = set()
    if not raw_root.exists():
        return hashes
    for f in raw_root.rglob("*.md"):
        if f.is_file():
            hashes.add(hash_file(f))
    return hashes


def sanitize(name: str) -> str:
    base = Path(name).name  # strip any path
    base = re.sub(r"\s+", "-", base.strip())
    base = re.sub(r"[^\w.\-]+", "_", base, flags=re.UNICODE)
    base = base.lstrip(".") or "untitled.md"
    if not base.endswith(".md"):
        base += ".md"
    return base


def unique_dest(folder: Path, name: str) -> Path:
    candidate = folder / name
    if not candidate.exists():
        return candidate
    stem, suffix = candidate.stem, candidate.suffix
    for n in range(1, 10000):
        c = folder / f"{stem}-{n}{suffix}"
        if not c.exists():
            return c
    raise RuntimeError(f"could not find unique name in {folder} for {name}")


def git_commit(repo: Path, paths: list[Path], message: str, log: logging.Logger) -> None:
    rel = [str(p.relative_to(repo)) for p in paths]
    subprocess.run(["git", "-C", str(repo), "add", "--", *rel], check=True)
    out = subprocess.run(
        ["git", "-C", str(repo), "diff", "--cached", "--quiet"],
    )
    if out.returncode == 0:
        log.info("git: nothing staged after add, skipping commit")
        return
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", message],
        check=True, capture_output=True,
    )
    log.info("git: committed %s", message)


def candidate_files(drop: Path) -> list[Path]:
    if not drop.exists():
        return []
    out = []
    for p in sorted(drop.iterdir()):
        if not p.is_file():
            continue
        if p.suffix.lower() != ".md":
            continue
        if p.name.startswith(SKIP_PREFIXES) or p.name.endswith(SKIP_SUFFIXES):
            continue
        out.append(p)
    return out


def main() -> int:
    log = setup_logging()
    LOCK_PATH.touch(exist_ok=True)
    lock_fd = LOCK_PATH.open("w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.info("another ingest run is in progress; exiting")
        return 0

    drop = Path(os.environ.get("MIRA_DROP_DIR", str(Path.home() / "MiraDrop")))
    files = candidate_files(drop)
    if not files:
        return 0

    try:
        repo = repo_root()
    except subprocess.CalledProcessError:
        log.error("could not resolve repo root from %s", Path(__file__).resolve())
        return 2

    branch = current_branch(repo)
    allowed = {b.strip() for b in os.environ.get("MIRA_WIKI_ALLOWED_BRANCHES", "main").split(",") if b.strip()}
    if branch not in allowed:
        log.warning("branch %s not in allowed=%s; %d files left in %s", branch, sorted(allowed), len(files), drop)
        return 0

    raw_root = repo / "wiki" / "raw"
    today = dt.datetime.now().strftime("%Y-%m-%d")
    target_dir = raw_root / today
    target_dir.mkdir(parents=True, exist_ok=True)

    seen = existing_hashes(raw_root)
    moved: list[Path] = []
    for src in files:
        try:
            digest = hash_file(src)
        except OSError as exc:
            log.error("hash failed for %s: %s", src, exc)
            continue
        if digest in seen:
            log.info("dedup-skipped %s sha=%s", src.name, digest[:12])
            src.unlink(missing_ok=True)
            continue
        dest = unique_dest(target_dir, sanitize(src.name))
        try:
            shutil.move(str(src), str(dest))
        except OSError as exc:
            log.error("move failed %s -> %s: %s", src, dest, exc)
            continue
        log.info("moved %s -> %s", src.name, dest.relative_to(repo))
        moved.append(dest)
        seen.add(digest)

    if not moved:
        return 0

    names = ", ".join(p.name for p in moved[:3])
    extra = f" (+{len(moved) - 3} more)" if len(moved) > 3 else ""
    message = f"chore(wiki): raw ingest {names}{extra}"
    try:
        git_commit(repo, moved, message, log)
    except subprocess.CalledProcessError as exc:
        log.error("git commit failed: %s", exc.stderr.decode() if exc.stderr else exc)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
