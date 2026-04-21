# MIRA FactoryLM — Apache 2.0
"""MIRA Slack Bot — GSD engine + direct data commands via Socket Mode."""

import asyncio
import io as _io
import logging
import os

import httpx
from chat_adapter import SlackChatAdapter
from pdf_handler import ingest_pdf
from PIL import Image
from shared.chat.dispatcher import ChatDispatcher
from shared.engine import Supervisor
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from slack_bolt.async_app import AsyncApp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-slack")

SLACK_BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
SLACK_APP_TOKEN = os.environ["SLACK_APP_TOKEN"]
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
MCP_BASE_URL = os.environ.get("MCP_BASE_URL", "http://mira-mcp:8001")
MCP_REST_API_KEY = os.environ.get("MCP_REST_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")

# Optional channel allowlist — if set, MIRA only responds in listed channel IDs
ALLOWED_CHANNELS = [
    c.strip() for c in os.environ.get("SLACK_ALLOWED_CHANNELS", "").split(",") if c.strip()
]

engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)

# Chat Abstraction Layer — wraps engine in platform-agnostic protocol
adapter = SlackChatAdapter(
    bot_token=SLACK_BOT_TOKEN,
    signing_secret=os.environ.get("SLACK_SIGNING_SECRET", ""),
)
dispatcher = ChatDispatcher(engine)

app = AsyncApp(token=SLACK_BOT_TOKEN)

IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}


def _session_key(event: dict) -> str:
    """Derive unique session key from Slack event."""
    channel = event["channel"]
    thread_ts = event.get("thread_ts", event.get("ts", ""))
    return f"slack:{channel}:{thread_ts}"


def _thread_ts(event: dict) -> str:
    """Get the thread_ts to reply in-thread."""
    return event.get("thread_ts", event.get("ts", ""))


