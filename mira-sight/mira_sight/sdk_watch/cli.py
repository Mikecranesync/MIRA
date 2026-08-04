"""CLI for the MIRA Sight SDK watcher.

Usage:
    python -m tools.mira_sight.sdk_watch.cli --dry-run           # default
    python -m tools.mira_sight.sdk_watch.cli --apply             # writes baselines + packets
    python -m tools.mira_sight.sdk_watch.cli --fixture-dir DIR   # offline (tests/CI PR lane)

Live network fetches happen ONLY against the registry allowlist, with size and
timeout caps. Exit code 0 = ran (changes or not); 2 = one or more source errors.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .watcher import FETCH_TIMEOUT_S, run_watch

REPO_ROOT = Path(__file__).resolve().parents[3]


def _live_fetcher(url: str) -> tuple[int, bytes]:
    import httpx

    resp = httpx.get(
        url,
        timeout=FETCH_TIMEOUT_S,
        follow_redirects=True,
        headers={"User-Agent": "mira-sight-sdk-watch (+https://github.com/Mikecranesync/MIRA)"},
    )
    return resp.status_code, resp.content


def _fixture_fetcher(fixture_dir: Path):
    import hashlib

    def fetch(url: str) -> tuple[int, bytes]:
        name = hashlib.sha256(url.encode()).hexdigest()[:16] + ".bin"
        path = fixture_dir / name
        if not path.exists():
            return 404, b""
        return 200, path.read_bytes()

    return fetch


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="MIRA Sight SDK watcher")
    ap.add_argument(
        "--registry", type=Path, default=REPO_ROOT / "config/mira-sight-sdk-sources.yaml"
    )
    ap.add_argument(
        "--baselines", type=Path, default=REPO_ROOT / "config/mira-sight-sdk-baselines.lock.json"
    )
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "artifacts/mira-sight/sdk-watch")
    ap.add_argument(
        "--apply", action="store_true", help="write baselines + packets (default is dry-run)"
    )
    ap.add_argument(
        "--fixture-dir", type=Path, default=None, help="offline mode: recorded fixtures, no network"
    )
    args = ap.parse_args(argv)

    fetch = _fixture_fetcher(args.fixture_dir) if args.fixture_dir else _live_fetcher
    report = run_watch(
        args.registry, args.baselines, fetch, dry_run=not args.apply, out_dir=args.out_dir
    )
    summary = {
        "dry_run": report.dry_run,
        "changed": [r.source_id for r in report.results if r.status == "changed"],
        "new_baseline": [r.source_id for r in report.results if r.status == "new_baseline"],
        "unchanged": [r.source_id for r in report.results if r.status == "unchanged"],
        "errors": {r.source_id: r.error for r in report.results if r.status == "error"},
    }
    print(json.dumps(summary, indent=2))
    for p in report.packets:
        print(f"::notice::sdk change detected: {p['dedupe_key']}")
    return 2 if summary["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
