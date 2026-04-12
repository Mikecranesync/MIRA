"""MIRA Pipeline — OpenAI-compatible API wrapping GSDEngine.

Open WebUI connects to this service as an additional model provider.
The pipeline appears as "MIRA Diagnostic" in the model selector.
All chat messages routed to this model go through the full GSD
diagnostic workflow (FSM, RAG, guardrails, safety keywords).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
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

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="MIRA Pipeline", docs_url=None, redoc_url=None)

engine: GSDEngine | None = None


@app.on_event("startup")
async def _startup():
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


# ── Auth middleware ──────────────────────────────────────────────────────────


@app.middleware("http")
async def _auth(request: Request, call_next):
    if request.url.path in ("/health",):
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

    # Extract user identity from Open WebUI forwarded headers (per-conversation)
    chat_id = (
        request.headers.get("X-OpenWebUI-Chat-Id")
        or request.headers.get("x-openwebui-chat-id")
        or (req.user.get("id") if isinstance(req.user, dict) else None)
        or (req.user if isinstance(req.user, str) and req.user else None)
        or (req.metadata.get("chat_id") if req.metadata else None)
        or "openwebui_anonymous"
    )

    t0 = time.monotonic()
    reply = await engine.process(
        chat_id=chat_id,
        message=last_user_msg,
        photo_b64=photo_b64,
        platform="openwebui",
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    logger.info("PIPELINE_CALL chat_id=%s latency_ms=%d len=%d", chat_id, latency_ms, len(reply))

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
