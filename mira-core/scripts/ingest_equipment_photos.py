#!/usr/bin/env python3
"""Ingest equipment photos into MIRA knowledge base.

Accepts ALL equipment photos (not just nameplates). Classifies each with
Claude Vision, generates real embeddings via Ollama, inserts into NeonDB,
and triggers automatic manual discovery for identified make/model pairs.

Usage:
    # Dry run — classify but don't write
    ANTHROPIC_API_KEY=... python3 ingest_equipment_photos.py --dry-run \
        --incoming-dir ~/takeout_staging/dry_run_sample

    # Full run with quality inspection
    ANTHROPIC_API_KEY=... python3 ingest_equipment_photos.py \
        --incoming-dir ~/takeout_staging/ollama_confirmed \
        --source-prefix takeout --no-move --inspect

    # With cost guard
    ANTHROPIC_API_KEY=... python3 ingest_equipment_photos.py \
        --incoming-dir ~/takeout_staging/ollama_confirmed \
        --max-cost 50 --inspect
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import logging
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("equipment-ingest")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INCOMING = REPO_ROOT / "mira-core" / "data" / "equipment_photos" / "incoming"
PROCESSED = REPO_ROOT / "mira-core" / "data" / "equipment_photos" / "processed"
REGIME3_DIR = REPO_ROOT / "tests" / "regime3_nameplate"
PHOTOS_DIR = REGIME3_DIR / "photos" / "real"
LABELS_PATH = REGIME3_DIR / "golden_labels" / "v1" / "real_photos.json"

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic"}

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

# Rough cost estimate per Claude Vision call (Sonnet input tokens for image)
EST_COST_PER_IMAGE = 0.01

# ── Vision Prompt (accepts ALL equipment, not just nameplates) ───────────────

VISION_PROMPT = """\
Examine this photo. Is this industrial equipment, machinery, an electrical \
component, a control panel, wiring, or maintenance/repair work?

If YES — identify the equipment and return JSON:
{
  "is_equipment": true,
  "equipment_type": "motor|pump|vfd|transformer|breaker|contactor|starter|panel|plc|wiring|conduit|junction_box|relay|sensor|valve|compressor|generator|other",
  "make": "manufacturer name if visible, else null",
  "model": "model number if visible, else null",
  "catalog": "catalog number if visible, else null",
  "serial": "serial number if visible, else null",
  "has_nameplate": true or false,
  "nameplate_fields": {
    "voltage": "if visible",
    "amperage": "if visible",
    "rpm": "if visible",
    "hz": "if visible",
    "hp": "if visible"
  },
  "description": "Brief 1-2 sentence description of what is shown in the photo",
  "condition": "normal|damaged|fault_visible|unknown",
  "confidence": "high|medium|low"
}

If NO (this is not industrial equipment) — respond only:
{"is_equipment": false}

Respond with ONLY the JSON object, no other text."""

VERIFY_PROMPT_TEMPLATE = """\
A previous analysis said this photo shows: {description}
Equipment type: {equipment_type}, Make: {make}, Model: {model}

