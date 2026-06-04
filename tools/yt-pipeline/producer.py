"""Generates Seedance B-roll clips, selects topic-relevant slideshow visuals, synthesizes narration audio."""
from __future__ import annotations

import logging
import random
import sys
import time
from pathlib import Path

import httpx
import yaml

log = logging.getLogger("yt-pipeline.producer")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_SCREENSHOTS_DIR = _REPO_ROOT / "docs" / "promo-screenshots"
_VISUALS_MANIFEST = Path(__file__).parent / "visuals.yaml"
_visuals_cache: dict | None = None

# Reuse MIRA's existing TTS engine from the comic pipeline (single source of truth).
_COMIC_ROOT = _REPO_ROOT / "marketing" / "comic-pipeline"
if str(_COMIC_ROOT) not in sys.path:
    sys.path.insert(0, str(_COMIC_ROOT))

from openai import OpenAI  # noqa: E402  (import after sys.path setup)
from pipeline.v2.tts import synth_beat  # noqa: E402  (comic-pipeline TTS)

_API_BASE = "https://ark.ap-southeast.byteplus.com/api/v3"
_MODEL = "seedance-1-0-lite-t2v-250428"
_POLL_INTERVAL = 10
_MAX_POLLS = 36  # 6 minutes

# Narration voice — same engine/voice/style the comic pipeline uses.
_TTS_MODEL = "gpt-4o-mini-tts"
_TTS_VOICE = "onyx"
_TTS_SPEED = 1.05
_NARRATION_STYLE = (
    "Speak like a confident, experienced maintenance engineer talking to a peer. "
    "Conversational and direct — not pitching, just telling it straight. "
    "Natural rhythm. Let short sentences land with weight. "
    "Longer sentences flow without over-emphasizing every word."
)


def _load_visuals_config(manifest_path: Path = _VISUALS_MANIFEST) -> dict:
    """Load visuals.yaml once and cache the parsed dict."""
    global _visuals_cache
    if _visuals_cache is None:
        loaded = yaml.safe_load(manifest_path.read_text())
        _visuals_cache = loaded
        return loaded
    return _visuals_cache


def _industrial_pool(tags: list[str], base_dir: Path, pattern: str) -> list[Path]:
    """Glob the regime3 photo dir for every requested tag and return the combined pool."""
    pool: list[Path] = []
    for tag in tags:
        glob_pat = pattern.replace("{tag}", tag)
        pool.extend(sorted(base_dir.glob(glob_pat)))
    return pool


def _product_pool(base_dir: Path, globs: list[str]) -> list[Path]:
    """Collect product screenshots matching any of the configured glob patterns."""
    pool: list[Path] = []
    for g in globs:
        pool.extend(sorted(base_dir.glob(g)))
    # De-dup while preserving order.
    seen: set[Path] = set()
    uniq: list[Path] = []
    for p in pool:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def _interleave(industrial: list[Path], product: list[Path]) -> list[Path]:
    """Round-robin merge so the slideshow alternates hardware → UI → hardware."""
    out: list[Path] = []
    i = j = 0
    while i < len(industrial) or j < len(product):
        if i < len(industrial):
            out.append(industrial[i])
            i += 1
        if j < len(product):
            out.append(product[j])
            j += 1
    return out


