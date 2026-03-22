#!/usr/bin/env python3
"""Google Photos Nameplate Ingest — pull industrial nameplate photos,
filter with Claude Vision, ingest into Regime 3 golden labels.

Usage:
    doppler run --project factorylm --config prd -- python tools/google_photos_ingest.py --dry-run
    doppler run --project factorylm --config prd -- python tools/google_photos_ingest.py --max-photos 50
    doppler run --project factorylm --config prd -- python tools/google_photos_ingest.py
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
logger = logging.getLogger("google-photos-ingest")

REPO_ROOT = Path(__file__).parent.parent
REGIME3_DIR = REPO_ROOT / "tests" / "regime3_nameplate"
PHOTOS_DIR = REGIME3_DIR / "photos" / "real"
LABELS_PATH = REGIME3_DIR / "golden_labels" / "v1" / "real_photos.json"
TEMP_DIR = Path("/tmp/nameplate_candidates")
LOW_CONF_DIR = TEMP_DIR / "low_confidence"

SCOPES = ["https://www.googleapis.com/auth/photoslibrary.readonly"]
TOKEN_PATH = Path.home() / ".config" / "factorylm" / "google_photos_token.json"

CLAUDE_MODEL = "claude-sonnet-4-20250514"

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


# ── Section 1: OAuth2 Auth ──────────────────────────────────────────────────


def get_credentials():
    """Load or create Google Photos OAuth2 credentials."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None

    # Load existing token
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    # Refresh or re-auth
    if creds and creds.expired and creds.refresh_token:
        logger.info("Refreshing expired token...")
        creds.refresh(Request())
    elif not creds or not creds.valid:
        client_id = os.environ.get("GOOGLE_CLIENT_ID")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
        if not client_id or not client_secret:
            logger.error(
                "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set. "
                "Run with: doppler run --project factorylm --config prd -- python %s",
                __file__,
            )
            sys.exit(1)

        client_config = {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": ["http://localhost"],
            }
        }
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        creds = flow.run_local_server(port=0)
        logger.info("OAuth2 consent completed.")

    # Save token
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    logger.info("Token saved to %s", TOKEN_PATH)

    return creds


def build_service(creds):
    """Build Google Photos API service."""
    from googleapiclient.discovery import build

    return build(
        "photoslibrary",
        "v1",
        credentials=creds,
        static_discovery=False,
    )


# ── Section 2: Fetch Candidates ─────────────────────────────────────────────


def fetch_candidates(service, max_results: int = 500) -> list[dict]:
    """Fetch candidate photos from Google Photos using content filter."""
    body = {
        "pageSize": min(100, max_results),
        "filters": {
            "contentFilter": {
                "includedContentCategories": ["DOCUMENTS", "UTILITY"],
                "excludedContentCategories": [
                    "SELFIES",
                    "PEOPLE",
                    "WEDDINGS",
                    "PETS",
                    "FOOD",
                    "ANIMALS",
                    "BIRTHDAYS",
                    "HOLIDAYS",
                ],
            },
            "mediaTypeFilter": {"mediaTypes": ["PHOTO"]},
        },
    }

    candidates = []
    page_token = None

    while len(candidates) < max_results:
        if page_token:
            body["pageToken"] = page_token

        response = service.mediaItems().search(body=body).execute()
        items = response.get("mediaItems", [])

        if not items:
            break

        for item in items:
            if len(candidates) >= max_results:
                break
            meta = item.get("mediaMetadata", {})
            candidates.append(
                {
                    "id": item["id"],
                    "filename": item.get("filename", "unknown"),
                    "baseUrl": item["baseUrl"],
                    "width": int(meta.get("width", 0)),
                    "height": int(meta.get("height", 0)),
                    "creationTime": meta.get("creationTime", ""),
                }
            )

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    logger.info("Fetched %d candidate photos", len(candidates))
    return candidates


