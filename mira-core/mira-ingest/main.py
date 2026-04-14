"""MIRA ingest service — photo ingestion, vector search, KB push, document KB ingest."""

import asyncio
import base64
import io
import json
import logging
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

from crawl_verifier import (
    OUTCOME_SUCCESS,
    classify_historical,
    list_verifications,
    verify_crawl,
)

logger = logging.getLogger("mira-ingest")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

DB_PATH = os.getenv("MIRA_DB_PATH", "/app/mira.db")
PHOTOS_DIR = Path(os.getenv("PHOTOS_DIR", "/data/photos"))
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DESCRIBE_MODEL = os.getenv("DESCRIBE_MODEL", "qwen2.5vl:7b")
EMBED_VISION_MODEL = os.getenv("EMBED_VISION_MODEL", "nomic-embed-vision-v1.5")
EMBED_TEXT_MODEL = os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text-v1.5")
OPENWEBUI_URL = os.getenv("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.getenv("OPENWEBUI_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.getenv("KNOWLEDGE_COLLECTION_ID", "")
MAX_PX = int(os.getenv("MAX_INGEST_PX", "1024"))
MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")
FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v1"
APIFY_API_KEY = os.getenv("APIFY_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Manufacturer → primary doc-search URL (Firecrawl maps these to find model PDFs)
_MANUFACTURER_DOC_URLS: dict[str, str] = {
    "allen-bradley": "https://literature.rockwellautomation.com/idc/groups/literature/documents/",
    "rockwell": "https://literature.rockwellautomation.com/",
    "abb": "https://new.abb.com/drives/documents",
    "siemens": "https://support.industry.siemens.com/cs/ww/en/",
    "automationdirect": "https://www.automationdirect.com/manuals/",
    "yaskawa": "https://www.yaskawa.com/downloads/",
    "schneider": "https://www.se.com/ww/en/download/",
    "danfoss": "https://www.danfoss.com/en/service-and-support/downloads/",
    "mitsubishi": "https://www.mitsubishielectric.com/fa/products/drv/",
    "lenze": "https://www.lenze.com/en/service/downloads/",
    "pilz": "https://www.pilz.com/en-US/support/downloads",
    "omron": "https://www.fa.omron.com/support/technical-info/",
    "eaton": "https://www.eaton.com/content/dam/eaton/",
}

# Collection routing patterns for document-kb endpoint
_ELECTRICAL_RE = re.compile(r"wiring|schematic|diagram|electrical|one.?line|ladder", re.I)
_MANUAL_RE = re.compile(r"manual|vfd|drive|plc|motor|pump|compressor|datasheet", re.I)

DESCRIBE_SYSTEM = (
    "You are an industrial maintenance AI helping a technician at a machine. "
    "When shown an equipment photo, respond in under 100 words using plain language. "
    "Structure your response as: "
    "(1) What is this device — name the make, model, and function. "
    "(2) What likely caused any visible issue — state the most probable fault cause. "
    "(3) What should the tech do right now — give one specific, concrete next step. "
    "If the image is a nameplate or tag only, identify the device and give one "
    "general next step for a tech responding to an unknown fault on this equipment type. "
    "Never use unexplained acronyms. Do not exceed 100 words."
)

app = FastAPI(title="mira-ingest")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _get_db() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    return db


def _ensure_table() -> None:
    db = _get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS equipment_photos (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_tag    TEXT NOT NULL,
            location     TEXT,
            notes        TEXT,
            description  TEXT,
            photo_path   TEXT,
            image_vector TEXT,
            text_vector  TEXT,
            ingested_at  TEXT
        )
    """)
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def _sanitize_image(data: bytes) -> bytes:
    """Strip EXIF metadata and resize to MAX_PX longest side."""
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_PX:
        scale = MAX_PX / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, exif=b"")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------


def _cosine_similarity(a: list, b: list) -> float:
    """Pure-Python cosine similarity between two float vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Ollama calls
# ---------------------------------------------------------------------------


async def _describe_photo(image_b64: str, notes: str = "") -> str:
    user_text = DESCRIBE_SYSTEM
    if notes:
        user_text += f"\n\nTechnician's situation: {notes}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": DESCRIBE_MODEL,
                "stream": False,
                "messages": [
                    {
                        "role": "user",
                        "content": user_text,
                        "images": [image_b64],
                    }
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def _embed_image(image_b64: str) -> list:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_VISION_MODEL, "input": image_b64},
        )
        resp.raise_for_status()
        return resp.json()["embeddings"][0]


async def _embed_text(text: str) -> list:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_TEXT_MODEL, "input": text},
        )
        resp.raise_for_status()
        return resp.json()["embeddings"][0]


# ---------------------------------------------------------------------------
# Open WebUI KB push (best-effort, never fails ingest)
# ---------------------------------------------------------------------------


