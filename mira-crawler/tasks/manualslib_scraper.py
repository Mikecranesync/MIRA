"""ManualsLib scraper — discovery + direct PDF extraction.

ARCHITECTURE NOTE (2026-04-29):
  ManualsLib's viewer is Vue.js client-side rendered. The static image files
  served at storage/pdf59/.../_bg.jpg/png are blank white page backgrounds
  (96% white pixels, 0.1% black — confirmed via pixel analysis). The 80×114px
  thumbnails are too small for OCR. PDF download requires a JavaScript CAPTCHA.
  Scraping the viewer itself requires a headless browser (Playwright).

  This module therefore serves two purposes:
    1. Discovery mode — crawl ManualsLib brand/category pages to find what
       manuals exist for a given manufacturer, then cross-reference with known
       direct PDF sources (sources.yaml).
    2. Direct PDF mode — given a publicly accessible PDF URL (manufacturer CDN,
       government portal, etc.), download it, send to the docling API for
       text extraction, and feed through ingest_text_inline().

  Use `scrape_pdf_direct()` for the actual extraction pipeline.
  Use `discover_manuals()` to find what equipment has documentation.

  If you need ManualsLib's viewer text specifically, run a Playwright-based
  scraper (playwright_crawler.py handles that flow).

Run as a Celery task or standalone:
  python -m mira_crawler.tasks.manualslib_scraper scrape \\
    --pdf-url https://cdn.automationdirect.com/static/manuals/gs20m/gs20m.pdf \\
    --manufacturer AutomationDirect --model GS20 --type user_manual

  python -m mira_crawler.tasks.manualslib_scraper discover \\
    --brand-url https://www.manualslib.com/brand/abb/
"""

from __future__ import annotations

import io
import json
import logging
import os
import random
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    try:
        from celery_app import app
    except ImportError:
        app = None  # standalone mode

try:
    from mira_crawler.tasks._shared import get_redis, ingest_text_inline, REDIS_SEEN_TTL_SEC
except ImportError:
    from tasks._shared import get_redis, ingest_text_inline, REDIS_SEEN_TTL_SEC

logger = logging.getLogger("mira-crawler.tasks.manualslib")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_BASE_URL = "https://www.manualslib.com"
_STATIC_BASE = "https://static-data2.manualslib.com"
_REDIS_SEEN_KEY = "mira:manualslib:seen_manuals"

OUTPUT_DIR = Path(os.getenv("MANUALSLIB_OUTPUT_DIR", "/tmp/manualslib_output"))

# Rate limiting
_MIN_DELAY = float(os.getenv("MANUALSLIB_MIN_DELAY", "2.0"))
_MAX_JITTER = float(os.getenv("MANUALSLIB_MAX_JITTER", "3.0"))
_FETCH_TIMEOUT = 30

# Ingest config
_TENANT_ID = os.getenv("MANUALSLIB_TENANT_ID", "system")
_OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
_EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

# User-Agent pool — rotated per request
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]

# Priority queue: HVAC equipment types crawled first
_PRIORITY_TYPES = [
    "hvac", "chiller", "vfd", "drive", "motor", "boiler",
    "compressor", "pump", "plc", "controller", "inverter",
]


# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------

_RE_PAGE_COUNT = re.compile(r'pageCount\s*=\s*(\d+)')
_RE_PRELOAD_IMG = re.compile(
    r'<link[^>]+rel=["\']preload["\'][^>]+href=["\']'
    r'(https://static-data2\.manualslib\.com/storage/[^"\']+?_\d+_bg\.[^"\']+)'
    r'["\']'
)
_RE_THUMB_SRC = re.compile(
    r'data-src=["\']//static-data2\.manualslib\.com/pdf7/\d+/\d+/(\d+)-[^/]+/images/([^_]+)_\d+_thumb\.png["\']'
)
_RE_MANUAL_ID = re.compile(r"/manual/(\d+)/")
_RE_LISTING_LINK = re.compile(r'href=["\'](/manual/\d+/[^"\'?#]+\.html)["\']')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ua() -> str:
    return random.choice(_USER_AGENTS)


def _sleep() -> None:
    time.sleep(_MIN_DELAY + random.uniform(0, _MAX_JITTER))


def _get(client: httpx.Client, url: str, **kwargs) -> Optional[httpx.Response]:
    try:
        resp = client.get(url, headers={"User-Agent": _ua()}, timeout=_FETCH_TIMEOUT, **kwargs)
        resp.raise_for_status()
        return resp
    except httpx.HTTPStatusError as exc:
        logger.warning("HTTP %s for %s", exc.response.status_code, url)
        return None
    except Exception as exc:
        logger.warning("Request failed for %s: %s", url, exc)
        return None


