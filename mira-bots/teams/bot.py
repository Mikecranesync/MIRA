"""MIRA Teams Bot — Microsoft Bot Framework (botbuilder-integration-aiohttp, MIT).

Prerequisites (manual — see docs/ops/teams-install-runbook.md):
  1. Azure Bot resource created (Free F0 tier)
  2. TEAMS_APP_ID + TEAMS_APP_PASSWORD in Doppler factorylm/prd
  3. Messaging endpoint set to https://<domain>/api/messages
"""

import io as _io
import logging
import os

from aiohttp import web
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings, TurnContext
from botbuilder.schema import Activity, ActivityTypes
from chat_adapter import TeamsChatAdapter
from PIL import Image
from shared.chat.dispatcher import ChatDispatcher
from shared.engine import Supervisor

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
bf_adapter = BotFrameworkAdapter(settings)

engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)

# Chat Abstraction Layer — wraps engine in platform-agnostic protocol
chat_adapter = TeamsChatAdapter(
    app_id=TEAMS_APP_ID,
    app_password=TEAMS_APP_PASSWORD,
    tenant_id=MIRA_TENANT_ID,
)
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

        normalized = await chat_adapter.normalize_incoming(body)

        # Pre-download image attachment and resize before dispatch
        if normalized.attachments:
            img_att = next((a for a in normalized.attachments if a.kind == "image"), None)
            if img_att:
                await turn_context.send_activity(
                    Activity(type=ActivityTypes.message, text="Analyzing equipment...")
                )
                try:
                    chat_adapter._turn_context = turn_context
                    raw_bytes = await chat_adapter.download_attachment(img_att)
                    img_att.data = _resize_for_vision(raw_bytes)
                    if not normalized.text:
                        normalized.text = "Analyze this equipment photo"
                except Exception as e:
                    logger.error("Photo download error: %s", e)
                    await turn_context.send_activity(
                        Activity(
                            type=ActivityTypes.message,
                            text=f"MIRA error downloading photo: {e}",
                        )
                    )
                    return

        if not normalized.text and not any(a.kind == "image" for a in normalized.attachments):
            return

        chat_adapter._turn_context = turn_context
        try:
            response = await dispatcher.dispatch(normalized)
            await chat_adapter.render_outgoing(response, normalized)
        except Exception as e:
            logger.error("Dispatch error: %s", e)
            await turn_context.send_activity(
                Activity(type=ActivityTypes.message, text=f"MIRA error: {e}")
            )

    try:
        await bf_adapter.process_activity(activity, auth_header, turn_handler)
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
