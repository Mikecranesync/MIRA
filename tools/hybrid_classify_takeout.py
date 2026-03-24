#!/usr/bin/env python3
"""Hybrid 3-stage photo classification pipeline for Google Takeout.

Stage 1: Metadata pre-filter (prefilter_takeout.py logic) — free, instant
Stage 2: CLIP/SigLIP zero-shot classification — free, fast
Stage 3: Claude Vision on ambiguous bucket — paid, accurate + nameplate extraction

Usage:
    # Dry run — all 3 stages, no file copies or API calls
    python3 hybrid_classify_takeout.py --dry-run

    # Full run — classify and extract nameplates
    doppler run --project factorylm --config prd -- python3 hybrid_classify_takeout.py

    # Stages 1+2 only (no Claude API spend)
    python3 hybrid_classify_takeout.py --stages 1,2

    # Stage 3 only (resume from previous CLIP results)
    doppler run --project factorylm --config prd -- python3 hybrid_classify_takeout.py --stages 3 --clip-csv ~/takeout_staging/clip_results.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import shutil
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("hybrid-classify")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_EXTRACTED = Path.home() / "takeout_staging" / "extracted"
DEFAULT_OUTPUT = Path.home() / "takeout_staging" / "hybrid_output"
DEFAULT_CSV = Path.home() / "takeout_staging" / "hybrid_results.csv"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

# CLIP thresholds for 3-bucket split
CLIP_HIGH_THRESHOLD = 0.65  # above = definitely industrial
CLIP_LOW_THRESHOLD = 0.45   # below = definitely personal
# Between low and high = ambiguous → send to Claude Vision


# ---------------------------------------------------------------------------
# Stage 1: Metadata pre-filter
# ---------------------------------------------------------------------------

def stage1_metadata_filter(
    all_images: list[Path],
) -> tuple[list[Path], list[Path], list[dict]]:
    """Run metadata-based keyword filter from prefilter_takeout.py.

    Returns:
        (remaining_images, rejected_images, stage1_rows)
    """
    # Import the prefilter logic
    script_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(script_dir))
    from prefilter_takeout import check_photo

    remaining = []
    rejected = []
    rows = []

    for img in all_images:
        passed, reject_reason, meta = check_photo(img)

        rows.append({
            "path": str(img),
            "stage": "1_metadata",
            "passed": passed,
            "reject_reason": reject_reason,
            "album": meta.get("album", ""),
            "industrial_score": "",
            "classification": "PASS_STAGE1" if passed else f"REJECT_S1:{reject_reason}",
            "nameplate_data": "",
        })

        if passed:
            remaining.append(img)
        else:
            # Also keep images that were rejected ONLY for "no_industrial_keyword"
            # These might still be equipment photos without metadata
            if reject_reason == "no_industrial_keyword":
                remaining.append(img)
            else:
                rejected.append(img)

    return remaining, rejected, rows


# ---------------------------------------------------------------------------
# Stage 2: CLIP classification
# ---------------------------------------------------------------------------

def stage2_clip_classify(
    images: list[Path],
    device: str = "mps",
    batch_size: int = 16,
) -> tuple[list[Path], list[Path], list[Path], list[dict]]:
    """Run CLIP zero-shot classification.

    Returns:
        (industrial_images, ambiguous_images, personal_images, stage2_rows)
    """
    from clip_classify_takeout import (
        INDUSTRIAL_PROMPTS,
        PERSONAL_PROMPTS,
        classify_batch_open_clip,
        classify_batch_transformers,
        load_clip_model,
    )

    model, preprocess_or_processor, tokenizer, dev, backend = load_clip_model(device)
    logger.info("CLIP backend: %s on %s", backend, dev)

    industrial = []
    ambiguous = []
    personal = []
    rows = []

    total = len(images)
    start = time.time()

    for batch_start in range(0, total, batch_size):
        batch = images[batch_start:batch_start + batch_size]

        if backend == "open_clip":
            batch_results = classify_batch_open_clip(
                model, preprocess_or_processor, tokenizer, batch, dev,
                INDUSTRIAL_PROMPTS, PERSONAL_PROMPTS,
            )
        else:
            batch_results = classify_batch_transformers(
                model, preprocess_or_processor, batch, dev,
                INDUSTRIAL_PROMPTS, PERSONAL_PROMPTS,
            )

        for r in batch_results:
            score = r["normalized_industrial"]
            path = Path(r["path"])

            if r.get("classification") == "ERROR":
                classification = "ERROR"
                ambiguous.append(path)  # send errors to Claude for review
            elif score >= CLIP_HIGH_THRESHOLD:
                classification = "INDUSTRIAL"
                industrial.append(path)
            elif score >= CLIP_LOW_THRESHOLD:
                classification = "AMBIGUOUS"
                ambiguous.append(path)
            else:
                classification = "PERSONAL"
                personal.append(path)

            rows.append({
                "path": str(path),
                "stage": "2_clip",
                "passed": classification in ("INDUSTRIAL", "AMBIGUOUS"),
                "reject_reason": "" if classification != "PERSONAL" else "clip_low_score",
                "album": "",
                "industrial_score": str(score),
                "classification": classification,
                "nameplate_data": "",
            })

        done = batch_start + len(batch)
        elapsed = time.time() - start
        rate = done / elapsed if elapsed > 0 else 0
        if done % (batch_size * 10) == 0 or done == total:
            logger.info(
                "CLIP %d/%d (%.0f img/s) IND=%d AMB=%d PERS=%d",
                done, total, rate, len(industrial), len(ambiguous), len(personal),
            )

    return industrial, ambiguous, personal, rows


# ---------------------------------------------------------------------------
# Stage 3: Claude Vision
# ---------------------------------------------------------------------------

def stage3_claude_vision(
    images: list[Path],
    dry_run: bool = False,
    include_low: bool = False,
) -> list[dict]:
    """Run Claude Vision nameplate extraction on ambiguous images.

    Returns stage3 result rows.
    """
    import anthropic
    import base64

    CLAUDE_MODEL = "claude-sonnet-4-20250514"
    VISION_PROMPT = (
        "Examine this photo. Does it show industrial equipment, a nameplate, "
        "data plate, motor, pump, VFD, transformer, compressor, breaker, "
        "contactor, control panel, electrical wiring, or similar?\n\n"
        "If YES — extract any readable fields as JSON:\n"
        '{"is_equipment": true, "is_nameplate": true/false, '
        '"make": "...", "model": "...", "equipment_type": "motor|pump|vfd|...|other", '
        '"confidence": "high|medium|low", "description": "brief description"}\n\n'
        'If NO — respond only: {"is_equipment": false}\n'
        "Respond with ONLY the JSON object."
    )

    rows = []

    if dry_run:
        logger.info("Stage 3 DRY RUN: would classify %d images with Claude Vision", len(images))
        for img in images:
            rows.append({
                "path": str(img),
                "stage": "3_claude",
                "passed": "DRY_RUN",
                "reject_reason": "",
                "album": "",
                "industrial_score": "",
                "classification": "PENDING_CLAUDE",
                "nameplate_data": "",
            })
        return rows

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set — cannot run Stage 3")
        logger.error("Run with: doppler run --project factorylm --config prd -- python3 %s", sys.argv[0])
        sys.exit(1)

    client = anthropic.Anthropic()
    confirmed = 0
    rejected = 0

    for i, img in enumerate(images):
        logger.info("Claude Vision %d/%d: %s", i + 1, len(images), img.name)

        try:
            photo_bytes = img.read_bytes()
            photo_b64 = base64.standard_b64encode(photo_bytes).decode("utf-8")

            suffix = img.suffix.lower()
            media_type_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp",
                ".heic": "image/jpeg",
            }
            media_type = media_type_map.get(suffix, "image/jpeg")

            response = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=512,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": photo_b64},
                        },
                        {"type": "text", "text": VISION_PROMPT},
                    ],
                }],
            )

            raw_text = response.content[0].text.strip()
            if raw_text.startswith("```"):
                lines = raw_text.split("\n")
                raw_text = "\n".join(lines[1:-1])

            result = json.loads(raw_text)

        except json.JSONDecodeError:
            logger.warning("Parse error for %s: %s", img.name, raw_text[:100])
            result = {"is_equipment": False, "parse_error": True}
        except Exception as e:
            logger.error("API error for %s: %s", img.name, e)
            result = {"is_equipment": False, "api_error": str(e)}

        is_equipment = result.get("is_equipment", False)
        confidence = result.get("confidence", "low")

        if is_equipment and (confidence != "low" or include_low):
            classification = "CONFIRMED_EQUIPMENT"
            confirmed += 1
        elif is_equipment and confidence == "low":
            classification = "LOW_CONFIDENCE"
        else:
            classification = "NOT_EQUIPMENT"
            rejected += 1

        rows.append({
            "path": str(img),
            "stage": "3_claude",
            "passed": is_equipment,
            "reject_reason": "" if is_equipment else "claude_rejected",
            "album": "",
            "industrial_score": confidence if is_equipment else "",
            "classification": classification,
            "nameplate_data": json.dumps(result) if is_equipment else "",
        })

        # Rate limit
        time.sleep(1.0)

    logger.info("Claude Vision: %d confirmed, %d rejected out of %d", confirmed, rejected, len(images))
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hybrid 3-stage photo classification pipeline",
    )
    parser.add_argument(
        "--extracted-dir",
        default=str(DEFAULT_EXTRACTED),
        help=f"Root of extracted Takeout tree (default: {DEFAULT_EXTRACTED})",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT),
        help=f"Output directory for classified photos (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--csv-out",
        default=str(DEFAULT_CSV),
        help=f"CSV results path (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--stages",
        default="1,2,3",
        help="Comma-separated stages to run (default: 1,2,3)",
    )
    parser.add_argument(
        "--clip-csv",
        default="",
        help="Resume Stage 3 from existing CLIP CSV (skip stages 1+2)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Classify but don't copy files or call Claude API",
    )
    parser.add_argument(
        "--include-low",
        action="store_true",
        help="Include low-confidence Claude classifications",
    )
    parser.add_argument(
        "--device",
        default="mps",
        choices=["mps", "cpu", "cuda"],
        help="Torch device for CLIP (default: mps)",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=0,
        help="Sample N images (0 = all) — useful for testing",
    )
    args = parser.parse_args()

    stages = {int(s.strip()) for s in args.stages.split(",")}
    extracted_dir = Path(args.extracted_dir)
    output_dir = Path(args.output_dir)
    csv_path = Path(args.csv_out)

    start_time = time.time()
    all_rows: list[dict] = []

    # ── Collect images ──────────────────────────────────────────────────
    all_images = sorted(
        p for p in extracted_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    total_images = len(all_images)
    logger.info("Found %d images in %s", total_images, extracted_dir)

    if args.sample > 0:
        import random
        all_images = random.sample(all_images, min(args.sample, len(all_images)))
        logger.info("Sampled %d images", len(all_images))

    if not all_images:
        logger.error("No images found")
        sys.exit(1)

    remaining = all_images
    s1_rejected = 0
    s2_industrial = []
    s2_ambiguous = []
    s2_personal = []

    # ── Stage 1: Metadata pre-filter ────────────────────────────────────
    if 1 in stages:
        logger.info("=== STAGE 1: Metadata Pre-Filter ===")
        remaining, rejected, s1_rows = stage1_metadata_filter(remaining)
        s1_rejected = len(rejected)
        all_rows.extend(s1_rows)
        logger.info(
            "Stage 1: %d remaining, %d hard-rejected (personal albums)",
            len(remaining), s1_rejected,
        )

    # ── Stage 2: CLIP classification ────────────────────────────────────
    if 2 in stages:
        logger.info("=== STAGE 2: CLIP Zero-Shot Classification ===")
        s2_industrial, s2_ambiguous, s2_personal, s2_rows = stage2_clip_classify(
            remaining, device=args.device,
        )
        all_rows.extend(s2_rows)
        logger.info(
            "Stage 2: %d industrial, %d ambiguous, %d personal",
            len(s2_industrial), len(s2_ambiguous), len(s2_personal),
        )

    # ── Stage 3: Claude Vision on ambiguous ─────────────────────────────
    if 3 in stages:
        claude_targets = s2_ambiguous

        # If resuming from CSV, load ambiguous paths from file
        if args.clip_csv:
            clip_csv = Path(args.clip_csv)
            if clip_csv.exists():
                claude_targets = []
                with open(clip_csv) as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if row.get("classification") == "AMBIGUOUS":
                            claude_targets.append(Path(row["path"]))
                logger.info("Loaded %d ambiguous images from %s", len(claude_targets), clip_csv)

        if claude_targets:
            logger.info("=== STAGE 3: Claude Vision (%d images) ===", len(claude_targets))
            est_cost = len(claude_targets) * 0.01  # rough estimate $0.01/image
            logger.info("Estimated Claude API cost: $%.2f", est_cost)
            s3_rows = stage3_claude_vision(
                claude_targets, dry_run=args.dry_run, include_low=args.include_low,
            )
            all_rows.extend(s3_rows)
        else:
            logger.info("Stage 3: no ambiguous images to process")

    # ── Copy classified photos ──────────────────────────────────────────
    if not args.dry_run:
        for subdir in ("industrial", "ambiguous_claude", "personal"):
            (output_dir / subdir).mkdir(parents=True, exist_ok=True)

        for img in s2_industrial:
            dest = output_dir / "industrial" / img.name
            if not dest.exists():
                shutil.copy2(img, dest)

        # Copy Claude-confirmed to industrial
        for row in all_rows:
            if row.get("classification") == "CONFIRMED_EQUIPMENT":
                src = Path(row["path"])
                dest = output_dir / "industrial" / src.name
                if not dest.exists():
                    shutil.copy2(src, dest)

    # ── Write unified CSV ───────────────────────────────────────────────
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["path", "stage", "passed", "reject_reason", "album",
                  "industrial_score", "classification", "nameplate_data"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    # ── Summary ─────────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    mode_label = " [DRY RUN]" if args.dry_run else ""

    # Count final classifications
    confirmed_industrial = len(s2_industrial) + sum(
        1 for r in all_rows if r.get("classification") == "CONFIRMED_EQUIPMENT"
    )
    confirmed_personal = len(s2_personal) + s1_rejected
    still_ambiguous = sum(
        1 for r in all_rows
        if r.get("classification") in ("AMBIGUOUS", "PENDING_CLAUDE", "LOW_CONFIDENCE")
    )

    print()
    print("=" * 65)
    print(f"Hybrid Photo Classification Pipeline{mode_label}")
    print("=" * 65)
    print(f"Stages run:            {','.join(str(s) for s in sorted(stages))}")
    print(f"Total images:          {total_images:>6,}")
    if args.sample:
        print(f"Sampled:               {len(all_images):>6,}")
    print()
    if 1 in stages:
        print(f"S1 metadata reject:    {s1_rejected:>6,}")
        print(f"S1 remaining:          {len(remaining):>6,}")
    if 2 in stages:
        print(f"S2 CLIP industrial:    {len(s2_industrial):>6,}")
        print(f"S2 CLIP ambiguous:     {len(s2_ambiguous):>6,}")
        print(f"S2 CLIP personal:      {len(s2_personal):>6,}")
    if 3 in stages:
        s3_confirmed = sum(1 for r in all_rows if r.get("classification") == "CONFIRMED_EQUIPMENT")
        s3_rejected = sum(1 for r in all_rows if r.get("stage") == "3_claude" and r.get("classification") == "NOT_EQUIPMENT")
        print(f"S3 Claude confirmed:   {s3_confirmed:>6,}")
        print(f"S3 Claude rejected:    {s3_rejected:>6,}")
    print()
    print(f"FINAL industrial:      {confirmed_industrial:>6,}")
    print(f"FINAL personal:        {confirmed_personal:>6,}")
    print(f"FINAL ambiguous:       {still_ambiguous:>6,}")
    print(f"Time elapsed:          {elapsed:.1f}s")
    print(f"CSV:                   {csv_path}")
    if not args.dry_run:
        print(f"Output dir:            {output_dir}")
    print("=" * 65)


if __name__ == "__main__":
    main()