def _parse_landing_page(html: str) -> dict:
    """Extract page count, storage base path, and model slug from landing page HTML."""
    result: dict = {}

    m = _RE_PAGE_COUNT.search(html)
    if m:
        result["page_count"] = int(m.group(1))

    m = _RE_PRELOAD_IMG.search(html)
    if m:
        preload_url = m.group(1)
        # e.g. .../storage/pdf59/292/29130/2912913/images/acs880_1_bg.jpg
        parts = preload_url.split("/storage/")
        if len(parts) == 2:
            result["storage_base"] = "storage/" + parts[1].rsplit("/images/", 1)[0]
        # extract model slug from filename: acs880_1_bg.jpg → acs880
        filename = preload_url.rsplit("/", 1)[-1]  # acs880_1_bg.jpg
        slug_m = re.match(r"(.+?)_\d+_bg\.", filename)
        if slug_m:
            result["model_slug"] = slug_m.group(1)

    # Fallback: extract slug from thumbnail data-src attributes
    if "model_slug" not in result:
        m = _RE_THUMB_SRC.search(html)
        if m:
            result["model_slug"] = m.group(2)

    return result


def _image_url(storage_base: str, model_slug: str, page: int, ext: str) -> str:
    return f"{_STATIC_BASE}/{storage_base}/images/{model_slug}_{page}_bg.{ext}"


def _ocr_image(image_bytes: bytes) -> str:
    """Run pytesseract OCR on raw image bytes. Returns empty string on failure."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        logger.error("pytesseract / Pillow not installed — OCR unavailable")
        return ""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        return pytesseract.image_to_string(img, lang="eng", config="--psm 6")
    except Exception as exc:
        logger.warning("OCR failed: %s", exc)
        return ""


def _resume_state(meta_path: Path) -> int:
    """Return last completed page from metadata file (0 = not started)."""
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            return int(meta.get("last_completed_page", 0))
        except Exception:
            pass
    return 0


def _save_metadata(meta_path: Path, data: dict) -> None:
    try:
        meta_path.write_text(json.dumps(data, indent=2))
    except Exception as exc:
        logger.warning("Could not save metadata: %s", exc)


# ---------------------------------------------------------------------------
# Core scrape function
# ---------------------------------------------------------------------------


def scrape_pdf_direct(
    pdf_url: str,
    *,
    manufacturer: str = "unknown",
    model: str = "unknown",
    manual_type: str = "manual",
    ingest: bool = True,
    docling_url: Optional[str] = None,
) -> dict:
    """Extract text from a publicly accessible PDF via the docling API.

    This is the recommended extraction path for manufacturer PDFs.
    ManualsLib's own viewer is Vue.js rendered and cannot be scraped via httpx.

    Args:
        pdf_url:      Direct HTTPS URL to the PDF (must be publicly accessible).
        manufacturer: Human-readable manufacturer name.
        model:        Model identifier.
        manual_type:  Type label (``"user_manual"``, ``"service_guide"``, etc.).
        ingest:       If True, feed extracted text through ingest_text_inline().
        docling_url:  Base URL of the docling-serve API (default: DOCLING_URL env var).
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    _docling = docling_url or os.getenv("DOCLING_URL", "http://localhost:5001")
    safe_mfr = re.sub(r"[^\w-]", "_", manufacturer).lower()
    safe_model = re.sub(r"[^\w-]", "_", model).lower()
    safe_type = re.sub(r"[^\w-]", "_", manual_type).lower()
    out_stem = f"{safe_mfr}_{safe_model}_{safe_type}"
    text_path = OUTPUT_DIR / f"{out_stem}.txt"

    result: dict = {
        "pdf_url": pdf_url,
        "manufacturer": manufacturer,
        "model": model,
        "manual_type": manual_type,
        "extracted_chars": 0,
        "chunks_ingested": 0,
        "output_file": str(text_path),
    }

    logger.info("Downloading %s for docling extraction", pdf_url)

    # Download PDF to temp file then upload (docling container may lack outbound access)
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        with httpx.Client(timeout=120, follow_redirects=True) as client:
            resp = client.get(pdf_url, headers={"User-Agent": _USER_AGENTS[0]})
            resp.raise_for_status()
            with open(tmp_path, "wb") as f:
                f.write(resp.content)
        logger.info("Downloaded %d bytes", len(resp.content))

        # Submit to docling file endpoint
        with open(tmp_path, "rb") as pdf_file:
            with httpx.Client(timeout=300) as client:
                dr = client.post(
                    f"{_docling}/v1/convert/file",
                    files={"files": (f"{safe_model}.pdf", pdf_file, "application/pdf")},
                    data={"options": json.dumps({
                        "to_formats": ["md"],
                        "image_export_mode": "placeholder",
                        "do_ocr": False,
                        "do_table_structure": True,
                    })},
                )
                dr.raise_for_status()
                data = dr.json()
    finally:
        try:
            import os as _os
            _os.unlink(tmp_path)
        except Exception:
            pass

    md = (data.get("document") or {}).get("md_content", "")
    if not md:
        result["error"] = "docling returned no md_content"
        return result

    # Strip base64 image data; keep markdown structure and text
    clean_lines = []
    in_b64 = False
    for line in md.split("\n"):
        if re.match(r"^!\[.*?\]\(data:image/", line):
            in_b64 = True
            clean_lines.append("[IMAGE]")
            continue
        if in_b64 and re.match(r"^[A-Za-z0-9+/=]{50,}", line.strip()):
            continue
        in_b64 = False
        clean_lines.append(line)
    text = "\n".join(clean_lines)

    text_path.write_text(text, encoding="utf-8")
    result["extracted_chars"] = len(text)
    logger.info("Extracted %d chars from %s PDF", len(text), model)

    if ingest and text.strip():
        try:
            n = ingest_text_inline(
                text=text,
                source_url=pdf_url,
                source_type="equipment_manual",
                tenant_id=_TENANT_ID,
                ollama_url=_OLLAMA_URL,
                embed_model=_EMBED_MODEL,
            )
            result["chunks_ingested"] = n
            logger.info("Ingested %d chunks from %s", n, pdf_url)
        except Exception as exc:
            logger.warning("Ingest failed (non-fatal): %s", exc)

    return result