async def _push_to_kb(asset_tag: str, description: str) -> None:
    if not KNOWLEDGE_COLLECTION_ID or not OPENWEBUI_URL:
        return
    headers = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/files/",
                headers=headers,
                files={"file": (f"{asset_tag}.txt", description.encode(), "text/plain")},
            )
            if resp.status_code not in (200, 201):
                logger.warning("KB file upload failed (%s): %s", resp.status_code, resp.text[:200])
                return
            file_id = resp.json().get("id")
            if file_id:
                await client.post(
                    f"{OPENWEBUI_URL}/api/v1/knowledge/{KNOWLEDGE_COLLECTION_ID}/file/add",
                    headers={**headers, "Content-Type": "application/json"},
                    json={"file_id": file_id},
                )
    except Exception as e:
        logger.warning("KB push failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Document KB helpers
# ---------------------------------------------------------------------------


def _route_collection(filename: str, hint: str | None) -> tuple[str, str]:
    """Map a filename (or explicit hint) to an Open WebUI knowledge collection."""
    if hint:
        h = hint.lower()
        if h == "electrical":
            return ("Electrical Prints", "Wiring diagrams and schematics.")
        if h == "manual":
            return ("Equipment Manuals", "Equipment manuals and datasheets.")
        return ("Facility Documents", "General facility documents.")
    if _ELECTRICAL_RE.search(filename):
        return ("Electrical Prints", "Wiring diagrams and schematics.")
    if _MANUAL_RE.search(filename):
        return ("Equipment Manuals", "Equipment manuals and datasheets.")
    return ("Facility Documents", "General facility documents uploaded by technicians.")


async def _get_or_create_kb_collection(name: str, desc: str) -> str:
    """Return the Open WebUI collection_id for `name`, creating it if needed."""
    headers: dict[str, str] = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{OPENWEBUI_URL}/api/v1/knowledge/", headers=headers)
        resp.raise_for_status()
        body = resp.json()
        # Handle both list shape and {items:[]} shape
        items = body if isinstance(body, list) else (body.get("items") or [])
        for col in items:
            if col.get("name") == name:
                logger.info("KB collection found: %s (%s)", name, col["id"])
                return col["id"]
        # Not found — create
        resp = await client.post(
            f"{OPENWEBUI_URL}/api/v1/knowledge/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"name": name, "description": desc},
        )
        resp.raise_for_status()
        col_id = resp.json()["id"]
        logger.info("KB collection created: %s (%s)", name, col_id)
        return col_id


async def _poll_file_status(file_id: str, timeout_s: int = 300) -> str:
    """Poll Open WebUI until file extraction is complete (or timeout/failed)."""
    headers: dict[str, str] = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
    max_polls = timeout_s // 3
    for i in range(max_polls):
        await asyncio.sleep(3)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{OPENWEBUI_URL}/api/v1/files/{file_id}/process/status",
                    headers=headers,
                )
                if resp.status_code == 404:
                    # Status endpoint not available in this Open WebUI version.
                    # Wait a fixed period and return completed optimistically.
                    logger.info(
                        "Status endpoint not found (404) for file_id=%s; "
                        "waiting 25s then proceeding optimistically",
                        file_id,
                    )
                    await asyncio.sleep(25)
                    return "completed"
                resp.raise_for_status()
                body = resp.json()
                # Status may be top-level or nested under "data"
                status = body.get("status") or body.get("data", {}).get("status", "")
                status = (status or "").lower()
                logger.debug("Poll %d/%d file=%s status=%s", i + 1, max_polls, file_id, status)
                if status in ("completed", "processed", "done", "ready"):
                    return "completed"
                if status in ("failed", "error"):
                    logger.warning("File processing failed: file_id=%s", file_id)
                    return "failed"
        except Exception as e:
            logger.warning("Poll %d error (continuing): %s", i + 1, e)
    logger.warning("File status poll timeout after %ds: file_id=%s", timeout_s, file_id)
    return "timeout"


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup():
    _ensure_table()
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    # Warn if nomic-embed-text is missing from Ollama — RAG will silently fail without it
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            if not any("nomic-embed-text" in name for name in models):
                logger.warning(
                    "nomic-embed-text not found in Ollama. RAG embedding will fail. "
                    "Run: ollama pull nomic-embed-text on the host, then restart."
                )
            else:
                logger.info("nomic-embed-text confirmed present in Ollama.")
    except Exception as e:
        logger.warning("Could not reach Ollama at %s to verify models: %s", OLLAMA_URL, e)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/db")
async def health_db():
    # SQLite check
    try:
        db = _get_db()
        db.execute("SELECT 1")
        db.close()
        sqlite_status = "ok"
    except Exception as exc:
        sqlite_status = f"error: {exc}"

    # NeonDB check (optional — graceful if NEON_DATABASE_URL not set)
    neon_result: dict = {"status": "not_configured"}
    if os.getenv("NEON_DATABASE_URL"):
        try:
            from db.neon import health_check as _neon_health

            neon_result = _neon_health()
        except Exception as exc:
            neon_result = {"status": "error", "detail": str(exc)}

    return {
        "sqlite": sqlite_status,
        "neondb": neon_result.get("status", "error"),
        "neondb_tenant_count": neon_result.get("tenant_count"),
        "neondb_knowledge_entries": neon_result.get("knowledge_entries"),
    }