def download_candidates(candidates: list[dict]) -> list[Path]:
    """Download candidate photos to temp directory."""
    import httpx

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    paths = []

    for i, c in enumerate(candidates):
        ext = Path(c["filename"]).suffix or ".jpg"
        dest = TEMP_DIR / f"candidate_{i:04d}{ext}"

        # Google Photos baseUrl needs dimension params to get actual image
        url = f"{c['baseUrl']}=w{c['width']}-h{c['height']}"
        try:
            resp = httpx.get(url, timeout=30)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            paths.append(dest)
        except Exception as e:
            logger.warning("Failed to download %s: %s", c["filename"], e)

        if (i + 1) % 50 == 0:
            logger.info("Downloaded %d/%d...", i + 1, len(candidates))

    logger.info("Downloaded %d photos to %s", len(paths), TEMP_DIR)
    return paths


# ── Section 3: Claude Vision Filter + Extract ────────────────────────────────


def classify_photo(photo_path: Path, client) -> dict:
    """Send photo to Claude Vision for nameplate classification + extraction."""
    photo_bytes = photo_path.read_bytes()
    photo_b64 = base64.standard_b64encode(photo_bytes).decode("utf-8")

    # Detect media type
    suffix = photo_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
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

    # Parse JSON — handle markdown code blocks
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse Claude response for %s: %s", photo_path.name, raw_text[:200])
        return {"is_nameplate": False, "parse_error": True}

    return result