def select_visuals(
    area: str,
    run_seed: int = 0,
    count: int = 12,
    *,
    manifest_path: Path = _VISUALS_MANIFEST,
    repo_root: Path = _REPO_ROOT,
) -> list[Path]:
    """Pick `count` topic-relevant slideshow paths for the given topics.yaml area.

    Uses visuals.yaml to map area → industrial-hardware tags + optional
    MIRA-product-screenshot fraction. Shuffle is deterministic per
    (area, run_seed) so each angle gets a stable but distinct slideshow.
    """
    cfg = _load_visuals_config(manifest_path)
    topic_cfg = cfg["topics"].get(area)
    if topic_cfg is None:
        # Unknown area — fall back to all industrial tags so we still ship
        # topical industrial imagery instead of MIRA UI.
        log.warning("Unknown area %r — falling back to all industrial tags", area)
        topic_cfg = {
            "industrial_tags": ["vfd", "motor", "contactor", "breaker", "starter", "plc", "panel", "sensor"],
            "product_fraction": 0.0,
        }

    pools = cfg["pools"]
    ind_pool = _industrial_pool(
        topic_cfg.get("industrial_tags", []),
        repo_root / pools["industrial_hardware"]["base_dir"],
        pools["industrial_hardware"]["filename_pattern"],
    )
    prod_pool = _product_pool(
        repo_root / pools["mira_product"]["base_dir"],
        pools["mira_product"]["filename_globs"],
    )

    if not ind_pool and not prod_pool:
        raise RuntimeError(
            f"select_visuals: both asset pools empty for area={area!r}. "
            f"Check {pools['industrial_hardware']['base_dir']} and "
            f"{pools['mira_product']['base_dir']}."
        )
    if not ind_pool:
        log.warning("Industrial pool empty for area=%r — using product pool only", area)
        topic_cfg = {**topic_cfg, "product_fraction": 1.0}

    rng = random.Random(hash((area, run_seed)) & 0xFFFFFFFF)

    product_fraction = float(topic_cfg.get("product_fraction", 0.0))
    n_product = int(round(count * product_fraction))
    n_industrial = count - n_product

    # Bound by what's actually available.
    n_industrial = min(n_industrial, len(ind_pool))
    n_product = min(n_product, len(prod_pool))
    # Top up from the other pool if one is exhausted, to keep the slideshow full.
    if n_industrial + n_product < count:
        deficit = count - n_industrial - n_product
        if len(ind_pool) - n_industrial >= deficit:
            n_industrial += deficit
        else:
            n_product += min(deficit, len(prod_pool) - n_product)

    if n_industrial > 0:
        ind_shuffled = ind_pool.copy()
        rng.shuffle(ind_shuffled)
        ind_pick = ind_shuffled[:n_industrial]
    else:
        ind_pick = []

    if n_product > 0:
        prod_shuffled = prod_pool.copy()
        rng.shuffle(prod_shuffled)
        prod_pick = prod_shuffled[:n_product]
    else:
        prod_pick = []

    if not prod_pick:
        return ind_pick[:count]
    if not ind_pick:
        return prod_pick[:count]
    return _interleave(ind_pick, prod_pick)[:count]


def select_screenshots(
    keywords: list[str],
    screenshots_dir: Path = _DEFAULT_SCREENSHOTS_DIR,
    count: int = 4,
) -> list[Path]:
    """Legacy keyword-match selector (deprecated — see select_visuals).

    Still callable for any external consumer, but the main pipeline routes
    through `select_visuals` now. This function was the source of the
    script-vs-visuals mismatch (Groq guessed keywords blind against a
    SaaS-UI-only screenshot pool → unrelated stills in fault-rescue videos).
    """
    all_shots = sorted(screenshots_dir.glob("*.png"), reverse=True)
    matches: list[Path] = []
    for kw in keywords:
        for shot in all_shots:
            if kw.lower() in shot.name.lower() and shot not in matches:
                matches.append(shot)
                break
    for shot in all_shots:
        if len(matches) >= count:
            break
        if shot not in matches:
            matches.append(shot)
    return matches[:count]