@app.post("/ingest/photo")
async def ingest_photo(
    image: UploadFile = File(...),
    asset_tag: str = Form(...),
    location: str = Form(default=""),
    notes: str = Form(default=""),
):
    # Tier limit check — returns HTTP 429 if daily limit exceeded
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    if tenant_id:
        try:
            from db.neon import check_tier_limit

            allowed, reason = check_tier_limit(tenant_id)
            if not allowed:
                raise HTTPException(status_code=429, detail=reason)
        except HTTPException:
            raise
        except Exception:
            pass  # fail open — never block on DB errors

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty image upload")

    try:
        clean = _sanitize_image(raw)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid image: {e}")

    # Save sanitized photo to disk
    asset_dir = PHOTOS_DIR / asset_tag
    asset_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    photo_path = str(asset_dir / f"{timestamp}.jpg")
    with open(photo_path, "wb") as f:
        f.write(clean)

    image_b64 = base64.b64encode(clean).decode()

    # Describe via vision model (non-fatal fallback)
    try:
        description = await _describe_photo(image_b64, notes=notes)
    except Exception as e:
        logger.error("Vision description failed: %s", e)
        description = notes or "No description available"

    # Embed image vector (non-fatal)
    try:
        image_vector = await _embed_image(image_b64)
    except Exception as e:
        logger.error("Image embed failed: %s", e)
        image_vector = []

    # Embed text vector (non-fatal)
    try:
        text_vector = await _embed_text(description)
    except Exception as e:
        logger.error("Text embed failed: %s", e)
        text_vector = []

    # Store in DB
    db = _get_db()
    cursor = db.execute(
        """INSERT INTO equipment_photos
           (asset_tag, location, notes, description, photo_path,
            image_vector, text_vector, ingested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            asset_tag,
            location,
            notes,
            description,
            photo_path,
            json.dumps(image_vector),
            json.dumps(text_vector),
            timestamp,
        ),
    )
    db.commit()
    photo_id = cursor.lastrowid
    db.close()

    # Push to Open WebUI KB (best-effort)
    await _push_to_kb(asset_tag, description)

    return {
        "id": photo_id,
        "asset_tag": asset_tag,
        "description": description,
        "photo_path": photo_path,
    }


@app.post("/ingest/search-visual")
async def search_visual(body: dict):
    """Dual-modality search: image embedding + text embedding merged with RRF.

    Body: {query_image_b64?, query_text?, top_k?}
    Returns: {results: [{...score...}]}
    """
    query_image_b64 = body.get("query_image_b64", "")
    query_text = body.get("query_text", "")
    top_k = int(body.get("top_k", 5))

    if not query_image_b64 and not query_text:
        raise HTTPException(status_code=422, detail="query_image_b64 or query_text required")

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    if not tenant_id:
        raise HTTPException(status_code=503, detail="MIRA_TENANT_ID not configured")

    try:
        from db.neon import recall_by_image, recall_knowledge
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"NeonDB not available: {e}")

    image_results: list[dict] = []
    text_results: list[dict] = []

    if query_image_b64:
        try:
            img_vec = await _embed_image(query_image_b64)
            image_results = recall_by_image(img_vec, tenant_id, limit=top_k * 2)
        except Exception as e:
            logger.warning("Visual search embed/recall failed: %s", e)

    if query_text:
        try:
            txt_vec = await _embed_text(query_text)
            text_results = recall_knowledge(txt_vec, tenant_id, limit=top_k * 2)
        except Exception as e:
            logger.warning("Text search embed/recall failed: %s", e)

    # Reciprocal Rank Fusion: score = 1/(60+rank_text) + 1/(60+rank_image)
    RRF_K = 60
    scores: dict[str, float] = {}
    entries: dict[str, dict] = {}

    for rank, r in enumerate(text_results):
        key = r.get("content", "")[:200]
        scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
        entries[key] = r

    for rank, r in enumerate(image_results):
        key = r.get("content", "")[:200]
        scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
        if key not in entries:
            entries[key] = r

    merged = sorted(
        [{"rrf_score": scores[k], **entries[k]} for k in scores],
        key=lambda x: x["rrf_score"],
        reverse=True,
    )
    return {"results": merged[:top_k]}


@app.post("/ingest/search")
async def search_photos(body: dict):
    query = body.get("query", "")
    top_k = int(body.get("top_k", 5))
    if not query:
        raise HTTPException(status_code=422, detail="query is required")

    try:
        query_vector = await _embed_text(query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embed failed: {e}")

    db = _get_db()
    rows = db.execute(
        "SELECT id, asset_tag, location, description, photo_path, text_vector, ingested_at "
        "FROM equipment_photos"
    ).fetchall()
    db.close()

    results = []
    for row in rows:
        try:
            vec = json.loads(row["text_vector"] or "[]")
        except Exception:
            vec = []
        if not vec:
            continue
        score = _cosine_similarity(query_vector, vec)
        results.append(
            {
                "id": row["id"],
                "asset_tag": row["asset_tag"],
                "location": row["location"],
                "description": row["description"],
                "photo_path": row["photo_path"],
                "ingested_at": row["ingested_at"],
                "score": score,
            }
        )

    results.sort(key=lambda x: x["score"], reverse=True)
    return {"results": results[:top_k]}


# ---------------------------------------------------------------------------
# Document KB ingest — upload original PDF to Open WebUI, let it chunk + embed
# ---------------------------------------------------------------------------


@app.post("/ingest/document-kb")
async def ingest_document_kb(
    file: UploadFile = File(...),
    filename: str = Form(default=None),
    collection_hint: str = Form(default=None),
    equipment_type: str = Form(default=None),
):
    """Upload a PDF to Open WebUI Knowledge Base.

    Open WebUI handles text extraction, chunking, and embedding via its
    configured engine (pypdf default; Docling when DOCLING_SERVER_URL is set).
    No local parsing is performed here.

    Returns JSON: {status, filename, collection_id, collection_name, file_id, processing_status}
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty file upload")

    fname = filename or file.filename or "document.pdf"

    # Validate file type — PDF only for MVP
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    mime = (file.content_type or "").lower()
    if mime != "application/pdf" and ext != "pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Only PDF files are supported (got mime={mime or 'unknown'}, ext={ext or 'none'})",
        )

    # Validate size (20MB Telegram limit, enforced universally)
    MB = 1024 * 1024
    if len(raw) > 20 * MB:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds 20MB limit ({len(raw) // MB}MB)",
        )

    # Tier limit check (fail open on DB errors — never block on infra failures)
    tenant_id = MIRA_TENANT_ID
    if tenant_id:
        try:
            from db.neon import check_tier_limit

            allowed, reason = check_tier_limit(tenant_id)
            if not allowed:
                raise HTTPException(status_code=429, detail=reason)
        except HTTPException:
            raise
        except Exception:
            pass

    # Route to the correct collection
    col_name, col_desc = _route_collection(fname, collection_hint)
    logger.info("Document KB ingest: %s → collection '%s'", fname, col_name)

    # Get or create the Open WebUI collection
    try:
        collection_id = await _get_or_create_kb_collection(col_name, col_desc)
    except Exception as e:
        logger.error("Collection create/find failed: %s", e)
        raise HTTPException(status_code=500, detail=f"KB collection unavailable: {e}")

    # Upload the raw PDF to Open WebUI
    headers: dict[str, str] = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/files/",
                headers=headers,
                files={"file": (fname, raw, "application/pdf")},
            )
            resp.raise_for_status()
            file_id = resp.json().get("id")
    except Exception as e:
        logger.error("Open WebUI file upload failed: %s", e)
        raise HTTPException(status_code=422, detail=f"File upload failed: {e}")

    if not file_id:
        raise HTTPException(status_code=422, detail="Open WebUI did not return a file_id")

    logger.info("File uploaded to Open WebUI: file_id=%s, polling for extraction...", file_id)

    # Poll until extraction + embedding complete
    processing_status = await _poll_file_status(file_id, timeout_s=300)

    if processing_status == "failed":
        raise HTTPException(
            status_code=422,
            detail=f"Open WebUI extraction failed for {fname}. Try re-uploading.",
        )

    # Attach to knowledge collection (extraction complete or timed-out best-effort)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/knowledge/{collection_id}/file/add",
                headers={**headers, "Content-Type": "application/json"},
                json={"file_id": file_id},
            )
            if resp.status_code == 400 and "duplicate" in resp.text.lower():
                logger.info("File already in KB collection (idempotent): file_id=%s", file_id)
            elif resp.status_code not in (200, 201):
                logger.warning(
                    "KB attach returned %s: %s (non-fatal)",
                    resp.status_code,
                    resp.text[:200],
                )
    except Exception as e:
        logger.warning("KB attach failed (non-fatal, file is uploaded): %s", e)

    logger.info(
        "Document KB ingest complete: %s → collection='%s' processing_status=%s",
        fname,
        col_name,
        processing_status,
    )

    return {
        "status": "ok",
        "filename": fname,
        "collection_id": collection_id,
        "collection_name": col_name,
        "file_id": file_id,
        "processing_status": processing_status,
        "equipment_type": equipment_type or "",
    }


