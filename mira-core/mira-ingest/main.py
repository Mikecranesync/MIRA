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
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image

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