def generate_broll(prompt: str, run_dir: Path, clip_name: str, api_key: str) -> Path:
    """Submit Seedance job, poll until complete, download MP4. Returns output path."""
    resp = httpx.post(
        f"{_API_BASE}/contents/generations/tasks",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": _MODEL,
            "content": [{"type": "text", "text": prompt}],
            "parameters": {"resolution": "720p", "duration": 8, "aspect_ratio": "16:9"},
        },
        timeout=30,
    )
    resp.raise_for_status()
    task_id = resp.json()["id"]
    log.info("Seedance job submitted: %s", task_id)

    for _ in range(_MAX_POLLS):
        time.sleep(_POLL_INTERVAL)
        status_resp = httpx.get(
            f"{_API_BASE}/contents/generations/tasks/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        status_resp.raise_for_status()
        data = status_resp.json()
        if data["status"] == "succeeded":
            video_url = data["content"][0]["video_url"]
            out_path = run_dir / f"{clip_name}.mp4"
            out_path.write_bytes(httpx.get(video_url, timeout=120).content)
            log.info("B-roll saved: %s", out_path)
            return out_path
        if data["status"] == "failed":
            raise RuntimeError(f"Seedance job {task_id} failed: {data}")

    raise TimeoutError(
        f"Seedance job {task_id} timed out after {_MAX_POLLS * _POLL_INTERVAL}s"
    )


def synth_narration(narration_text: str, run_dir: Path, *, api_key: str) -> Path:
    """Render narration text to narration.mp3 using MIRA's comic-pipeline TTS engine."""
    run_dir.mkdir(parents=True, exist_ok=True)
    client = OpenAI(api_key=api_key)
    mp3 = synth_beat(
        client,
        text=narration_text,
        voice=_TTS_VOICE,
        model=_TTS_MODEL,
        speed=_TTS_SPEED,
        cache_dir=run_dir,
        instructions=_NARRATION_STYLE,
    )
    out = run_dir / "narration.mp3"
    if mp3 != out:
        out.write_bytes(mp3.read_bytes())
    log.info("Narration synthesized: %s", out)
    return out


def produce(
    plan: dict,
    run_dir: Path,
    *,
    byteplus_api_key: str,
    openai_api_key: str,
) -> dict:
    """
    Generate all assets for a run. Returns asset path dict.

    If byteplus_api_key is empty/falsy, skips B-roll generation and omits
    scene1_clip/scene3_clip from the returned dict.

    If openai_api_key is empty/falsy, skips narration synthesis and omits
    narration_audio from the returned dict. The narration_script is ALWAYS
    written to disk and included in the returned dict.
    """
    run_dir.mkdir(parents=True, exist_ok=True)

    assets: dict = {}

    # B-roll is optional; only generate if api_key is present
    if byteplus_api_key:
        clip1 = generate_broll(plan["scene1_prompt"], run_dir, "scene1", byteplus_api_key)
        clip3 = generate_broll(plan["scene3_prompt"], run_dir, "scene3", byteplus_api_key)
        assets["scene1_clip"] = str(clip1)
        assets["scene3_clip"] = str(clip3)

    # Select 12 topic-relevant visuals to fill the slideshow.
    # Drives off plan["area"] (the topics.yaml bucket) + plan["angle_index"]
    # so each angle gets a stable but distinct slideshow.
    screenshots = select_visuals(plan["area"], run_seed=plan["angle_index"], count=12)

    # ALWAYS write the narration script to disk, regardless of TTS availability
    script_path = run_dir / "narration_script.txt"
    script_path.write_text(plan["scene2_narration"])
    assets["narration_script"] = str(script_path)

    # Narration (TTS) is optional and best-effort. We attempt it when a key is
    # present, but ANY failure (no quota / 429, billing, network) degrades
    # gracefully to a silent draft — the narration script is always on disk for
    # manual voiceover. When the OpenAI account is funded again, voiced output
    # resumes automatically with no config change.
    if openai_api_key:
        try:
            narration_audio = synth_narration(
                plan["scene2_narration"], run_dir, api_key=openai_api_key
            )
            assets["narration_audio"] = str(narration_audio)
        except Exception as exc:  # noqa: BLE001 — any TTS failure → silent draft
            log.warning(
                "TTS unavailable (%s: %s) — producing a SILENT draft; "
                "narration script saved at %s for manual voiceover.",
                type(exc).__name__, str(exc)[:160], script_path,
            )

    assets["screenshots"] = [str(s) for s in screenshots]

    return assets