def scrape_manual(
    manual_path: str,
    *,
    manufacturer: str = "unknown",
    model: str = "unknown",
    manual_type: str = "manual",
    ingest: bool = True,
    max_pages: Optional[int] = None,
) -> dict:
    """Scrape a single ManualsLib manual. Returns a result dict with stats.

    NOTE: ManualsLib's viewer is Vue.js rendered. The _bg.jpg/png images
    served at storage/pdf59/ are blank white page backgrounds. This function
    is retained for future Playwright-based rendering.
    Use scrape_pdf_direct() for actual text extraction from manufacturer PDFs.

    Args:
        manual_path: Path portion of the manual URL, e.g. ``/manual/2912913/Abb-Acs880.html``
        manufacturer: Human-readable manufacturer name (used in output filename).
        model:        Model identifier (used in output filename).
        manual_type:  Type label (``"manual"``, ``"service_guide"``, etc.).
        ingest:       If True, feed extracted text through ingest_text_inline().
        max_pages:    Limit pages scraped (for testing; None = all pages).
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    safe_mfr = re.sub(r"[^\w-]", "_", manufacturer).lower()
    safe_model = re.sub(r"[^\w-]", "_", model).lower()
    safe_type = re.sub(r"[^\w-]", "_", manual_type).lower()

    out_stem = f"{safe_mfr}_{safe_model}_{safe_type}"
    text_path = OUTPUT_DIR / f"{out_stem}.txt"
    meta_path = OUTPUT_DIR / f"{out_stem}_meta.json"

    canonical_url = urljoin(_BASE_URL, manual_path.split("?")[0])
    manual_id_m = _RE_MANUAL_ID.search(manual_path)
    manual_id = manual_id_m.group(1) if manual_id_m else "unknown"

    logger.info("Scraping manual %s (id=%s)", canonical_url, manual_id)

    result = {
        "manual_id": manual_id,
        "url": canonical_url,
        "manufacturer": manufacturer,
        "model": model,
        "manual_type": manual_type,
        "pages_scraped": 0,
        "pages_total": 0,
        "chunks_ingested": 0,
        "ocr_chars": 0,
        "errors": 0,
        "output_file": str(text_path),
    }

    with httpx.Client(follow_redirects=True) as client:
        # ── Step 1: Fetch landing page ──────────────────────────────────────
        landing_url = urljoin(_BASE_URL, manual_path.split("?")[0]) + "?page=1"
        resp = _get(client, landing_url)
        if resp is None:
            result["error"] = "landing page fetch failed"
            return result

        parsed = _parse_landing_page(resp.text)
        page_count = parsed.get("page_count", 0)
        storage_base = parsed.get("storage_base")
        model_slug = parsed.get("model_slug")

        if not page_count:
            result["error"] = "could not determine page count"
            return result
        if not storage_base or not model_slug:
            result["error"] = f"could not extract image URL components (storage_base={storage_base!r}, slug={model_slug!r})"
            return result

        result["pages_total"] = page_count
        logger.info("  %d pages, slug=%s, base=%s", page_count, model_slug, storage_base)

        # ── Step 2: Resume check ────────────────────────────────────────────
        last_page = _resume_state(meta_path)
        if last_page >= page_count:
            logger.info("  Already complete (last_page=%d). Skipping.", last_page)
            result["pages_scraped"] = page_count
            result["resumed"] = True
            return result

        if last_page > 0:
            logger.info("  Resuming from page %d", last_page + 1)

        pages_to_scrape = min(max_pages or page_count, page_count)

        # Open text file in append mode if resuming, otherwise write fresh
        file_mode = "a" if last_page > 0 else "w"
        all_text_parts: list[str] = []

        _sleep()

        with open(text_path, file_mode, encoding="utf-8") as fh:
            if last_page == 0:
                fh.write(f"# {manufacturer} {model} — {manual_type}\n")
                fh.write(f"# Source: {canonical_url}\n")
                fh.write(f"# Pages: {page_count}\n\n")

            for page_num in range(last_page + 1, pages_to_scrape + 1):
                # Try jpg first (cover pages), then png (text pages)
                img_bytes = None
                for ext in ("jpg", "png"):
                    img_url = _image_url(storage_base, model_slug, page_num, ext)
                    img_resp = _get(client, img_url)
                    if img_resp is not None:
                        img_bytes = img_resp.content
                        break

                if img_bytes is None:
                    logger.warning("  Page %d: image not found (tried jpg+png)", page_num)
                    result["errors"] += 1
                    # Still update last_completed so we don't re-attempt on resume
                    _save_metadata(meta_path, {
                        **result,
                        "last_completed_page": page_num,
                        "storage_base": storage_base,
                        "model_slug": model_slug,
                    })
                    _sleep()
                    continue

                page_text = _ocr_image(img_bytes)
                if page_text.strip():
                    fh.write(f"\n--- Page {page_num} ---\n")
                    fh.write(page_text)
                    all_text_parts.append(page_text)
                    result["ocr_chars"] += len(page_text)

                result["pages_scraped"] += 1

                if page_num % 10 == 0:
                    logger.info("  Progress: %d/%d pages", page_num, page_count)

                _save_metadata(meta_path, {
                    **result,
                    "last_completed_page": page_num,
                    "storage_base": storage_base,
                    "model_slug": model_slug,
                })

                _sleep()

    # ── Step 3: Ingest ──────────────────────────────────────────────────────
    if ingest and all_text_parts:
        full_text = "\n".join(all_text_parts)
        try:
            n = ingest_text_inline(
                text=full_text,
                source_url=canonical_url,
                source_type="equipment_manual",
                tenant_id=_TENANT_ID,
                ollama_url=_OLLAMA_URL,
                embed_model=_EMBED_MODEL,
            )
            result["chunks_ingested"] = n
            logger.info("  Ingested %d chunks from %s", n, canonical_url)
        except Exception as exc:
            logger.warning("  Ingest failed (non-fatal): %s", exc)

    logger.info(
        "Done: %s — %d/%d pages, %d chars OCR, %d chunks ingested, %d errors",
        out_stem,
        result["pages_scraped"],
        page_count,
        result["ocr_chars"],
        result["chunks_ingested"],
        result["errors"],
    )

    return result


# ---------------------------------------------------------------------------
# Discovery mode — crawl brand listing page
# ---------------------------------------------------------------------------


def discover_manuals(brand_url: str) -> list[str]:
    """Crawl a ManualsLib brand or category page and return manual paths.

    Args:
        brand_url: Full URL to a brand page, e.g.
            ``https://www.manualslib.com/brand/abb/``

    Returns:
        List of manual path strings like ``/manual/12345/Abb-Drive.html``
    """
    manuals: list[str] = []
    seen: set[str] = set()

    with httpx.Client(follow_redirects=True) as client:
        page = 1
        while True:
            url = brand_url if page == 1 else f"{brand_url}?page={page}"
            resp = _get(client, url)
            if resp is None:
                break

            found = _RE_LISTING_LINK.findall(resp.text)
            new = [p for p in found if p not in seen]
            if not new:
                break

            manuals.extend(new)
            seen.update(new)
            logger.info("Discovery page %d: found %d manuals (total %d)", page, len(new), len(manuals))
            page += 1
            _sleep()

    return manuals


def _priority_sort_key(path: str) -> int:
    """Lower = higher priority. HVAC/VFD types float to the top."""
    path_lower = path.lower()
    for idx, keyword in enumerate(_PRIORITY_TYPES):
        if keyword in path_lower:
            return idx
    return len(_PRIORITY_TYPES)


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------

if app is not None:
    @app.task(name="mira_crawler.tasks.manualslib.scrape_manual_task", bind=True, max_retries=2)
    def scrape_manual_task(self, manual_path: str, manufacturer: str = "unknown",  # noqa: ANN001
                           model: str = "unknown", manual_type: str = "manual") -> dict:
        """Celery-wrapped scrape for a single manual."""
        try:
            return scrape_manual(
                manual_path,
                manufacturer=manufacturer,
                model=model,
                manual_type=manual_type,
            )
        except Exception as exc:
            logger.error("Task failed for %s: %s", manual_path, exc)
            raise self.retry(exc=exc, countdown=60)

    @app.task(name="mira_crawler.tasks.manualslib.discover_and_scrape", bind=True)
    def discover_and_scrape_task(self, brand_url: str) -> dict:
        """Discover all manuals for a brand and enqueue individual scrape tasks."""
        paths = discover_manuals(brand_url)
        paths.sort(key=_priority_sort_key)

        redis = None
        try:
            redis = get_redis()
        except Exception:
            pass

        queued = 0
        skipped = 0
        for path in paths:
            canonical = urljoin(_BASE_URL, path)
            if redis is not None:
                try:
                    if redis.sismember(_REDIS_SEEN_KEY, canonical):
                        skipped += 1
                        continue
                    redis.sadd(_REDIS_SEEN_KEY, canonical)
                    redis.expire(_REDIS_SEEN_KEY, REDIS_SEEN_TTL_SEC)
                except Exception:
                    pass

            scrape_manual_task.apply_async(kwargs={"manual_path": path}, countdown=queued * 720)
            queued += 1

        logger.info("Queued %d manuals from %s (%d skipped as seen)", queued, brand_url, skipped)
        return {"brand_url": brand_url, "queued": queued, "skipped": skipped}


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="ManualsLib discovery + direct PDF extraction pipeline"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # Primary path: extract from a direct PDF URL via docling
    p_pdf = sub.add_parser("scrape", help="Extract text from a direct PDF URL via docling")
    p_pdf.add_argument("--pdf-url", required=True, help="Direct PDF URL (manufacturer CDN, govt portal, etc.)")
    p_pdf.add_argument("--manufacturer", default="unknown")
    p_pdf.add_argument("--model", default="unknown")
    p_pdf.add_argument("--type", dest="manual_type", default="manual")
    p_pdf.add_argument("--no-ingest", action="store_true", help="Skip KB ingest (text file only)")

    # Legacy: ManualsLib viewer path (blank images — kept for Playwright future)
    p_ml = sub.add_parser("scrape-ml", help="[DEPRECATED] ManualsLib viewer path (requires Playwright)")
    p_ml.add_argument("--url", required=True, help="Manual path, e.g. /manual/2912913/Abb-Acs880.html")
    p_ml.add_argument("--manufacturer", default="unknown")
    p_ml.add_argument("--model", default="unknown")
    p_ml.add_argument("--type", dest="manual_type", default="manual")
    p_ml.add_argument("--max-pages", type=int, default=None)
    p_ml.add_argument("--no-ingest", action="store_true")

    p_disc = sub.add_parser("discover", help="Discover manuals from a ManualsLib brand page URL")
    p_disc.add_argument("--brand-url", required=True, help="ManualsLib brand page URL")
    p_disc.add_argument("--scrape", action="store_true", help="Also scrape all discovered manuals")

    args = parser.parse_args()

    if args.cmd == "scrape":
        result = scrape_pdf_direct(
            args.pdf_url,
            manufacturer=args.manufacturer,
            model=args.model,
            manual_type=args.manual_type,
            ingest=not args.no_ingest,
        )
        print(json.dumps(result, indent=2))

    elif args.cmd == "scrape-ml":
        result = scrape_manual(
            args.url,
            manufacturer=args.manufacturer,
            model=args.model,
            manual_type=args.manual_type,
            ingest=not args.no_ingest,
            max_pages=args.max_pages,
        )
        print(json.dumps(result, indent=2))

    elif args.cmd == "discover":
        paths = discover_manuals(args.brand_url)
        paths.sort(key=_priority_sort_key)
        print(f"Found {len(paths)} manuals:")
        for p in paths:
            print(f"  {p}")

        if args.scrape:
            for path in paths:
                result = scrape_manual(path, ingest=True)
                print(json.dumps(result))
