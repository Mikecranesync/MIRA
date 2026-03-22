#!/usr/bin/env python3
"""Ingest equipment photos from the rclone sync drop folder.

Scans incoming/ for new photos, classifies each with Claude Vision,
inserts confirmed nameplates into NeonDB knowledge_entries, and
appends to Regime 3 golden labels.

Usage:
    doppler run --project factorylm --config prd -- python mira-core/scripts/ingest_equipment_photos.py --dry-run
    doppler run --project factorylm --config prd -- python mira-core/scripts/ingest_equipment_photos.py
    doppler run --project factorylm --config prd -- python mira-core/scripts/ingest_equipment_photos.py --include-low
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("gphotos-ingest")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INCOMING = REPO_ROOT / "mira-core" / "data" / "equipment_photos" / "incoming"
PROCESSED = REPO_ROOT / "mira-core" / "data" / "equipment_photos" / "processed"
REGIME3_DIR = REPO_ROOT / "tests" / "regime3_nameplate"
PHOTOS_DIR = REGIME3_DIR / "photos" / "real"
LABELS_PATH = REGIME3_DIR / "golden_labels" / "v1" / "real_photos.json"

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic"}

CLAUDE_MODEL = "claude-sonnet-4-20250514"

# Reuse the same vision prompt from tools/google_photos_ingest.py
VISION_PROMPT = """\
Examine this photo. Does it show an industrial equipment nameplate \
or data plate? These appear on motors, pumps, VFDs, transformers, \
compressors, breakers, contactors, or similar equipment.

If YES — extract every readable field as JSON:
{
  "is_nameplate": true,
  "make": "...",
  "model": "...",
  "catalog": "...",
  "serial": "...",
  "voltage": "...",
  "amperage": "...",
  "rpm": "...",
  "hz": "...",
  "hp": "...",
  "equipment_type": "motor|pump|vfd|transformer|breaker|contactor|starter|panel|other",
  "confidence": "high|medium|low",
  "readable_fields": ["make","model",...]
}

