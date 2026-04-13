"""MIRA Pipeline — OpenAI-compatible API wrapping GSDEngine.

Open WebUI connects to this service as an additional model provider.
The pipeline appears as "MIRA Diagnostic" in the model selector.
All chat messages routed to this model go through the full GSD
diagnostic workflow (FSM, RAG, guardrails, safety keywords).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import BaseModel
from starlette.responses import JSONResponse

# GSDEngine lives in shared/ — mounted at build time from mira-bots/
sys.path.insert(0, os.path.dirname(__file__))
from shared.gsd_engine import GSDEngine

logger = logging.getLogger("mira-pipeline")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

# ── Configuration ────────────────────────────────────────────────────────────

PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")
DB_PATH = os.getenv("MIRA_DB_PATH", "/data/mira.db")
OPENWEBUI_URL = os.getenv("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.getenv("OPENWEBUI_API_KEY", "")
COLLECTION_ID = os.getenv("KNOWLEDGE_COLLECTION_ID", "")
VISION_MODEL = os.getenv("VISION_MODEL", "qwen2.5vl:7b")
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
INGEST_URL = os.getenv("INGEST_SERVICE_URL", "")
MAX_VISION_PX = int(os.getenv("MAX_VISION_PX", "1024"))


# ── Image resize + ingest helpers ────────────────────────────────────────────


def _resize_for_vision(photo_b64: str) -> str:
    """Downscale base64 image to MAX_VISION_PX longest side.

    Matches Telegram bot's _resize_for_vision — cuts vision model latency.
    Returns resized base64 string (no data: prefix). Falls back to original
    if the image can't be decoded.
    """
    try:
        raw = base64.b64decode(photo_b64)
        img = Image.open(io.BytesIO(raw))
        if max(img.size) <= MAX_VISION_PX:
            return photo_b64
        w, h = img.size
        ratio = MAX_VISION_PX / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        logger.info("IMAGE_RESIZE %dx%d → %dx%d", w, h, img.width, img.height)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        logger.warning("IMAGE_RESIZE skipped: %s", e)
        return photo_b64


async def _ingest_photo_background(photo_b64: str, asset_tag: str) -> None:
    """POST photo to mira-ingest for KB storage. Non-blocking — never raises."""
    if not INGEST_URL:
        return
    try:
        photo_bytes = base64.b64decode(photo_b64)
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{INGEST_URL}/ingest/photo",
                data={"asset_tag": asset_tag},
                files={"image": ("photo.jpg", photo_bytes, "image/jpeg")},
            )
            if resp.status_code == 200:
                logger.info("INGEST_PHOTO asset=%s id=%s", asset_tag, resp.json().get("id"))
            else:
                logger.warning("INGEST_PHOTO failed %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.error("INGEST_PHOTO error: %s", e)


# ── App ──────────────────────────────────────────────────────────────────────

engine: GSDEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    engine = GSDEngine(
        db_path=DB_PATH,
        openwebui_url=OPENWEBUI_URL,
        api_key=OPENWEBUI_API_KEY,
        collection_id=COLLECTION_ID,
        vision_model=VISION_MODEL,
        tenant_id=TENANT_ID or None,
    )
    logger.info("MIRA Pipeline started — GSDEngine initialized (db=%s)", DB_PATH)
    yield
    engine = None


app = FastAPI(title="MIRA Pipeline", docs_url=None, redoc_url=None, lifespan=lifespan)


# ── Auth middleware ──────────────────────────────────────────────────────────


@app.middleware("http")
async def _auth(request: Request, call_next):
    if request.url.path in ("/health", "/v1/models"):
        return await call_next(request)
    if PIPELINE_API_KEY:
        auth = request.headers.get("Authorization", "")
        expected = f"Bearer {PIPELINE_API_KEY}"
        if auth != expected:
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return await call_next(request)


# ── Health ───────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "engine": engine is not None}


# ── OpenAI-compatible: GET /v1/models ────────────────────────────────────────


@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "mira-diagnostic",
                "object": "model",
                "created": 1700000000,
                "owned_by": "factorylm",
                "name": "MIRA Diagnostic",
                "info": {
                    "meta": {
                        "capabilities": {
                            "vision": True,
                        },
                    },
                },
            }
        ],
    }


# ── OpenAI-compatible: POST /v1/chat/completions ────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str | list


class ChatCompletionRequest(BaseModel):
    model: str = "mira-diagnostic"
    messages: list[ChatMessage]
    stream: bool = False
    user: str | dict | None = None
    metadata: dict | None = None
    model_config = {"extra": "allow"}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, req: ChatCompletionRequest):
    if engine is None:
        raise HTTPException(503, "GSDEngine not initialized")

    # Extract last user message (text content)
    last_user_msg = ""
    photo_b64 = None
    for msg in reversed(req.messages):
        if msg.role != "user":
            continue
        if isinstance(msg.content, str):
            last_user_msg = msg.content
        elif isinstance(msg.content, list):
            for part in msg.content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        last_user_msg = part.get("text", "")
                    elif part.get("type") == "image_url":
                        url = part.get("image_url", {}).get("url", "")
                        if url.startswith("data:"):
                            photo_b64 = url.split(",", 1)[-1] if "," in url else None
        break

    if not last_user_msg and not photo_b64:
        raise HTTPException(400, "No user message found")

    # Open WebUI sends synthetic "suggest follow-ups" requests after each exchange.
    # These must NOT touch the GSD engine — they advance the FSM and corrupt state.
    if last_user_msg.lstrip().startswith("### Task:") or last_user_msg.lstrip().startswith(
        "Suggest "
    ):
        logger.info("SKIP synthetic follow-up request: %s", last_user_msg[:60])
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "mira-diagnostic",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": ""},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    # Extract user identity from Open WebUI forwarded headers (per-conversation)
    chat_id = (
        request.headers.get("X-OpenWebUI-Chat-Id")
        or request.headers.get("x-openwebui-chat-id")
        or (req.user.get("id") if isinstance(req.user, dict) else None)
        or (req.user if isinstance(req.user, str) and req.user else None)
        or (req.metadata.get("chat_id") if req.metadata else None)
        or "openwebui_anonymous"
    )

    # Handle reset command — clear FSM state before processing
    if last_user_msg.strip().lower() in ("/reset", "reset", "start over", "new session"):
        engine.reset(chat_id)
        logger.info("FSM_RESET chat_id=%s", chat_id)
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "mira-diagnostic",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Conversation reset. What equipment needs help?",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    # Resize image for vision model (matches Telegram bot behavior)
    if photo_b64:
        photo_b64 = _resize_for_vision(photo_b64)

    t0 = time.monotonic()
    try:
        reply = await engine.process(
            chat_id=chat_id,
            message=last_user_msg,
            photo_b64=photo_b64,
            platform="openwebui",
        )
    except Exception as e:
        logger.error("ENGINE_ERROR chat_id=%s: %s", chat_id, e)
        reply = "MIRA encountered an error processing your request. Please try again."
    latency_ms = int((time.monotonic() - t0) * 1000)
    logger.info("PIPELINE_CALL chat_id=%s latency_ms=%d len=%d", chat_id, latency_ms, len(reply))

    # Queue photo for KB ingest in background (non-blocking)
    if photo_b64:
        asset_tag = last_user_msg.split()[0] if last_user_msg.strip() else "UNKNOWN"
        asyncio.create_task(_ingest_photo_background(photo_b64, asset_tag))

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    if req.stream:
        return _stream_response(reply, completion_id, created)

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": "mira-diagnostic",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _stream_response(reply: str, completion_id: str, created: int):
    """Yield SSE chunks in OpenAI streaming format."""

    async def _generate():
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": "mira-diagnostic",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": reply},
                    "finish_reason": None,
                }
            ],
        }
        yield f"data: {json.dumps(chunk)}\n\n"

        done_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": "mira-diagnostic",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(done_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_generate(), media_type="text/event-stream")
