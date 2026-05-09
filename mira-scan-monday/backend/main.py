from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from . import db, manual_search, mira_rag, monday_api, scan_queue, vision
from .models import (
    AssetPlate,
    ChatMessageRequest,
    ChatMessageResponse,
    KBResult,
    ManualRequestQueueRequest,
    ManualRequestQueueResponse,
    MondayColumnUpdate,
    MondayUpdateResponse,
    QueueAck,
    QueueStatusResponse,
    ScanRequest,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("mira-scan")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.ensure_scan_queue_table()
    yield


app = FastAPI(title="MIRA Scan", version="0.2.0", lifespan=lifespan)

_allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://*.monday.com,http://localhost:5173",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.monday\.com",
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scan/extract", response_model=AssetPlate)
async def scan_extract(req: ScanRequest) -> AssetPlate:
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    try:
        plate = await vision.extract_asset_plate(req.image_base64, req.mime_type)
    except Exception as exc:
        logger.exception("vision extract failed")
        raise HTTPException(status_code=502, detail=f"vision extract failed: {exc}") from exc
    return plate


@app.get("/kb/lookup", response_model=KBResult)
async def kb_lookup(
    background: BackgroundTasks,
    make: str = "",
    model: str = "",
) -> KBResult:
    """Identify the scanned asset against the live KB + curated allowlist.

    On miss we enqueue (make, model) into mira_scan_queue AND fire a
    background task that runs a real-time web search for the manual.
    The frontend polls `/queue/status?make=&model=` for progress.
    """
    if not make and not model:
        raise HTTPException(status_code=400, detail="make or model is required")

    result = await mira_rag.lookup_asset(make=make, model=model)
    if not result.matched:
        ack = await scan_queue.enqueue(
            make=make,
            model=model,
            source="mira-scan",
            notes="auto-enqueued from /kb/lookup miss",
        )
        if ack:
            result.queued = QueueAck(**ack)
            # Don't block the scan response on a 5–15s search.
            background.add_task(manual_search.run_search_and_update, make, model)
    return result


@app.post("/queue/search-now", response_model=ManualRequestQueueResponse)
async def queue_search_now(req: ManualRequestQueueRequest) -> ManualRequestQueueResponse:
    """Synchronous variant of the background search.

    Enqueues if needed, runs the search inline, and returns the final
    queue row state so the caller can render the result without
    polling. Slower (~5–15s) but useful for shell scripts and tests.
    """
    if not (req.make.strip() and req.model.strip()):
        raise HTTPException(status_code=400, detail="make and model are required")

    await scan_queue.enqueue(
        make=req.make,
        model=req.model,
        serial=req.serial,
        source=req.source or "mira-scan",
        notes=req.notes,
    )
    await manual_search.run_search_and_update(req.make, req.model)
    row = await scan_queue.find_one(req.make, req.model)
    if row is None:
        return ManualRequestQueueResponse(ok=False, error="queue row missing after search")
    return ManualRequestQueueResponse(
        ok=True,
        queued=QueueAck(
            id=row["id"],
            status=row["status"],
            times_seen=row["times_seen"],
            first_seen=row["first_seen"],
        ),
        item=row,
    )


@app.post("/chat/message", response_model=ChatMessageResponse)
async def chat_message(req: ChatMessageRequest) -> ChatMessageResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    reply, sources = await mira_rag.chat(
        message=req.message,
        asset_id=req.asset_id,
        asset_label=req.asset_label,
        history=req.history,
    )
    return ChatMessageResponse(reply=reply, sources=sources)


@app.post("/queue/manual-request", response_model=ManualRequestQueueResponse)
async def queue_manual_request(req: ManualRequestQueueRequest) -> ManualRequestQueueResponse:
    if not (req.make.strip() and req.model.strip()):
        raise HTTPException(status_code=400, detail="make and model are required")
    ack = await scan_queue.enqueue(
        make=req.make,
        model=req.model,
        serial=req.serial,
        source=req.source or "mira-scan",
        notes=req.notes,
    )
    if ack is None:
        return ManualRequestQueueResponse(
            ok=False,
            error="queue unavailable (NEON_DATABASE_URL unset or DB unreachable)",
        )
    return ManualRequestQueueResponse(ok=True, queued=QueueAck(**ack))


@app.get("/queue/status", response_model=QueueStatusResponse)
async def queue_status(
    limit: int = 50,
    make: str = "",
    model: str = "",
) -> QueueStatusResponse:
    """Queue summary, or — when both `make` and `model` are provided —
    a single-row lookup so the upsell screen can poll for live updates."""
    if make and model:
        row = await scan_queue.find_one(make=make, model=model)
        items = [row] if row else []
        return QueueStatusResponse(available=row is not None, counts={}, items=items)
    data = await scan_queue.status(limit=limit)
    return QueueStatusResponse(**data)


@app.post("/monday/update-item", response_model=MondayUpdateResponse)
async def monday_update_item(
    req: MondayColumnUpdate,
    request: Request,
) -> MondayUpdateResponse:
    if not req.item_id or not req.board_id:
        raise HTTPException(status_code=400, detail="item_id and board_id are required")
    if not req.columns:
        raise HTTPException(status_code=400, detail="columns must not be empty")

    session_token = request.headers.get("x-monday-session-token")
    if session_token:
        logger.debug("received monday session token (len=%d)", len(session_token))

    try:
        new_id = await monday_api.update_item_columns(
            board_id=req.board_id,
            item_id=req.item_id,
            columns=req.columns,
        )
    except monday_api.MondayError as exc:
        logger.warning("monday update failed: %s", exc)
        return MondayUpdateResponse(ok=False, error=str(exc))
    except Exception as exc:
        logger.exception("monday update unexpected error")
        return MondayUpdateResponse(ok=False, error=f"{exc.__class__.__name__}: {exc}")
    return MondayUpdateResponse(ok=True, monday_item_id=new_id)
