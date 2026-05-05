from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from . import mira_rag, monday_api, vision
from .models import (
    AssetPlate,
    ChatMessageRequest,
    ChatMessageResponse,
    KBResult,
    MondayColumnUpdate,
    MondayUpdateResponse,
    ScanRequest,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("mira-scan")

app = FastAPI(title="MIRA Scan", version="0.1.0")

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
async def kb_lookup(make: str = "", model: str = "") -> KBResult:
    if not make and not model:
        raise HTTPException(status_code=400, detail="make or model is required")
    return await mira_rag.lookup_asset(make=make, model=model)


@app.post("/chat/message", response_model=ChatMessageResponse)
async def chat_message(req: ChatMessageRequest) -> ChatMessageResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    reply, sources = await mira_rag.chat(
        message=req.message,
        asset_id=req.asset_id,
        history=req.history,
    )
    return ChatMessageResponse(reply=reply, sources=sources)


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