If NO — respond only: {"is_nameplate": false}
Respond with ONLY the JSON object, no other text."""


# ── Claude Vision Classification ─────────────────────────────────────────────


def classify_photo(photo_path: Path, client) -> dict:
    """Send photo to Claude Vision for nameplate classification + extraction."""
    photo_bytes = photo_path.read_bytes()
    photo_b64 = base64.standard_b64encode(photo_bytes).decode("utf-8")

    suffix = photo_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/jpeg",  # Claude doesn't support HEIC natively
    }
    media_type = media_type_map.get(suffix, "image/jpeg")

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": photo_b64,
                        },
                    },
                    {"type": "text", "text": VISION_PROMPT},
                ],
            }
        ],
    )

    raw_text = response.content[0].text.strip()

    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.warning(
            "Failed to parse Claude response for %s: %s",
            photo_path.name,
            raw_text[:200],
        )
        return {"is_nameplate": False, "parse_error": True}

    return result


# ── NeonDB Knowledge Insert ──────────────────────────────────────────────────


def insert_to_neondb(result: dict, photo_path: Path, tenant_id: str) -> str | None:
    """Insert a confirmed nameplate into NeonDB knowledge_entries."""
    sys.path.insert(0, str(REPO_ROOT / "mira-core" / "mira-ingest"))
    from db.neon import insert_knowledge_entry, knowledge_entry_exists

    source_url = f"gphotos://{photo_path.name}"

    if knowledge_entry_exists(tenant_id, source_url, 0):
        logger.info("Already ingested: %s (skipping)", photo_path.name)
        return None

    # Build content from extracted fields
    fields = []
    for key in ("make", "model", "catalog", "serial", "voltage", "amperage", "rpm", "hp", "hz"):
        val = result.get(key)
        if val:
            fields.append(f"{key}: {val}")

    equipment_type = result.get("equipment_type", "other")
    content = f"{equipment_type} nameplate — " + ", ".join(fields) if fields else f"{equipment_type} nameplate"

    # No embedding for now — insert with empty embedding
    # Future: generate via Anthropic or local model
    entry_id = insert_knowledge_entry(
        tenant_id=tenant_id,
        content=content,
        embedding=[0.0] * 1536,  # placeholder — pgvector needs a vector
        manufacturer=result.get("make"),
        model_number=result.get("model"),
        source_url=source_url,
        chunk_index=0,
        page_num=None,
        section=equipment_type,
        source_type="gphotos",
    )

    logger.info("Inserted knowledge entry %s for %s", entry_id, photo_path.name)
    return entry_id


# ── Regime 3 Golden Labels ───────────────────────────────────────────────────


def _next_case_id(existing_cases: list[dict], equipment_type: str) -> str:
    """Generate next case ID like gp_motor_001."""
    prefix = f"gp_{equipment_type}_"
    existing_nums = []
    for c in existing_cases:
        cid = c.get("id", "")
        if cid.startswith(prefix):
            try:
                existing_nums.append(int(cid[len(prefix):]))
            except ValueError:
                pass
    next_num = max(existing_nums, default=0) + 1
    return f"{prefix}{next_num:03d}"


def append_golden_label(result: dict, photo_path: Path) -> str | None:
    """Copy photo to Regime 3 and append to real_photos.json."""
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    if LABELS_PATH.exists():
        with open(LABELS_PATH) as f:
            data = json.load(f)
    else:
        data = {
            "description": "Ground truth labels for real equipment nameplate photos",
            "source": "mixed",
            "status": "ANNOTATED",
            "cases": [],
        }

    equipment_type = result.get("equipment_type", "other")
    case_id = _next_case_id(data["cases"], equipment_type)

    ext = photo_path.suffix or ".jpg"
    dest_filename = f"{case_id}{ext}"
    dest_path = PHOTOS_DIR / dest_filename
    shutil.copy2(photo_path, dest_path)

    rel_path = dest_path.relative_to(REPO_ROOT)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    ground_truth = {
        "classification": "EQUIPMENT_PHOTO",
        "make": result.get("make"),
        "model": result.get("model"),
        "catalog": result.get("catalog"),
        "serial": result.get("serial"),
        "voltage": result.get("voltage"),
        "amperage": result.get("amperage"),
        "rpm": result.get("rpm"),
        "component_type": equipment_type,
    }

    case_entry = {
        "id": case_id,
        "image": str(rel_path).replace("\\", "/"),
        "ground_truth": ground_truth,
        "source": "google_photos_rclone",
        "date_ingested": today,
        "confidence": result.get("confidence", "medium"),
        "notes": "Auto-extracted via Claude Vision from rclone sync",
    }

    extras = {}
    for key in ("hz", "hp", "readable_fields"):
        if result.get(key):
            extras[key] = result[key]
    if extras:
        case_entry["extras"] = extras

    data["cases"].append(case_entry)
    data["status"] = "ANNOTATED"

    with open(LABELS_PATH, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    logger.info("Added golden label %s for %s", case_id, photo_path.name)
    return case_id


# ── Main Pipeline ────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Ingest equipment photos from rclone sync folder",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Classify photos but don't write to NeonDB or move files",
    )
    parser.add_argument(
        "--include-low",
        action="store_true",
        help="Also ingest low-confidence classifications",
    )
    parser.add_argument(
        "--incoming-dir",
        type=str,
        default=str(INCOMING),
        help=f"Override incoming directory (default: {INCOMING})",
    )
    args = parser.parse_args()

    incoming = Path(args.incoming_dir)
    if not incoming.exists():
        logger.error("Incoming directory does not exist: %s", incoming)
        logger.info("Run sync_gphotos.sh first to populate it.")
        sys.exit(1)

    # Find all photos
    photos = [
        p
        for p in incoming.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    ]

    if not photos:
        logger.info("No photos found in %s — nothing to ingest.", incoming)
        sys.exit(0)

    logger.info("Found %d photos to process in %s", len(photos), incoming)

    import anthropic

    client = anthropic.Anthropic()
    tenant_id = os.environ.get("MIRA_TENANT_ID")
    if not tenant_id and not args.dry_run:
        logger.error("MIRA_TENANT_ID not set. Run with Doppler or set env var.")
        sys.exit(1)

    confirmed = []
    skipped = []
    low_confidence = []

    PROCESSED.mkdir(parents=True, exist_ok=True)

    for i, photo in enumerate(photos):
        logger.info("Classifying %d/%d: %s", i + 1, len(photos), photo.name)

        result = classify_photo(photo, client)

        if not result.get("is_nameplate"):
            skipped.append(photo.name)
            if not args.dry_run:
                shutil.move(str(photo), str(PROCESSED / photo.name))
            continue

        confidence = result.get("confidence", "low")

        if confidence == "low" and not args.include_low:
            low_confidence.append(photo.name)
            logger.info("  Low confidence — skipping: %s", photo.name)
            if not args.dry_run:
                shutil.move(str(photo), str(PROCESSED / f"low_{photo.name}"))
            continue

        # Confirmed nameplate
        make = result.get("make", "?")
        model = result.get("model", "?")
        eq_type = result.get("equipment_type", "?")
        logger.info("  CONFIRMED: %s %s (%s) [%s]", make, model, eq_type, confidence)

        if not args.dry_run:
            # Insert to NeonDB
            if tenant_id:
                insert_to_neondb(result, photo, tenant_id)

            # Append to Regime 3 golden labels
            append_golden_label(result, photo)

            # Move to processed
            shutil.move(str(photo), str(PROCESSED / photo.name))

        confirmed.append({"name": photo.name, "result": result})

        # Rate limit — Claude API
        time.sleep(1.0)

    # Summary
    print()
    print("=" * 50)
    print("Equipment Photo Ingest" + (" — DRY RUN" if args.dry_run else ""))
    print("=" * 50)
    print(f"Total scanned:     {len(photos):>4}")
    print(f"Confirmed:         {len(confirmed):>4}")
    print(f"Skipped:           {len(skipped):>4}")
    print(f"Low confidence:    {len(low_confidence):>4}")

    if confirmed:
        type_counts: dict[str, int] = {}
        for entry in confirmed:
            eq = entry["result"].get("equipment_type", "other")
            type_counts[eq] = type_counts.get(eq, 0) + 1
        print("Equipment types:")
        for t, c in sorted(type_counts.items()):
            print(f"  {t}: {c}")

    if not args.dry_run and confirmed:
        print(f"Golden labels: {LABELS_PATH.relative_to(REPO_ROOT)}")
        print(f"NeonDB entries inserted: {len(confirmed)}")

    print("=" * 50)


if __name__ == "__main__":
    main()