def _resize_for_vision(image_bytes: bytes) -> bytes:
    """Downscale image to MAX_VISION_PX longest side before base64 encoding."""
    max_px = int(os.getenv("MAX_VISION_PX", "512"))
    img = Image.open(_io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= max_px:
        return image_bytes
    scale = max_px / max(w, h)
    img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


async def _download_slack_file(url: str) -> bytes:
    """Download a file from Slack using the bot token for auth."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"})
        resp.raise_for_status()
        return resp.content


# Dedup set: Slack fires both app_mention and message for @mentions
_SEEN_EVENTS = set()


@app.event("app_mention")
async def handle_mention(event, say, client):
    """Handle @FactoryLM mentions in channels."""
    await handle_message(event, say, client)


@app.event("message")
async def handle_message(event, say, client):
    """Handle all message events — text and file uploads."""
    ts = event.get("ts", "")
    if ts in _SEEN_EVENTS:
        return
    _SEEN_EVENTS.add(ts)
    if len(_SEEN_EVENTS) > 200:
        _SEEN_EVENTS.clear()

    if event.get("subtype") in (
        "bot_message",
        "message_changed",
        "message_deleted",
    ):
        return
    if event.get("bot_id"):
        return

    if ALLOWED_CHANNELS and event.get("channel") not in ALLOWED_CHANNELS:
        return  # silently ignore messages outside allowed channels

    thread = _thread_ts(event)
    files = event.get("files", [])
    pdf_files = [f for f in files if f.get("mimetype", "") == "application/pdf"]

    # PDF path — KB ingestion, not a diagnostic session; bypass the dispatcher
    if pdf_files:
        await say(text="Processing PDF...", thread_ts=thread)
        try:
            file_info = pdf_files[0]
            url = file_info.get("url_private_download") or file_info.get("url_private")
            filename = file_info.get("name", "document.pdf")
            pdf_bytes = await _download_slack_file(url)
            reply = await ingest_pdf(pdf_bytes, filename)
        except Exception as e:
            logger.error("PDF handler error: %s", e)
            reply = f"MIRA error processing PDF: {e}"
        await say(text=reply, thread_ts=thread)
        return

    # Normalize via ChatAdapter
    normalized = await adapter.normalize_incoming(event)

    # Pre-download image attachment and resize before dispatch so the
    # dispatcher can pass photo_b64 straight to the engine.
    if normalized.attachments:
        img_att = next((a for a in normalized.attachments if a.kind == "image"), None)
        if img_att:
            await say(text="Analyzing equipment...", thread_ts=thread)
            try:
                raw_bytes = await adapter.download_attachment(img_att)
                img_att.data = _resize_for_vision(raw_bytes)
                if not normalized.text:
                    normalized.text = "Analyze this equipment photo"
            except Exception as e:
                logger.error("Photo download error: %s", e)
                await say(text=f"MIRA error downloading photo: {e}", thread_ts=thread)
                return

    if not normalized.text and not any(a.kind == "image" for a in normalized.attachments):
        return  # nothing to process

    try:
        response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
    except Exception as e:
        logger.error("Dispatch error: %s", e)
        await say(text=f"MIRA error: {e}", thread_ts=thread)


@app.command("/mira-equipment")
async def equipment_command(ack, command, say):
    """Query live equipment status from MCP."""
    await ack()
    equipment_id = command.get("text", "").strip()
    url = f"{MCP_BASE_URL}/api/equipment"
    if equipment_id:
        url += f"?equipment_id={equipment_id}"
    headers = {}
    if MCP_REST_API_KEY:
        headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            rows = resp.json().get("equipment", [])
        if not rows:
            await say(text="No equipment found.")
            return
        lines = ["*Equipment Status:*"]
        for r in rows:
            readings = []
            if r.get("speed_rpm") is not None:
                readings.append(f"{r['speed_rpm']} RPM")
            if r.get("temperature_c") is not None:
                readings.append(f"{r['temperature_c']}\u00b0C")
            if r.get("current_amps") is not None:
                readings.append(f"{r['current_amps']}A")
            if r.get("pressure_psi") is not None:
                readings.append(f"{r['pressure_psi']} PSI")
            reading_str = ", ".join(readings) if readings else "no readings"
            lines.append(
                f"\u2022 {r['name']} ({r['equipment_id']}): "
                f"{r['status'].upper()} \u2014 {reading_str}"
            )
        await say(text="\n".join(lines))
    except Exception as e:
        logger.error("Equipment command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/mira-faults")
async def faults_command(ack, command, say):
    """Query active faults from MCP."""
    await ack()
    headers = {}
    if MCP_REST_API_KEY:
        headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{MCP_BASE_URL}/api/faults/active", headers=headers)
            resp.raise_for_status()
            faults = resp.json().get("active_faults", [])
        if not faults:
            await say(text="No active faults.")
            return
        lines = [f"*Active Faults ({len(faults)}):*"]
        for f in faults:
            lines.append(
                f"\u2022 [{f['severity'].upper()}] {f['equipment_id']} \u2014 "
                f"{f['fault_code']}: {f['description']}"
            )
        await say(text="\n".join(lines))
    except Exception as e:
        logger.error("Faults command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/mira-status")
async def status_command(ack, command, say):
    """AI-powered equipment status summary."""
    await ack()
    headers = {"Content-Type": "application/json"}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
    try:
        payload = {
            "model": "mira:latest",
            "messages": [
                {
                    "role": "user",
                    "content": "Give a brief status summary of all monitored equipment",
                }
            ],
        }
        if KNOWLEDGE_COLLECTION_ID:
            payload["files"] = [{"type": "collection", "id": KNOWLEDGE_COLLECTION_ID}]
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{OPENWEBUI_BASE_URL}/api/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        await say(text=data["choices"][0]["message"]["content"])
    except Exception as e:
        logger.error("Status command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/mira-reset")
async def reset_command(ack, command, say):
    """Reset GSD conversation state for this channel."""
    await ack()
    channel = command["channel_id"]
    session = f"slack:{channel}:main"
    engine.reset(session)
    await say(text="Conversation reset. Start fresh anytime.")


@app.command("/mira")
async def mira_command(ack, command, say):
    """Ask MIRA a maintenance question directly via slash command."""
    await ack()
    question = command.get("text", "").strip()
    if not question:
        await say(text="Usage: `/mira [question]` — e.g. `/mira VFD tripped OC1 fault`")
        return
    channel_id = command["channel_id"]
    normalized = await adapter.normalize_incoming(
        {
            "ts": command.get("trigger_id", ""),
            "user": command.get("user_id", ""),
            "channel": channel_id,
            "channel_type": "slash",
            "text": question,
        }
    )
    try:
        response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
    except Exception as e:
        logger.error("/mira command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/work-order")
async def work_order_command(ack, command, say):
    """Shortcut to open a corrective work order via MIRA."""
    await ack()
    description = command.get("text", "").strip()
    if not description:
        await say(text="Usage: `/work-order [description]` — e.g. `/work-order Conveyor belt slipping on Line 1`")
        return
    channel_id = command["channel_id"]
    normalized = await adapter.normalize_incoming(
        {
            "ts": command.get("trigger_id", ""),
            "user": command.get("user_id", ""),
            "channel": channel_id,
            "channel_type": "slash",
            "text": f"create work order: {description}",
        }
    )
    try:
        response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
    except Exception as e:
        logger.error("/work-order command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/asset")
async def asset_command(ack, command, say):
    """Look up an asset by QR tag or name."""
    await ack()
    tag = command.get("text", "").strip()
    if not tag:
        await say(text="Usage: `/asset [tag]` — e.g. `/asset PUMP-A3` or `/asset Line 2 conveyor`")
        return
    channel_id = command["channel_id"]
    normalized = await adapter.normalize_incoming(
        {
            "ts": command.get("trigger_id", ""),
            "user": command.get("user_id", ""),
            "channel": channel_id,
            "channel_type": "slash",
            "text": f"check equipment history for {tag}",
        }
    )
    try:
        response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
    except Exception as e:
        logger.error("/asset command error: %s", e)
        await say(text=f"MIRA error: {e}")


@app.command("/mira-help")
async def help_command(ack, command, say):
    """Show available commands."""
    await ack()
    await say(
        text=(
            "*MIRA Commands:*\n"
            "`/mira [question]` \u2014 Ask MIRA anything about your equipment\n"
            "`/work-order [description]` \u2014 Open a corrective work order\n"
            "`/asset [tag]` \u2014 Look up asset history by QR tag\n"
            "`/mira-equipment [id]` \u2014 Live equipment status (instant)\n"
            "`/mira-faults` \u2014 Active fault list (instant)\n"
            "`/mira-status` \u2014 AI equipment summary\n"
            "`/mira-reset` \u2014 Reset conversation state\n\n"
            "Or just type any maintenance question in a thread.\n"
            "Upload a photo to identify equipment and diagnose faults."
        )
    )


async def main():
    handler = AsyncSocketModeHandler(app, SLACK_APP_TOKEN)
    logger.info("MIRA Slack bot started (Socket Mode)")
    await handler.start_async()


if __name__ == "__main__":
    asyncio.run(main())
