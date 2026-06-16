#!/usr/bin/env python3
"""Backfill enriched text + image embeddings for existing KB entries.

Reads survey_results.csv, rebuilds content text with full survey metadata,
re-embeds text + image, and upserts to NeonDB by source_url.

Usage:
    # Dry run — print what would be re-embedded
    NEON_DATABASE_URL=... python3 backfill_vision_embeddings.py \
        --survey ~/takeout_staging/survey_results.csv --dry-run

    # Full run with cost guard
    NEON_DATABASE_URL=... MIRA_TENANT_ID=... python3 backfill_vision_embeddings.py \
        --survey ~/takeout_staging/survey_results.csv \
        --photo-dir ~/takeout_staging/ollama_confirmed \
        --max-cost 10
"""

from __future__ import annotations

import argparse
import base64
import csv
import logging
import os
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill-vision")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))
sys.path.insert(0, str(REPO_ROOT / "mira-core" / "mira-ingest"))

from ingest.embedder import embed_image as _embed_image  # noqa: E402
from ingest.embedder import embed_text as _embed_text  # noqa: E402
from ingest_equipment_photos import _build_content_text  # noqa: E402

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

# ~$0.01/image for vision classification (not charged here — only embeddings)
EST_COST_PER_ROW = 0.002


def _load_survey(csv_path: Path) -> list[dict]:
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _find_photo(filename: str, photo_dir: Path) -> Path | None:
    for ext in ("", ".jpg", ".jpeg", ".png"):
        p = photo_dir / (filename + ext)
        if p.exists():
            return p
    # recursive search
    matches = list(photo_dir.rglob(filename))
    return matches[0] if matches else None


