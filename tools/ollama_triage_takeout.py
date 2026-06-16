#!/usr/bin/env python3
"""Ollama qwen2.5vl:7b second-pass triage for CLIP-filtered photos.

Reads CLIP results CSV, takes INDUSTRIAL + AMBIGUOUS images, and runs
each through Ollama's local vision model for binary classification.

Usage:
    # Dry run — show what would be processed
    python3 ollama_triage_takeout.py --dry-run

    # Full run with resume support
    python3 ollama_triage_takeout.py

    # Custom CLIP CSV
    python3 ollama_triage_takeout.py --clip-csv /path/to/clip_results.csv
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import logging
import sys
import time
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("ollama-triage")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_CLIP_CSV = Path.home() / "takeout_staging" / "clip_results.csv"
DEFAULT_OUTPUT_CSV = Path.home() / "takeout_staging" / "ollama_triage_results.csv"
DEFAULT_CHECKPOINT = Path.home() / "takeout_staging" / "ollama_checkpoint.txt"
DEFAULT_FILTERED = Path.home() / "takeout_staging" / "ollama_confirmed"

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5vl:7b"

# Simple binary prompt — we want yes/no, not detailed analysis
TRIAGE_PROMPT = (
    "Look at this image. Is this a photo of industrial equipment, machinery, "
    "an electrical panel, motor, pump, VFD, circuit breaker, control panel, "
    "nameplate, data plate, wiring, or maintenance/repair work?\n\n"
    "Answer with ONLY one word: yes or no"
)

# Max image dimension before sending to Ollama (saves RAM + speeds inference)
MAX_DIM = 512


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def load_and_resize(path: Path) -> str | None:
    """Load image, resize to MAX_DIM, return base64 string."""
    try:
        from PIL import Image

        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass

        img = Image.open(path).convert("RGB")

        # Resize if larger than MAX_DIM
        w, h = img.size
        if max(w, h) > MAX_DIM:
            ratio = MAX_DIM / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        import io
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    except Exception as e:
        logger.warning("Failed to load %s: %s", path.name, e)
        return None


# ---------------------------------------------------------------------------
# Ollama API
# ---------------------------------------------------------------------------

def classify_with_ollama(
    client: httpx.Client, image_b64: str, filename: str,
) -> tuple[bool, str]:
    """Send image to Ollama for binary yes/no classification.

    Returns (is_equipment: bool, raw_response: str).
    """
    try:
        resp = client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": TRIAGE_PROMPT,
                "images": [image_b64],
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 10,  # only need yes/no
                },
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("response", "").strip().lower()

        # Parse yes/no from response
        is_equipment = raw.startswith("yes")

        return is_equipment, raw

    except httpx.TimeoutException:
        logger.warning("Timeout for %s", filename)
        return False, "TIMEOUT"
    except Exception as e:
        logger.error("Ollama error for %s: %s", filename, e)
        return False, f"ERROR: {e}"


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------

def load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def save_checkpoint(path: Path, item: str) -> None:
    with open(path, "a") as f:
        f.write(item + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ollama second-pass triage on CLIP-filtered photos",
    )
    parser.add_argument(
        "--clip-csv",
        default=str(DEFAULT_CLIP_CSV),
        help=f"CLIP results CSV (default: {DEFAULT_CLIP_CSV})",
    )
    parser.add_argument(
        "--output-csv",
        default=str(DEFAULT_OUTPUT_CSV),
        help=f"Output CSV (default: {DEFAULT_OUTPUT_CSV})",
    )
    parser.add_argument(
        "--filtered-dir",
        default=str(DEFAULT_FILTERED),
        help=f"Copy confirmed equipment photos here (default: {DEFAULT_FILTERED})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without calling Ollama",
    )
    parser.add_argument(
        "--buckets",
        default="INDUSTRIAL,AMBIGUOUS",
        help="Comma-separated CLIP buckets to process (default: INDUSTRIAL,AMBIGUOUS)",
    )
    args = parser.parse_args()

    clip_csv = Path(args.clip_csv)
    output_csv = Path(args.output_csv)
    filtered_dir = Path(args.filtered_dir)
    checkpoint_path = DEFAULT_CHECKPOINT
    buckets = {b.strip() for b in args.buckets.split(",")}

    if not clip_csv.exists():
        logger.error("CLIP CSV not found: %s", clip_csv)
        logger.error("Run clip_classify_takeout.py first")
        sys.exit(1)

    # Load CLIP results and filter to target buckets
    targets: list[dict] = []
    with open(clip_csv) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["classification"] in buckets:
                targets.append(row)

    logger.info(
        "Loaded %d images from CLIP CSV (buckets: %s)",
        len(targets), ", ".join(sorted(buckets)),
    )

    if not targets:
        logger.info("Nothing to process")
        sys.exit(0)

    # Resume support
    done = load_checkpoint(checkpoint_path)
    remaining = [t for t in targets if t["path"] not in done]
    if done:
        logger.info("Checkpoint: %d already done, %d remaining", len(done), len(remaining))

    if args.dry_run:
        print(f"\nDRY RUN: would process {len(remaining)} images with Ollama {OLLAMA_MODEL}")
        print(f"Estimated time: {len(remaining) * 4 / 3600:.1f} - {len(remaining) * 6 / 3600:.1f} hours")
        print(f"Estimated cost: $0")
        return

    # Check Ollama is running
    try:
        with httpx.Client() as check:
            r = check.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            if not any(OLLAMA_MODEL in m for m in models):
                logger.error("Model %s not found. Available: %s", OLLAMA_MODEL, models)
                sys.exit(1)
            logger.info("Ollama OK, model %s available", OLLAMA_MODEL)
    except Exception as e:
        logger.error("Cannot reach Ollama at %s: %s", OLLAMA_BASE_URL, e)
        sys.exit(1)

    # Create output dirs
    filtered_dir.mkdir(parents=True, exist_ok=True)

    # Process
    results: list[dict] = []
    confirmed = 0
    rejected = 0
    errors = 0
    total = len(remaining)
    start_time = time.time()

    with httpx.Client() as client:
        for i, row in enumerate(remaining):
            path = Path(row["path"])
            clip_score = row.get("normalized_industrial", "")
            clip_class = row.get("classification", "")

            # Load and resize image
            img_b64 = load_and_resize(path)
            if img_b64 is None:
                errors += 1
                results.append({
                    "path": str(path),
                    "clip_classification": clip_class,
                    "clip_score": clip_score,
                    "ollama_is_equipment": False,
                    "ollama_raw": "LOAD_ERROR",
                    "final_classification": "ERROR",
                })
                save_checkpoint(checkpoint_path, str(path))
                continue

            # Classify
            is_equipment, raw = classify_with_ollama(client, img_b64, path.name)

            if is_equipment:
                confirmed += 1
                final = "CONFIRMED_EQUIPMENT"
                # Copy to filtered dir
                import shutil
                dest = filtered_dir / path.name
                if dest.exists():
                    dest = filtered_dir / f"{path.parent.name}__{path.name}"
                shutil.copy2(path, dest)
            else:
                rejected += 1
                final = "NOT_EQUIPMENT"

            results.append({
                "path": str(path),
                "clip_classification": clip_class,
                "clip_score": clip_score,
                "ollama_is_equipment": is_equipment,
                "ollama_raw": raw[:50],
                "final_classification": final,
            })

            save_checkpoint(checkpoint_path, str(path))

            # Progress every 50 images
            done_count = i + 1
            elapsed = time.time() - start_time
            rate = done_count / elapsed if elapsed > 0 else 0
            eta = (total - done_count) / rate if rate > 0 else 0

            if done_count % 50 == 0 or done_count == total:
                logger.info(
                    "Progress: %d/%d (%.1f sec/img, ETA %.0fm) | CONFIRMED=%d REJECTED=%d ERR=%d",
                    done_count, total, 1 / rate if rate > 0 else 0, eta / 60,
                    confirmed, rejected, errors,
                )

    # Write output CSV
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["path", "clip_classification", "clip_score",
                  "ollama_is_equipment", "ollama_raw", "final_classification"]
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    elapsed_total = time.time() - start_time

    print()
    print("=" * 60)
    print("Ollama Triage Results")
    print("=" * 60)
    print(f"Model:                 {OLLAMA_MODEL}")
    print(f"Input (CLIP filtered): {len(targets):>6,}")
    print(f"Processed this run:    {total:>6,}")
    print(f"CONFIRMED equipment:   {confirmed:>6,}")
    print(f"REJECTED (personal):   {rejected:>6,}")
    print(f"Errors:                {errors:>6,}")
    print(f"Time:                  {elapsed_total / 3600:.1f} hours ({elapsed_total:.0f}s)")
    if total > 0:
        print(f"Avg per image:         {elapsed_total / total:.1f}s")
    print(f"Output CSV:            {output_csv}")
    print(f"Confirmed dir:         {filtered_dir}")
    print()
    print("Next step: run ingest_equipment_photos.py on confirmed photos")
    print(f"  doppler run --project factorylm --config prd -- \\")
    print(f"    python3 ~/Mira/mira-core/scripts/ingest_equipment_photos.py \\")
    print(f"    --incoming-dir {filtered_dir} --dry-run --no-move")
    print("=" * 60)


if __name__ == "__main__":
    main()
