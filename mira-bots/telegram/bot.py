"""MIRA Telegram Bot — GSD engine + direct data commands."""

import asyncio
import base64
import io as _io
import logging
import os

import httpx
from chat_adapter import TelegramChatAdapter
from PIL import Image
from shared import tts
from shared.chat.dispatcher import ChatDispatcher
from shared.engine import Supervisor
from telegram import Update
from telegram.constants import ChatAction
from telegram.error import Conflict
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
from voice_transcription import transcribe_voice

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
KNOWLEDGE_COLLECTION_ID = os.environ.get(
    "KNOWLEDGE_COLLECTION_ID", "dd9004b9-3af2-4751-9993-3307e478e9a3"
)
INGEST_SERVICE_URL = os.environ.get("INGEST_SERVICE_URL", "")

engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
    mcp_base_url=MCP_BASE_URL,
)

# Chat Abstraction Layer — wraps engine in platform-agnostic protocol
adapter = TelegramChatAdapter(bot_token=TELEGRAM_BOT_TOKEN)
dispatcher = ChatDispatcher(engine)

FAULT_KEYWORDS = {
    "fault",
    "error",
    "fail",
    "trip",
    "alarm",
    "down",
    "not working",
    "broken",
    "stopped",
    "issue",
    "warning",
}

# Photo batching: accumulate rapid-fire multi-photo messages before processing
PHOTO_BUFFER: dict[int, dict] = {}
PHOTO_BUFFER_WINDOW = 4.0  # seconds to wait for additional photos in same burst


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
                await self.context.bot.send_chat_action(chat_id=self.chat_id, action=self.action)
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
    for suffix in (
        "-manual",
        "-guide",
        "-spec",
        "-datasheet",
        "-data-sheet",
        "_manual",
        "_guide",
        "_spec",
        "_datasheet",
        "_data_sheet",
    ):
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
    """Receive PDF documents, index into Open WebUI KB via mira-ingest."""
    doc = update.message.document
    filename = doc.file_name or "upload.pdf"
    caption = update.message.caption or ""

    if doc.mime_type != "application/pdf":
        await update.message.reply_text(f"Only PDF files are supported (got {doc.mime_type}).")
        return

    MB = 1024 * 1024
    if doc.file_size and doc.file_size > 20 * MB:
        await update.message.reply_text(f"{filename} is {doc.file_size // MB}MB — limit is 20MB.")
        return

    if not INGEST_SERVICE_URL:
        await update.message.reply_text("Ingest service not configured.")
        return

    equipment_type = _equipment_type_from_doc(filename, caption)
    await update.message.reply_text(f"Indexing {filename}...")
    logger.info(
        "PDF from %s: %s (type=%s)", update.effective_user.first_name, filename, equipment_type
    )

    async def _do_ingest_doc():
        try:
            tg_file = await context.bot.get_file(doc.file_id)
            pdf_bytes = bytes(await tg_file.download_as_bytearray())
            async with httpx.AsyncClient(timeout=360) as client:
                resp = await client.post(
                    f"{INGEST_SERVICE_URL}/ingest/document-kb",
                    data={"filename": filename, "equipment_type": equipment_type or ""},
                    files={"file": (filename, pdf_bytes, "application/pdf")},
                )
                resp.raise_for_status()
                data = resp.json()
            col = data.get("collection_name", "Knowledge Base")
            proc = data.get("processing_status", "completed")
            if proc == "completed":
                reply = f"Indexed *{filename}* into *{col}* collection.\nAsk me anything about it."
            else:
                reply = (
                    f"*{filename}* uploaded to *{col}*.\n"
                    "Extraction is still processing — RAG will be available shortly."
                )
            await update.message.reply_text(reply, parse_mode="Markdown")
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code == 429:
                msg = "Daily ingest limit reached. Try again tomorrow."
            elif code == 413:
                msg = f"{filename} is too large (limit 20MB)."
            elif code == 422:
                msg = f"Could not process {filename}: {e.response.text[:120]}"
            else:
                msg = f"Indexing failed ({code}). Try again later."
            logger.error("doc ingest HTTP %s: %s", code, e.response.text[:200])
            await update.message.reply_text(msg)
        except Exception as exc:
            logger.error("doc ingest error: %s", exc)
            await update.message.reply_text(f"Indexing {filename} failed. Please try again.")

    asyncio.create_task(_do_ingest_doc())


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
            f"Voice responses are currently {status}.\nUse /voice on or /voice off to change."
        )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route text messages through the GSD engine via ChatAdapter."""
    text = update.message.text
    chat_id = str(update.effective_chat.id)
    logger.info("Received from %s: %s", update.effective_user.first_name, text)
    if any(kw in text.lower() for kw in FAULT_KEYWORDS):
        await update.message.reply_text("Diagnosing...")
    normalized = await adapter.normalize_incoming(update.to_dict())
    try:
        async with typing_action(context, update.effective_chat.id):
            response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
        await _maybe_send_voice(update, context, chat_id, response.text)
    except Exception as e:
        logger.error("Dispatch error: %s", e)
        await update.message.reply_text(f"MIRA error: {e}")


async def voice_message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming Telegram voice messages (OGG/Opus).

    Pipeline:
      1. Download voice file from Telegram
      2. Transcribe via Groq Whisper (whisper-large-v3-turbo)
      3. Route transcribed text through the normal GSD engine (same as text)
      4. If MIRA's reply contains a WO preview, the FSM handles "yes" confirmation
         through the same handle_message path on the next turn

    Falls back gracefully if GROQ_API_KEY is missing or Whisper fails.
    """
    voice = update.message.voice
    chat_id = str(update.effective_chat.id)
    user_name = update.effective_user.first_name if update.effective_user else "User"

    logger.info(
        "Voice message from %s: duration=%ds file_id=%s",
        user_name,
        voice.duration if voice else 0,
        voice.file_id if voice else "?",
    )

    # Acknowledge receipt while we transcribe
    await update.message.reply_text("🎤 Transcribing your message…")

    try:
        tg_file = await context.bot.get_file(voice.file_id)
        audio_bytes = await tg_file.download_as_bytearray()
    except Exception as exc:
        logger.error("Voice download failed: %s", exc)
        await update.message.reply_text(
            "Sorry, I couldn't download your voice message. Please try again or type your message."
        )
        return

    async with typing_action(context, update.effective_chat.id):
        transcribed = await transcribe_voice(bytes(audio_bytes))

    if not transcribed:
        await update.message.reply_text(
            "I couldn't transcribe your voice message "
            "(GROQ_API_KEY may not be set, or the audio was unclear).\n"
            "Please type your message instead."
        )
        return

    logger.info("Voice → text from %s: %r", user_name, transcribed[:100])

    # Echo transcription so the tech can see what was captured
    await update.message.reply_text(f'_🎤 Heard: "{transcribed}"_', parse_mode="Markdown")

    # Route through the exact same path as a text message
    normalized = await adapter.normalize_incoming(update.to_dict())
    normalized.text = transcribed

    if any(kw in transcribed.lower() for kw in FAULT_KEYWORDS):
        await update.message.reply_text("Diagnosing…")

    try:
        async with typing_action(context, update.effective_chat.id):
            response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
        await _maybe_send_voice(update, context, chat_id, response.text)
    except Exception as exc:
        logger.error("Voice dispatch error: %s", exc)
        await update.message.reply_text(f"MIRA error: {exc}")


