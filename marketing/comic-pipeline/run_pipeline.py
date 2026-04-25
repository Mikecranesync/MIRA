#!/usr/bin/env python3
"""
MIRA comic pipeline — master orchestrator.

Usage:
  doppler run --project factorylm --config prd -- \\
      python run_pipeline.py --scene all --quality high

Flags:
  --scene [all|1|2|3|4|5]
  --skip-images  --skip-audio  --skip-video
  --quality [low|medium|high]   (overrides config.yaml)
  --dry-run                     (prints cost table, no API calls)
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any

import yaml
from rich.console import Console
from rich.table import Table

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from pipeline import assemble_final, generate_panels, generate_voiceover, stitch_video

CONFIG_PATH = PROJECT_ROOT / "config.yaml"
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "scene_scripts.yaml"

console = Console()


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _resolve_scene_ids(flag: str, script: dict[str, Any]) -> list[str]:
    all_ids = list(script["scenes"].keys())
    if flag == "all":
        return all_ids
    if flag in all_ids:
        return [flag]
    raise SystemExit(f"--scene must be 'all' or one of {all_ids}, got {flag!r}")


def _dry_run_report(scene_ids: list[str], script: dict[str, Any], cfg: dict[str, Any]) -> None:
    quality = cfg["image_quality"]
    per_panel_cost = float(cfg["cost_per_panel_usd"][quality])
    tts_cost = float(cfg["cost_per_scene_tts_usd"])

    table = Table(title=f"Dry run — quality={quality}", show_lines=True)
    table.add_column("Scene", justify="left")
    table.add_column("Title", justify="left")
    table.add_column("Panels", justify="right")
    table.add_column("Image $", justify="right")
    table.add_column("TTS $", justify="right")
    table.add_column("Scene $", justify="right")

    total_panels = 0
    total = 0.0
    for sid in scene_ids:
        scene = script["scenes"][sid]
        n = len(scene["panels"])
        img_cost = n * per_panel_cost
        scene_cost = img_cost + tts_cost
        total += scene_cost
        total_panels += n
        table.add_row(
            sid, scene["title"], str(n),
            f"${img_cost:.3f}", f"${tts_cost:.3f}", f"${scene_cost:.3f}",
        )
    table.add_row(
        "total", f"{len(scene_ids)} scenes", str(total_panels),
        f"${total_panels * per_panel_cost:.3f}",
        f"${len(scene_ids) * tts_cost:.3f}",
        f"[bold]${total:.3f}[/bold]",
    )
    console.print(table)
    console.print(
        "[dim]Dry run only — no API calls made. "
        "Calibrate `cost_per_panel_usd` in config.yaml if prices drift.[/dim]"
    )


def _progress_panel(scene_id, panel_id, path, *, skipped=False):
    tag = "[yellow]skip[/yellow]" if skipped else "[green]ok[/green]"
    console.print(f"  [scene {scene_id}] panel {panel_id} {tag} → {path.name}")


def _progress_audio(scene_id, path, duration, *, skipped=False):
    tag = "[yellow]skip[/yellow]" if skipped else "[green]ok[/green]"
    console.print(f"  [scene {scene_id}] audio {tag} {duration:.1f}s → {path.name}")


def _progress_stitch(scene_id, path, *, skipped=False):
    tag = "[yellow]skip[/yellow]" if skipped else "[green]ok[/green]"
    console.print(f"  [scene {scene_id}] clip {tag} → {path.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA comic video pipeline")
    parser.add_argument("--scene", default="all", help="scene id or 'all' (default)")
    parser.add_argument("--skip-images", action="store_true")
    parser.add_argument("--skip-audio", action="store_true")
    parser.add_argument("--skip-video", action="store_true")
    parser.add_argument("--quality", choices=["low", "medium", "high"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    cfg = _load_yaml(CONFIG_PATH)
    if args.quality:
        cfg["image_quality"] = args.quality
        # Runtime-only override; we do NOT rewrite config.yaml.
    script = _load_yaml(SCRIPT_PATH)
    scene_ids = _resolve_scene_ids(args.scene, script)

    if args.dry_run:
        _dry_run_report(scene_ids, script, cfg)
        return 0

    # Persist the resolved config (with --quality override) so sub-modules see it.
    resolved_cfg_path = PROJECT_ROOT / "output" / ".resolved-config.yaml"
    resolved_cfg_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_cfg_path.write_text(yaml.safe_dump(cfg))

    t0 = time.time()

    if not args.skip_images:
        console.rule("[bold]1/4 Generate panels[/bold]")
        generate_panels.generate_all(
            script_path=SCRIPT_PATH,
            config_path=resolved_cfg_path,
            scene_filter=scene_ids,
            progress_cb=_progress_panel,
        )

    if not args.skip_audio:
        console.rule("[bold]2/4 Generate voiceover[/bold]")
        generate_voiceover.generate_all(
            script_path=SCRIPT_PATH,
            config_path=resolved_cfg_path,
            scene_filter=scene_ids,
            progress_cb=_progress_audio,
        )

    if not args.skip_video:
        console.rule("[bold]3/4 Stitch per-scene clips[/bold]")
        stitch_video.stitch_all(
            script_path=SCRIPT_PATH,
            config_path=resolved_cfg_path,
            scene_filter=scene_ids,
            progress_cb=_progress_stitch,
        )

        console.rule("[bold]4/4 Assemble final video[/bold]")
        # Final assembly only runs on a full build (all scenes present).
        full_build = set(scene_ids) == set(script["scenes"].keys())
        if full_build:
            final = assemble_final.assemble_final(
                config_path=resolved_cfg_path,
                ordered_scene_ids=list(script["scenes"].keys()),
            )
            console.print(f"[bold green]FINAL:[/bold green] {final}")
        else:
            console.print("[dim]Skipping final assembly (partial scene set).[/dim]")

    console.print(f"[dim]Total runtime: {time.time() - t0:.1f}s[/dim]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
