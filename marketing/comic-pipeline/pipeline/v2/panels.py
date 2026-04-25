"""
Programmatic shot-source generation for comic-pipeline v2.

Reads `storyboard_v2.yaml`'s `style_guide` + per-shot `generation.prompt` and
calls OpenAI gpt-image-1 with the existing reference image(s) as anchors. The
result is dropped into `output/v2/sources/shot_{id}.png` and downstream
canvas/render stages keep working unchanged.

If a shot has no `generation` block, falls back to the legacy
`reference/<file>` path. This keeps the pipeline working for shots that
haven't been migrated yet.

Pattern follows OpenAI cookbook for character consistency:
    1. Master style preamble restated verbatim every call.
    2. Named-character invariants restated whenever a character appears.
    3. images.edit() with reference anchor as the FIRST image in the array
       (only the first input retains "extra richness in texture" per the
       cookbook prompting guide).
    4. input_fidelity="high" — single most important parameter for keeping
       characters recognizable across panels.
    5. n=2 — generate twice, downstream scorer (panel_score.py — TODO) picks
       the best; for now we just write the first candidate to disk.

Cost (gpt-image-1, 1536x1024, quality=high, n=2):
    ~$0.30–0.40 per shot. Full 5-shot regen: ~$1.50–2.00.
"""
from __future__ import annotations

import base64
import logging
import os
import random
import re
import time
from pathlib import Path
from typing import Any

from openai import APIError, OpenAI, RateLimitError

logger = logging.getLogger("comic.v2.panels")


def _sleep_backoff(attempt: int, base: float = 2.0) -> None:
    delay = base * (2**attempt)
    jitter = delay * random.uniform(-0.2, 0.2)
    time.sleep(max(0.5, delay + jitter))


def _detect_characters(prompt: str, characters: dict[str, str]) -> list[str]:
    """Find which named characters are mentioned in the shot prompt."""
    found: list[str] = []
    for name in characters:
        # word-boundary, case-insensitive match
        if re.search(rf"\b{re.escape(name)}\b", prompt, re.IGNORECASE):
            found.append(name)
    return found


def _compose_prompt(
    *,
    shot_prompt: str,
    style_guide: dict[str, Any],
) -> str:
    """Build the full prompt: style preamble + character invariants + shot."""
    parts: list[str] = [style_guide["master_prompt"].strip()]

    characters = style_guide.get("characters", {})
    used = _detect_characters(shot_prompt, characters)
    if used:
        parts.append("Character invariants — keep these EXACTLY consistent:")
        for name in used:
            parts.append(f"- {name.upper()}: {characters[name].strip()}")

    parts.append("Scene:")
    parts.append(shot_prompt.strip())
    return "\n\n".join(parts)


def _resolve_anchors(
    *,
    shot: dict[str, Any],
    reference_dir: Path,
) -> list[Path]:
    """Resolve generation.reference_anchors to absolute paths that exist."""
    gen = shot.get("generation") or {}
    raw = gen.get("reference_anchors") or []
    out: list[Path] = []
    for rel in raw:
        p = (reference_dir / rel).expanduser().resolve()
        if p.exists():
            out.append(p)
        else:
            logger.warning("Reference anchor missing, skipping: %s", p)
    return out


def _generate_one(
    client: OpenAI,
    *,
    prompt: str,
    anchors: list[Path],
    model: str,
    size: str,
    quality: str,
    n: int,
    input_fidelity: str,
    max_retries: int,
) -> list[bytes]:
    """Return raw PNG bytes for n candidate panels for one shot."""
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            kwargs: dict[str, Any] = dict(
                model=model,
                prompt=prompt,
                size=size,
                quality=quality,
                n=n,
                output_format="png",
            )
            # input_fidelity is only valid on edit endpoint and only when at
            # least one reference image is supplied.
            if anchors:
                kwargs["input_fidelity"] = input_fidelity
                handles = [open(p, "rb") for p in anchors]
                try:
                    response = client.images.edit(image=handles, **kwargs)
                finally:
                    for h in handles:
                        h.close()
            else:
                response = client.images.generate(**kwargs)

            out: list[bytes] = []
            for item in response.data:
                if not item.b64_json:
                    raise RuntimeError("gpt-image returned empty b64_json")
                out.append(base64.b64decode(item.b64_json))
            return out
        except RateLimitError as e:
            last_err = e
            logger.warning("Rate-limited (attempt %d/%d): %s", attempt + 1, max_retries, e)
            _sleep_backoff(attempt)
        except APIError as e:
            last_err = e
            logger.warning("APIError (attempt %d/%d): %s", attempt + 1, max_retries, e)
            _sleep_backoff(attempt)
    raise RuntimeError(f"shot generation failed after {max_retries} retries: {last_err}")


