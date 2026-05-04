#!/usr/bin/env python3
"""
Standalone verifier — runs the Playwright check on an EXISTING v2 build
without re-rendering. Reads output/v2/build_manifest.json (written by
build_video_v2.py) for beat timings.

Usage:
  .venv/bin/python verify_video_v2.py
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import yaml
from rich.console import Console

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from pipeline.v2 import verify as v2_verify

STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_v2.yaml"
WORK_ROOT = PROJECT_ROOT / "output" / "v2"
MANIFEST_PATH = WORK_ROOT / "build_manifest.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
console = Console()


def main() -> int:
    if not MANIFEST_PATH.exists():
        console.print(
            f"[red]ERROR[/red] no build_manifest.json at {MANIFEST_PATH}.\n"
            f"Run build_video_v2.py first."
        )
        return 2

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())
    manifest = json.loads(MANIFEST_PATH.read_text())
    video_path = Path(manifest["video_path"])
    if not video_path.exists():
        console.print(f"[red]ERROR[/red] video missing: {video_path}")
        return 2

    expectations = v2_verify.build_expectations(manifest=manifest, storyboard=storyboard)
    console.print(f"[bold]verify[/bold] {len(expectations)} expectations against {video_path.name}")

    out_dir = WORK_ROOT / "verify"
    results = v2_verify.run_verification(
        video_path=video_path, expectations=expectations, out_dir=out_dir,
    )
    console.print(
        f"[green]done[/green] {len(results['screenshots'])} frames -> {out_dir / 'report.html'}"
    )
    console.print(f"[dim]Open with: open {out_dir / 'report.html'}[/dim]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