# ---------------------------------------------------------------------------
# Reactive KB scrape trigger — fired by RAGWorker when knowledge gap detected
# ---------------------------------------------------------------------------


class ScrapeTriggerRequest(BaseModel):
    equipment_id: str  # Full asset_identified string from FSM state
    manufacturer: str  # Parsed manufacturer name
    model: str  # Parsed model number/name
    tenant_id: str = ""
    chat_id: str = ""  # Telegram chat_id for proactive notification
    context: str = ""  # Optional fault context / description


@app.post("/ingest/scrape-trigger")
async def scrape_trigger(body: ScrapeTriggerRequest, background_tasks: BackgroundTasks):
    """
    Reactive KB gap filler: discovers and ingests manufacturer docs for the
    identified equipment model, then sends a Telegram notification when done.

    Returns immediately. All work happens in a background task.
    Requires FIRECRAWL_API_KEY or APIFY_API_KEY in Doppler factorylm/prd.
    Apify is used when FIRECRAWL_API_KEY is absent (free tier, website-content-crawler actor).
    """
    if not FIRECRAWL_API_KEY and not APIFY_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="No scraping backend configured — set FIRECRAWL_API_KEY or APIFY_API_KEY",
        )

    job_id = str(uuid.uuid4())[:8]
    logger.info(
        "Scrape trigger queued: job=%s equipment=%r manufacturer=%r model=%r chat=%s",
        job_id,
        body.equipment_id[:60],
        body.manufacturer[:40],
        body.model[:40],
        body.chat_id or "none",
    )

    background_tasks.add_task(_run_scrape_and_ingest, job_id, body)
    return {"job_id": job_id, "status": "queued", "equipment_id": body.equipment_id}


