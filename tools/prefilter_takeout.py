#!/usr/bin/env python3
"""Google Takeout photo pre-filter for MIRA industrial knowledge base.

Walks ~/takeout_staging/extracted/ and uses JSON sidecar metadata to decide
whether each photo is industrial/equipment-related (PASS) or personal (REJECT).

Passing photos are copied to ~/takeout_staging/filtered/.
All results logged to ~/takeout_staging/prefilter_results.csv.

Usage:
    python3 ~/takeout_staging/prefilter.py --dry-run   # report only, no copies
    python3 ~/takeout_staging/prefilter.py             # copy passing photos
    python3 ~/takeout_staging/prefilter.py --extracted-dir /path/to/extracted
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_EXTRACTED = Path.home() / "takeout_staging" / "extracted"
DEFAULT_FILTERED  = Path.home() / "takeout_staging" / "filtered"
DEFAULT_CSV       = Path.home() / "takeout_staging" / "prefilter_results.csv"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

# Keywords that signal industrial / equipment content.
# Checked case-insensitively as substrings against filename, title,
# description, and album name.
PASS_KEYWORDS: set[str] = {
    "equipment", "maintenance", "repair", "motor", "pump", "panel",
    "conveyor", "machine", "plant", "facility", "nameplate", "asset",
    "work order", "job", "fault", "failure", "electrical", "hvac",
    "compressor", "vfd", "drive", "inverter", "plc", "breaker",
    "transformer", "contactor", "starter", "wiring", "switchgear",
    "generator", "bearing", "gearbox", "coupling", "sensor", "valve",
    "industrial", "factory", "warehouse", "shop floor", "control panel",
    "junction box", "terminal", "relay", "overload", "conduit",
    "motor starter", "variable frequency", "nameplate", "data plate",
    "tag plate", "serial number", "model number", "hp rating",
    "voltage rating", "ampere", "rpm", "hertz",
    # Common equipment brand names that appear in photo titles
    "allen-bradley", "allen bradley", "siemens", "schneider", "square d",
    "eaton", "cutler-hammer", "abb", "automationdirect", "yaskawa",
    "danfoss", "mitsubishi", "fanuc", "omron", "rockwell", "ge motor",
    "baldor", "leeson", "marathon", "us motors", "nema",
    # Maintenance context words
    "work order", "wo#", "wo #", "pm ", "cm ", "corrective",
    "preventive", "lubrication", "vibration", "alignment", "inspection",
}

# Keywords that strongly indicate personal / non-industrial content.
# If any of these match in the ALBUM name, the photo is rejected outright.
REJECT_ALBUM_KEYWORDS: set[str] = {
    "vacation", "holiday", "birthday", "wedding", "party", "family",
    "friends", "travel", "trip", "beach", "food", "restaurant",
    "selfie", "portrait", "graduation", "baby", "kids", "children",
    "christmas", "thanksgiving", "halloween", "easter", "new year",
    "anniversary", "engagement", "honeymoon", "concert", "sports",
    "pets", "animals", "dog", "cat",
}


# ---------------------------------------------------------------------------
# Sidecar helpers
# ---------------------------------------------------------------------------

def find_sidecar(image_path: Path) -> Path | None:
    """Locate the Google Takeout JSON sidecar for an image.

    Takeout uses several naming conventions depending on export version:
      Old format:  photo.jpg  → photo.jpg.json
      New format:  photo.jpg  → photo.jpg.supplemental-metadata.json
      Truncated:   photo.jpg  → photo.jpg.supplemental-me.json  (long filenames)
      Stem-only:   photo.jpg  → photo.json  (rare)

    For very long filenames the entire sidecar name is limited to ~51 chars,
    so the photo name itself gets truncated before the suffix is appended.
    """
    name = image_path.name

    # Convention 1: photo.jpg.json  (old export format)
    c = image_path.parent / (name + ".json")
    if c.exists():
        return c

    # Convention 2: photo.jpg.supplemental-metadata.json  (new export format)
    c = image_path.parent / (name + ".supplemental-metadata.json")
    if c.exists():
        return c

    # Convention 3: photo.jpg.supplemental-me.json  (new format, long filenames)
    c = image_path.parent / (name + ".supplemental-me.json")
    if c.exists():
        return c

    # Convention 4: photo.json  (stem-only, rare)
    c = image_path.parent / (image_path.stem + ".json")
    if c.exists():
        return c

    # Convention 5: truncated name — scan siblings for any .json starting
    # with first 20 chars of the photo filename (conservative match)
    prefix = name[:20]
    for sibling in image_path.parent.iterdir():
        if sibling.suffix == ".json" and sibling.name.startswith(prefix):
            return sibling

    return None


def parse_sidecar(sidecar_path: Path) -> dict[str, str]:
    """Parse a Takeout JSON sidecar and return normalised metadata.

    Returns dict with keys: title, description, album, device_folder.

    Note: Newer Takeout exports do NOT include albumData.title in the JSON.
    The album name is the parent directory in the Takeout zip structure.
    """
    try:
        data = json.loads(sidecar_path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {"title": "", "description": "", "album": "", "device_folder": ""}

    title       = str(data.get("title", "") or "")
    description = str(data.get("description", "") or "")

    # albumData.title is present in some older Takeout exports
    album_data = data.get("albumData", {}) or {}
    album      = str(album_data.get("title", "") or "")

    # Fallback 1: parent directory name (the Google Photos album name)
    if not album:
        album = sidecar_path.parent.name

    # Device folder name (e.g. "Whatsapp pics", "Camera") — useful reject signal
    origin = data.get("googlePhotosOrigin", {}) or {}
    mobile = origin.get("mobileUpload", {}) or {}
    device_folder = str((mobile.get("deviceFolder") or {}).get("localFolderName", "") or "")

    return {
        "title": title,
        "description": description,
        "album": album,
        "device_folder": device_folder,
    }


# ---------------------------------------------------------------------------
# Keyword matching
# ---------------------------------------------------------------------------

def _has_keyword(text: str, keywords: set[str]) -> tuple[bool, str]:
    """Return (matched, keyword) — case-insensitive substring search."""
    lower = text.lower()
    for kw in sorted(keywords):   # sorted for deterministic output
        if kw in lower:
            return True, kw
    return False, ""


def check_photo(image_path: Path) -> tuple[bool, str, dict[str, str]]:
    """Decide PASS/REJECT for a single image.

    Returns (passed: bool, reject_reason: str, metadata: dict).
    reject_reason is '' when passed=True.
    metadata keys: title, description, album.
    """
    sidecar = find_sidecar(image_path)

    if sidecar:
        meta = parse_sidecar(sidecar)
    else:
        # No sidecar — fall back to filename + parent dir name
        meta = {
            "title":         image_path.name,
            "description":   "",
            "album":         image_path.parent.name,
            "device_folder": "",
        }

    # --- Reject gate: album name is explicitly personal ---
    album_matched, album_kw = _has_keyword(meta["album"], REJECT_ALBUM_KEYWORDS)
    if album_matched:
        return False, f"reject_album:{album_kw}", meta

    # --- Pass gate: any field contains an industrial keyword ---
    combined = " ".join([
        image_path.name,
        meta["title"],
        meta["description"],
        meta["album"],
        meta.get("device_folder", ""),
    ])
    pass_matched, pass_kw = _has_keyword(combined, PASS_KEYWORDS)
    if pass_matched:
        return True, "", meta

    # --- Default: no industrial signal → reject ---
    return False, "no_industrial_keyword", meta


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pre-filter Google Takeout photos for MIRA industrial KB ingest",
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
        help=f"CSV log path (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report counts without copying any files",
    )
    args = parser.parse_args()

    extracted_dir = Path(args.extracted_dir)
    filtered_dir  = Path(args.filtered_dir)
    csv_path      = Path(args.csv_out)

    if not extracted_dir.exists():
        print(f"ERROR: extracted-dir does not exist: {extracted_dir}", file=sys.stderr)
        sys.exit(1)

    if not args.dry_run:
        filtered_dir.mkdir(parents=True, exist_ok=True)

    # --- Collect all image files ---
    all_images: list[Path] = [
        p for p in extracted_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]

    if not all_images:
        print(f"No image files found in {extracted_dir}")
        print("(The extracted directory may be empty or contain no supported images.)")
        print("Supported extensions:", ", ".join(sorted(IMAGE_EXTENSIONS)))
        sys.exit(0)

    # --- Filter + write CSV ---
    pass_count   = 0
    reject_count = 0
    rows: list[dict] = []

    for image_path in sorted(all_images):
        passed, reject_reason, meta = check_photo(image_path)

        rows.append({
            "original_path":  str(image_path),
            "album":          meta["album"],
            "title":          meta["title"],
            "description":    meta["description"][:200],   # truncate long descriptions
            "device_folder":  meta.get("device_folder", ""),
            "passed":         str(passed),
            "reject_reason":  reject_reason,
        })

        if passed:
            pass_count += 1
            if not args.dry_run:
                dest = filtered_dir / image_path.name
                # Handle name collisions by appending parent dir prefix
                if dest.exists():
                    dest = filtered_dir / f"{image_path.parent.name}__{image_path.name}"
                shutil.copy2(image_path, dest)
        else:
            reject_count += 1

    # Write CSV (always — useful even in dry-run)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["original_path", "album", "title", "description", "device_folder", "passed", "reject_reason"],
        )
        writer.writeheader()
        writer.writerows(rows)

    # --- Summary banner ---
    total      = len(all_images)
    pass_rate  = (pass_count / total * 100) if total else 0.0
    mode_label = " [DRY RUN]" if args.dry_run else ""

    print()
    print("=" * 55)
    print(f"MIRA Photo Pre-Filter{mode_label}")
    print("=" * 55)
    print(f"Source dir:            {extracted_dir}")
    print(f"Total images found:    {total:>6,}")
    print(f"{'Would pass:' if args.dry_run else 'Passed:':22s} {pass_count:>6,}")
    print(f"{'Would reject:' if args.dry_run else 'Rejected:':22s} {reject_count:>6,}")
    print(f"Pass rate:             {pass_rate:>5.1f}%")
    print(f"CSV written to:        {csv_path}")
    if not args.dry_run:
        print(f"Filtered photos dir:   {filtered_dir}")
    print("=" * 55)


if __name__ == "__main__":
    main()
