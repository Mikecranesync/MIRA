"""MIRA Telegram Bot — GSD engine + direct data commands."""

import asyncio
import base64
import io as _io
import logging
import os

import httpx
from PIL import Image
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
)

from shared.gsd_engine import GSDEngine
from shared import tts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-bot")

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
MCP_BASE_URL = os.environ.get("MCP_BASE_URL", "http://mira-mcp:8001")
MCP_REST_API_KEY = os.environ.get("MCP_REST_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "dd9004b9-3af2-4751-9993-3307e478e9a3")
INGEST_SERVICE_URL = os.environ.get("INGEST_SERVICE_URL", "")

engine = GSDEngine(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)

FAULT_KEYWORDS = {
    "fault", "error", "fail", "trip", "alarm", "down",
    "not working", "broken", "stopped", "issue", "warning",
}


class typing_action:
    """Async context manager that sends a looping typing indicator to Telegram."""

    def __init__(self, context, chat_id: int, action: str = "typing"):
        self.context = context
        self.chat_id = chat_id
        self.action = action
        self._task = None

    async def _loop(self):
        while True:
            try:
                await self.context.bot.send_chat_action(
                    chat_id=self.chat_id, action=self.action
                )
            except Exception:
                pass
            await asyncio.sleep(4)

    async def __aenter__(self):
        self._task = asyncio.create_task(self._loop())
        return self

    async def __aexit__(self, *args):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


def _resize_for_vision(image_bytes: bytes) -> bytes:
    """Downscale image to MAX_VISION_PX longest side before base64 encoding.

    Cuts qwen2.5vl:7b encoder latency from ~12s to ~3s on M4 Mini.
    """
    MAX_PX = int(os.getenv("MAX_VISION_PX", "1024"))
    img = Image.open(_io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= MAX_PX:
        return image_bytes
    scale = MAX_PX / max(w, h)
    img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _equipment_type_from_doc(filename: str, caption: str) -> str:
    """Derive equipment type slug from filename, with caption override.

    Caption first word wins: sending 'VFD' as caption → 'vfd'.
    Fallback: strip doc-type suffixes from filename stem.
    """
    if caption and caption.strip():
        return caption.strip().split()[0].lower()[:40]
    stem = os.path.splitext(filename)[0].lower()
    for suffix in ("-manual", "-guide", "-spec", "-datasheet", "-data-sheet",
                   "_manual", "_guide", "_spec", "_datasheet", "_data_sheet"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem[:40] or "general"


async def _ingest_photo_background(photo_bytes: bytes, asset_tag: str) -> None:
    """POST photo to mira-ingest. Runs in background — never raises."""
    if not INGEST_SERVICE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{INGEST_SERVICE_URL}/ingest/photo",
                data={"asset_tag": asset_tag},
                files={"image": ("photo.jpg", photo_bytes, "image/jpeg")},
            )
            if resp.status_code == 200:
                logger.info("Ingest OK for %s: id=%s", asset_tag, resp.json().get("id"))
            else:
                logger.warning("Ingest failed %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.error("Ingest background error: %s", e)


async def document_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive PDF documents, index them into the knowledge base via mira-mcp."""
    chat_id = str(update.effective_chat.id)
    doc = update.message.document
    filename = doc.file_name or "upload.pdf"
    caption = update.message.caption or ""

    if doc.mime_type != "application/pdf":
        await update.message.reply_text(
            f"Only PDF files are supported (got {doc.mime_type})."
        )
        return

    MB = 1024 * 1024
    if doc.file_size and doc.file_size > 20 * MB:
        await update.message.reply_text(
            f"{filename} is {doc.file_size // MB}MB — Telegram's bot limit is 20MB."
        )
        return

    equipment_type = _equipment_type_from_doc(filename, caption)
    await update.message.reply_text(f"Indexing {filename}...")
    logger.info("PDF from %s: %s (type=%s)", update.effective_user.first_name,
                filename, equipment_type)

    async def _do_ingest():
        try:
            file = await context.bot.get_file(doc.file_id)
            pdf_bytes = bytes(await file.download_as_bytearray())
            headers = {}
            if MCP_REST_API_KEY:
                headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
            async with httpx.AsyncClient(timeout=180) as client:
                resp = await client.post(
                    f"{MCP_BASE_URL}/ingest/pdf",
                    headers=headers,
                    data={"equipment_type": equipment_type},
                    files={"file": (filename, pdf_bytes, "application/pdf")},
                )
                resp.raise_for_status()
                data = resp.json()
            chunks = data.get("chunks", 0)
            await update.message.reply_text(
                f"Indexed {chunks} pages from {filename}\n"
                f"Type: {data.get('equipment_type', equipment_type)}\n"
                "Ask me anything about it."
            )
        except Exception as exc:
            logger.error("PDF ingest error: %s", exc)
            await update.message.reply_text(f"Failed to index {filename}: {exc}")

    asyncio.create_task(_do_ingest())


def _get_voice_enabled(chat_id: str) -> bool:
    """Read voice_enabled flag from DB for this chat."""
    import sqlite3
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    try:
        db = sqlite3.connect(db_path)
        db.execute("PRAGMA journal_mode=WAL")
        row = db.execute(
            "SELECT voice_enabled FROM conversation_state WHERE chat_id = ?", (chat_id,)
        ).fetchone()
        db.close()
        return bool(row[0]) if row else False
    except Exception:
        return False


def _set_voice_enabled(chat_id: str, enabled: bool) -> None:
    """Write voice_enabled flag to DB for this chat."""
    import sqlite3
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """INSERT INTO conversation_state (chat_id, voice_enabled)
           VALUES (?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET voice_enabled = excluded.voice_enabled""",
        (chat_id, 1 if enabled else 0),
    )
    db.commit()
    db.close()


async def _maybe_send_voice(
    update: Update, context: ContextTypes.DEFAULT_TYPE, chat_id: str, text: str
) -> None:
    """If voice is enabled, synthesize OGG and send as voice message."""
    if not _get_voice_enabled(chat_id):
        return
    await context.bot.send_chat_action(
        chat_id=update.effective_chat.id, action=ChatAction.RECORD_VOICE
    )
    ogg = await tts.text_to_ogg(text)
    if ogg:
        await update.message.reply_voice(voice=ogg)


async def voice_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enable, disable, or query voice responses with /voice on|off."""
    chat_id = str(update.effective_chat.id)
    arg = (context.args[0].lower() if context.args else "").strip()
    if arg == "on":
        _set_voice_enabled(chat_id, True)
        await update.message.reply_text("Voice responses enabled. Use /voice off to disable.")
    elif arg == "off":
        _set_voice_enabled(chat_id, False)
        await update.message.reply_text("Voice responses disabled.")
    else:
        status = "on" if _get_voice_enabled(chat_id) else "off"
        await update.message.reply_text(
            f"Voice responses are currently {status}.\n"
            "Use /voice on or /voice off to change."
        )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route text messages through the GSD engine."""
    text = update.message.text
    chat_id = str(update.effective_chat.id)
    logger.info("Received from %s: %s", update.effective_user.first_name, text)
    if any(kw in text.lower() for kw in FAULT_KEYWORDS):
        await update.message.reply_text("Diagnosing...")
    try:
        async with typing_action(context, update.effective_chat.id):
            reply = await engine.process(chat_id, text)
    except Exception as e:
        logger.error("GSD error: %s", e)
        reply = f"MIRA error: {e}"
    await update.message.reply_text(reply)
    await _maybe_send_voice(update, context, chat_id, reply)


async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route photos through vision model then GSD engine."""
    chat_id = str(update.effective_chat.id)
    caption = update.message.caption or "Analyze this equipment photo"
    logger.info("Photo from %s: %s", update.effective_user.first_name, caption)
    await update.message.reply_text("Analyzing equipment...")
    try:
        photo = update.message.photo[-1]
        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id, action=ChatAction.UPLOAD_PHOTO
        )
        file = await context.bot.get_file(photo.file_id)
        raw_bytes = bytes(await file.download_as_bytearray())
        vision_bytes = _resize_for_vision(raw_bytes)
        photo_b64 = base64.b64encode(vision_bytes).decode("utf-8")
        async with typing_action(context, update.effective_chat.id):
            process_task = asyncio.create_task(
                engine.process(chat_id, caption, photo_b64=photo_b64)
            )
            try:
                reply = await asyncio.wait_for(
                    asyncio.shield(process_task), timeout=10.0
                )
            except asyncio.TimeoutError:
                await update.message.reply_text(
                    "Processing equipment photo — this may take up to 90 seconds"
                    " for detailed images..."
                )
                reply = await process_task
        if INGEST_SERVICE_URL:
            asset_tag = caption.split()[0] if caption else "UNKNOWN"
            asyncio.create_task(_ingest_photo_background(raw_bytes, asset_tag))
            reply += "\n\nPhoto queued for knowledge base."
    except Exception as e:
        logger.error("Photo handler error: %s", e)
        reply = f"MIRA error: {e}"
    await update.message.reply_text(reply)
    await _maybe_send_voice(update, context, chat_id, reply)


async def reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Reset GSD conversation state."""
    chat_id = str(update.effective_chat.id)
    engine.reset(chat_id)
    await update.message.reply_text("Conversation reset.")


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Query Open WebUI for an equipment status summary."""
    headers = {"Content-Type": "application/json"}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
    try:
        async with typing_action(context, update.effective_chat.id):
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{OPENWEBUI_BASE_URL}/api/chat/completions",
                    headers=headers,
                    json={
                        "model": "mira:latest",
                        "messages": [{"role": "user", "content": "Give a brief status summary of all monitored equipment"}],
                        "files": [{"type": "collection", "id": KNOWLEDGE_COLLECTION_ID}],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        await update.message.reply_text(data["choices"][0]["message"]["content"])
    except Exception as e:
        logger.error("Status command error: %s", e)
        await update.message.reply_text(f"MIRA error: {e}")


async def equipment_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Query live equipment status directly from MCP (no LLM)."""
    equipment_id = context.args[0] if context.args else ""
    url = f"{MCP_BASE_URL}/api/equipment"
    if equipment_id:
        url += f"?equipment_id={equipment_id}"
    headers = {}
    if MCP_REST_API_KEY:
        headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
    try:
        async with typing_action(context, update.effective_chat.id):
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                rows = resp.json().get("equipment", [])
        if not rows:
            await update.message.reply_text("No equipment found.")
            return
        lines = ["Equipment Status:"]
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
        await update.message.reply_text("\n".join(lines))
    except Exception as e:
        logger.error("Equipment command error: %s", e)
        await update.message.reply_text(f"MIRA error: {e}")


async def faults_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Query active faults directly from MCP (no LLM)."""
    headers = {}
    if MCP_REST_API_KEY:
        headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
    try:
        async with typing_action(context, update.effective_chat.id):
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{MCP_BASE_URL}/api/faults/active", headers=headers)
                resp.raise_for_status()
                faults = resp.json().get("active_faults", [])
        if not faults:
            await update.message.reply_text("No active faults.")
            return
        lines = [f"Active Faults ({len(faults)}):"]
        for f in faults:
            lines.append(f"\u2022 [{f['severity'].upper()}] {f['equipment_id']} \u2014 {f['fault_code']}: {f['description']}")
        await update.message.reply_text("\n".join(lines))
    except Exception as e:
        logger.error("Faults command error: %s", e)
        await update.message.reply_text(f"MIRA error: {e}")


async def bad_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Flag the last response as unhelpful."""
    chat_id = str(update.effective_chat.id)
    reason = " ".join(context.args) if context.args else ""
    engine.log_feedback(chat_id, "bad", reason)
    if reason:
        await update.message.reply_text(f"Logged: {reason}")
    else:
        await update.message.reply_text("Logged. What specifically was wrong?\nUse /bad <reason> to explain.")


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Return static command list."""
    await update.message.reply_text(
        "MIRA Commands:\n"
        "/equipment [id] \u2014 Live equipment status (instant)\n"
        "/faults \u2014 Active fault list (instant)\n"
        "/status \u2014 AI equipment summary\n"
        "/voice on|off \u2014 Enable/disable spoken responses\n"
        "/bad [reason] \u2014 Flag this response as unhelpful\n"
        "/reset \u2014 Reset conversation state\n"
        "/help \u2014 Show this help\n"
        "Or just type any maintenance question.\n"
        "Send a photo to identify equipment.\n"
        "Send a PDF manual to index it for retrieval."
    )


def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("equipment", equipment_command))
    app.add_handler(CommandHandler("faults", faults_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("reset", reset_command))
    app.add_handler(CommandHandler("voice", voice_command))
    app.add_handler(CommandHandler("bad", bad_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(MessageHandler(filters.Document.PDF, document_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    logger.info("MIRA Telegram bot started (polling)")
    app.run_polling()


if __name__ == "__main__":
    main()