async def _run_scrape_and_ingest(job_id: str, body: ScrapeTriggerRequest) -> None:
    """
    Background: map manufacturer site → filter model-relevant URLs →
    scrape top 3 docs → ingest each into Open WebUI KB → verify crawl quality → notify Telegram.
    """
    started_at = datetime.now(timezone.utc).isoformat()
    logger.info("[%s] Starting scrape for %r %r", job_id, body.manufacturer, body.model)

    # 1. Pick the base URL for this manufacturer
    mfr_key = body.manufacturer.lower().replace(" ", "-").replace("_", "-")
    base_url = None
    for key, url in _MANUFACTURER_DOC_URLS.items():
        if key in mfr_key or mfr_key in key:
            base_url = url
            break

    use_apify = bool(APIFY_API_KEY) and not FIRECRAWL_API_KEY
    apify_run_id = ""

    if not base_url:
        logger.info(
            "[%s] No known doc URL for %r — using %s search",
            job_id,
            body.manufacturer,
            "Apify" if use_apify else "Firecrawl",
        )
        if use_apify:
            scraped_docs, apify_run_id = await _apify_search_model(
                job_id, body.manufacturer, body.model
            )
        else:
            scraped_docs = await _firecrawl_search_model(job_id, body.manufacturer, body.model)
    else:
        # Map the manufacturer's doc site, then filter for this model
        if use_apify:
            scraped_docs, apify_run_id = await _apify_map_and_scrape(
                job_id, base_url, body.model
            )
        else:
            scraped_docs = await _firecrawl_map_and_scrape(job_id, base_url, body.model)

    if not scraped_docs:
        logger.warning("[%s] No docs found for %r %r", job_id, body.manufacturer, body.model)
        # Still run verification if we have an Apify run ID — records the EMPTY/FAILED outcome
        if use_apify and apify_run_id:
            await verify_crawl(
                job_id=job_id,
                apify_run_id=apify_run_id,
                manufacturer=body.manufacturer,
                model=body.model,
                kb_writes=0,
                kb_write_attempts=0,
                started_at=started_at,
            )
        await _notify_telegram(
            body.chat_id,
            f"I searched for documentation on *{body.equipment_id}* but didn't find "
            f"specific manufacturer docs. Try sending me a PDF manual directly.",
        )
        return

    # 2. Ingest each scraped doc into Open WebUI KB — track KB write outcomes
    kb_write_attempts = 0
    kb_writes = 0
    ingested = 0
    for doc in scraped_docs[:3]:
        try:
            fname = doc.get("filename", f"{body.model}_{ingested + 1}.txt")
            content = doc.get("content", "")
            if len(content) < 100:
                continue
            kb_write_attempts += 1
            ok = await _ingest_scraped_text(
                fname, content, equipment_type=body.model[:40], run_id=apify_run_id or job_id
            )
            if ok:
                kb_writes += 1
                ingested += 1
        except Exception as e:
            logger.error("[%s] Ingest failed for %s: %s", job_id, doc.get("filename"), e)

    logger.info(
        "[%s] Ingested %d/%d docs for %r (kb_writes=%d/%d)",
        job_id,
        ingested,
        len(scraped_docs),
        body.equipment_id,
        kb_writes,
        kb_write_attempts,
    )

    # 3. Crawl verification — classify outcome, persist record
    verification: dict = {}
    if use_apify and apify_run_id:
        try:
            verification = await verify_crawl(
                job_id=job_id,
                apify_run_id=apify_run_id,
                manufacturer=body.manufacturer,
                model=body.model,
                kb_writes=kb_writes,
                kb_write_attempts=kb_write_attempts,
                started_at=started_at,
            )
        except Exception as exc:
            logger.error("[%s] Crawl verification failed (non-fatal): %s", job_id, exc)

    crawl_outcome = verification.get("outcome", "") if verification else ""

    # 4. Notify the technician — honest message based on verified outcome
    if body.chat_id:
        if crawl_outcome == OUTCOME_SUCCESS and ingested > 0:
            msg = (
                f"*New knowledge added* ✅\n"
                f"I found and indexed *{ingested}* document(s) for *{body.equipment_id}*.\n\n"
                f"Ask me anything about this equipment — I now have manufacturer documentation.\n\n"
                f"_Tip: ask about fault codes, wiring, specs, or replacement parts._"
            )
        elif crawl_outcome in ("LOW_QUALITY", "SHELL_ONLY") or (
            not crawl_outcome and ingested > 0
        ):
            msg = (
                f"I found pages for *{body.equipment_id}* but the content was listing "
                f"pages rather than actual manual documentation. "
                f"Send me a PDF manual directly and I'll index it immediately."
            )
        else:
            msg = (
                f"I searched for *{body.equipment_id}* documentation but the content "
                f"wasn't detailed enough to index. Send me a PDF manual directly and "
                f"I'll index it immediately."
            )
        await _notify_telegram(body.chat_id, msg)