def _upsert_embedding(
    tenant_id: str,
    source_url: str,
    content: str,
    text_vec: list[float],
    image_vec: list[float] | None,
) -> bool:
    """Update existing knowledge_entries row or insert if missing. Returns True on success."""
    from db.neon import _engine
    from sqlalchemy import text as sa_text

    img_val = str(image_vec) if image_vec else None

    try:
        with _engine().connect() as conn:
            # Check if row exists
            count = (
                conn.execute(
                    sa_text(
                        "SELECT COUNT(*) FROM knowledge_entries "
                        "WHERE tenant_id = :tid AND source_url = :url AND source_page = 0"
                    ),
                    {"tid": tenant_id, "url": source_url},
                ).scalar()
                or 0
            )

            if count > 0:
                conn.execute(
                    sa_text("""
                    UPDATE knowledge_entries
                    SET content = :content,
                        embedding = cast(:emb AS vector),
                        image_embedding = cast(:img AS vector)
                    WHERE tenant_id = :tid AND source_url = :url AND source_page = 0
                """),
                    {
                        "content": content,
                        "emb": str(text_vec),
                        "img": img_val,
                        "tid": tenant_id,
                        "url": source_url,
                    },
                )
            else:
                import json
                import uuid

                conn.execute(
                    sa_text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, content, embedding,
                         image_embedding, source_url, source_page, metadata,
                         is_private, verified, chunk_type)
                    VALUES
                        (:id, :tid, 'equipment_photo', :content, cast(:emb AS vector),
                         cast(:img AS vector), :url, 0, cast(:meta AS jsonb),
                         false, false, 'text')
                """),
                    {
                        "id": str(uuid.uuid4()),
                        "tid": tenant_id,
                        "content": content,
                        "emb": str(text_vec),
                        "img": img_val,
                        "url": source_url,
                        "meta": json.dumps({"source": "backfill", "chunk_index": 0}),
                    },
                )
            conn.commit()
        return True
    except Exception as e:
        logger.error("Upsert failed for %s: %s", source_url, e)
        return False


def main():
    parser = argparse.ArgumentParser(description="Backfill vision embeddings from survey CSV")
    parser.add_argument("--survey", required=True, help="Path to survey_results.csv")
    parser.add_argument("--photo-dir", default="", help="Directory containing source photos")
    parser.add_argument(
        "--source-prefix",
        default="equipment_photo",
        help="Source URL prefix (default: equipment_photo)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would be re-embedded without writing"
    )
    parser.add_argument(
        "--max-cost", type=float, default=0, help="Stop if estimated cost exceeds this (0=no limit)"
    )
    parser.add_argument(
        "--checkpoint-dir", default="", help="Directory for checkpoint files (resume support)"
    )
    args = parser.parse_args()

    survey_path = Path(args.survey).expanduser()
    if not survey_path.exists():
        logger.error("Survey CSV not found: %s", survey_path)
        sys.exit(1)

    tenant_id = os.environ.get("MIRA_TENANT_ID")
    if not tenant_id and not args.dry_run:
        logger.error("MIRA_TENANT_ID not set.")
        sys.exit(1)

    photo_dir = Path(args.photo_dir).expanduser() if args.photo_dir else None

    rows = _load_survey(survey_path)
    candidates = [r for r in rows if r.get("mira_candidate", "").lower() == "yes"]
    logger.info("Survey rows: %d total, %d mira_candidate=yes", len(rows), len(candidates))

    # Checkpoint support
    checkpoint_path = None
    already_done: set[str] = set()
    if args.checkpoint_dir:
        cp_dir = Path(args.checkpoint_dir)
        cp_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = cp_dir / "backfill_checkpoint.txt"
        if checkpoint_path.exists():
            already_done = {
                ln.strip() for ln in checkpoint_path.read_text().splitlines() if ln.strip()
            }
            candidates = [r for r in candidates if r.get("filename", "") not in already_done]
            logger.info("Checkpoint: %d done, %d remaining", len(already_done), len(candidates))

    ok = skip = fail = 0
    est_cost = 0.0

    for i, row in enumerate(candidates):
        if args.max_cost > 0 and est_cost >= args.max_cost:
            logger.warning(
                "COST GUARD: $%.2f ≥ --max-cost $%.2f. Stopping.", est_cost, args.max_cost
            )
            break

        filename = row.get("filename") or row.get("photo_filename") or ""
        if not filename:
            skip += 1
            continue

        source_url = f"{args.source_prefix}://{filename}"

        # Build enriched content text using survey fields
        result_dict = {
            "equipment_type": row.get("equipment_type", "equipment"),
            "make": row.get("make"),
            "model": row.get("model"),
            "description": row.get("description"),
            "has_nameplate": bool(row.get("voltage") or row.get("amperage")),
            "nameplate_fields": {
                "voltage": row.get("voltage"),
                "amperage": row.get("amperage"),
                "rpm": row.get("rpm"),
                "hz": row.get("hz"),
                "hp": row.get("hp"),
            },
            "catalog": row.get("catalog"),
            "serial": row.get("serial"),
            "condition": row.get("condition"),
        }
        survey_extra = {
            "severity": row.get("severity"),
            "fault_codes": row.get("fault_codes"),
            "photo_type": row.get("photo_type"),
        }
        content = _build_content_text(result_dict, survey=survey_extra)

        if args.dry_run:
            print(f"\n[{i + 1}/{len(candidates)}] {filename}")
            print(content[:300])
            skip += 1
            continue

        logger.info("[%d/%d] Re-embedding: %s", i + 1, len(candidates), filename)

        text_vec = _embed_text(content, ollama_url=OLLAMA_URL, model=EMBED_MODEL)
        if text_vec is None:
            logger.warning("Text embed failed for %s — skipping", filename)
            fail += 1
            continue

        image_vec = None
        if photo_dir:
            photo_path = _find_photo(filename, photo_dir)
            if photo_path:
                raw = photo_path.read_bytes()
                b64 = base64.standard_b64encode(raw).decode()
                image_vec = _embed_image(b64, ollama_url=OLLAMA_URL)
                if image_vec is None:
                    logger.warning("Image embed failed for %s — storing NULL", filename)
            else:
                logger.warning("Photo not found: %s", filename)

        if _upsert_embedding(tenant_id, source_url, content, text_vec, image_vec):
            ok += 1
        else:
            fail += 1

        if checkpoint_path:
            with open(checkpoint_path, "a") as f:
                f.write(filename + "\n")

        est_cost += EST_COST_PER_ROW
        time.sleep(0.1)

    mode = " (DRY RUN)" if args.dry_run else ""
    print(f"\n{'=' * 50}")
    print(f"Backfill Vision Embeddings{mode}")
    print(f"{'=' * 50}")
    print(f"Candidates:  {len(candidates)}")
    print(f"Updated:     {ok}")
    print(f"Skipped:     {skip}")
    print(f"Failed:      {fail}")
    print(f"Est. cost:   ${est_cost:.2f}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
