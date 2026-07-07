"""MIRA Telegram Bot — GSD engine + direct data commands."""

import asyncio
import base64
import io as _io
import logging
import os
import re

import httpx
from admin_commands import (
    invite_command,
    invite_status_command,
    revoke_command,
    team_command,
)
from chat_adapter import TelegramChatAdapter
from PIL import Image
from shared import chat_tenant, tts
from shared.chat.dispatcher import ChatDispatcher
from shared.contextualization_intake import (
    hub_folder_upload_configured,
    submit_file_to_hub_folder,
)
from shared.conversation_logger import log_turn, measure_ms
from shared.drive_packs import answer_question, list_packs, resolve_pack
from shared.engine import Supervisor
from shared.identity.service import get_identity_service
from shared.integrations.atlas_cmms import AtlasCMMSClient
from shared.integrations.wo_outbox import OutboxRow, run_drain_forever
from shared.notifications.push import send_push
from shared.photo_batch_queue import (
    BURST_WINDOW_SECONDS,
    BurstFull,
    PhotoBatchQueue,
    PhotoBatchRecord,
    QueueFull,
)
from shared.photo_handler import (
    DEFAULT_PHOTO_CAPTION,
    preserve_first_meaningful_caption,
)
from shared.tenant.authorizer import Authorizer
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from start_command import start_command
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
# Telegram is a thin evidence-capture client. Photos/docs are POSTed as raw
# files to the Hub's citable folder-upload door (POST /api/uploads/folder,
# Bearer HUB_INGEST_TOKEN + X-Mira-Tenant-Id), which routes through the golden
# path to `knowledge_entries` (per-tenant, citable) — #2540. Env-var names match
# tools/mira-drop-watcher. HUB_IMPORT_URL is kept only as a back-compat base.
HUB_URL = os.environ.get("HUB_URL", "")
HUB_BASE_PATH = os.environ.get("HUB_BASE_PATH", "/hub")
HUB_INGEST_TOKEN = os.environ.get("HUB_INGEST_TOKEN", "")
HUB_IMPORT_URL = os.environ.get("HUB_IMPORT_URL", "")  # back-compat base only


def _hub_intake_configured() -> bool:
    """True when the Hub folder-upload door has a base URL + Bearer token."""
    return hub_folder_upload_configured(
        hub_url=HUB_URL or HUB_IMPORT_URL or None,
        token=HUB_INGEST_TOKEN or None,
    )


engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
    mcp_base_url=MCP_BASE_URL,
)

# Multi-tenant infra (NeonDB-backed)
ADMIN_TELEGRAM_IDS = os.environ.get("ADMIN_TELEGRAM_IDS", "")
DEFAULT_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")

_identity_service = get_identity_service()
_authorizer = Authorizer(admin_telegram_ids=ADMIN_TELEGRAM_IDS)