async def _process_photo_batch(
    batches: list[tuple[bytes, bytes]],
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Process buffered (raw_bytes, vision_bytes) pairs.

    Single photo: dispatches through ChatDispatcher (FSM-aware, unchanged path).
    Multi-photo burst: sends acknowledgment immediately, runs each photo through
    VisionWorker sequentially, then combines results into one intelligent reply.
    """
    chat_id = str(update.effective_chat.id)

    if len(batches) == 1:
        # Single-photo path — unchanged; goes through ChatDispatcher for FSM routing
        await update.message.reply_text("Analyzing equipment...")
        _raw_bytes, vision_bytes = batches[0]
        update_dict = update.to_dict()
        async with typing_action(context, update.effective_chat.id):
            try:
                normalized = await adapter.normalize_incoming(update_dict)
                normalized.text = caption
                if normalized.attachments:
                    normalized.attachments[0].data = vision_bytes
                process_task = asyncio.create_task(dispatcher.dispatch(normalized))
                try:
                    response = await asyncio.wait_for(asyncio.shield(process_task), timeout=10.0)
                except asyncio.TimeoutError:
                    await update.message.reply_text(
                        "Processing equipment photo — this may take up to 90 seconds"
                        " for detailed images..."
                    )
                    response = await process_task
                final_reply = response.text or "MIRA error: no response from vision pipeline."
            except Exception as e:
                logger.error("Photo processing error: %s", e)
                final_reply = f"MIRA error: {e}"
    else:
        # Multi-photo burst — ack immediately, process sequentially, combine
        n = len(batches)
        await update.message.reply_text(
            f"📸 Processing {n} photos — I'll have results for you shortly."
        )
        async with typing_action(context, update.effective_chat.id):
            photos_b64 = [base64.b64encode(vision_bytes).decode() for _, vision_bytes in batches]
            try:
                final_reply = await engine.process_multi_photo(
                    chat_id=chat_id,
                    message=caption,
                    photos_b64=photos_b64,
                    platform="telegram",
                )
            except Exception as e:
                logger.error("Multi-photo processing error: %s", e)
                final_reply = f"MIRA error processing {n} photos: {e}"

    if INGEST_SERVICE_URL:
        asset_tag = caption.split()[0] if caption else "UNKNOWN"
        for raw_bytes, _ in batches:
            asyncio.create_task(_ingest_photo_background(raw_bytes, asset_tag))
        final_reply += "\n\nPhoto(s) queued for knowledge base."

    await update.message.reply_text(final_reply)
    await _maybe_send_voice(update, context, chat_id, final_reply)


async def _flush_photos(
    chat_id_int: int,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Wait for buffer window, then process all buffered photos as a batch."""
    await asyncio.sleep(PHOTO_BUFFER_WINDOW)
    buf = PHOTO_BUFFER.pop(chat_id_int, None)
    if not buf:
        return
    await _process_photo_batch(buf["batches"], buf["caption"], update, context)


async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Buffer photos and process as a batch after PHOTO_BUFFER_WINDOW seconds."""
    chat_id_int = update.effective_chat.id
    caption = update.message.caption or "Analyze this equipment photo"
    logger.info("Photo from %s: %s", update.effective_user.first_name, caption)

    # Download and resize immediately; store raw bytes for KB ingest
    try:
        photo = update.message.photo[-1]
        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id, action=ChatAction.UPLOAD_PHOTO
        )
        file = await context.bot.get_file(photo.file_id)
        raw_bytes = bytes(await file.download_as_bytearray())
        vision_bytes = _resize_for_vision(raw_bytes)
    except Exception as e:
        logger.error("Photo download error: %s", e)
        await update.message.reply_text(f"MIRA error: {e}")
        return

    # Add to buffer; cancel and restart the flush timer
    buf = PHOTO_BUFFER.get(chat_id_int)
    if buf:
        existing_task = buf.get("task")
        if existing_task:
            existing_task.cancel()
        buf["batches"].append((raw_bytes, vision_bytes))
        buf["caption"] = caption  # last caption wins
        buf["update"] = update
    else:
        PHOTO_BUFFER[chat_id_int] = {
            "batches": [(raw_bytes, vision_bytes)],
            "caption": caption,
            "update": update,
            "task": None,
        }

    flush_task = asyncio.create_task(_flush_photos(chat_id_int, update, context))
    PHOTO_BUFFER[chat_id_int]["task"] = flush_task


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
                        "messages": [
                            {
                                "role": "user",
                                "content": "Give a brief status summary of all monitored equipment",
                            }
                        ],
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
            lines.append(
                f"\u2022 [{f['severity'].upper()}] {f['equipment_id']} \u2014 {f['fault_code']}: {f['description']}"
            )
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
        await update.message.reply_text(
            "Logged. What specifically was wrong?\nUse /bad <reason> to explain."
        )


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


async def _startup(application: Application) -> None:
    """Clear any competing webhook/poller and verify bot identity before polling."""
    try:
        await application.bot.delete_webhook(drop_pending_updates=True)
        logger.info("Webhook cleared (drop_pending_updates=True)")
    except Exception as exc:
        logger.warning("delete_webhook failed: %s", exc)

    try:
        me = await application.bot.get_me()
        logger.info("Bot identity confirmed: @%s (id=%s)", me.username, me.id)
    except Conflict as exc:
        logger.error(
            "409 Conflict on getMe — another process is already polling with this token. "
            "To fix: SSH to every node and run: "
            "pkill -f 'python bot.py' || docker stop mira-bot-telegram. "
            "Then restart this container. Error: %s",
            exc,
        )
        raise SystemExit(1) from exc


async def _conflict_error_handler(update: object, context) -> None:
    """On 409 Conflict sleep 15s and let PTB retry — avoids crash-restart loop."""
    import asyncio

    from telegram.error import Conflict as TGConflict

    if isinstance(context.error, TGConflict):
        logger.warning(
            "409 Conflict during polling — another session is active. "
            "Sleeping 15s and retrying (do NOT call getUpdates externally while bot is running)."
        )
        await asyncio.sleep(15)
        return  # let PTB retry getUpdates
    raise context.error


def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).post_init(_startup).build()
    app.add_handler(CommandHandler("equipment", equipment_command))
    app.add_handler(CommandHandler("faults", faults_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("reset", reset_command))
    app.add_handler(CommandHandler("voice", voice_command))
    app.add_handler(CommandHandler("bad", bad_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(MessageHandler(filters.Document.PDF, document_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.VOICE, voice_message_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_error_handler(_conflict_error_handler)
    _ver_path = os.path.join(os.path.dirname(__file__), "VERSION")
    _ver = open(_ver_path).read().strip() if os.path.exists(_ver_path) else "unknown"
    logger.info("MIRA Telegram bot starting (polling) version=%s", _ver)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