Look at this photo and answer with ONLY one of: AGREE, DISAGREE, or UNSURE.
If DISAGREE, add a brief explanation after a pipe character.
Example: DISAGREE | This is actually a residential HVAC unit, not industrial equipment."""


# ── Image Handling ───────────────────────────────────────────────────────────

MAX_IMAGE_BYTES = 3_700_000  # 5MB base64 limit ÷ 1.33 encoding overhead


def _resize_for_claude(photo_path: Path) -> tuple[bytes, str]:
    """Load photo, resize if >5MB or HEIC, return (jpeg_bytes, media_type)."""
    from PIL import Image

    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass

    suffix = photo_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".heic": "image/jpeg",
    }

    raw_bytes = photo_path.read_bytes()

    if len(raw_bytes) <= MAX_IMAGE_BYTES and suffix not in (".heic",):
        return raw_bytes, media_type_map.get(suffix, "image/jpeg")

    import io
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

    logger.info("Resized %s: %dKB → %dKB (q=%d)",
                photo_path.name, len(raw_bytes) // 1024, buf.tell() // 1024, quality)
    return buf.getvalue(), "image/jpeg"


# ── Claude Vision ────────────────────────────────────────────────────────────

def _call_claude_vision(photo_b64: str, media_type: str, prompt: str, client) -> str:
    """Send image + prompt to Claude, return raw text response."""
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": photo_b64}},
                {"type": "text", "text": prompt},
            ],
        }],
    )
    return response.content[0].text.strip()


def classify_photo(photo_path: Path, client) -> dict:
    """Send photo to Claude Vision for equipment identification."""
    photo_bytes, media_type = _resize_for_claude(photo_path)
    photo_b64 = base64.standard_b64encode(photo_bytes).decode("utf-8")

    raw_text = _call_claude_vision(photo_b64, media_type, VISION_PROMPT, client)

    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse Claude response for %s: %s", photo_path.name, raw_text[:200])
        return {"is_equipment": False, "parse_error": True}

    # Store the base64 for potential verification call
    result["_photo_b64"] = photo_b64
    result["_media_type"] = media_type
    return result


def verify_classification(result: dict, client) -> str:
    """Spot-check: ask Claude to verify a previous classification. Returns AGREE/DISAGREE/UNSURE."""
    photo_b64 = result.get("_photo_b64", "")
    media_type = result.get("_media_type", "image/jpeg")
    if not photo_b64:
        return "SKIP"

    prompt = VERIFY_PROMPT_TEMPLATE.format(
        description=result.get("description", "unknown"),
        equipment_type=result.get("equipment_type", "unknown"),
        make=result.get("make") or "unknown",
        model=result.get("model") or "unknown",
    )

    try:
        raw = _call_claude_vision(photo_b64, media_type, prompt, client)
        verdict = raw.strip().split("|")[0].strip().upper()
        if verdict in ("AGREE", "DISAGREE", "UNSURE"):
            return raw.strip()
        return f"UNSURE | unparseable: {raw[:80]}"
    except Exception as e:
        logger.warning("Verification call failed: %s", e)
        return f"ERROR | {e}"


# ── Embeddings ───────────────────────────────────────────────────────────────

def _embed_text(text: str) -> list[float]:
    """Generate real embedding via Ollama nomic-embed-text."""
    try:
        resp = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        # Ollama /api/embeddings returns {"embedding": [...]}
        return data["embedding"]
    except Exception as e:
        logger.warning("Embedding failed (using placeholder): %s", e)
        return [0.0] * 768  # nomic-embed-text is 768-dim


def _build_content_text(result: dict) -> str:
    """Build rich text content for NeonDB from classification result."""
    parts = []

    eq_type = result.get("equipment_type", "equipment")
    make = result.get("make")
    model = result.get("model")

    # Header
    header = eq_type.replace("_", " ").title()
    if make:
        header = f"{make} {header}"
    if model:
        header += f" {model}"
    parts.append(header)

    # Description
    desc = result.get("description")
    if desc:
        parts.append(desc)

    # Nameplate fields
    if result.get("has_nameplate"):
        np = result.get("nameplate_fields", {})
        np_parts = []
        for key in ("voltage", "amperage", "rpm", "hz", "hp"):
            val = np.get(key)
            if val:
                np_parts.append(f"{key}: {val}")
        if np_parts:
            parts.append("Nameplate: " + ", ".join(np_parts))

    # Catalog / serial
    for key in ("catalog", "serial"):
        val = result.get(key)
        if val:
            parts.append(f"{key}: {val}")

    # Condition
    condition = result.get("condition")
    if condition and condition != "unknown":
        parts.append(f"Condition: {condition}")

    return ". ".join(parts)


# ── NeonDB Insert ────────────────────────────────────────────────────────────

def insert_to_neondb(
    result: dict, photo_path: Path, tenant_id: str,
    source_prefix: str = "equipment_photo",
) -> str | None:
    """Insert equipment photo knowledge entry with real embedding."""
    sys.path.insert(0, str(REPO_ROOT / "mira-core" / "mira-ingest"))
    from db.neon import insert_knowledge_entry, knowledge_entry_exists

    source_url = f"{source_prefix}://{photo_path.name}"

    if knowledge_entry_exists(tenant_id, source_url, 0):
        logger.info("Already ingested: %s (skipping)", photo_path.name)
        return None

    content = _build_content_text(result)
    embedding = _embed_text(content)

    equipment_type = result.get("equipment_type", "other")

    metadata = {
        "has_nameplate": result.get("has_nameplate", False),
        "condition": result.get("condition", "unknown"),
        "confidence": result.get("confidence", "low"),
    }
    if result.get("has_nameplate") and result.get("nameplate_fields"):
        metadata["nameplate_fields"] = result["nameplate_fields"]

    entry_id = insert_knowledge_entry(
        tenant_id=tenant_id,
        content=content,
        embedding=embedding,
        manufacturer=result.get("make"),
        model_number=result.get("model"),
        source_url=source_url,
        chunk_index=0,
        page_num=None,
        section=equipment_type,
        source_type="equipment_photo",
    )

    logger.info("Inserted knowledge entry %s for %s", entry_id, photo_path.name)
    return entry_id


# ── Manual Discovery ─────────────────────────────────────────────────────────

# Known manufacturer URL patterns for targeted manual lookup
MANUFACTURER_MANUAL_URLS: dict[str, str] = {
    "rockwell": "https://literature.rockwellautomation.com",
    "allen-bradley": "https://literature.rockwellautomation.com",
    "allen bradley": "https://literature.rockwellautomation.com",
    "siemens": "https://support.industry.siemens.com",
    "abb": "https://library.e.abb.com",
    "schneider": "https://download.schneider-electric.com",
    "square d": "https://download.schneider-electric.com",
    "mitsubishi": "https://dl.mitsubishielectric.com",
    "eaton": "https://www.eaton.com/us/en-us/catalog",
    "cutler-hammer": "https://www.eaton.com/us/en-us/catalog",
    "automationdirect": "https://library.automationdirect.com",
    "yaskawa": "https://www.yaskawa.com/downloads",
    "danfoss": "https://www.danfoss.com/en/service-and-support",
}


def trigger_manual_discovery(
    result: dict, tenant_id: str, dry_run: bool = False,
    discovered_models: set | None = None,
) -> bool:
    """If make+model identified, queue manual URL for ingest. Returns True if queued."""
    make = result.get("make")
    model = result.get("model")
    if not make or not model:
        return False

    # Dedup within this batch
    key = f"{make}|{model}".lower()
    if discovered_models is not None:
        if key in discovered_models:
            return False
        discovered_models.add(key)

    if dry_run:
        logger.info("  MANUAL DISCOVERY (dry): would search for %s %s manual", make, model)
        return True

    try:
        sys.path.insert(0, str(REPO_ROOT / "mira-core" / "mira-ingest"))
        from db.neon import manual_exists_for, queue_manual_url

        if manual_exists_for(make, model, tenant_id):
            logger.info("  Manual already in KB for %s %s", make, model)
            return False

        # Construct search URL based on known manufacturer patterns
        make_lower = make.lower()
        base_url = None
        for mfr_key, url in MANUFACTURER_MANUAL_URLS.items():
            if mfr_key in make_lower:
                base_url = url
                break

        # Queue for ingest
        search_url = f"{base_url}/search?q={model}" if base_url else f"https://www.google.com/search?q={make}+{model}+user+manual+filetype:pdf"
        queue_manual_url(search_url, make, model, tenant_id)
        logger.info("  MANUAL QUEUED: %s %s → %s", make, model, search_url)
        return True

    except ImportError:
        logger.warning("manual_exists_for/queue_manual_url not available in neon.py — skipping manual discovery")
        return False
    except Exception as e:
        logger.warning("Manual discovery failed for %s %s: %s", make, model, e)
        return False


# ── Regime 3 Golden Labels ───────────────────────────────────────────────────

def _next_case_id(existing_cases: list[dict], equipment_type: str) -> str:
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
    """Copy photo to Regime 3 and append to real_photos.json (nameplates only)."""
    if not result.get("has_nameplate"):
        return None

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    if LABELS_PATH.exists():
        with open(LABELS_PATH) as f:
            data = json.load(f)
    else:
        data = {"description": "Ground truth labels for real equipment photos",
                "source": "mixed", "status": "ANNOTATED", "cases": []}

    equipment_type = result.get("equipment_type", "other")
    case_id = _next_case_id(data["cases"], equipment_type)

    ext = photo_path.suffix or ".jpg"
    dest_filename = f"{case_id}{ext}"
    dest_path = PHOTOS_DIR / dest_filename
    shutil.copy2(photo_path, dest_path)

    rel_path = dest_path.relative_to(REPO_ROOT)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    np = result.get("nameplate_fields", {})
    ground_truth = {
        "classification": "EQUIPMENT_PHOTO",
        "make": result.get("make"),
        "model": result.get("model"),
        "catalog": result.get("catalog"),
        "serial": result.get("serial"),
        "voltage": np.get("voltage"),
        "amperage": np.get("amperage"),
        "rpm": np.get("rpm"),
        "component_type": equipment_type,
    }

    case_entry = {
        "id": case_id,
        "image": str(rel_path).replace("\\", "/"),
        "ground_truth": ground_truth,
        "source": "takeout_ingest",
        "date_ingested": today,
        "confidence": result.get("confidence", "medium"),
        "notes": f"Auto-extracted via Claude Vision. Condition: {result.get('condition', 'unknown')}",
    }

    extras = {}
    for key in ("hz", "hp"):
        val = np.get(key)
        if val:
            extras[key] = val
    if result.get("description"):
        extras["description"] = result["description"]
    if extras:
        case_entry["extras"] = extras

    data["cases"].append(case_entry)
    data["status"] = "ANNOTATED"

    with open(LABELS_PATH, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    logger.info("Added golden label %s for %s", case_id, photo_path.name)
    return case_id


# ── Monitoring Dashboard ─────────────────────────────────────────────────────

class IngestMonitor:
    """Tracks stats and prints dashboard during batch ingest."""

    def __init__(self):
        self.type_counts: dict[str, int] = {}
        self.make_counts: dict[str, int] = {}
        self.confidence_counts: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
        self.nameplate_count = 0
        self.equipment_count = 0
        self.not_equipment_count = 0
        self.error_count = 0
        self.manuals_queued = 0
        self.embeddings_ok = 0
        self.verify_agree = 0
        self.verify_disagree = 0
        self.verify_total = 0
        self.est_cost = 0.0

    def record(self, result: dict, verified: str | None = None, manual_queued: bool = False):
        if result.get("is_equipment"):
            self.equipment_count += 1
            eq_type = result.get("equipment_type", "other")
            self.type_counts[eq_type] = self.type_counts.get(eq_type, 0) + 1

            make = result.get("make") or "unknown"
            self.make_counts[make] = self.make_counts.get(make, 0) + 1

            conf = result.get("confidence", "low")
            self.confidence_counts[conf] = self.confidence_counts.get(conf, 0) + 1

            if result.get("has_nameplate"):
                self.nameplate_count += 1
        elif result.get("parse_error"):
            self.error_count += 1
        else:
            self.not_equipment_count += 1

        self.est_cost += EST_COST_PER_IMAGE

        if verified:
            self.verify_total += 1
            if verified.startswith("AGREE"):
                self.verify_agree += 1
            elif verified.startswith("DISAGREE"):
                self.verify_disagree += 1
                self.est_cost += EST_COST_PER_IMAGE  # verification call

        if manual_queued:
            self.manuals_queued += 1

    def print_dashboard(self, current: int, total: int):
        processed = self.equipment_count + self.not_equipment_count + self.error_count
        top_types = sorted(self.type_counts.items(), key=lambda x: -x[1])[:6]
        top_makes = sorted(self.make_counts.items(), key=lambda x: -x[1])[:5]

        types_str = " ".join(f"{t}={c}" for t, c in top_types)
        makes_str = " ".join(f"{m}={c}" for m, c in top_makes)
        verify_str = (f"{self.verify_agree}/{self.verify_total} agree"
                      if self.verify_total > 0 else "n/a")

        print(f"\n{'='*60}")
        print(f"Ingest Monitor ({current}/{total})")
        print(f"{'='*60}")
        print(f"Equipment:     {self.equipment_count}  |  Not equipment: {self.not_equipment_count}  |  Errors: {self.error_count}")
        print(f"Types:         {types_str}")
        print(f"Manufacturers: {makes_str}")
        print(f"Confidence:    high={self.confidence_counts['high']} med={self.confidence_counts['medium']} low={self.confidence_counts['low']}")
        print(f"Has nameplate: {self.nameplate_count}/{self.equipment_count} ({self.nameplate_count/max(self.equipment_count,1)*100:.0f}%)")
        print(f"Spot-check:    {verify_str}")
        print(f"Manuals queued:{self.manuals_queued}")
        print(f"Est. cost:     ${self.est_cost:.2f}")
        print(f"{'='*60}\n")

    @property
    def disagree_rate(self) -> float:
        if self.verify_total == 0:
            return 0.0
        return self.verify_disagree / self.verify_total


# ── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest equipment photos into MIRA knowledge base",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Classify photos but don't write to NeonDB or move files")
    parser.add_argument("--include-low", action="store_true",
                        help="Also ingest low-confidence classifications")
    parser.add_argument("--incoming-dir", type=str, default=str(INCOMING),
                        help=f"Override incoming directory (default: {INCOMING})")
    parser.add_argument("--source-prefix", type=str, default="equipment_photo",
                        help="Source URL prefix (default: equipment_photo)")
    parser.add_argument("--no-move", action="store_true",
                        help="Don't move files to processed/")
    parser.add_argument("--inspect", action="store_true",
                        help="Enable spot-check verification (every 20th photo)")
    parser.add_argument("--inspect-every", type=int, default=20,
                        help="Verify every N-th photo (default: 20)")
    parser.add_argument("--max-cost", type=float, default=0,
                        help="Stop if estimated cost exceeds this (0=no limit)")
    parser.add_argument("--checkpoint-dir", type=str, default="",
                        help="Directory for checkpoint files (resume support)")
    args = parser.parse_args()

    incoming = Path(args.incoming_dir)
    if not incoming.exists():
        logger.error("Incoming directory does not exist: %s", incoming)
        sys.exit(1)

    photos = sorted(
        p for p in incoming.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    if not photos:
        logger.info("No photos found in %s — nothing to ingest.", incoming)
        sys.exit(0)

    logger.info("Found %d photos to process in %s", len(photos), incoming)

    import anthropic
    client = anthropic.Anthropic()

    tenant_id = os.environ.get("MIRA_TENANT_ID")
    if not tenant_id and not args.dry_run:
        logger.error("MIRA_TENANT_ID not set. Set env var or use Doppler.")
        sys.exit(1)

    # Checkpoint support
    checkpoint_path = None
    already_done: set[str] = set()
    if args.checkpoint_dir:
        cp_dir = Path(args.checkpoint_dir)
        cp_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = cp_dir / "ingest_checkpoint.txt"
        if checkpoint_path.exists():
            already_done = {l.strip() for l in checkpoint_path.read_text().splitlines() if l.strip()}
            photos = [p for p in photos if str(p) not in already_done]
            logger.info("Checkpoint: %d done, %d remaining", len(already_done), len(photos))

    monitor = IngestMonitor()
    confirmed = []
    skipped = []
    discovered_models: set[str] = set()
    inspection_log: list[dict] = []

    PROCESSED.mkdir(parents=True, exist_ok=True)
    start_time = time.time()

    for i, photo in enumerate(photos):
        # Cost guard
        if args.max_cost > 0 and monitor.est_cost >= args.max_cost:
            logger.warning("COST GUARD: estimated cost $%.2f exceeds --max-cost $%.2f. Stopping.",
                           monitor.est_cost, args.max_cost)
            break

        logger.info("Classifying %d/%d: %s", i + 1, len(photos), photo.name)

        try:
            result = classify_photo(photo, client)
        except Exception as e:
            logger.error("Claude API error for %s: %s", photo.name, e)
            monitor.error_count += 1
            # Exponential backoff on rate limit
            if "429" in str(e) or "rate" in str(e).lower():
                wait = min(60, 2 ** (monitor.error_count % 6))
                logger.warning("Rate limited — waiting %ds", wait)
                time.sleep(wait)
            continue

        if not result.get("is_equipment"):
            skipped.append(photo.name)
            monitor.record(result)
            if not args.dry_run and not args.no_move:
                shutil.move(str(photo), str(PROCESSED / photo.name))
            if checkpoint_path:
                with open(checkpoint_path, "a") as f:
                    f.write(str(photo) + "\n")
            continue

        confidence = result.get("confidence", "low")
        if confidence == "low" and not args.include_low:
            skipped.append(photo.name)
            logger.info("  Low confidence — skipping: %s", photo.name)
            monitor.record(result)
            continue

        # Equipment confirmed
        make = result.get("make") or "?"
        model_num = result.get("model") or "?"
        eq_type = result.get("equipment_type", "?")
        has_np = "NP" if result.get("has_nameplate") else ""
        condition = result.get("condition", "?")
        logger.info("  CONFIRMED: %s %s (%s) [%s] %s cond=%s",
                     make, model_num, eq_type, confidence, has_np, condition)

        # Spot-check verification
        verified = None
        if args.inspect and (i + 1) % args.inspect_every == 0:
            logger.info("  SPOT-CHECK: verifying classification...")
            verified = verify_classification(result, client)
            logger.info("  VERDICT: %s", verified)
            inspection_log.append({
                "photo": photo.name, "classification": eq_type,
                "make": make, "model": model_num, "verdict": verified,
            })

            if monitor.disagree_rate > 0.15 and monitor.verify_total >= 5:
                logger.error("QUALITY ALERT: disagree rate %.0f%% exceeds 15%% threshold!",
                             monitor.disagree_rate * 100)
                logger.error("Pausing ingest. Review inspection_log.csv before continuing.")
                break

        # Manual discovery
        manual_queued = trigger_manual_discovery(result, tenant_id or "", args.dry_run, discovered_models)

        # Record stats (strip base64 before storing)
        result_clean = {k: v for k, v in result.items() if not k.startswith("_")}
        monitor.record(result, verified=verified, manual_queued=manual_queued)

        if not args.dry_run:
            if tenant_id:
                insert_to_neondb(result_clean, photo, tenant_id, args.source_prefix)
            append_golden_label(result_clean, photo)
            if not args.no_move:
                shutil.move(str(photo), str(PROCESSED / photo.name))

        confirmed.append({"name": photo.name, "result": result_clean})

        if checkpoint_path:
            with open(checkpoint_path, "a") as f:
                f.write(str(photo) + "\n")

        # Rate limit
        time.sleep(1.0)

        # Dashboard every 50 photos
        if (i + 1) % 50 == 0:
            monitor.print_dashboard(i + 1, len(photos))

    # Write inspection log
    if inspection_log:
        log_path = Path(args.incoming_dir).parent / "inspection_log.csv"
        with open(log_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["photo", "classification", "make", "model", "verdict"])
            writer.writeheader()
            writer.writerows(inspection_log)
        logger.info("Inspection log: %s", log_path)

    # Final summary
    elapsed = time.time() - start_time
    mode_label = " — DRY RUN" if args.dry_run else ""

    print()
    print("=" * 60)
    print(f"Equipment Photo Ingest{mode_label}")
    print("=" * 60)
    print(f"Total scanned:     {len(photos):>6}")
    print(f"Equipment found:   {monitor.equipment_count:>6}")
    print(f"Not equipment:     {monitor.not_equipment_count:>6}")
    print(f"Errors:            {monitor.error_count:>6}")
    print(f"Time:              {elapsed:.0f}s ({elapsed/max(len(photos),1):.1f}s/photo)")
    print(f"Est. cost:         ${monitor.est_cost:.2f}")

    if confirmed:
        print(f"\nEquipment types:")
        for t, c in sorted(monitor.type_counts.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")

        print(f"\nTop manufacturers:")
        for m, c in sorted(monitor.make_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"  {m}: {c}")

        print(f"\nNameplates:        {monitor.nameplate_count}/{monitor.equipment_count}")
        print(f"Manuals queued:    {monitor.manuals_queued}")

    if monitor.verify_total > 0:
        print(f"\nQuality check:     {monitor.verify_agree}/{monitor.verify_total} agree "
              f"({monitor.verify_agree/monitor.verify_total*100:.0f}%)")
        if monitor.verify_disagree > 0:
            print(f"  Disagree:        {monitor.verify_disagree}")

    if not args.dry_run and confirmed:
        print(f"\nGolden labels:     {LABELS_PATH.relative_to(REPO_ROOT)}")
        print(f"NeonDB entries:    {len(confirmed)}")

    print("=" * 60)


if __name__ == "__main__":
    main()