_neon_url = os.environ.get("NEON_DATABASE_URL", "")
_admin_db_engine = (
    create_engine(
        _neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    if _neon_url
    else None
)

# Chat Abstraction Layer — wraps engine in platform-agnostic protocol
adapter = TelegramChatAdapter(bot_token=TELEGRAM_BOT_TOKEN)
dispatcher = ChatDispatcher(engine, identity_service=_identity_service)

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

# Photo batching: in-memory pre-collector decides single vs multi after a 4s
# window. Single-photo bursts go through the FSM-aware ChatDispatcher (the
# existing path, unchanged). Multi-photo bursts (2+) are enqueued to the
# durable PhotoBatchQueue and drained by a single async worker — vision is
# GPU-bound on one Ollama node, so worker concurrency is 1.
#
# Pre-collector state lives in memory and is dropped on bot restart (max
# data loss = the 4s burst window). Anything that makes it into the durable
# queue survives restarts.
_BURST_COLLECTOR: dict[int, dict] = {}
_PHOTO_QUEUE_DB_PATH = os.environ.get(
    "PHOTO_QUEUE_DB_PATH",
    os.path.join(
        os.path.dirname(os.environ.get("MIRA_DB_PATH", "/data/mira.db")), "photo_batches.db"
    ),
)
photo_queue = PhotoBatchQueue(_PHOTO_QUEUE_DB_PATH)


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


def _intake_meta(update: Update) -> tuple[str, str, str]:
    """(uploader_id, captured_at_iso, tenant_id) from a Telegram update.

    Uploader is the numeric Telegram id (pseudonymous) — never a name — to keep
    PII out of provenance. Tenant is resolved by the **uploader's user id**, the
    same key the chat adapter uses (``chat_adapter.py`` → ``chat_tenant.resolve``)
    and that onboarding maps; ``effective_chat.id`` is the (negative) group id in
    group chats and would miss the mapping.
    """
    uploader = str(update.effective_user.id) if update.effective_user else ""
    msg_date = getattr(update.message, "date", None)
    captured_at = msg_date.isoformat() if msg_date else ""
    tenant_id = chat_tenant.resolve(uploader)
    return uploader, captured_at, tenant_id


async def _submit_photo_to_hub(raw_bytes: bytes, caption: str, update: Update) -> None:
    """POST a photo to the Hub's citable folder-upload door (#2540).

    Runs in background — ``submit_file_to_hub_folder`` never raises, so a failed
    Hub POST cannot break the chat reply. The tenant header keeps the upload
    per-tenant and citable. ``caption`` is unused on this path (the folder door
    ingests the raw file; the Hub derives context on its own).
    """
    if not _hub_intake_configured():
        return
    _uploader, _captured_at, tenant_id = _intake_meta(update)
    await submit_file_to_hub_folder(
        raw_bytes=raw_bytes,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=tenant_id,
        hub_url=HUB_URL or HUB_IMPORT_URL or None,
        base_path=HUB_BASE_PATH,
        token=HUB_INGEST_TOKEN or None,
    )


async def _submit_doc_to_hub(pdf_bytes: bytes, filename: str, caption: str, update: Update) -> bool:
    """POST a PDF to the Hub's citable folder-upload door (#2540).

    Returns True on a 2xx Hub response. Never raises. ``caption`` is unused on
    this path (the folder door ingests the raw file).
    """
    if not _hub_intake_configured():
        return False
    _uploader, _captured_at, tenant_id = _intake_meta(update)
    return await submit_file_to_hub_folder(
        raw_bytes=pdf_bytes,
        filename=filename,
        mime="application/pdf",
        tenant_id=tenant_id,
        hub_url=HUB_URL or HUB_IMPORT_URL or None,
        base_path=HUB_BASE_PATH,
        token=HUB_INGEST_TOKEN or None,
    )


async def document_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive PDF documents and submit them to the Hub as intake evidence.

    HubV3: a PDF is a contextualization source. The bot builds the §2 intake
    contract and POSTs it (+ raw bytes) to the Hub import endpoint, where it
    lands as a ``proposed`` source for review. The bot owns no truth.
    """
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

    if not _hub_intake_configured():
        await update.message.reply_text("Hub intake is not configured.")
        return

    await update.message.reply_text(f"Submitting {filename} to the Hub...")
    logger.info("PDF from telegram_id=%s: %s", update.effective_user.id, filename)

    async def _do_submit_doc():
        try:
            tg_file = await context.bot.get_file(doc.file_id)
            pdf_bytes = bytes(await tg_file.download_as_bytearray())
            ok = await _submit_doc_to_hub(pdf_bytes, filename, caption, update)
            if ok:
                reply = (
                    f"Submitted *{filename}* to the Hub for review.\n"
                    "It will appear as a proposed source once contextualized."
                )
            else:
                reply = f"Couldn't submit {filename} to the Hub. Please try again later."
            await update.message.reply_text(reply, parse_mode="Markdown")
        except Exception as exc:
            logger.error("doc submit error: %s", exc)
            await update.message.reply_text(f"Submitting {filename} failed. Please try again.")

    asyncio.create_task(_do_submit_doc())


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
    import time as _time

    text = update.message.text
    chat_id = str(update.effective_chat.id)
    logger.info("Received from %s: %s", update.effective_user.first_name, text)
    if any(kw in text.lower() for kw in FAULT_KEYWORDS):
        await update.message.reply_text("Diagnosing...")
    normalized = await adapter.normalize_incoming(update.to_dict())
    try:
        _t0 = _time.monotonic()
        async with typing_action(context, update.effective_chat.id):
            response = await dispatcher.dispatch(normalized)
        await adapter.render_outgoing(response, normalized)
        # Append-only eval log — fail-open. See docs/specs/bot-eval-loop-spec.md.
        await log_turn(
            chat_id=chat_id,
            user_message=text or "",
            bot_response=response.text or "",
            source="telegram",
            intent=getattr(response, "intent", None),
            has_citations=bool(getattr(response, "citations", None)),
            response_time_ms=measure_ms(_t0),
        )
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


async def _dispatch_single_photo(
    raw_bytes: bytes,
    vision_bytes: bytes,
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Single-photo path — FSM-aware dispatch through ChatDispatcher.

    Unchanged behaviour from the previous in-memory PHOTO_BUFFER. Single
    photos still need work-order / FSM context, so they bypass the durable
    queue and run synchronously while we still hold the original Update.
    """
    chat_id = str(update.effective_chat.id)
    await update.message.reply_text("Analyzing equipment...")
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

    if _hub_intake_configured():
        asyncio.create_task(_submit_photo_to_hub(raw_bytes, caption, update))
        final_reply += "\n\nPhoto submitted to the Hub for review."

    await update.message.reply_text(final_reply)
    await _maybe_send_voice(update, context, chat_id, final_reply)


async def _enqueue_multi_photo_burst(
    batches: list[tuple[bytes, bytes]],
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Multi-photo path — push every photo into the durable queue, ack now.

    The actual processing happens later inside ``_photo_batch_worker``, so
    a bot restart between burst-close and worker-pickup is recoverable. We
    still need the Update here only to send the immediate ack message;
    everything else (vision, synthesis, reply) happens worker-side using
    only ``application.bot``.
    """
    chat_id = str(update.effective_chat.id)
    n = len(batches)
    ack = await update.message.reply_text(
        f"📸 Queued {n} photos — I'll have results for you shortly."
    )

    batch_id: int | None = None
    rejected = 0
    for raw_bytes, vision_bytes in batches:
        photo_b64 = base64.b64encode(vision_bytes).decode()
        try:
            batch_id, _ = await photo_queue.add_photo_to_burst(
                chat_id=chat_id,
                platform="telegram",
                photo_b64=photo_b64,
                caption=caption,
                ack_message_id=ack.message_id,
            )
        except BurstFull:
            rejected += 1
            continue

    if batch_id is None:
        await update.message.reply_text(
            "MIRA: every photo in this burst was rejected — please retry."
        )
        return

    if rejected:
        await update.message.reply_text(
            f"⚠️ Burst capped at {n - rejected}/{n} photos "
            f"({rejected} dropped — try fewer photos at once)."
        )

    try:
        await photo_queue.close_burst(batch_id)
    except QueueFull:
        await update.message.reply_text(
            "🚧 The photo queue is full right now. Please retry in a moment."
        )
        await photo_queue.mark_failed(batch_id, "queue full at close_burst")
        return

    if _hub_intake_configured():
        for raw_bytes, _ in batches:
            asyncio.create_task(_submit_photo_to_hub(raw_bytes, caption, update))


async def _flush_collector(
    chat_id_int: int,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """After the burst window closes, route to single or multi path."""
    try:
        await asyncio.sleep(BURST_WINDOW_SECONDS)
    except asyncio.CancelledError:
        return

    buf = _BURST_COLLECTOR.pop(chat_id_int, None)
    if not buf:
        return

    batches = buf["batches"]
    caption = buf["caption"]
    last_update = buf["update"]

    if len(batches) == 1:
        raw_bytes, vision_bytes = batches[0]
        await _dispatch_single_photo(raw_bytes, vision_bytes, caption, last_update, context)
    else:
        await _enqueue_multi_photo_burst(batches, caption, last_update, context)


async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Collect photos for ``BURST_WINDOW_SECONDS``, then route single/multi."""
    chat_id_int = update.effective_chat.id
    caption = update.message.caption or DEFAULT_PHOTO_CAPTION
    logger.info("Photo from %s: %s", update.effective_user.first_name, caption)

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

    buf = _BURST_COLLECTOR.get(chat_id_int)
    if buf:
        existing_task = buf.get("task")
        if existing_task:
            existing_task.cancel()
        buf["batches"].append((raw_bytes, vision_bytes))
        buf["caption"] = preserve_first_meaningful_caption(buf["caption"], caption)
        buf["update"] = update
    else:
        _BURST_COLLECTOR[chat_id_int] = {
            "batches": [(raw_bytes, vision_bytes)],
            "caption": caption,
            "update": update,
            "task": None,
        }

    flush_task = asyncio.create_task(_flush_collector(chat_id_int, update, context))
    _BURST_COLLECTOR[chat_id_int]["task"] = flush_task


async def _photo_batch_worker(application: Application) -> None:
    """Drain the durable photo-batch queue forever.

    Vision is GPU-bound on a single Ollama node, so concurrency = 1 by
    design. On every iteration: dequeue (blocks), process via
    ``engine.process_multi_photo``, deliver reply via ``application.bot``,
    mark done/failed. Worker exceptions are logged but never propagated —
    the loop must outlive any single bad batch.
    """
    logger.info("PHOTO_QUEUE_WORKER starting (db=%s)", _PHOTO_QUEUE_DB_PATH)
    while True:
        rec: PhotoBatchRecord
        try:
            rec = await photo_queue.dequeue()
        except Exception as exc:
            logger.error("PHOTO_QUEUE_WORKER dequeue error: %s", exc)
            await asyncio.sleep(1.0)
            continue

        n = len(rec.photos_b64)
        logger.info(
            "PHOTO_QUEUE_WORKER processing batch_id=%d chat=%s n=%d",
            rec.id,
            rec.chat_id,
            n,
        )

        async def _edit_ack(text: str) -> None:
            if rec.ack_message_id is None:
                return
            try:
                await application.bot.edit_message_text(
                    chat_id=int(rec.chat_id),
                    message_id=rec.ack_message_id,
                    text=text,
                )
            except Exception as edit_exc:
                logger.debug(
                    "PHOTO_QUEUE_WORKER ack edit failed batch_id=%d: %s",
                    rec.id,
                    edit_exc,
                )

        async def _on_progress(idx_done: int, n_total: int) -> None:
            if idx_done < n_total:
                await _edit_ack(f"📸 Processing photo {idx_done + 1}/{n_total}…")
            else:
                await _edit_ack(f"📸 Synthesizing answer for {n_total} photos…")

        try:
            reply = await engine.process_multi_photo(
                chat_id=rec.chat_id,
                message=rec.caption,
                photos_b64=rec.photos_b64,
                platform=rec.platform,
                on_progress=_on_progress,
            )
            if not reply:
                reply = (
                    f"MIRA error: vision pipeline returned no response for "
                    f"{n} photos. Please retry."
                )
            try:
                await application.bot.send_message(chat_id=int(rec.chat_id), text=reply)
            except Exception as send_exc:
                logger.error(
                    "PHOTO_QUEUE_WORKER reply send failed batch_id=%d: %s",
                    rec.id,
                    send_exc,
                )
            await photo_queue.mark_done(rec.id, reply)
        except Exception as exc:
            logger.exception("PHOTO_QUEUE_WORKER processing error batch_id=%d", rec.id)
            try:
                await application.bot.send_message(
                    chat_id=int(rec.chat_id),
                    text=f"MIRA error processing {n} photos: {exc}",
                )
            except Exception as send_exc:
                logger.error(
                    "PHOTO_QUEUE_WORKER error-reply send failed batch_id=%d: %s",
                    rec.id,
                    send_exc,
                )
            await photo_queue.mark_failed(rec.id, str(exc))


async def reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Reset GSD conversation state."""
    chat_id = str(update.effective_chat.id)
    engine.reset(chat_id)
    await update.message.reply_text("Conversation reset.")


async def new_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Hard-reset conversation state — no preview of WO, no carryover from prior sessions."""
    chat_id = str(update.effective_chat.id)
    engine.reset(chat_id)
    logger.info("NEW_SESSION chat_id=%s user=%s", chat_id, update.effective_user.first_name)
    await update.message.reply_text("🔄 Fresh start. What can I help with?")


# Tolerant /new matcher: catches "/new", "/ new", "/New", "/  new", "/NEW", etc.
# Telegram normally only fires CommandHandler on exact "/new"; users on shaky
# autocorrect or copy-paste end up with stray spaces or capitalised variants
# that fall through to the message handler and confuse the engine.
_NEW_VARIANT_RE = re.compile(r"^\s*/\s*new(?:@\w+)?\s*$", re.IGNORECASE)


async def new_command_variant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text-message variants of /new that don't match PTB's CommandHandler."""
    text = update.message.text or ""
    if not _NEW_VARIANT_RE.match(text):
        return
    await new_command(update, context)


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


async def drive_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Answer a drive-pack question — deterministic, pack-grounded, read-only.

    ``/drive <pack-alias> <question>``. The ONLY answer source is
    ``shared.drive_packs.answer_question`` (deterministic pack JSON) — never
    the engine or an LLM. An unmatched question still renders the pack's own
    honest "I won't guess" answer, never a generic fallback.
    """
    if not context.args or len(context.args) < 2:
        packs = ", ".join(list_packs())
        await update.message.reply_text(
            "Usage: /drive <drive> <question>\n"
            "Example: /drive gs10 What does CE10 mean?\n"
            f"Available: {packs}"
        )
        return

    pack_alias = context.args[0]
    question = " ".join(context.args[1:])
    pack = resolve_pack(pack_alias)
    if pack is None:
        packs = ", ".join(list_packs())
        await update.message.reply_text(
            f"I don't have a drive pack matching '{pack_alias}'. Available: {packs}."
        )
        return

    try:
        async with typing_action(context, update.effective_chat.id):
            result = await asyncio.to_thread(answer_question, pack.pack_id, question)
        reply = result.answer
        if result.citations:
            reply += "\n\nSources:"
            for c in result.citations:
                page = f" p.{c['page']}" if c.get("page") else ""
                reply += f"\n[Source: {c['doc']}{page}]"
        reply += (
            f"\n\nsource: {result.answer_source} · pack: {result.pack_id} · "
            f"fallback_used: {str(result.fallback_used).lower()} · "
            f"live_telemetry: {str(result.live_telemetry).lower()} · "
            f"read_only: {str(result.read_only).lower()}"
        )
        # Plain text (no parse_mode): the pack answer contains OEM text with
        # unbalanced brackets ("[COM1 Time-out Detection]", "[Source: ...]") that
        # Telegram's legacy Markdown parser rejects with a 400 "can't parse
        # entities" — send it verbatim instead.
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error("Drive command error: %s", e)
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
        "/invite <email> \u2014 (admin) mint enrollment link\n"
        "/team \u2014 (admin) list enrolled members\n"
        "/revoke <telegram_id> \u2014 (admin) remove a member\n"
        "/invite_status \u2014 (admin) list pending/used invites\n"
        "/equipment [id] \u2014 Live equipment status (instant)\n"
        "/faults \u2014 Active fault list (instant)\n"
        "/drive <drive> <question> \u2014 Ask a drive pack (instant, pack-grounded)\n"
        "/status \u2014 AI equipment summary\n"
        "/voice on|off \u2014 Enable/disable spoken responses\n"
        "/bad [reason] \u2014 Flag this response as unhelpful\n"
        "/new \u2014 Fresh start (clear conversation state)\n"
        "/reset \u2014 Reset conversation state (alias for /new)\n"
        "/help \u2014 Show this help\n"
        "Or just type any maintenance question.\n"
        "Send a photo to identify equipment.\n"
        "Send a PDF manual to index it for retrieval."
    )


async def _startup(application: Application) -> None:
    """Clear any competing webhook/poller, verify identity, start photo worker + outbox drain."""
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

    # --- Photo batch worker (multi-photo queue / #987) ----------------------
    n_recovered = await photo_queue.recover_orphans()
    if n_recovered:
        logger.warning(
            "PHOTO_QUEUE recovered %d orphan batch(es) from previous shutdown",
            n_recovered,
        )
    application.create_task(_photo_batch_worker(application), name="photo_batch_worker")

    # --- Atlas WO outbox drain (Unit 8 / CRA-17) ----------------------------
    # Re-attempts every 5 minutes. Each pass tries one POST per pending row;
    # the row's `attempts` counter increments. After 3h unsent, an admin
    # alert fires once via ntfy.sh.
    _outbox_client = AtlasCMMSClient()  # reads MCP_BASE_URL + MCP_REST_API_KEY

    # Startup connectivity check — surfaces Atlas/MCP misconfiguration before demo.
    try:
        async with httpx.AsyncClient(timeout=5) as _probe:
            _probe_url = _outbox_client.base_url.rstrip("/") + "/health"
            _r = await _probe.get(_probe_url, headers=_outbox_client._headers())
            if _r.status_code < 300:
                logger.info("Atlas/MCP probe OK (%s)", _probe_url)
            else:
                logger.warning(
                    "Atlas/MCP probe returned HTTP %d — WO creation may fail. "
                    "Check MCP_BASE_URL and MCP_REST_API_KEY in Doppler.",
                    _r.status_code,
                )
    except Exception as _probe_exc:
        logger.warning(
            "Atlas/MCP probe failed (%s) — WO creation will use outbox fallback. "
            "Check that mira-mcp is running and MCP_BASE_URL is correct.",
            _probe_exc,
        )

    async def _outbox_submit(payload: dict) -> dict:
        try:
            return await _outbox_client._post_work_order(payload)
        except Exception as exc:
            return {"error": f"{type(exc).__name__}: {exc}"}

    async def _outbox_alert(row: OutboxRow) -> None:
        title = str(row.payload.get("title", ""))[:60]
        await send_push(
            message=(
                f"Atlas WO unsent for 3h+ (outbox_id={row.id}, attempts={row.attempts}). "
                f"Title: {title!r}. Last error: {row.last_error!r}"
            ),
            title="MIRA WO Outbox Stuck",
            priority="high",
            tags=["warning", "construction"],
        )

    application.create_task(
        run_drain_forever(_outbox_submit, _outbox_alert),
        name="wo_outbox_drain",
    )


_conflict_count = 0
_CONFLICT_EXIT_THRESHOLD = 5  # 5 × 15s = 75s of silence before hard exit


async def _conflict_error_handler(update: object, context) -> None:
    """On 409 Conflict: sleep 15s and retry, but exit after 5 consecutive conflicts.

    Without a hard exit the bot loops silently forever and drops every message —
    a demo killer if a stale CHARLIE poller is running. After _CONFLICT_EXIT_THRESHOLD
    consecutive conflicts the container exits so restart: unless-stopped surfaces the
    problem to ops and the log makes the fix obvious.
    """
    import asyncio

    from telegram.error import Conflict as TGConflict

    global _conflict_count
    if isinstance(context.error, TGConflict):
        _conflict_count += 1
        logger.warning(
            "409 Conflict during polling (%d/%d) — another session is active. "
            "Fix: SSH to each node and run: docker stop mira-bot-telegram. "
            "Then restart this container only on the primary node (VPS).",
            _conflict_count,
            _CONFLICT_EXIT_THRESHOLD,
        )
        if _conflict_count >= _CONFLICT_EXIT_THRESHOLD:
            logger.error(
                "409 Conflict limit reached (%d) — exiting so restart:unless-stopped "
                "surfaces this to ops. Kill the competing poller on CHARLIE first.",
                _CONFLICT_EXIT_THRESHOLD,
            )
            raise SystemExit(1)
        await asyncio.sleep(15)
        return  # let PTB retry getUpdates
    _conflict_count = 0  # reset on any successful update
    raise context.error


def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).post_init(_startup).build()

    # Helper to bind admin command kwargs without subclassing PTB's CommandHandler.
    async def _wrap_invite(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text(
                "Admin commands unavailable: NEON_DATABASE_URL not set."
            )
            return
        await invite_command(
            update,
            context,
            engine=_admin_db_engine,
            auth=_authorizer,
            tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_team(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text(
                "Admin commands unavailable: NEON_DATABASE_URL not set."
            )
            return
        await team_command(
            update,
            context,
            engine=_admin_db_engine,
            auth=_authorizer,
            tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_revoke(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text(
                "Admin commands unavailable: NEON_DATABASE_URL not set."
            )
            return
        await revoke_command(
            update,
            context,
            engine=_admin_db_engine,
            auth=_authorizer,
            tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_invite_status(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text(
                "Admin commands unavailable: NEON_DATABASE_URL not set."
            )
            return
        await invite_status_command(
            update,
            context,
            engine=_admin_db_engine,
            auth=_authorizer,
            tenant_id=DEFAULT_TENANT_ID,
        )

    async def _wrap_start(update, context):
        if _admin_db_engine is None:
            await update.message.reply_text("MIRA isn't fully configured. Ask your admin.")
            return
        # No-args /start from an already-enrolled user → behave like /new.
        # Args present → invite-token consumption flow (unchanged).
        if not (context.args or []):
            chat_id = str(update.effective_chat.id)
            engine.reset(chat_id)
            logger.info(
                "START_RESET chat_id=%s user=%s",
                chat_id,
                update.effective_user.first_name if update.effective_user else "?",
            )
            await update.message.reply_text("🔄 Fresh start. What can I help with?")
            return
        await start_command(
            update,
            context,
            engine=_admin_db_engine,
            diagnostic_engine=engine,
        )

    # IMPORTANT: register /start and /new FIRST so they win over the legacy welcome
    # AND so they always run before the message handler regardless of FSM state.
    app.add_handler(CommandHandler("start", _wrap_start))
    app.add_handler(CommandHandler("new", new_command))
    app.add_handler(CommandHandler("invite", _wrap_invite))
    app.add_handler(CommandHandler("team", _wrap_team))
    app.add_handler(CommandHandler("revoke", _wrap_revoke))
    app.add_handler(CommandHandler("invite_status", _wrap_invite_status))
    app.add_handler(CommandHandler("equipment", equipment_command))
    app.add_handler(CommandHandler("faults", faults_command))
    app.add_handler(CommandHandler("drive", drive_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("reset", reset_command))
    app.add_handler(CommandHandler("voice", voice_command))
    app.add_handler(CommandHandler("bad", bad_command))
    app.add_handler(CommandHandler("help", help_command))
    # /new variant matcher: catches "/ new", "/New", " /new ", etc. that PTB's
    # CommandHandler doesn't match. Must be registered BEFORE the catch-all
    # text handler so a stray-space /new doesn't get diagnosed as a question.
    app.add_handler(
        MessageHandler(
            filters.Regex(r"^\s*/\s*new(?:@\w+)?\s*$") & ~filters.COMMAND,
            new_command_variant,
        )
    )
    app.add_handler(MessageHandler(filters.Document.PDF, document_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.VOICE, voice_message_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_error_handler(_conflict_error_handler)
    _ver_path = os.path.join(os.path.dirname(__file__), "VERSION")
    _ver = open(_ver_path).read().strip() if os.path.exists(_ver_path) else "unknown"
    logger.info(
        "MIRA Telegram bot starting (polling) version=%s admins=%d", _ver, _authorizer.admin_count()
    )
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
