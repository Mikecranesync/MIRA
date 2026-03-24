#!/usr/bin/env python3
"""CLIP/SigLIP zero-shot classification for Google Takeout photos.

Classifies images as industrial equipment vs personal photos using
zero-shot CLIP embeddings. No API calls — runs entirely on local hardware.

Usage:
    # Dry run — score 100 samples, print distribution
    python3 clip_classify_takeout.py --dry-run --sample 100

    # Full run — classify all images, copy passing to filtered dir
    python3 clip_classify_takeout.py

    # Custom threshold + custom dirs
    python3 clip_classify_takeout.py --threshold 0.55 --extracted-dir /path/to/photos
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import random
import sys
import shutil
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("clip-classify")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_EXTRACTED = Path.home() / "takeout_staging" / "extracted"
DEFAULT_FILTERED = Path.home() / "takeout_staging" / "clip_filtered"
DEFAULT_CSV = Path.home() / "takeout_staging" / "clip_results.csv"
DEFAULT_CHECKPOINT = Path.home() / "takeout_staging" / "clip_checkpoint.txt"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

# Text prompts for zero-shot classification
# More specific prompts produce better CLIP scores
INDUSTRIAL_PROMPTS = [
    "a photo of an industrial equipment nameplate with text",
    "a photo of an electric motor in a factory",
    "a photo of a variable frequency drive VFD",
    "a photo of an electrical control panel with wiring",
    "a photo of a circuit breaker panel or switchgear",
    "a photo of a pump or compressor in an industrial setting",
    "a photo of a PLC programmable logic controller",
    "a photo of electrical wiring or conduit",
    "a photo of a transformer or power distribution equipment",
    "a photo of maintenance work on industrial machinery",
    "a photo of a conveyor belt or mechanical equipment",
    "a photo of a data plate or specification label on equipment",
]

PERSONAL_PROMPTS = [
    "a family photo of people smiling",
    "a selfie",
    "a photo of food or a meal",
    "a photo of a pet dog or cat",
    "a landscape or nature photo",
    "a photo of a house or building exterior",
    "a photo of a child or baby",
    "a photo of a vacation or travel destination",
    "a screenshot of a phone or computer",
    "a photo of a car or vehicle",
]

DEFAULT_THRESHOLD = 0.55  # industrial probability > threshold = PASS (softmax sum)
BATCH_SIZE = 16  # images per batch for CLIP inference


# ---------------------------------------------------------------------------
# CLIP Model Loading
# ---------------------------------------------------------------------------

def load_clip_model(device: str = "mps"):
    """Load CLIP model and preprocessing.

    Tries open_clip first (SigLIP), falls back to transformers CLIP.
    """
    try:
        import open_clip
        import torch

        # SigLIP is best for zero-shot on Apple Silicon
        # ViT-B-16-SigLIP is a good balance of speed and accuracy
        model_name = "ViT-B-16-SigLIP"
        pretrained = "webli"

        logger.info("Loading %s (pretrained=%s) on %s", model_name, pretrained, device)
        model, _, preprocess = open_clip.create_model_and_transforms(
            model_name, pretrained=pretrained, device=device,
        )
        tokenizer = open_clip.get_tokenizer(model_name)
        model.eval()

        return model, preprocess, tokenizer, device, "open_clip"

    except ImportError:
        logger.warning("open_clip not found, trying transformers CLIP...")

    try:
        from transformers import CLIPProcessor, CLIPModel
        import torch

        model_id = "openai/clip-vit-base-patch32"
        logger.info("Loading %s on %s", model_id, device)
        model = CLIPModel.from_pretrained(model_id).to(device)
        processor = CLIPProcessor.from_pretrained(model_id)
        model.eval()

        return model, processor, None, device, "transformers"

    except ImportError:
        logger.error("Neither open_clip nor transformers installed.")
        logger.error("Install with: uv pip install open-clip-torch torch Pillow")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify_batch_open_clip(
    model, preprocess, tokenizer, image_paths: list[Path], device: str,
    industrial_prompts: list[str], personal_prompts: list[str],
) -> list[dict]:
    """Classify a batch of images using open_clip."""
    import torch
    from PIL import Image

    # Register HEIC support if available
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass

    results = []
    all_prompts = industrial_prompts + personal_prompts
    n_industrial = len(industrial_prompts)

    # Tokenize text prompts once
    text_tokens = tokenizer(all_prompts).to(device)

    # Get the model's logit scale for proper temperature scaling
    logit_scale = model.logit_scale.exp().item() if hasattr(model, 'logit_scale') else 100.0

    with torch.no_grad():
        text_features = model.encode_text(text_tokens)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

    for path in image_paths:
        try:
            img = Image.open(path).convert("RGB")
            img_tensor = preprocess(img).unsqueeze(0).to(device)

            with torch.no_grad():
                image_features = model.encode_image(img_tensor)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)

                # Scaled cosine similarity → softmax probabilities
                logits = (image_features @ text_features.T).squeeze(0) * logit_scale
                probs = torch.softmax(logits, dim=-1)

                # Sum probabilities for industrial vs personal prompts
                industrial_prob = probs[:n_industrial].sum().item()
                personal_prob = probs[n_industrial:].sum().item()

            results.append({
                "path": str(path),
                "industrial_score": round(industrial_prob, 4),
                "personal_score": round(personal_prob, 4),
                "normalized_industrial": round(industrial_prob, 4),
                "classification": "",  # filled by caller
            })

        except Exception as e:
            logger.warning("Failed to process %s: %s", path.name, e)
            results.append({
                "path": str(path),
                "industrial_score": 0.0,
                "personal_score": 0.0,
                "normalized_industrial": 0.0,
                "classification": "ERROR",
            })

    return results


def classify_batch_transformers(
    model, processor, image_paths: list[Path], device: str,
    industrial_prompts: list[str], personal_prompts: list[str],
) -> list[dict]:
    """Classify a batch of images using transformers CLIP."""
    import torch
    from PIL import Image

    results = []
    all_prompts = industrial_prompts + personal_prompts
    n_industrial = len(industrial_prompts)

    for path in image_paths:
        try:
            img = Image.open(path).convert("RGB")
            inputs = processor(
                text=all_prompts, images=img, return_tensors="pt", padding=True,
            ).to(device)

            with torch.no_grad():
                outputs = model(**inputs)
                logits = outputs.logits_per_image.squeeze(0)
                probs = logits.softmax(dim=-1)

                industrial_score = probs[:n_industrial].sum().item()
                personal_score = probs[n_industrial:].sum().item()

            results.append({
                "path": str(path),
                "industrial_score": round(industrial_score, 4),
                "personal_score": round(personal_score, 4),
                "normalized_industrial": round(industrial_score, 4),
                "classification": "",
            })

        except Exception as e:
            logger.warning("Failed to process %s: %s", path.name, e)
            results.append({
                "path": str(path),
                "industrial_score": 0.0,
                "personal_score": 0.0,
                "normalized_industrial": 0.0,
                "classification": "ERROR",
            })

    return results


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_checkpoint(checkpoint_path: Path) -> set[str]:
    """Load set of already-processed file paths from checkpoint."""
    if not checkpoint_path.exists():
        return set()
    with open(checkpoint_path) as f:
        return {line.strip() for line in f if line.strip()}


def save_checkpoint(checkpoint_path: Path, processed_path: str) -> None:
    """Append a processed path to checkpoint file."""
    with open(checkpoint_path, "a") as f:
        f.write(processed_path + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CLIP zero-shot classification of Takeout photos for industrial equipment",
    )
    parser.add_argument(
        "--extracted-dir",
        default=str(DEFAULT_EXTRACTED),
        help=f"Root of extracted Takeout tree (default: {DEFAULT_EXTRACTED})",
    )
    parser.add_argument(
        "--filtered-dir",
        default=str(DEFAULT_FILTERED),
        help=f"Output directory for passing photos (default: {DEFAULT_FILTERED})",
    )
    parser.add_argument(
        "--csv-out",
        default=str(DEFAULT_CSV),
        help=f"CSV results path (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"Industrial score threshold for PASS (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Score images but don't copy files",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=0,
        help="Process only N random samples (0 = all)",
    )
    parser.add_argument(
        "--device",
        default="mps",
        choices=["mps", "cpu", "cuda"],
        help="Torch device (default: mps for Apple Silicon)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from checkpoint (skip already-processed files)",
    )
    args = parser.parse_args()

    extracted_dir = Path(args.extracted_dir)
    filtered_dir = Path(args.filtered_dir)
    csv_path = Path(args.csv_out)
    checkpoint_path = DEFAULT_CHECKPOINT

    if not extracted_dir.exists():
        logger.error("Extracted dir does not exist: %s", extracted_dir)
        sys.exit(1)

    # Collect all images
    all_images = sorted(
        p for p in extracted_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )

    if not all_images:
        logger.error("No images found in %s", extracted_dir)
        sys.exit(1)

    logger.info("Found %d images in %s", len(all_images), extracted_dir)

    # Resume support
    already_done: set[str] = set()
    if args.resume:
        already_done = load_checkpoint(checkpoint_path)
        before = len(all_images)
        all_images = [p for p in all_images if str(p) not in already_done]
        logger.info("Resume: skipping %d already-processed, %d remaining", before - len(all_images), len(all_images))

    # Sample mode
    if args.sample > 0 and args.sample < len(all_images):
        all_images = random.sample(all_images, args.sample)
        logger.info("Sampling %d images", args.sample)

    # Load model
    model, preprocess_or_processor, tokenizer, device, backend = load_clip_model(args.device)
    logger.info("Using %s backend on %s", backend, device)

    if not args.dry_run:
        filtered_dir.mkdir(parents=True, exist_ok=True)

    # Process in batches
    all_results: list[dict] = []
    pass_count = 0
    reject_count = 0
    ambiguous_count = 0
    error_count = 0

    total = len(all_images)
    start_time = time.time()

    for batch_start in range(0, total, BATCH_SIZE):
        batch = all_images[batch_start:batch_start + BATCH_SIZE]

        if backend == "open_clip":
            batch_results = classify_batch_open_clip(
                model, preprocess_or_processor, tokenizer, batch, device,
                INDUSTRIAL_PROMPTS, PERSONAL_PROMPTS,
            )
        else:
            batch_results = classify_batch_transformers(
                model, preprocess_or_processor, batch, device,
                INDUSTRIAL_PROMPTS, PERSONAL_PROMPTS,
            )

        for r in batch_results:
            if r["classification"] == "ERROR":
                error_count += 1
            else:
                score = r["normalized_industrial"]
                if score >= 0.7:
                    r["classification"] = "INDUSTRIAL"
                    pass_count += 1
                elif score >= args.threshold:
                    r["classification"] = "AMBIGUOUS"
                    ambiguous_count += 1
                else:
                    r["classification"] = "PERSONAL"
                    reject_count += 1

                # Copy passing photos (INDUSTRIAL + AMBIGUOUS)
                if not args.dry_run and r["classification"] in ("INDUSTRIAL", "AMBIGUOUS"):
                    src = Path(r["path"])
                    dest = filtered_dir / f"{r['classification'].lower()}__{src.name}"
                    if dest.exists():
                        dest = filtered_dir / f"{r['classification'].lower()}__{src.parent.name}__{src.name}"
                    shutil.copy2(src, dest)

            # Checkpoint
            if args.resume:
                save_checkpoint(checkpoint_path, r["path"])

            all_results.append(r)

        # Progress
        done = batch_start + len(batch)
        elapsed = time.time() - start_time
        rate = done / elapsed if elapsed > 0 else 0
        eta = (total - done) / rate if rate > 0 else 0
        logger.info(
            "Progress: %d/%d (%.0f img/s, ETA %.0fs) | INDUSTRIAL=%d AMBIGUOUS=%d PERSONAL=%d ERR=%d",
            done, total, rate, eta, pass_count, ambiguous_count, reject_count, error_count,
        )

    # Write CSV (always)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["path", "industrial_score", "personal_score", "normalized_industrial", "classification"],
        )
        writer.writeheader()
        writer.writerows(all_results)

    # Score distribution summary
    industrial_scores = [r["normalized_industrial"] for r in all_results if r["classification"] != "ERROR"]
    if industrial_scores:
        scores_sorted = sorted(industrial_scores)
        p10 = scores_sorted[len(scores_sorted) // 10]
        p25 = scores_sorted[len(scores_sorted) // 4]
        p50 = scores_sorted[len(scores_sorted) // 2]
        p75 = scores_sorted[3 * len(scores_sorted) // 4]
        p90 = scores_sorted[9 * len(scores_sorted) // 10]
    else:
        p10 = p25 = p50 = p75 = p90 = 0.0

    elapsed_total = time.time() - start_time
    mode_label = " [DRY RUN]" if args.dry_run else ""
    sample_label = f" [SAMPLE={args.sample}]" if args.sample > 0 else ""

    print()
    print("=" * 60)
    print(f"CLIP Photo Classification{mode_label}{sample_label}")
    print("=" * 60)
    print(f"Backend:               {backend} on {device}")
    print(f"Source dir:            {extracted_dir}")
    print(f"Total images:          {total:>6,}")
    print(f"INDUSTRIAL (>0.70):    {pass_count:>6,}")
    print(f"AMBIGUOUS (0.50-0.70): {ambiguous_count:>6,}")
    print(f"PERSONAL (<0.50):      {reject_count:>6,}")
    print(f"Errors:                {error_count:>6,}")
    print(f"Threshold:             {args.threshold}")
    print(f"Time elapsed:          {elapsed_total:.1f}s ({total / elapsed_total:.0f} img/s)")
    print()
    print("Score distribution (normalized_industrial):")
    print(f"  P10={p10:.3f}  P25={p25:.3f}  P50={p50:.3f}  P75={p75:.3f}  P90={p90:.3f}")
    print()
    print(f"CSV:                   {csv_path}")
    if not args.dry_run:
        print(f"Filtered dir:          {filtered_dir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
