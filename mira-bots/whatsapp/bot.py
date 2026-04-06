"""MIRA WhatsApp Bot — Twilio WhatsApp Sandbox (MIT-compatible).

Prerequisites (manual — see docs/SETUP_WHATSAPP.md):
  1. Twilio account + WhatsApp Sandbox activated
  2. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in Doppler
  3. Webhook URL: https://<domain>:8010/webhook (configured in Twilio console)

Session ID format: {MIRA_TENANT_ID}_whatsapp_{phone_number}
"""

import base64
import io as _io
import logging
import os

import httpx
from fastapi import FastAPI, Form, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from PIL import Image
from twilio.request_validator import RequestValidator

from shared.adapters.base import MIRAAdapter
from shared.gsd_engine import GSDEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-whatsapp")

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "default")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")
MAX_VISION_PX = int(os.environ.get("MAX_VISION_PX", "512"))
VALIDATE_TWILIO = os.environ.get("TWILIO_VALIDATE_SIGNATURE", "true").lower() == "true"

engine = GSDEngine(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)

validator = RequestValidator(TWILIO_AUTH_TOKEN) if TWILIO_AUTH_TOKEN else None


class WhatsAppAdapter(MIRAAdapter):
    platform = "whatsapp"

    async def send_photo(
        self, image_bytes: bytes, session_id: str, caption: str = ""
    ) -> str:
        resized = _resize_for_vision(image_bytes)
        photo_b64 = base64.b64encode(resized).decode("utf-8")
        return await engine.process(session_id, caption or "Analyze this equipment", photo_b64=photo_b64, platform="whatsapp")

    async def send_text(self, text: str, session_id: str) -> str:
        return await engine.process(session_id, text, platform="whatsapp")

    async def format_response(self, raw_response: str) -> str:
        # WhatsApp supports basic markdown: *bold*, _italic_
        return raw_response


whatsapp_adapter = WhatsAppAdapter()


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


async def _download_media(url: str) -> bytes:
    auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    async with httpx.AsyncClient(timeout=30, auth=auth) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


app = FastAPI(title="MIRA WhatsApp Bot", docs_url=None, redoc_url=None)


@app.get("/health")
async def health():
    return {"status": "ok", "platform": "whatsapp"}


@app.post("/webhook")
async def webhook(
    request: Request,
    From: str = Form(...),
    Body: str = Form(""),
    NumMedia: str = Form("0"),
    MediaUrl0: str = Form(""),
    MediaContentType0: str = Form(""),
):
    """Twilio WhatsApp webhook — receives incoming messages."""
    # Validate Twilio signature in production
    if VALIDATE_TWILIO and validator:
        form_data = await request.form()
        url = str(request.url)
        signature = request.headers.get("X-Twilio-Signature", "")
        if not validator.validate(url, dict(form_data), signature):
            logger.warning("Invalid Twilio signature — rejecting request")
            return PlainTextResponse("Forbidden", status_code=403)

    phone = From.replace("whatsapp:", "")
    session_id = whatsapp_adapter.build_session_id(MIRA_TENANT_ID, phone)
    num_media = int(NumMedia or "0")

    try:
        if num_media > 0 and MediaContentType0.startswith("image/"):
            image_bytes = await _download_media(MediaUrl0)
            reply = await whatsapp_adapter.send_photo(image_bytes, session_id, caption=Body)
        else:
            reply = await whatsapp_adapter.send_text(Body or "Hello", session_id)
    except Exception as e:
        reply = await whatsapp_adapter.handle_error(e)

    # Respond with TwiML
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message to="{From}">{reply}</Message>
</Response>"""
    return PlainTextResponse(twiml, media_type="application/xml")