def generate_shot_sources(
    *,
    storyboard: dict[str, Any],
    reference_dir: Path,
    out_dir: Path,
    force_regen: bool = False,
    progress_cb=None,
) -> dict[int, Path]:
    """For each shot, return the path to its source image.

    - Shot has `generation.prompt`: regenerate (or use cache) via gpt-image-1.
    - Shot has no `generation`: fall back to `reference_dir / shot["file"]`.

    Returns {shot_id: Path}. Caller passes this dict downstream to
    canvas_pre_render() in place of the old hardcoded {id: REF_DIR/file}.
    """
    style_guide = storyboard.get("style_guide") or {}
    defaults = style_guide.get("generation_defaults") or {}
    model = defaults.get("model", "gpt-image-1")
    quality = defaults.get("quality", "high")
    size = defaults.get("size", "1536x1024")
    n = int(defaults.get("n", 2))
    input_fidelity = defaults.get("input_fidelity", "high")
    max_retries = int(defaults.get("max_retries", 5))

    out_dir.mkdir(parents=True, exist_ok=True)

    # OpenAI client is lazy — only construct if we'll actually call the API.
    client: OpenAI | None = None

    sources: dict[int, Path] = {}
    for shot in storyboard["shots"]:
        shot_id = int(shot["id"])
        gen = shot.get("generation")
        cache_path = out_dir / f"shot_{shot_id}.png"

        # Resolution rules (opt-in to API spend):
        #   1. Cache hit → use it (regardless of force_regen … unless force_regen).
        #   2. force_regen=True → call API, overwrite cache.
        #   3. No cache, no force_regen → fall back to legacy `file:`.
        # This means ordinary `--skip-render`/`--skip-tts` builds NEVER hit the
        # OpenAI image API. Generation only fires when --regen-panels is set.

        if cache_path.exists() and cache_path.stat().st_size > 0 and not force_regen:
            sources[shot_id] = cache_path
            logger.info("[panels] cache hit shot %d -> %s", shot_id, cache_path.name)
            if progress_cb:
                progress_cb(shot_id, cache_path, mode="cache", skipped=True)
            continue

        if not force_regen or not (gen and gen.get("prompt")):
            # Either no generation prompt available, or user did not pass
            # --regen-panels. Use whatever was on disk before.
            legacy = (reference_dir / shot["file"]).expanduser().resolve()
            if not legacy.exists():
                raise RuntimeError(
                    f"shot {shot_id}: no cached gen, no --regen-panels, and "
                    f"legacy file is missing at {legacy}"
                )
            sources[shot_id] = legacy
            if progress_cb:
                progress_cb(shot_id, legacy, mode="legacy", skipped=True)
            continue

        if client is None:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError(
                    "OPENAI_API_KEY not set — run under "
                    "`doppler run --project factorylm --config prd -- ...`"
                )
            client = OpenAI(api_key=api_key)

        full_prompt = _compose_prompt(
            shot_prompt=gen["prompt"], style_guide=style_guide,
        )
        anchors = _resolve_anchors(shot=shot, reference_dir=reference_dir)

        logger.info(
            "[panels] generating shot %d (anchors=%d, n=%d, q=%s)",
            shot_id, len(anchors), n, quality,
        )
        candidates = _generate_one(
            client,
            prompt=full_prompt,
            anchors=anchors,
            model=model,
            size=size,
            quality=quality,
            n=n,
            input_fidelity=input_fidelity,
            max_retries=max_retries,
        )

        # Write all candidates to disk so a human can review them.
        candidates_dir = out_dir / "candidates" / f"shot_{shot_id}"
        candidates_dir.mkdir(parents=True, exist_ok=True)
        candidate_paths: list[Path] = []
        for i, png in enumerate(candidates):
            cp = candidates_dir / f"candidate_{i}.png"
            cp.write_bytes(png)
            candidate_paths.append(cp)

        # Score with Claude vision and promote the highest-scoring candidate
        # to the canonical shot_{id}.png. Scoring failures are non-fatal —
        # we just default to candidate 0.
        winner_path = candidate_paths[0]
        scores_jsonable: list[dict[str, Any]] = []
        if len(candidate_paths) > 1 and anchors:
            try:
                # Lazy import: only pulls anthropic if we actually need it.
                from . import panel_score as v2_score
                winner_path, scores = v2_score.score_and_pick_best(
                    anchor_path=anchors[0],
                    candidate_paths=candidate_paths,
                    prompt=full_prompt,
                )
                scores_jsonable = v2_score.scores_as_jsonable(scores)
                logger.info(
                    "[panels] shot %d winner: %s (overall=%.2f)",
                    shot_id, winner_path.name,
                    next(s["overall"] for s in scores_jsonable
                         if s["candidate_path"] == str(winner_path)),
                )
            except Exception as e:
                logger.warning("scoring failed for shot %d, using candidate 0: %s", shot_id, e)

        cache_path.write_bytes(winner_path.read_bytes())
        # Persist scores alongside the canonical PNG for review.
        if scores_jsonable:
            (out_dir / f"shot_{shot_id}_scores.json").write_text(
                __import__("json").dumps(scores_jsonable, indent=2)
            )
        sources[shot_id] = cache_path
        if progress_cb:
            progress_cb(shot_id, cache_path, mode="generated", skipped=False)

    return sources
