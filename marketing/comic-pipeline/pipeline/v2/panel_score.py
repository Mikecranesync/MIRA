"""
Panel-quality scoring for comic-pipeline v2.

After `panels.generate_shot_sources()` produces n=2 candidates per shot, this
module asks Claude (vision) to score each candidate against three criteria:
    - character_match     : do named characters match anchor reference (1-10)
    - style_match         : does style match the master_prompt (1-10)
    - prompt_adherence    : does the panel actually depict what the prompt asks (1-10)

The highest `overall` (= mean of the three) wins and is promoted to the
canonical `shot_{id}.png` path. All candidate scores are persisted to
`build_manifest.json` so a human can review without re-paying for scoring.

Cost: claude-3-5-haiku-vision is ~$0.001 per candidate-image scored. For a
full 5-shot × n=2 batch: ~$0.01. Negligible vs the ~$1.67 image-gen cost.

We deliberately use Anthropic (not OpenAI gpt-4o-vision) for scoring to keep
OpenAI usage in this pipeline narrowly scoped to image generation + TTS, per
ADR-0013. Anthropic is the project's primary LLM provider regardless.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import anthropic

logger = logging.getLogger("comic.v2.panel_score")

DEFAULT_MODEL = "claude-haiku-4-5-20251001"  # cheap, fast, vision-capable

SCORE_RUBRIC = """\
You are scoring a generated comic panel image against:
  1. The supplied REFERENCE/ANCHOR image (which encodes the canonical
     character likeness and visual style).
  2. The supplied PROMPT (which describes what the panel should depict).

Score each dimension 1-10 (10 = perfect, 5 = mediocre, 1 = unusable):

  - character_match: Do named characters look like the anchor? (faces,
    proportions, outfit, hair, glasses). Score 1 if anyone is unrecognizable
    relative to the anchor; 10 if the same person is depicted in every panel
    they appear in.
  - style_match: Does line work, color palette, panel-border style match the
    anchor's gritty-Vertigo-comic look?
  - prompt_adherence: Does the image actually contain the elements the prompt
    asked for (specific signs, screens, layouts, speech bubbles)?

Return ONLY this JSON object, no preamble, no code fences:
{"character_match": <int>, "style_match": <int>, "prompt_adherence": <int>, "notes": "<one sentence>"}\
"""


@dataclass
class CandidateScore:
    candidate_path: str
    character_match: int
    style_match: int
    prompt_adherence: int
    overall: float
    notes: str


def _b64_image(path: Path) -> dict[str, Any]:
    """Encode an image file as a Claude vision content block."""
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


def _parse_json_strict(raw: str) -> dict[str, Any]:
    """Pull a single JSON object out of the response text, tolerating fences."""
    # Tolerate ```json … ``` fences and surrounding chatter.
    m = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON object found in: {raw[:300]}")
    return json.loads(m.group(0))


def score_candidate(
    client: anthropic.Anthropic,
    *,
    anchor_path: Path,
    candidate_path: Path,
    prompt: str,
    model: str = DEFAULT_MODEL,
) -> CandidateScore:
    """Score one candidate image vs an anchor + prompt, return CandidateScore."""
    content: list[dict[str, Any]] = [
        {"type": "text", "text": "ANCHOR (reference style + characters):"},
        _b64_image(anchor_path),
        {"type": "text", "text": "CANDIDATE (the panel to score):"},
        _b64_image(candidate_path),
        {"type": "text", "text": f"PROMPT FOR THE PANEL:\n{prompt}"},
        {"type": "text", "text": SCORE_RUBRIC},
    ]
    message = client.messages.create(
        model=model,
        max_tokens=300,
        messages=[{"role": "user", "content": content}],
    )
    raw = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
    parsed = _parse_json_strict(raw)
    cm = int(parsed.get("character_match", 0))
    sm = int(parsed.get("style_match", 0))
    pa = int(parsed.get("prompt_adherence", 0))
    return CandidateScore(
        candidate_path=str(candidate_path),
        character_match=cm,
        style_match=sm,
        prompt_adherence=pa,
        overall=round((cm + sm + pa) / 3.0, 2),
        notes=str(parsed.get("notes", ""))[:240],
    )


def score_and_pick_best(
    *,
    anchor_path: Path,
    candidate_paths: list[Path],
    prompt: str,
    model: str = DEFAULT_MODEL,
) -> tuple[Path, list[CandidateScore]]:
    """Score every candidate, return (winner_path, all_scores).

    Picks the candidate with the highest `overall`. Caller decides whether
    `overall` is high enough to accept or whether to trigger a regen.
    """
    if not candidate_paths:
        raise ValueError("score_and_pick_best needs at least one candidate")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set — run under "
            "`doppler run --project factorylm --config prd -- ...`"
        )
    client = anthropic.Anthropic(api_key=api_key)

    scores: list[CandidateScore] = []
    for cp in candidate_paths:
        try:
            s = score_candidate(
                client, anchor_path=anchor_path, candidate_path=cp,
                prompt=prompt, model=model,
            )
        except Exception as e:
            logger.warning("scoring failed for %s: %s — assigning 0", cp.name, e)
            s = CandidateScore(
                candidate_path=str(cp),
                character_match=0, style_match=0, prompt_adherence=0,
                overall=0.0, notes=f"score error: {e}",
            )
        logger.info(
            "[score] %s overall=%.2f (char=%d style=%d prompt=%d) %s",
            cp.name, s.overall, s.character_match, s.style_match,
            s.prompt_adherence, s.notes[:80],
        )
        scores.append(s)

    winner_idx = max(range(len(scores)), key=lambda i: scores[i].overall)
    return candidate_paths[winner_idx], scores


def scores_as_jsonable(scores: list[CandidateScore]) -> list[dict[str, Any]]:
    """For embedding in build_manifest.json."""
    return [asdict(s) for s in scores]
