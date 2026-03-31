"""MIRA Teams Bot — Microsoft Bot Framework (botbuilder-integration-aiohttp, MIT).

Prerequisites (manual — see docs/SETUP_TEAMS.md):
  1. Azure Bot resource created (Free F0 tier)
  2. TEAMS_APP_ID + TEAMS_APP_PASSWORD in Doppler factorylm/prd
  3. Messaging endpoint set to https://<domain>/api/messages

Session ID format: {MIRA_TENANT_ID}_teams_{user_id}
"""

import base64
import io as _io
import logging
import os

import httpx
from aiohttp import web
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings, TurnContext
from botbuilder.schema import Activity, ActivityTypes
from PIL import Image

from shared.adapters.base import MIRAAdapter
from shared.gsd_engine import GSDEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-teams")

TEAMS_APP_ID = os.environ.get("TEAMS_APP_ID", "")
TEAMS_APP_PASSWORD = os.environ.get("TEAMS_APP_PASSWORD", "")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "default")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")
MAX_VISION_PX = int(os.environ.get("MAX_VISION_PX", "512"))

settings = BotFrameworkAdapterSettings(TEAMS_APP_ID, TEAMS_APP_PASSWORD)
adapter = BotFrameworkAdapter(settings)

engine = GSDEngine(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)


class TeamsAdapter(MIRAAdapter):
    platform = "teams"

    async def send_photo(
        self, image_bytes: bytes, session_id: str, caption: str = ""
    ) -> str:
        resized = _resize_for_vision(image_bytes)
        photo_b64 = base64.b64encode(resized).decode("utf-8")
        return await engine.process(session_id, caption or "Analyze this equipment", photo_b64=photo_b64, platform="teams")

    async def send_text(self, text: str, session_id: str) -> str:
        return await engine.process(session_id, text, platform="teams")

    async def format_response(self, raw_response: str) -> str:
        return raw_response  # Teams renders markdown natively


teams_adapter = TeamsAdapter()


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


async def _download_attachment(url: str, token: str) -> bytes:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()
        return resp.content


async def messages_handler(req: web.Request) -> web.Response:
    """POST /api/messages — Bot Framework webhook endpoint."""
    if "application/json" not in req.content_type:
        return web.Response(status=415)

    body = await req.json()
    activity = Activity().deserialize(body)
    auth_header = req.headers.get("Authorization", "")

    async def turn_handler(turn_context: TurnContext):
        if turn_context.activity.type != ActivityTypes.message:
            return

        user_id = turn_context.activity.from_property.id if turn_context.activity.from_property else "unknown"
        session_id = teams_adapter.build_session_id(MIRA_TENANT_ID, user_id)
        text = (turn_context.activity.text or "").strip()
        attachments = turn_context.activity.attachments or []

        image_attachments = [
            a for a in attachments
            if a.content_type and a.content_type.startswith("image/")
        ]

        try:
            if image_attachments:
                att = image_attachments[0]
                token = turn_context.activity.service_url  # placeholder — real token from adapter
                image_bytes = await _download_attachment(att.content_url, "")
                reply = await teams_adapter.send_photo(image_bytes, session_id, caption=text)
            else:
                reply = await teams_adapter.send_text(text or "Hello", session_id)
        except Exception as e:
            reply = await teams_adapter.handle_error(e)

        await turn_context.send_activity(Activity(type=ActivityTypes.message, text=reply))

    try:
        await adapter.process_activity(activity, auth_header, turn_handler)
    except Exception as e:
        logger.error("Activity processing error: %s", e)
        return web.Response(status=500)

    return web.Response(status=200)


async def health_handler(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "platform": "teams"})


app = web.Application()
app.router.add_post("/api/messages", messages_handler)
app.router.add_get("/health", health_handler)

if __name__ == "__main__":
    port = int(os.environ.get("TEAMS_PORT", "8020"))
    logger.info("MIRA Teams bot starting on port %d", port)
    web.run_app(app, port=port)
