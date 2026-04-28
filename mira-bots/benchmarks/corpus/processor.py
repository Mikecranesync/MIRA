"""Corpus processor — enrich raw scraped posts with extractor metadata.

Reads raw JSON files from corpus/raw/, runs all three extractors, then writes:
  - corpus/processed/questions.json      (all enriched posts)
  - corpus/processed/by_category/<cat>.json
  - corpus/processed/by_manufacturer/<mfr>.json

Usage:
    python corpus/processor.py
    python corpus/processor.py --raw-dir corpus/raw --out-dir corpus/processed
"""

from __future__ import annotations

import argparse
import json
import logging
from collections import Counter, defaultdict
from pathlib import Path

from extractors.classifier import classify
from extractors.equipment import extract_equipment, has_equipment_mention
from extractors.fault_codes import extract_fault_codes, has_fault_code

logger = logging.getLogger("corpus-processor")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

_RAW_DIR = Path(__file__).parent / "raw"
_OUT_DIR = Path(__file__).parent / "processed"


# ---------------------------------------------------------------------------
# Core enrichment
# ---------------------------------------------------------------------------


def enrich(post: dict) -> dict:
    text = f"{post.get('title', '')} {post.get('selftext', '')}"

    equip = extract_equipment(text)
    codes = extract_fault_codes(text)
    has_eq = has_equipment_mention(text)
    has_fc = has_fault_code(text)

    cl = classify(
        title=post.get("title", ""),
        body=post.get("selftext", ""),
        score=post.get("score", 0),
        has_equipment=has_eq,
        has_fault_code=has_fc,
    )

    return {
        **post,
        "category": cl.category,
        "urgency": cl.urgency,
        "quality_score": cl.quality_score,
        "quality_pass": cl.quality_pass,
        "quality_reasons": cl.reasons,
        "manufacturer": equip.manufacturer,
        "equipment_type": equip.equipment_type,
        "model_number": equip.model_number,
        "fault_codes": [
            {"code": fc.code, "manufacturer": fc.manufacturer, "description": fc.description}
            for fc in codes
        ],
    }


# ---------------------------------------------------------------------------
# Split writers
# ---------------------------------------------------------------------------


def _write_splits(
    posts: list[dict],
    out_dir: Path,
) -> None:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    by_mfr: dict[str, list[dict]] = defaultdict(list)

    for p in posts:
        by_cat[p["category"]].append(p)
        mfr = p.get("manufacturer") or "unknown"
        by_mfr[mfr].append(p)

    cat_dir = out_dir / "by_category"
    cat_dir.mkdir(parents=True, exist_ok=True)
    for cat, items in by_cat.items():
        (cat_dir / f"{cat}.json").write_text(json.dumps(items, indent=2))

    mfr_dir = out_dir / "by_manufacturer"
    mfr_dir.mkdir(parents=True, exist_ok=True)
    for mfr, items in by_mfr.items():
        safe_name = mfr.lower().replace(" ", "_").replace("/", "_").replace("-", "_")
        (mfr_dir / f"{safe_name}.json").write_text(json.dumps(items, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def process(raw_dir: Path = _RAW_DIR, out_dir: Path = _OUT_DIR) -> None:
    raw_files = sorted(raw_dir.glob("*.json"))
    if not raw_files:
        logger.warning("No raw JSON files found in %s", raw_dir)
        return

    all_posts: list[dict] = []
    for f in raw_files:
        posts = json.loads(f.read_text())
        logger.info("Processing %s (%d posts)…", f.name, len(posts))
        for post in posts:
            all_posts.append(enrich(post))

    # Deduplicate by post ID
    seen: set[str] = set()
    unique: list[dict] = []
    for p in all_posts:
        pid = p.get("id", "")
        if pid and pid not in seen:
            seen.add(pid)
            unique.append(p)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "questions.json").write_text(json.dumps(unique, indent=2))
    _write_splits(unique, out_dir)

    # Stats
    quality_pass = [p for p in unique if p.get("quality_pass")]
    cat_counts: Counter[str] = Counter(p["category"] for p in unique)
    urgency_counts: Counter[str] = Counter(p["urgency"] for p in unique)
    print(f"\n{'='*60}")
    print(f"Corpus stats — {len(unique)} posts ({len(quality_pass)} quality-pass)")
    print(f"{'='*60}")

    print("\nBy category:")
    for cat, n in cat_counts.most_common():
        print(f"  {cat:<25} {n:>4}")

    print("\nBy urgency:")
    for urg, n in urgency_counts.most_common():
        print(f"  {urg:<25} {n:>4}")

    print("\nTop manufacturers (quality-pass posts):")
    qp_mfr: Counter[str] = Counter(
        p.get("manufacturer") or "unknown"
        for p in quality_pass
        if p.get("manufacturer")
    )
    for mfr, n in qp_mfr.most_common(10):
        print(f"  {mfr:<25} {n:>4}")

    print(f"\nOutput: {out_dir / 'questions.json'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich raw corpus posts")
    parser.add_argument("--raw-dir", default=str(_RAW_DIR))
    parser.add_argument("--out-dir", default=str(_OUT_DIR))
    args = parser.parse_args()

    process(Path(args.raw_dir), Path(args.out_dir))