def filter_with_vision(
    photo_paths: list[Path],
    include_low: bool = False,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Classify all photos with Claude Vision.

    Returns (confirmed, skipped, low_confidence).
    """
    import anthropic

    client = anthropic.Anthropic()
    confirmed = []
    skipped = []
    low_confidence = []

    for i, path in enumerate(photo_paths):
        logger.info(
            "Classifying %d/%d: %s", i + 1, len(photo_paths), path.name
        )

        result = classify_photo(path, client)

        if not result.get("is_nameplate"):
            skipped.append({"path": str(path), "result": result})
            continue

        confidence = result.get("confidence", "low")
        entry = {"path": str(path), "result": result}

        if confidence == "low" and not include_low:
            low_confidence.append(entry)
            # Save to low-confidence dir for manual review
            LOW_CONF_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, LOW_CONF_DIR / path.name)
        else:
            confirmed.append(entry)

        # Rate limit — 1 second between calls
        time.sleep(1.0)

        if (i + 1) % 25 == 0:
            logger.info(
                "Progress: %d classified, %d confirmed, %d skipped, %d low",
                i + 1,
                len(confirmed),
                len(skipped),
                len(low_confidence),
            )

    return confirmed, skipped, low_confidence


# ── Section 4: Ingest Confirmed Photos ───────────────────────────────────────


def _next_case_id(existing_cases: list[dict], equipment_type: str) -> str:
    """Generate next case ID like gp_motor_001."""
    prefix = f"gp_{equipment_type}_"
    existing_nums = []
    for c in existing_cases:
        cid = c.get("id", "")
        if cid.startswith(prefix):
            try:
                existing_nums.append(int(cid[len(prefix) :]))
            except ValueError:
                pass
    next_num = max(existing_nums, default=0) + 1
    return f"{prefix}{next_num:03d}"


def ingest_confirmed(confirmed: list[dict]) -> int:
    """Copy confirmed photos and append to real_photos.json."""
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing labels
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

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    added = 0

    for entry in confirmed:
        src_path = Path(entry["path"])
        result = entry["result"]

        equipment_type = result.get("equipment_type", "other")
        case_id = _next_case_id(data["cases"], equipment_type)

        # Copy photo
        ext = src_path.suffix or ".jpg"
        dest_filename = f"{case_id}{ext}"
        dest_path = PHOTOS_DIR / dest_filename
        shutil.copy2(src_path, dest_path)

        # Build relative image path from repo root
        rel_path = dest_path.relative_to(REPO_ROOT)

        # Build ground truth from Claude extraction
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
            "source": "google_photos",
            "date_ingested": today,
            "confidence": result.get("confidence", "medium"),
            "notes": "Auto-extracted via Claude Vision",
        }

        # Store extra fields in metadata
        extras = {}
        for key in ("hz", "hp", "readable_fields"):
            if result.get(key):
                extras[key] = result[key]
        if extras:
            case_entry["extras"] = extras

        data["cases"].append(case_entry)
        added += 1

    # Update status
    data["status"] = "ANNOTATED"
    if "project_context" not in data:
        data["source"] = "mixed — MACK RIDES electrical prints + Google Photos nameplates"

    # Write back
    with open(LABELS_PATH, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    logger.info("Added %d cases to %s", added, LABELS_PATH)
    return added


# ── Section 5: Summary Banner ────────────────────────────────────────────────


def print_banner(
    n_candidates: int,
    confirmed: list[dict],
    skipped: list[dict],
    low_confidence: list[dict],
) -> None:
    """Print ingest summary."""
    # Count equipment types
    type_counts: dict[str, int] = {}
    for entry in confirmed:
        eq_type = entry["result"].get("equipment_type", "other")
        type_counts[eq_type] = type_counts.get(eq_type, 0) + 1

    type_str = " | ".join(f"{t}: {c}" for t, c in sorted(type_counts.items()))

    print()
    print("=" * 50)
    print("Google Photos Nameplate Ingest")
    print("=" * 50)
    print(f"Candidates fetched:     {n_candidates:>4}")
    print(f"Confirmed nameplates:   {len(confirmed):>4}")
    print(f"Skipped (not nameplate):{len(skipped):>4}")
    print(f"Low confidence:         {len(low_confidence):>4}  (review recommended)")
    if type_str:
        print(f"Equipment types:")
        print(f"  {type_str}")
    print(f"Written to: {LABELS_PATH.relative_to(REPO_ROOT)}")
    print("=" * 50)
    print()


def print_dry_run_banner(candidates: list[dict]) -> None:
    """Print dry-run summary."""
    print()
    print("=" * 50)
    print("Google Photos Nameplate Ingest — DRY RUN")
    print("=" * 50)
    print(f"Candidates matching content filter: {len(candidates)}")
    print()
    for c in candidates[:10]:
        print(f"  {c['filename']:<40} {c['width']}x{c['height']}")
    if len(candidates) > 10:
        print(f"  ... and {len(candidates) - 10} more")
    print()
    print("No photos downloaded. No Claude Vision calls made.")
    print("Run without --dry-run to classify and ingest.")
    print("=" * 50)
    print()


# ── Section 6: CLI ───────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Google Photos Nameplate Ingest for MIRA Regime 3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  %(prog)s --dry-run              OAuth + count candidates only\n"
            "  %(prog)s --max-photos 10        Classify 10 photos\n"
            "  %(prog)s                        Full run (up to 500)\n"
            "  %(prog)s --review-low           Include low-confidence photos\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch candidates and count them — skip Vision API and ingest",
    )
    parser.add_argument(
        "--max-photos",
        type=int,
        default=500,
        help="Maximum candidate photos to fetch (default: 500)",
    )
    parser.add_argument(
        "--review-low",
        action="store_true",
        help="Also ingest low-confidence photos (tagged confidence: low)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(REGIME3_DIR),
        help=f"Output directory (default: {REGIME3_DIR})",
    )
    args = parser.parse_args()

    # Step 1: Auth
    logger.info("Authenticating with Google Photos...")
    creds = get_credentials()
    service = build_service(creds)
    logger.info("Authenticated successfully.")

    # Step 2: Fetch candidates
    candidates = fetch_candidates(service, max_results=args.max_photos)

    if not candidates:
        logger.warning("No candidate photos found matching content filter.")
        sys.exit(0)

    # Dry run — stop here
    if args.dry_run:
        print_dry_run_banner(candidates)
        sys.exit(0)

    # Step 3: Download
    photo_paths = download_candidates(candidates)

    if not photo_paths:
        logger.error("No photos downloaded successfully.")
        sys.exit(1)

    # Step 4: Claude Vision filter
    confirmed, skipped, low_confidence = filter_with_vision(
        photo_paths, include_low=args.review_low
    )

    # Step 5: Ingest
    if confirmed:
        ingest_confirmed(confirmed)
    else:
        logger.warning("No nameplates confirmed — nothing to ingest.")

    # Step 6: Banner
    print_banner(len(candidates), confirmed, skipped, low_confidence)

    # Clean up temp downloads (keep low-confidence for review)
    for p in photo_paths:
        if p.exists() and LOW_CONF_DIR not in p.parents:
            p.unlink()

    if confirmed:
        logger.info("Done. Run 'pytest tests/regime3_nameplate/ -v' to verify.")


if __name__ == "__main__":
    main()
