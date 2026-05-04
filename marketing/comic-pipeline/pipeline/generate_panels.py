#!/usr/bin/env python3
"""
Generate comic panel images via OpenAI gpt-image-1.

Two modes:
  - text-only  : images.generate(prompt=...)
  - ref-image  : images.edit(image=[ref1, ref2], prompt=...) when the scene
                 has reference_images set (keeps characters consistent).

Output: PNG per panel at output/panels/scene_{id}/panel_{n}.png
"""
from __future__ import annotations

import base64
import logging
import os
import random
import time
from pathlib import Path
from typing import Any

import yaml
from openai import OpenAI, APIError, RateLimitError

logger = logging.getLogger("comic.panels")


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _sleep_backoff(attempt: int, base: float) -> None:
    """Exponential backoff with a ±20% jitter to avoid thundering-herd retries."""
    delay = base * (2**attempt)
    jitter = delay * random.uniform(-0.2, 0.2)
    time.sleep(max(0.5, delay + jitter))


def _resolve_refs(scene: dict[str, Any], reference_root: Path) -> list[Path]:
    refs: list[Path] = []
    for rel in scene.get("reference_images", []) or []:
        p = (reference_root / rel).expanduser().resolve()
        if p.exists():
            refs.append(p)
        else:
            logger.warning("Reference image not found, skipping: %s", p)
    return refs


def _generate_one(
    client: OpenAI,
    *,
    prompt: str,
    size: str,
    quality: str,
    refs: list[Path],
    max_retries: int,
    retry_base: float,
) -> bytes:
    """Return raw PNG bytes for one panel. Routes to edit() if refs present."""
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            if refs:
                handles = [open(r, "rb") for r in refs]
                try:
                    response = client.images.edit(
                        model="gpt-image-1",
                        image=handles,
                        prompt=prompt,
                        size=size,
                        quality=quality,
                        n=1,
                    )
                finally:
                    for h in handles:
                        h.close()
            else:
                response = client.images.generate(
                    model="gpt-image-1",
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    n=1,
                )
            b64 = response.data[0].b64_json
            if not b64:
                raise RuntimeError("gpt-image-1 returned empty b64_json")
            return base64.b64decode(b64)
        except RateLimitError as e:
            last_err = e
            logger.warning("Rate-limited (attempt %d/%d): %s", attempt + 1, max_retries, e)
            _sleep_backoff(attempt, retry_base)
        except APIError as e:
            last_err = e
            logger.warning("OpenAI APIError (attempt %d/%d): %s", attempt + 1, max_retries, e)
            _sleep_backoff(attempt, retry_base)
    raise RuntimeError(f"panel generation failed after {max_retries} retries: {last_err}")


def generate_scene_panels(
    *,
    scene_id: str,
    scene: dict[str, Any],
    cfg: dict[str, Any],
    client: OpenAI,
    out_dir: Path,
    progress_cb=None,
) -> list[Path]:
    """Generate every panel for a single scene. Idempotent: skips existing PNGs."""
    master_style = cfg["master_style_context"].strip()
    size = cfg["image_size"]
    quality = cfg["image_quality"]
    reference_root = Path(cfg["reference_root"]).expanduser()
    max_retries = int(cfg.get("max_retries", 5))
    retry_base = float(cfg.get("retry_base_delay_seconds", 2.0))

    refs = _resolve_refs(scene, reference_root)
    scene_dir = out_dir / f"scene_{scene_id}"
    scene_dir.mkdir(parents=True, exist_ok=True)
    panel_paths: list[Path] = []

    for panel in scene["panels"]:
        panel_id = panel["id"]
        out_path = scene_dir / f"panel_{panel_id}.png"
        if out_path.exists() and out_path.stat().st_size > 0:
            logger.info("[scene %s] panel %s: already exists, skipping", scene_id, panel_id)
            panel_paths.append(out_path)
            if progress_cb:
                progress_cb(scene_id, panel_id, out_path, skipped=True)
            continue

        full_prompt = f"{master_style}\n\n{panel['prompt'].strip()}"
        logger.info("[scene %s] panel %s: generating...", scene_id, panel_id)
        png_bytes = _generate_one(
            client,
            prompt=full_prompt,
            size=size,
            quality=quality,
            refs=refs,
            max_retries=max_retries,
            retry_base=retry_base,
        )
        out_path.write_bytes(png_bytes)
        panel_paths.append(out_path)
        if progress_cb:
            progress_cb(scene_id, panel_id, out_path, skipped=False)

    return panel_paths


def generate_all(
    *,
    script_path: Path,
    config_path: Path,
    scene_filter: list[str] | None = None,
    progress_cb=None,
) -> dict[str, list[Path]]:
    """Top-level entry: iterate scenes from scene_scripts.yaml."""
    cfg = _load_yaml(config_path)
    script = _load_yaml(script_path)
    scenes = script["scenes"]

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY not set in environment. Run with: "
            "doppler run --project factorylm --config prd -- python run_pipeline.py ..."
        )
    client = OpenAI(api_key=api_key)

    out_root = Path(cfg["work_root"]) / "panels"
    results: dict[str, list[Path]] = {}
    for scene_id, scene in scenes.items():
        if scene_filter and scene_id not in scene_filter:
            continue
        results[scene_id] = generate_scene_panels(
            scene_id=scene_id, scene=scene, cfg=cfg,
            client=client, out_dir=out_root, progress_cb=progress_cb,
        )
    return results
