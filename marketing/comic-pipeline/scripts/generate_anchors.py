#!/usr/bin/env python3
"""
Generate canonical character anchor turnaround sheets for the comic pipeline.

Anchors are the foundation of cross-panel character consistency. Per OpenAI's
gpt-image-1.5 cookbook (2026): generate ONE character anchor (front + side +
back-3/4, neutral expression, full outfit, palette swatch). Then in every
subsequent panel call, pass the anchor as the FIRST image in the array with
`input_fidelity="high"`. That single trick is the difference between
"kinda the same person" and "recognizably the same person across 20+ panels."

This script reads the 5 named characters from `style_guide.characters` in
storyboard_v2.yaml and emits one anchor PNG per character to:
    reference/anchors/<name>.png

Cost (gpt-image-1, 1024x1024 quality=high, n=1):
    ~$0.17 per character × 5 characters ≈ $0.85 total.

Usage:
    doppler run --project factorylm --config prd -- \\
        .venv/bin/python scripts/generate_anchors.py [--regen]

  Without --regen, characters whose anchor PNG already exists are skipped.

After generation, REVIEW each anchor by eye. If a character looks wrong, just
delete that one anchor and re-run with --regen — the others won't be touched.
"""
from __future__ import annotations

import argparse
import base64
import logging
import os
import sys
from pathlib import Path

import yaml
from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_v2.yaml"
ANCHOR_DIR = PROJECT_ROOT / "reference" / "anchors"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("generate-anchors")


ANCHOR_PROMPT_TEMPLATE = """\
Character anchor / turnaround sheet for a serialized industrial comic book.
SINGLE flat layout image showing ONE character three times across the frame:
left third — front view (full body, neutral standing pose, neutral expression),
center third — three-quarter side view (same character, same outfit, same
proportions), right third — back-three-quarter view. Below the three views, a
small horizontal palette swatch row of the character's primary colors.

CHARACTER:
{description}

STYLE: gritty 1990s Vertigo-comic ink + flat color, dark steel blue + amber +
high-contrast black palette, dramatic chiaroscuro lighting on face, NOT
cartoon, NOT superhero. Plain mid-grey background, no scene, no props, no
speech bubbles, no panel borders. The image should look like a model sheet a
production artist would tape to the wall — clean, reference-quality.
"""


def _gen_anchor(client: OpenAI, *, character_name: str, description: str, out_path: Path) -> None:
    prompt = ANCHOR_PROMPT_TEMPLATE.format(description=description.strip())
    logger.info("[anchor] generating %s ...", character_name)
    response = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size="1024x1024",
        quality="high",
        n=1,
        output_format="png",
    )
    b64 = response.data[0].b64_json
    if not b64:
        raise RuntimeError(f"empty b64_json for {character_name}")
    out_path.write_bytes(base64.b64decode(b64))
    logger.info("[anchor] wrote %s (%d bytes)", out_path, out_path.stat().st_size)


def main() -> int:
    p = argparse.ArgumentParser(description="Generate character anchor PNGs")
    p.add_argument("--regen", action="store_true",
                   help="re-generate anchors that already exist on disk")
    p.add_argument("--only", nargs="*",
                   help="generate only these character names (default: all)")
    p.add_argument("--dry-run", action="store_true",
                   help="show what would be generated; no API calls")
    args = p.parse_args()

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())
    style_guide = storyboard.get("style_guide") or {}
    characters: dict[str, str] = style_guide.get("characters") or {}
    if not characters:
        raise SystemExit("storyboard has no style_guide.characters block")

    targets = [n for n in characters if not args.only or n in args.only]
    if not targets:
        raise SystemExit(f"no matching characters; available: {list(characters)}")

    ANCHOR_DIR.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print(f"[dry-run] would generate {len(targets)} anchors at {ANCHOR_DIR}:")
        for name in targets:
            out = ANCHOR_DIR / f"{name}.png"
            status = "exists" if out.exists() else "missing"
            print(f"  - {name}: {out.name} ({status})")
        cost = 0.17 * sum(
            1 for n in targets if args.regen or not (ANCHOR_DIR / f"{n}.png").exists()
        )
        print(f"  estimated cost: ${cost:.2f}")
        return 0

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY not set — run under `doppler run ...`")
    client = OpenAI(api_key=api_key)

    skipped = 0
    generated = 0
    for name in targets:
        out_path = ANCHOR_DIR / f"{name}.png"
        if out_path.exists() and not args.regen:
            logger.info("[anchor] %s exists, skipping (pass --regen to overwrite)", name)
            skipped += 1
            continue
        _gen_anchor(
            client,
            character_name=name,
            description=characters[name],
            out_path=out_path,
        )
        generated += 1

    print(f"\n✅ Generated {generated}, skipped {skipped}, total {len(targets)} anchors")
    print(f"   Inspect: open {ANCHOR_DIR}")
    print(
        "   To use anchors in shot generation, add their paths to each shot's\n"
        "   `generation.reference_anchors:` list in scripts/storyboard_v2.yaml.\n"
        "   The anchor for a named character should be the FIRST item — only\n"
        "   the first ref image gets the high-fidelity treatment from the\n"
        "   gpt-image-1 edit endpoint."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