async def _firecrawl_map_and_scrape(job_id: str, base_url: str, model: str) -> list[dict]:
    """Map a manufacturer doc site and scrape pages matching the model number."""
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    model_tokens = [t.lower() for t in re.split(r"[\s\-_/]+", model) if len(t) > 2]

    # Map the site to discover URLs
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{FIRECRAWL_API_BASE}/map",
                headers=headers,
                json={"url": base_url, "limit": 500},
            )
            resp.raise_for_status()
            all_urls: list[str] = resp.json().get("links", [])
    except Exception as e:
        logger.error("[%s] Firecrawl map failed: %s", job_id, e)
        return []

    logger.info("[%s] Mapped %d URLs from %s", job_id, len(all_urls), base_url)

    # Filter for URLs that contain model tokens and look like docs/PDFs
    _DOC_RE = re.compile(r"\.(pdf|htm|html)$|/manual|/document|/datasheet|/guide|/spec", re.I)
    matched = [
        u for u in all_urls if any(t in u.lower() for t in model_tokens) and _DOC_RE.search(u)
    ]

    if not matched:
        # Loosen: any doc URL containing any model token
        matched = [u for u in all_urls if any(t in u.lower() for t in model_tokens)]

    logger.info("[%s] Matched %d URLs for model %r", job_id, len(matched), model)
    return await _scrape_urls(job_id, matched[:5], model)


async def _firecrawl_search_model(job_id: str, manufacturer: str, model: str) -> list[dict]:
    """Use Firecrawl search endpoint to find docs when no known base URL."""
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    query = f"{manufacturer} {model} manual datasheet PDF"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{FIRECRAWL_API_BASE}/search",
                headers=headers,
                json={"query": query, "limit": 5},
            )
            resp.raise_for_status()
            results = resp.json().get("data", [])
    except Exception as e:
        logger.error("[%s] Firecrawl search failed: %s", job_id, e)
        return []

    urls = [r.get("url") for r in results if r.get("url")]
    logger.info("[%s] Search found %d URLs for %r %r", job_id, len(urls), manufacturer, model)
    return await _scrape_urls(job_id, urls[:3], model)


async def _scrape_urls(job_id: str, urls: list[str], model: str) -> list[dict]:
    """Scrape a list of URLs, return list of {filename, content} dicts."""
    results = []
    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{FIRECRAWL_API_BASE}/scrape",
                    headers={
                        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={"url": url, "formats": ["markdown"]},
                )
                if resp.status_code != 200:
                    logger.warning("[%s] Scrape %s returned %d", job_id, url[:80], resp.status_code)
                    continue
                data = resp.json()
                content = (
                    data.get("data", {}).get("markdown")
                    or data.get("markdown")
                    or data.get("content")
                    or ""
                )
                if len(content) >= 100:
                    # Derive a clean filename from URL
                    slug = re.sub(r"[^a-z0-9_\-]", "_", url.split("/")[-1].lower())[:40] or "doc"
                    fname = f"{model[:20]}_{slug}.txt".replace(" ", "_")
                    results.append({"filename": fname, "content": content, "source_url": url})
                    logger.info("[%s] Scraped %s: %d chars", job_id, url[:80], len(content))
        except Exception as e:
            logger.error("[%s] Scrape error for %s: %s", job_id, url[:80], e)

    return results


# ---------------------------------------------------------------------------
# Apify scraping backend (used when FIRECRAWL_API_KEY is absent)
# ---------------------------------------------------------------------------


def _apify_items_to_docs(job_id: str, items: list, model: str) -> list[dict]:
    """Convert Apify dataset items to the {filename, content, source_url} shape."""
    results = []
    for item in items:
        content = item.get("markdown") or item.get("text") or ""
        url = item.get("url", "")
        if len(content) < 100:
            continue
        slug = re.sub(r"[^a-z0-9_\-]", "_", url.split("/")[-1].lower())[:40] or "doc"
        fname = f"{model[:20]}_{slug}.txt".replace(" ", "_")
        results.append({"filename": fname, "content": content, "source_url": url})
        logger.info("[%s] Apify doc: %s (%d chars)", job_id, url[:80], len(content))
    return results[:5]


