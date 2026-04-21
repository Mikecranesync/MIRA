#!/usr/bin/env python3
"""Blind categorization sweep of equipment photos.

Walks a directory of confirmed equipment photos, sends each to claude-haiku-4-5
for classification, and writes a CSV decision table. No database writes.

Usage:
    # Test run — 20 photos
    doppler run --project factorylm --config prd -- \\
        python3 mira-core/scripts/survey_equipment_photos.py --limit 20 --max-cost 0.10

    # Full sweep
    nohup doppler run --project factorylm --config prd -- \\
        python3 mira-core/scripts/survey_equipment_photos.py --max-cost 8.00 \\
        > /tmp/photo_survey.log 2>&1 &
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import anthropic

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("photo-survey")

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
EST_COST_PER_IMAGE = 0.002  # conservative estimate (actual ~$0.0001 with detail:low)
MAX_IMAGE_BYTES = 3_700_000

CSV_FIELDNAMES = [
    "filename",
    "album",
    "file_size_kb",
    "is_equipment",
    "photo_type",
    "equipment_type",
    "make",
    "model",
    "has_fault_code",
    "fault_codes",
    "condition",
    "severity",
    "confidence",
    "mira_candidate",
    "reject_reason",
    "one_line_summary",
    "parse_error",
    "raw_error",
    "processed_at",
]

SURVEY_PROMPT = """\
Examine this photo. Respond with ONLY a JSON object, no other text.
{
  "is_equipment": true or false,
  "photo_type": "nameplate|fault_event|installation|inspection|overview|repair|component|unknown",
  "equipment_type": "motor|pump|vfd|transformer|breaker|contactor|starter|panel|plc|wiring|conduit|relay|sensor|valve|compressor|generator|person|vehicle|facility|other|unknown",
  "make": "manufacturer name if ANY text is readable on a data plate or label, else null",
  "model": "model number if visible, else null",
  "has_fault_code": true or false,
  "fault_codes": ["any fault/error codes visible on display or labels — e.g. F002, OC1, E-11 — else empty list"],
  "condition": "normal|worn|damaged|fault_visible|end_of_life|unknown",
  "severity": 1,
  "confidence": "high|medium|low",
  "mira_candidate": "yes|maybe|no",
  "reject_reason": "if mira_candidate is no only: no_equipment|person_only|completely_obscured|zero_industrial_relevance|other — else null",
  "one_line_summary": "one sentence max describing what is shown"
}

mira_candidate rules:
- "yes"   = clearly identifiable equipment, good detail, OR partial view where
            equipment type is still recognizable (e.g. partial motor end bell,
            corner of a VFD with label fragment, single terminal block in focus)
- "maybe" = something equipment-related is present but too obscured, too far,
            or too dark to extract any useful identity or condition detail
- "no"    = no equipment at all (person only, blank wall, food, vehicle interior,
            random object with zero industrial relevance)
Key rule: if ANY industrial component is identifiable — even partially —
default to "yes" or "maybe". Reserve "no" strictly for photos with zero
equipment relevance. Partial is not worthless.

