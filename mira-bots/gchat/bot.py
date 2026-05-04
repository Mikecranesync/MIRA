"""MIRA Google Chat Bot — synchronous HTTP webhook (aiohttp).

Google Chat posts events to this endpoint and expects the response
in the HTTP response body (synchronous). No separate API call needed
for basic reply flows.

Prerequisites (see docs/ops/gchat-install-runbook.md):
  1. GCP project with Chat API enabled
  2. Service account with domain-wide delegation
  3. GCHAT_SERVICE_ACCOUNT_JSON in Doppler factorylm/prd
  4. Webhook URL set to https://<domain>/gchat/events
"""

import io as _io
import json
import logging
import os

from aiohttp import web
from chat_adapter import GoogleChatAdapter
from PIL import Image
from shared.chat.dispatcher import ChatDispatcher
from shared.chat.renderers.gchat_cards import render_gchat
from shared.engine import Supervisor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-gchat")

# Service account JSON — Doppler-managed, base64-encoded string or raw JSON
_SA_JSON = os.environ.get("GCHAT_SERVICE_ACCOUNT_JSON", "{}")
GCHAT_VERIFICATION_TOKEN = os.environ.get("GCHAT_VERIFICATION_TOKEN", "")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")
MAX_VISION_PX = int(os.environ.get("MAX_VISION_PX", "512"))

try:
    _sa_info = json.loads(_SA_JSON) if _SA_JSON and _SA_JSON != "{}" else {}
except (json.JSONDecodeError, ValueError):
    _sa_info = _SA_JSON  # treat as base64 string

engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)

# Chat Abstraction Layer
chat_adapter = GoogleChatAdapter(service_account_info=_sa_info or {"private_key": "", "client_email": ""})
dispatcher = ChatDispatcher(engine)


def _resize_for_vision(image_bytes: bytes) -> bytes:
    img = Image.open(_io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= MAX_VISION_PX:
        return image_bytes
    scale = MAX_VISION_PX / max(w, h)
    img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _verify_token(event: dict) -> bool:
    """Check verification token if configured (optional, simple approach)."""
    if not GCHAT_VERIFICATION_TOKEN:
        return True
    return event.get("token", "") == GCHAT_VERIFICATION_TOKEN


async def handle_gchat_event(event: dict) -> dict:
    """Process a Google Chat event and return the Cards v2 response synchronously."""
    event_type = event.get("type", "")

    if event_type == "ADDED_TO_SPACE":
        return {"text": "Hi! I'm MIRA, your AI maintenance assistant. Send me a question or a photo of equipment."}

    if event_type == "REMOVED_FROM_SPACE":
        return {}

    if event_type not in ("MESSAGE", "CARD_CLICKED"):
        return {}

    normalized = await chat_adapter.normalize_incoming(event)

    # Pre-download image if present
    if normalized.attachments:
        img_att = next((a for a in normalized.attachments if a.kind == "image"), None)
        if img_att:
            try:
                raw_bytes = await chat_adapter.download_attachment(img_att)
                img_att.data = _resize_for_vision(raw_bytes)
                if not normalized.text:
                    normalized.text = "Analyze this equipment photo"
            except Exception as e:
                logger.error("Photo download error: %s", e)
                return {"text": f"MIRA error downloading photo: {e}"}

    if not normalized.text and not any(a.kind == "image" for a in normalized.attachments):
        return {}

    try:
        response = await dispatcher.dispatch(normalized)
        # Synchronous response — return Cards v2 payload in HTTP response body
        return render_gchat(response)
    except Exception as e:
        logger.error("Dispatch error: %s", e)
        return {"text": f"MIRA error: {e}"}


async def gchat_events_handler(req: web.Request) -> web.Response:
    """POST /gchat/events — Google Chat webhook endpoint."""
    try:
        event = await req.json()
    except Exception:
        return web.Response(status=400, text="invalid JSON")

    if not _verify_token(event):
        return web.Response(status=401, text="invalid token")

    try:
        result = await handle_gchat_event(event)
    except Exception as e:
        logger.error("Event handler error: %s", e)
        return web.json_response({"text": f"MIRA error: {e}"})

    return web.json_response(result)


async def health_handler(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "platform": "gchat"})


app = web.Application()
app.router.add_post("/gchat/events", gchat_events_handler)
app.router.add_get("/health", health_handler)

if __name__ == "__main__":
    port = int(os.environ.get("GCHAT_PORT", "8030"))
    logger.info("MIRA Google Chat bot starting on port %d", port)
    web.run_app(app, port=port)