async def _apify_map_and_scrape(
    job_id: str, base_url: str, model: str
) -> tuple[list[dict], str]:
    """Crawl a known manufacturer doc site with Apify, filter by model tokens.

    Returns (docs, apify_run_id). run_id is "" on failure.
    """
    import urllib.parse as _up

    model_tokens = [t.lower() for t in re.split(r"[\s\-_/]+", model) if len(t) > 2]
    globs = [{"glob": f"**/*{_up.quote(t)}*"} for t in model_tokens[:3]]

    run_input = {
        "startUrls": [{"url": base_url}],
        "maxCrawlDepth": 1,
        "maxCrawlPages": 100,
        "crawlerType": "cheerio",
        "outputFormats": ["markdown"],
        "globs": globs if globs else [{"glob": "**/*.pdf"}, {"glob": "**/*manual*"}],
    }

    def _run_sync() -> tuple[list, str]:
        from apify_client import ApifyClient  # type: ignore

        client = ApifyClient(APIFY_API_KEY)
        run = client.actor("apify/website-content-crawler").call(
            run_input=run_input, timeout_secs=180
        )
        run_id = (run or {}).get("id", "")
        dataset_id = (run or {}).get("defaultDatasetId")
        if not dataset_id:
            return [], run_id
        return list(client.dataset(dataset_id).list_items().items), run_id

    loop = asyncio.get_event_loop()
    try:
        items, apify_run_id = await loop.run_in_executor(None, _run_sync)
    except Exception as e:
        logger.error("[%s] Apify map+scrape failed: %s", job_id, e)
        return [], ""

    logger.info("[%s] Apify returned %d items from %s", job_id, len(items), base_url)
    return _apify_items_to_docs(job_id, items, model), apify_run_id


async def _apify_search_model(
    job_id: str, manufacturer: str, model: str
) -> tuple[list[dict], str]:
    """Use Apify to crawl a DuckDuckGo search when no known manufacturer base URL exists.

    Returns (docs, apify_run_id). run_id is "" on failure.
    """
    import urllib.parse as _up

    encoded = _up.quote_plus(f"{manufacturer} {model} manual datasheet")
    search_url = f"https://html.duckduckgo.com/html/?q={encoded}"

    run_input = {
        "startUrls": [{"url": search_url}],
        "maxCrawlDepth": 1,
        "maxCrawlPages": 5,
        "crawlerType": "cheerio",
        "outputFormats": ["markdown"],
    }

    def _run_sync() -> tuple[list, str]:
        from apify_client import ApifyClient  # type: ignore

        client = ApifyClient(APIFY_API_KEY)
        run = client.actor("apify/website-content-crawler").call(
            run_input=run_input, timeout_secs=120
        )
        run_id = (run or {}).get("id", "")
        dataset_id = (run or {}).get("defaultDatasetId")
        if not dataset_id:
            return [], run_id
        return list(client.dataset(dataset_id).list_items().items), run_id

    loop = asyncio.get_event_loop()
    try:
        items, apify_run_id = await loop.run_in_executor(None, _run_sync)
    except Exception as e:
        logger.error("[%s] Apify search failed: %s", job_id, e)
        return [], ""

    logger.info("[%s] Apify search returned %d items", job_id, len(items))
    return _apify_items_to_docs(job_id, items, manufacturer), apify_run_id


async def _ingest_scraped_text(
    filename: str,
    content: str,
    equipment_type: str = "",
    run_id: str = "",
) -> bool:
    """Push scraped markdown text to Open WebUI KB via the existing collection routing.

    Returns True if the KB file/add call returned HTTP 200/201, False otherwise.
    run_id is used for log correlation with the crawl verifier.
    """
    if not OPENWEBUI_URL or not OPENWEBUI_API_KEY:
        return False

    col_name, col_desc = _route_collection(filename, equipment_type or None)
    collection_id = await _get_or_create_kb_collection(col_name, col_desc)

    headers: dict[str, str] = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"

    encoded = content.encode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/files/",
                headers=headers,
                files={"file": (filename, encoded, "text/plain")},
            )
            resp.raise_for_status()
            file_id = resp.json().get("id")
    except Exception as exc:
        logger.error(
            "KB file upload failed run_id=%s filename=%s: %s", run_id or "?", filename, exc
        )
        return False

    if not file_id:
        return False

    kb_ok = False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            kb_resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/knowledge/{collection_id}/file/add",
                headers={**headers, "Content-Type": "application/json"},
                json={"file_id": file_id},
            )
            kb_ok = kb_resp.status_code in (200, 201)
            if not kb_ok:
                logger.warning(
                    "KB file/add returned %d run_id=%s filename=%s: %s",
                    kb_resp.status_code,
                    run_id or "?",
                    filename,
                    kb_resp.text[:200],
                )
    except Exception as exc:
        logger.error(
            "KB file/add failed run_id=%s filename=%s: %s", run_id or "?", filename, exc
        )

    logger.info(
        "Scraped text ingested: %s → collection=%s kb_ok=%s run_id=%s",
        filename,
        col_name,
        kb_ok,
        run_id or "?",
    )
    return kb_ok


