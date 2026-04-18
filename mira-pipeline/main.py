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
import sqlite3
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import BaseModel
from starlette.responses import JSONResponse

# GSDEngine lives in shared/ — mounted at build time from mira-bots/
sys.path.insert(0, os.path.dirname(__file__))
import threading

from feedback_sync import run_loop as feedback_sync_loop
from memory import ConversationMemory
from shared.gsd_engine import GSDEngine

# Explicit handler setup: logging.basicConfig() is a no-op once uvicorn has
# already installed its own handlers on the root logger, so we configure our
# named logger directly to guarantee PIPELINE_CALL lines appear in docker logs.
logger = logging.getLogger("mira-pipeline")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
logger.propagate = True

# ── Configuration ────────────────────────────────────────────────────────────

PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")
DB_PATH = os.getenv("MIRA_DB_PATH", "/data/mira.db")
OPENWEBUI_URL = os.getenv("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.getenv("OPENWEBUI_API_KEY", "")
COLLECTION_ID = os.getenv("KNOWLEDGE_COLLECTION_ID", "")
VISION_MODEL = os.getenv("VISION_MODEL", "qwen2.5vl:7b")
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
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


# ── Regenerate helpers (P0-2) ────────────────────────────────────────────────


def _detect_and_rollback_regenerate(db_path: str, chat_id: str, user_message: str) -> bool:
    """Detect an OW Regenerate and roll back FSM state if confirmed.

    Open WebUI's Regenerate button strips the last assistant message and
    resends the identical user query.  The GSD engine would then advance the
    FSM a second time for the same turn, corrupting diagnostic state.

    Detection: query the ``interactions`` table for the most recent entry for
    this chat_id.  If ``user_message`` matches, it is a regenerate.

    Rollback: find the FSM state from the interaction BEFORE the last one and
    write it back to ``conversation_state``.  The engine will then re-process
    the message starting from the correct prior state.

    Returns True if a rollback was performed, False otherwise.
    """
    try:
        db = sqlite3.connect(db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.row_factory = sqlite3.Row

        rows = db.execute(
            """SELECT id, user_message, fsm_state
               FROM interactions
               WHERE chat_id = ?
               ORDER BY id DESC
               LIMIT 2""",
            (chat_id,),
        ).fetchall()

        if not rows:
            db.close()
            return False

        last = rows[0]
        if last["user_message"].strip() != user_message.strip():
            db.close()
            return False

        # It's a regenerate.  Determine the state to restore:
        # rows[1] is the interaction *before* the one we're rolling back, so
        # its fsm_state is the FSM position we should restart from.
        # If there is no prior row the session started at IDLE.
        prior_state = rows[1]["fsm_state"] if len(rows) > 1 else "IDLE"
        prior_state = prior_state or "IDLE"

        db.execute(
            """UPDATE conversation_state
               SET state = ?, updated_at = CURRENT_TIMESTAMP
               WHERE chat_id = ?""",
            (prior_state, chat_id),
        )
        # Also remove the last interaction row so history stays consistent
        db.execute("DELETE FROM interactions WHERE id = ?", (last["id"],))
        db.commit()
        db.close()

        logger.info(
            "P0-2 REGENERATE chat_id=%s rolled back to state=%s (was: %s)",
            chat_id, prior_state, last["fsm_state"],
        )
        return True

    except Exception as exc:
        logger.warning("P0-2 regenerate check failed (non-fatal): %s", exc)
        return False


# ── App ──────────────────────────────────────────────────────────────────────

engine: GSDEngine | None = None
memory: ConversationMemory | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine, memory
    engine = GSDEngine(
        db_path=DB_PATH,
        openwebui_url=OPENWEBUI_URL,
        api_key=OPENWEBUI_API_KEY,
        collection_id=COLLECTION_ID,
        vision_model=VISION_MODEL,
        tenant_id=TENANT_ID or None,
    )
    try:
        memory = ConversationMemory()
        logger.info("ConversationMemory enabled")
    except Exception as e:
        logger.warning("ConversationMemory disabled: %s", e)
        memory = None
    # Start feedback sync background thread (polls Open WebUI DB for new ratings)
    sync_thread = threading.Thread(target=feedback_sync_loop, daemon=True)
    sync_thread.start()
    logger.info("MIRA Pipeline started — GSDEngine initialized (db=%s)", DB_PATH)
    yield
    engine = None
    memory = None


app = FastAPI(title="MIRA Pipeline", docs_url=None, redoc_url=None, lifespan=lifespan)

from eval_api import router as _eval_router  # noqa: E402
app.include_router(_eval_router)


# ── Auth middleware ──────────────────────────────────────────────────────────


@app.middleware("http")
async def _auth(request: Request, call_next):
    if request.url.path in ("/health", "/v1/models", "/eval/latest", "/eval/list", "/webhook/signup"):
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

    # Open WebUI sends synthetic task messages that must NOT touch the GSD engine.
    # There are two distinct subtypes with different correct responses:
    #
    # 1. "### Task: Continue generating …" — the Continue button.  OW expects the
    #    response to be the continued text, not empty.  Return the last assistant
    #    turn verbatim so the UI shows something and the FSM does not advance.
    #
    # 2. All other "### Task:" / "Suggest " variants — follow-up suggestions,
    #    title generation, etc.  Return empty; OW discards these internally.
    stripped_msg = last_user_msg.lstrip()
    if stripped_msg.startswith("### Task: Continue"):
        # P0-1 FIX: find the last assistant message in history and echo it back.
        last_assistant = ""
        for msg in reversed(req.messages):
            if msg.role == "assistant":
                content = msg.content
                if isinstance(content, list):
                    last_assistant = " ".join(
                        p.get("text", "") for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ).strip()
                else:
                    last_assistant = str(content)
                break
        logger.info("P0-1 CONTINUE intercepted — echoing last assistant turn (%d chars)", len(last_assistant))
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "mira-diagnostic",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": last_assistant},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    if stripped_msg.startswith("### Task:") or stripped_msg.startswith("Suggest "):
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
    reset_phrases = (
        "/reset",
        "reset",
        "start over",
        "new session",
        "never mind",
        "nevermind",
        "wrong chat",
        "ignore that",
        "that wasn't for you",
        "that wasnt for you",
        "scratch that",
    )
    if last_user_msg.strip().lower() in reset_phrases or any(
        last_user_msg.strip().lower().startswith(p) for p in ("never mind", "nevermind", "wrong ")
    ):
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

    # P0-2: Detect regenerate — if OW is replaying the same user message for
    # this chat session, roll the FSM back to its pre-turn state before calling
    # the engine so we don't advance the diagnostic state twice.
    _detect_and_rollback_regenerate(DB_PATH, chat_id, last_user_msg)

    # Resize image for vision model (matches Telegram bot behavior)
    if photo_b64:
        photo_b64 = _resize_for_vision(photo_b64)

    # Memory retrieval — inject past facts into the message context
    memory_block = ""
    if memory and chat_id != "openwebui_anonymous":
        try:
            memories = memory.search(chat_id, last_user_msg)
            memory_block = memory.format_memory_block(memories)
            if memory_block:
                logger.info("MEMORY_INJECT chat_id=%s memories=%d", chat_id, len(memories))
        except Exception as e:
            logger.warning("Memory search failed: %s", e)

    # Prepend memory context to the user message so the engine sees it
    effective_message = last_user_msg
    if memory_block:
        effective_message = (
            f"[MIRA MEMORY — facts from this session]\n{memory_block}\n"
            f"[END MEMORY]\n\n{last_user_msg}"
        )

    t0 = time.monotonic()
    try:
        reply = await engine.process(
            chat_id=chat_id,
            message=effective_message,
            photo_b64=photo_b64,
            platform="openwebui",
        )
    except Exception as e:
        logger.error("ENGINE_ERROR chat_id=%s: %s", chat_id, e)
        reply = "MIRA encountered an error processing your request. Please try again."
    latency_ms = int((time.monotonic() - t0) * 1000)
    logger.info("PIPELINE_CALL chat_id=%s latency_ms=%d len=%d", chat_id, latency_ms, len(reply))

    # Memory extraction — store facts from this turn (non-blocking)
    if memory and chat_id != "openwebui_anonymous":
        try:
            memory.extract_and_store(chat_id, last_user_msg, reply)
        except Exception as e:
            logger.warning("Memory extract failed: %s", e)

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


# ── Debug: Session Photo — GET /v1/debug/photo/{chat_id} ────────────────────


@app.get("/v1/debug/photo/{chat_id}")
async def get_session_photo(chat_id: str):
    """Return the session photo for a given chat_id (debugging)."""
    from starlette.responses import FileResponse

    photo_dir = Path(DB_PATH).parent / "session_photos"
    photo_path = photo_dir / f"{chat_id}.jpg"
    if not photo_path.exists():
        raise HTTPException(404, f"No session photo for chat {chat_id}")
    return FileResponse(str(photo_path), media_type="image/jpeg")


# ── Debug: Conversation State — GET /v1/debug/state/{chat_id} ───────────────


@app.get("/v1/debug/state/{chat_id}")
async def get_conversation_state(chat_id: str):
    """Return full conversation state for debugging."""
    import sqlite3 as _sqlite3

    db = _sqlite3.connect(DB_PATH)
    db.row_factory = _sqlite3.Row
    row = db.execute("SELECT * FROM conversation_state WHERE chat_id = ?", (chat_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, f"No state for chat {chat_id}")
    import json as _json

    ctx = _json.loads(row["context"]) if row["context"] else {}
    return {
        "chat_id": row["chat_id"],
        "state": row["state"],
        "exchange_count": row["exchange_count"],
        "asset_identified": row["asset_identified"],
        "fault_category": row["fault_category"],
        "history": ctx.get("history", []),
        "session_context": ctx.get("session_context", {}),
        "photo_url": f"/v1/debug/photo/{chat_id}",
    }


# ── Debug: Recent Sessions — GET /v1/debug/sessions ─────────────────────────


@app.get("/v1/debug/sessions")
async def list_recent_sessions():
    """List recent conversation sessions for debugging."""
    import sqlite3 as _sqlite3

    db = _sqlite3.connect(DB_PATH)
    db.row_factory = _sqlite3.Row
    rows = db.execute(
        "SELECT chat_id, state, exchange_count, asset_identified, updated_at "
        "FROM conversation_state ORDER BY rowid DESC LIMIT 10"
    ).fetchall()
    db.close()
    photo_dir = Path(DB_PATH).parent / "session_photos"
    return [
        {
            "chat_id": r["chat_id"],
            "state": r["state"],
            "exchanges": r["exchange_count"],
            "asset": (r["asset_identified"] or "")[:80],
            "has_photo": (photo_dir / f"{r['chat_id']}.jpg").exists(),
        }
        for r in rows
    ]


# ── Debug: API Spend — GET /v1/debug/spend ──────────────────────────────────


@app.get("/v1/debug/spend")
async def api_spend():
    """Return API spend breakdown: today, 7-day, 30-day, by provider."""
    import sqlite3 as _sqlite3

    db = _sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")

    def _query(where: str) -> list[dict]:
        rows = db.execute(
            f"SELECT model, COUNT(*) as calls, "
            f"COALESCE(SUM(input_tokens),0) as input_tokens, "
            f"COALESCE(SUM(output_tokens),0) as output_tokens "
            f"FROM api_usage WHERE {where} GROUP BY model ORDER BY input_tokens DESC"
        ).fetchall()
        results = []
        for r in rows:
            model, calls, inp, out = r
            if "claude" in (model or "").lower():
                cost = (inp * 0.000003) + (out * 0.000015)
            else:
                cost = 0.0
            results.append(
                {"model": model, "calls": calls, "input": inp, "output": out, "cost": round(cost, 4)}
            )
        return results

    today = _query("DATE(timestamp) = DATE('now')")
    week = _query("timestamp > datetime('now', '-7 days')")
    month = _query("timestamp > datetime('now', '-30 days')")

    total_row = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) "
        "FROM api_usage"
    ).fetchone()
    db.close()

    def _sum_cost(rows: list[dict]) -> float:
        return round(sum(r["cost"] for r in rows), 4)

    return {
        "today": {"providers": today, "total_cost": _sum_cost(today)},
        "7_day": {"providers": week, "total_cost": _sum_cost(week)},
        "30_day": {"providers": month, "total_cost": _sum_cost(month)},
        "all_time": {"calls": total_row[0], "input_tokens": total_row[1], "output_tokens": total_row[2]},
        "daily_cap": float(os.getenv("CLAUDE_DAILY_SPEND_CAP", "1.00")),
    }


# ── Feedback — POST /v1/feedback ────────────────────────────────────────────


class FeedbackRequest(BaseModel):
    chat_id: str
    rating: str  # "up" or "down"
    reason: str = ""
    model_config = {"extra": "allow"}


@app.post("/v1/feedback")
async def submit_feedback(req: FeedbackRequest):
    """Capture thumbs-up/down rating and write to mira.db feedback_log."""
    if engine is None:
        raise HTTPException(503, "GSDEngine not initialized")

    feedback = "positive" if req.rating in ("up", "1", "positive") else "negative"
    engine.log_feedback(req.chat_id, feedback, req.reason)
    logger.info("FEEDBACK chat_id=%s rating=%s reason=%r", req.chat_id, feedback, req.reason)
    return {"ok": True, "chat_id": req.chat_id, "feedback": feedback}


# ── Learning Stats — GET /v1/learning-stats ─────────────────────────────────


@app.get("/v1/learning-stats")
async def learning_stats():
    """Return feedback counts and fine-tune readiness."""
    import sqlite3 as _sqlite3

    db = _sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")

    total_approved = db.execute(
        "SELECT COUNT(*) FROM feedback_log WHERE feedback = 'positive'"
    ).fetchone()[0]
    total_rejected = db.execute(
        "SELECT COUNT(*) FROM feedback_log WHERE feedback = 'negative'"
    ).fetchone()[0]
    approved_today = db.execute(
        "SELECT COUNT(*) FROM feedback_log WHERE feedback = 'positive' AND created_at >= date('now')"
    ).fetchone()[0]
    total_conversations = db.execute("SELECT COUNT(*) FROM conversation_state").fetchone()[0]
    db.close()

    min_examples = 50
    return {
        "total_approved": total_approved,
        "total_rejected": total_rejected,
        "approved_today": approved_today,
        "total_conversations": total_conversations,
        "current_model_version": "v0.6.0-base",
        "min_examples_needed": min_examples,
        "ready_to_finetune": total_approved >= min_examples,
        "days_until_finetune": max(0, min_examples - total_approved),
    }


# ── Memory Stats — GET /v1/memory-stats ─────────────────────────────────────


@app.get("/v1/memory-stats")
async def memory_stats():
    """Return memory store statistics."""
    if memory is None:
        return {"enabled": False}
    stats = memory.get_stats()
    stats["enabled"] = True
    return stats


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


# ── Webhook: new user signup notification ───────────────────────────────────

_SMTP_HOST = "smtp.gmail.com"
_SMTP_PORT = 587
_GOOGLE_USER = os.getenv("GOOGLE_USER", "mike@cranesync.com")
_GOOGLE_APP_PASSWORD = os.getenv("GOOGLE_APP_PASSWORD", "")
_ADMIN_EMAIL = os.getenv("OPENWEBUI_ADMIN_EMAIL", "mike@cranesync.com")


@app.post("/webhook/signup")
async def webhook_signup(request: Request):
    """Receive Open WebUI signup webhook → email admin."""
    if not _GOOGLE_APP_PASSWORD:
        logger.warning("GOOGLE_APP_PASSWORD not set — signup notification skipped")
        return {"status": "skipped", "reason": "no smtp credentials"}

    try:
        body = await request.json()
    except Exception:
        return {"status": "error", "reason": "invalid json"}

    user_data = body.get("user", "{}")
    if isinstance(user_data, str):
        import json as _json
        try:
            user_data = _json.loads(user_data)
        except Exception:
            user_data = {}

    user_name = user_data.get("name", body.get("message", "Unknown"))
    user_email = user_data.get("email", "unknown")

    subject = f"New MIRA signup: {user_name}"
    text = (
        f"New user signed up for MIRA:\n\n"
        f"  Name:  {user_name}\n"
        f"  Email: {user_email}\n"
        f"  Role:  {user_data.get('role', 'user')}\n\n"
        f"Login at app.factorylm.com to manage users."
    )

    import smtplib
    from email.mime.text import MIMEText

    try:
        msg = MIMEText(text)
        msg["Subject"] = subject
        msg["From"] = _GOOGLE_USER
        msg["To"] = _ADMIN_EMAIL

        with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT) as server:
            server.starttls()
            server.login(_GOOGLE_USER, _GOOGLE_APP_PASSWORD)
            server.sendmail(_GOOGLE_USER, _ADMIN_EMAIL, msg.as_string())

        logger.info("Signup notification sent to %s for user %s", _ADMIN_EMAIL, user_email)
        return {"status": "sent"}
    except Exception as e:
        logger.error("Failed to send signup notification: %s", e)
        return {"status": "error", "reason": str(e)}
