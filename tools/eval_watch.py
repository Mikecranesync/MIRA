#!/usr/bin/env python3
"""MIRA on-save eval watcher — runs a small subset of eval scenarios on file save.

Opt-in: engineer starts this manually in a side terminal during prompt-tweak
sessions. Watches `mira-bots/shared/`, `mira-pipeline/`, and
`tests/eval/fixtures/` for `.py`/`.md`/`.yaml` saves. On a debounced save event
runs the fixtures listed in `tests/eval/watch_set.txt` via the existing offline
harness — same path as `python tests/eval/offline_run.py --suite text`.

Usage:
    python tools/eval_watch.py            # watch + react to saves
    python tools/eval_watch.py --once     # run watch_set once and exit
    python tools/eval_watch.py --help

Requires real LLM API keys in env (Doppler is fine):
    doppler run --project factorylm --config prd -- python tools/eval_watch.py

Spec: docs/superpowers/specs/2026-04-19-velocity-3-precommit-smoke-design.md
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from threading import Lock, Timer

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

WATCH_DIRS = [
    REPO_ROOT / "mira-bots" / "shared",
    REPO_ROOT / "mira-pipeline",
    REPO_ROOT / "tests" / "eval" / "fixtures",
]
WATCH_SUFFIXES = {".py", ".md", ".yaml"}
IGNORE_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "node_modules"}
WATCH_SET_FILE = REPO_ROOT / "tests" / "eval" / "watch_set.txt"
DEBOUNCE_SECONDS = 0.5


def load_watch_set() -> list[str]:
    if not WATCH_SET_FILE.exists():
        print(f"ERROR: watch set file missing: {WATCH_SET_FILE}", file=sys.stderr)
        sys.exit(2)
    lines = WATCH_SET_FILE.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]


async def run_subset(fixture_filenames: list[str]) -> int:
    """Run the named fixtures through the offline harness without the LLM judge.
    Returns 0 if every fixture passed every binary checkpoint, 1 otherwise."""
    os.environ.setdefault("EVAL_DISABLE_JUDGE", "1")

    from tests.eval.local_pipeline import LocalPipeline
    from tests.eval.offline_run import _load_text_fixtures, run_suite

    all_fixtures = _load_text_fixtures()
    by_id = {f.get("_filename", f["id"]): f for f in all_fixtures}
    by_basename = {Path(f.get("_filename", "")).name: f for f in all_fixtures}

    selected: list[dict] = []
    missing: list[str] = []
    for name in fixture_filenames:
        f = by_id.get(name) or by_basename.get(name) or by_basename.get(name + ".yaml")
        if f is None:
            missing.append(name)
        else:
            selected.append(f)

    if missing:
        print(f"ERROR: fixture(s) not found in tests/eval/fixtures/: {missing}", file=sys.stderr)
        return 2

    pipeline = LocalPipeline()
    grades, _judge_results, total_seconds = await run_suite(
        pipeline=pipeline, fixtures=selected, judge=None, use_synthetic_user=False
    )

    passed = sum(1 for g in grades if all(g.checkpoints.values()))
    print(f"\n{passed}/{len(grades)} passed in {total_seconds:.1f}s")
    return 0 if passed == len(grades) else 1


def is_watched(path: Path) -> bool:
    if path.suffix not in WATCH_SUFFIXES:
        return False
    if any(part in IGNORE_PARTS for part in path.parts):
        return False
    return True


def run_watch_loop() -> None:
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError:
        print(
            "ERROR: watchdog not installed. Run: pip install watchdog\n"
            "(Or: bash tools/setup_precommit.sh — installs both pre-commit and watchdog.)",
            file=sys.stderr,
        )
        sys.exit(1)

    fixture_filenames = load_watch_set()
    print(
        f"MIRA eval watcher (debounce {DEBOUNCE_SECONDS:.1f}s, {len(fixture_filenames)} fixtures)\n"
        f"  watching: {', '.join(str(d.relative_to(REPO_ROOT)) for d in WATCH_DIRS)}\n"
        f"  fixtures: {WATCH_SET_FILE.relative_to(REPO_ROOT)}\n"
        f"  Ctrl-C to stop.\n"
    )

    debounce_lock = Lock()
    pending_timer: list[Timer] = []

    def trigger_run():
        try:
            rc = asyncio.run(run_subset(fixture_filenames))
            print(f"  exit={rc}\n")
        except Exception as exc:
            print(f"  ERROR: {exc}\n", file=sys.stderr)

    class Handler(FileSystemEventHandler):
        def on_modified(self, event):
            if event.is_directory:
                return
            path = Path(event.src_path)
            if not is_watched(path):
                return
            with debounce_lock:
                for t in pending_timer:
                    t.cancel()
                pending_timer.clear()
                t = Timer(DEBOUNCE_SECONDS, trigger_run)
                t.daemon = True
                t.start()
                pending_timer.append(t)
                rel = path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path
                print(f"changed: {rel} → run in {DEBOUNCE_SECONDS:.1f}s")

        on_created = on_modified

    observer = Observer()
    handler = Handler()
    for d in WATCH_DIRS:
        if d.exists():
            observer.schedule(handler, str(d), recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping…")
        observer.stop()
    observer.join()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="MIRA on-save eval watcher (opt-in; LLM API keys required in env)"
    )
    parser.add_argument(
        "--once", action="store_true", help="Run watch_set.txt once and exit (for ad-hoc use)."
    )
    args = parser.parse_args()
    if args.once:
        return asyncio.run(run_subset(load_watch_set()))
    run_watch_loop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