severity: 1=normal reference, 2=monitor, 3=schedule maintenance, 4=urgent, 5=safety hazard.
Return ONLY the JSON object."""


# ── Image Encoding ────────────────────────────────────────────────────────────


def _encode_image(photo_path: Path) -> tuple[str, str]:
    """Return (base64_str, media_type) for an image file, resizing if needed."""
    suffix = photo_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/jpeg",
    }

    raw_bytes = photo_path.read_bytes()

    # Fast path: small non-HEIC file
    if len(raw_bytes) <= MAX_IMAGE_BYTES and suffix not in (".heic",):
        return base64.standard_b64encode(raw_bytes).decode(), media_type_map.get(
            suffix, "image/jpeg"
        )

    # PIL resize path
    try:
        import io

        from PIL import Image

        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        except ImportError:
            pass

        img = Image.open(photo_path).convert("RGB")
        max_dim = 1536
        w, h = img.size
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        buf = io.BytesIO()
        quality = 85
        img.save(buf, format="JPEG", quality=quality)
        while buf.tell() > MAX_IMAGE_BYTES and quality > 40:
            quality -= 10
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)

        logger.debug(
            "Resized %s: %dKB → %dKB", photo_path.name, len(raw_bytes) // 1024, buf.tell() // 1024
        )
        return base64.standard_b64encode(buf.getvalue()).decode(), "image/jpeg"

    except ImportError:
        # PIL not available — send raw bytes and hope for the best
        logger.debug("PIL not available, sending raw bytes for %s", photo_path.name)
        return base64.standard_b64encode(raw_bytes).decode(), media_type_map.get(
            suffix, "image/jpeg"
        )


# ── Anthropic Call ────────────────────────────────────────────────────────────


def survey_photo(photo_path: Path, client: anthropic.Anthropic, model: str) -> dict:
    """Send photo to model for survey classification. Returns parsed result dict."""
    b64, media_type = _encode_image(photo_path)

    response = client.messages.create(
        model=model,
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": SURVEY_PROMPT},
                ],
            }
        ],
    )

    raw_text = response.content[0].text.strip()

    # Strip markdown code fences if present
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(raw_text)
        result["parse_error"] = False
        result["raw_error"] = ""
    except json.JSONDecodeError:
        result = {
            "parse_error": True,
            "raw_error": raw_text[:200],
            "is_equipment": None,
            "photo_type": "unknown",
            "equipment_type": "unknown",
            "make": None,
            "model": None,
            "has_fault_code": False,
            "fault_codes": [],
            "condition": "unknown",
            "severity": 1,
            "confidence": "low",
            "mira_candidate": "maybe",
            "reject_reason": None,
            "one_line_summary": "parse error",
        }

    return result


# ── CSV Writer ────────────────────────────────────────────────────────────────


def _write_row(writer: csv.DictWriter, f, photo_path: Path, result: dict) -> None:
    """Write one row to CSV and flush immediately."""
    fault_codes = result.get("fault_codes") or []
    row = {
        "filename": photo_path.name,
        "album": photo_path.parent.name,
        "file_size_kb": round(photo_path.stat().st_size / 1024, 1),
        "is_equipment": result.get("is_equipment"),
        "photo_type": result.get("photo_type", "unknown"),
        "equipment_type": result.get("equipment_type", "unknown"),
        "make": result.get("make") or "",
        "model": result.get("model") or "",
        "has_fault_code": result.get("has_fault_code", False),
        "fault_codes": "|".join(fault_codes) if fault_codes else "",
        "condition": result.get("condition", "unknown"),
        "severity": result.get("severity", 1),
        "confidence": result.get("confidence", "low"),
        "mira_candidate": result.get("mira_candidate", "maybe"),
        "reject_reason": result.get("reject_reason") or "",
        "one_line_summary": result.get("one_line_summary", ""),
        "parse_error": result.get("parse_error", False),
        "raw_error": result.get("raw_error", ""),
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }
    writer.writerow(row)
    f.flush()


# ── Summary Printing ──────────────────────────────────────────────────────────


def _print_summary(
    all_rows: list[dict],
    total_found: int,
    skipped: int,
    parse_errors: int,
    est_cost: float,
    output_csv: Path,
) -> None:
    processed = len(all_rows)
    candidates = defaultdict(int)
    photo_types = defaultdict(int)
    equip_types = defaultdict(int)
    makes = defaultdict(int)
    conditions = defaultdict(int)
    albums = defaultdict(int)
    reject_reasons = defaultdict(int)
    fault_code_count = 0
    all_fault_codes: list[str] = []
    fault_by_make: defaultdict[str, int] = defaultdict(int)

    for row in all_rows:
        cand = row.get("mira_candidate", "maybe")
        candidates[cand] += 1

        pt = row.get("photo_type", "unknown")
        photo_types[pt] += 1

        et = row.get("equipment_type", "unknown")
        equip_types[et] += 1

        make = row.get("make") or ""
        if make:
            makes[make] += 1

        conditions[row.get("condition", "unknown")] += 1
        albums[row.get("album", "")] += 1

        rr = row.get("reject_reason") or ""
        if rr:
            reject_reasons[rr] += 1

        codes_raw = row.get("fault_codes") or ""
        codes = [c for c in codes_raw.split("|") if c]
        if codes:
            fault_code_count += 1
            all_fault_codes.extend(codes)
            if make:
                fault_by_make[make] += len(codes)

    unique_codes = sorted(set(all_fault_codes))

    W = 47
    print()
    print("═" * W)
    print(" MIRA PHOTO SURVEY — RESULTS SUMMARY")
    print("═" * W)
    print(f"Total photos found:       {total_found:>6}")
    print(f"Photos processed:         {processed:>6}")
    print(f"Skipped (resume):         {skipped:>6}")
    print(f"Parse errors:             {parse_errors:>6}")
    print(f"Estimated cost:           ${est_cost:.2f}")

    print("── MIRA CANDIDATES ──")
    print(f"YES (ingest now):         {candidates['yes']:>6}")
    print(f"MAYBE (review):           {candidates['maybe']:>6}")
    print(f"NO  (discard):            {candidates['no']:>6}")

    print("── PHOTO TYPES ──")
    for pt, cnt in sorted(photo_types.items(), key=lambda x: -x[1]):
        if cnt > 0:
            print(f"  {pt:<24} {cnt}")

    print("── EQUIPMENT TYPES ──")
    for et, cnt in sorted(equip_types.items(), key=lambda x: -x[1])[:10]:
        print(f"  {et:<24} {cnt}")

    print("── MAKES IDENTIFIED ──")
    for mk, cnt in sorted(makes.items(), key=lambda x: -x[1])[:15]:
        print(f"  {mk:<30} {cnt}")

    print("── FAULT EVIDENCE ──")
    print(f"Photos with fault codes:  {fault_code_count:>6}")
    if unique_codes:
        print(f"Unique fault codes seen:  {', '.join(unique_codes)}")
    if fault_by_make:
        fault_str = ", ".join(
            f"{m}: {c}" for m, c in sorted(fault_by_make.items(), key=lambda x: -x[1])[:8]
        )
        print(f"Fault photos by make:     {fault_str}")

    print("── CONDITION DISTRIBUTION ──")
    for cond in ("normal", "worn", "damaged", "fault_visible", "end_of_life", "unknown"):
        cnt = conditions.get(cond, 0)
        print(f"  {cond:<20} {cnt}")

    print("── ALBUMS / FOLDERS ──")
    for album, cnt in sorted(albums.items(), key=lambda x: -x[1]):
        label = album or "(root)"
        print(f"  {label:<34} {cnt}")

    if reject_reasons:
        print("── REJECT REASONS ──")
        for rr, cnt in sorted(reject_reasons.items(), key=lambda x: -x[1]):
            print(f"  {rr:<30} {cnt}")

    print(f"Full results saved to: {output_csv}")
    print("═" * W)


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Blind photo survey — categorize without ingesting"
    )
    parser.add_argument(
        "--incoming-dir",
        type=str,
        default=str(Path.home() / "takeout_staging" / "ollama_confirmed"),
    )
    parser.add_argument(
        "--output-csv",
        type=str,
        default=str(Path.home() / "takeout_staging" / "survey_results.csv"),
    )
    parser.add_argument("--max-cost", type=float, default=5.00)
    parser.add_argument("--limit", type=int, default=0, help="Stop after N photos (0=no limit)")
    parser.add_argument("--model", type=str, default="claude-haiku-4-5-20251001")
    args = parser.parse_args()

    incoming = Path(args.incoming_dir).expanduser()
    output_csv = Path(args.output_csv).expanduser()

    if not incoming.exists():
        logger.error("Directory not found: %s", incoming)
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Discovery walk
    photos = sorted(
        p for p in incoming.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    total_found = len(photos)
    print(f"Found {total_found} photos in {incoming}")

    # Checkpoint resume
    already_done: set[str] = set()
    existing_rows: list[dict] = []
    if output_csv.exists():
        with open(output_csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                already_done.add(row["filename"])
                existing_rows.append(row)
        photos = [p for p in photos if p.name not in already_done]
        print(f"Resuming: {len(already_done)} done, {len(photos)} remaining")
    else:
        print("Starting fresh survey")

    if args.limit > 0:
        photos = photos[: args.limit]
        print(f"--limit {args.limit}: processing {len(photos)} photos")

    if not photos:
        print("Nothing to process.")
        _print_summary(existing_rows, total_found, len(already_done), 0, 0.0, output_csv)
        return

    # Open CSV for append (or create with header)
    write_header = not output_csv.exists()
    csv_file = open(output_csv, "a", newline="", encoding="utf-8")  # noqa: SIM115
    writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDNAMES)
    if write_header:
        writer.writeheader()
        csv_file.flush()

    est_cost = 0.0
    parse_errors = 0
    new_rows: list[dict] = []

    try:
        for i, photo in enumerate(photos):
            # Cost guard
            if args.max_cost > 0 and est_cost >= args.max_cost:
                logger.warning(
                    "COST GUARD: $%.3f exceeds --max-cost $%.2f — stopping.",
                    est_cost,
                    args.max_cost,
                )
                break

            try:
                result = survey_photo(photo, client, args.model)
            except Exception as e:
                logger.warning("API error for %s: %s", photo.name, e)
                result = {
                    "parse_error": True,
                    "raw_error": str(e)[:200],
                    "is_equipment": None,
                    "photo_type": "unknown",
                    "equipment_type": "unknown",
                    "make": None,
                    "model": None,
                    "has_fault_code": False,
                    "fault_codes": [],
                    "condition": "unknown",
                    "severity": 1,
                    "confidence": "low",
                    "mira_candidate": "maybe",
                    "reject_reason": None,
                    "one_line_summary": f"error: {str(e)[:80]}",
                }
                if "429" in str(e) or "rate" in str(e).lower():
                    wait = min(60, 2 ** min(parse_errors, 5))
                    logger.warning("Rate limited — waiting %ds", wait)
                    time.sleep(wait)

            if result.get("parse_error"):
                parse_errors += 1

            _write_row(writer, csv_file, photo, result)

            row_dict = {
                "filename": photo.name,
                "album": photo.parent.name,
                "mira_candidate": result.get("mira_candidate", "maybe"),
                "photo_type": result.get("photo_type", "unknown"),
                "equipment_type": result.get("equipment_type", "unknown"),
                "make": result.get("make") or "",
                "model": result.get("model") or "",
                "has_fault_code": result.get("has_fault_code", False),
                "fault_codes": "|".join(result.get("fault_codes") or []),
                "condition": result.get("condition", "unknown"),
                "severity": result.get("severity", 1),
                "confidence": result.get("confidence", "low"),
                "reject_reason": result.get("reject_reason") or "",
                "one_line_summary": result.get("one_line_summary", ""),
                "parse_error": result.get("parse_error", False),
            }
            new_rows.append(row_dict)
            est_cost += EST_COST_PER_IMAGE

            # Progress every 25 photos
            if (i + 1) % 25 == 0 or (i + 1) == len(photos):
                cand = result.get("mira_candidate", "?")
                pt = result.get("photo_type", "?")
                make = result.get("make") or "?"
                n_done = len(already_done) + i + 1
                print(
                    f"  [{n_done}/{total_found}] album={photo.parent.name} "
                    f"type={pt} make={make} candidate={cand}"
                )

            time.sleep(1.0)

    finally:
        csv_file.close()

    _print_summary(
        existing_rows + new_rows,
        total_found,
        len(already_done),
        parse_errors,
        est_cost,
        output_csv,
    )


if __name__ == "__main__":
    main()