async def _notify_telegram(chat_id: str, message: str) -> None:
    """Send a proactive Telegram message using the bot token from Doppler."""
    if not chat_id or not TELEGRAM_BOT_TOKEN:
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"},
            )
            if resp.status_code == 200:
                logger.info("Telegram notification sent to chat_id=%s", chat_id)
            else:
                logger.warning("Telegram notify failed: %d %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("Telegram notify error (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Crawl verification endpoints
# ---------------------------------------------------------------------------


@app.get("/ingest/crawl-verifications")
async def get_crawl_verifications(limit: int = 50):
    """Return the most recent crawl verification records (newest first).

    Used by the eval loop, future dashboard, and manual inspection.
    Each record contains: run_id, manufacturer, model, outcome, page_count,
    shell_ratio, content_density, model_keyword_hit, kb_writes, timestamps.
    """
    records = list_verifications(limit=min(limit, 200))
    return {
        "count": len(records),
        "records": records,
    }


class HistoricalClassifyRequest(BaseModel):
    apify_run_id: str
    manufacturer: str
    model: str
    job_id: str = "historical"


@app.post("/ingest/crawl-classify-historical")
async def classify_historical_run(body: HistoricalClassifyRequest):
    """Classify a historical Apify run after-the-fact.

    Used for retroactive analysis of past crawls (e.g. Yaskawa V1000 Brgo1xN4QLjhr0Pgc).
    Fetches the dataset from Apify, runs the quality gate, and writes a verification record.
    """
    result = await classify_historical(
        apify_run_id=body.apify_run_id,
        manufacturer=body.manufacturer,
        model=body.model,
        job_id=body.job_id,
    )
    return result


# ---------------------------------------------------------------------------
# Reddit Benchmark Agent routes
# ---------------------------------------------------------------------------

# Feature flag — set REDDIT_BENCHMARK_ENABLED=1 to activate
_BENCHMARK_ENABLED = os.getenv("REDDIT_BENCHMARK_ENABLED", "0") == "1"

# Lazy imports for benchmark_db — only when needed
_benchmark_db = None


def _get_benchmark_db():
    global _benchmark_db
    if _benchmark_db is None:
        # benchmark_db lives in mira-bots/shared — add to path if needed
        bots_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "mira-bots",
        )
        if bots_path not in sys.path:
            sys.path.insert(0, bots_path)
        import shared.benchmark_db as bdb

        bdb.DB_PATH = DB_PATH
        bdb.ensure_tables()
        _benchmark_db = bdb
    return _benchmark_db


def _check_benchmark_flag():
    if not _BENCHMARK_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Reddit benchmark agent disabled. Set REDDIT_BENCHMARK_ENABLED=1",
        )


@app.post("/agents/reddit-benchmark/harvest")
async def benchmark_harvest():
    """Trigger a Reddit harvest. Requires feature flag."""
    _check_benchmark_flag()
    # Import harvester at call time
    scripts_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "scripts",
    )
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    try:
        from reddit_harvest import harvest
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Harvest import failed: {exc}")
    result = harvest(db_path=DB_PATH)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@app.get("/agents/reddit-benchmark/questions")
async def benchmark_questions(limit: int = 50, offset: int = 0):
    """List harvested benchmark questions."""
    _check_benchmark_flag()
    bdb = _get_benchmark_db()
    questions = bdb.list_questions(limit=limit, offset=offset, db_path=DB_PATH)
    total = bdb.count_questions(db_path=DB_PATH)
    return {"questions": questions, "total": total}


@app.get("/agents/reddit-benchmark/runs")
async def benchmark_runs(limit: int = 20):
    """List benchmark runs."""
    _check_benchmark_flag()
    bdb = _get_benchmark_db()
    runs = bdb.list_runs(limit=limit, db_path=DB_PATH)
    return {"runs": runs}


@app.get("/agents/reddit-benchmark/runs/{run_id}/results")
async def benchmark_results(run_id: int):
    """Get results for a specific benchmark run."""
    _check_benchmark_flag()
    bdb = _get_benchmark_db()
    run = bdb.get_run(run_id, db_path=DB_PATH)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    results = bdb.list_results(run_id, db_path=DB_PATH)
    return {"run": run, "results": results}


@app.get("/agents/reddit-benchmark/runs/{run_id}/report")
async def benchmark_report(run_id: int):
    """Generate a report for a benchmark run."""
    _check_benchmark_flag()
    # Import report generator at call time
    bots_scripts = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "mira-bots",
        "scripts",
    )
    if bots_scripts not in sys.path:
        sys.path.insert(0, bots_scripts)
    try:
        from reddit_benchmark_report import generate_report
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"Report import failed: {exc}")
    report = generate_report(run_id, db_path=DB_PATH)
    if "error" in report:
        raise HTTPException(status_code=404, detail=report["error"])
    return {"summary": report["summary"], "console": report["console"]}
