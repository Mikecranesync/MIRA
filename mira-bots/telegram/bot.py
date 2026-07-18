"""MIRA Telegram Bot — GSD engine + direct data commands."""

import asyncio
import base64
import contextlib
import io as _io
import logging
import os
import re

import httpx
import printsense_commercial
import printsense_testkit
from admin_commands import (
    invite_command,
    invite_status_command,
    revoke_command,
    team_command,
)
from chat_adapter import TelegramChatAdapter
from PIL import Image
from shared import (
    chat_tenant,
    print_autoeval,
    print_translator,
    print_workspace,
    tts,
    wiring_intake,
)
from shared.chat.dispatcher import ChatDispatcher
from shared.contextualization_intake import (
    hub_folder_upload_configured,
    submit_file_to_hub_folder,
)
from shared.conversation_logger import log_turn, measure_ms
from shared.drive_packs import (
    answer_question,
    build_asset_identity,
    list_packs,
    load_pack,
    resolve_pack,
    resolve_service_pack,
)
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


def _redact_telegram_bot_token(value):
    """Mask Telegram bot tokens embedded in request URLs before logging."""
    if isinstance(value, str):
        return re.sub(r"/bot[^/\s]+/", "/bot<redacted>/", value)
    return value


class _TelegramBotTokenRedactionFilter(logging.Filter):
    """Logging filter that masks `/bot<id>:<token>/` URL path segments."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact_telegram_bot_token(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_redact_telegram_bot_token(arg) for arg in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                key: _redact_telegram_bot_token(value) for key, value in record.args.items()
            }
        return True


def _install_telegram_http_log_redaction() -> None:
    for name in ("httpx", "httpcore"):
        target = logging.getLogger(name)
        if not any(isinstance(f, _TelegramBotTokenRedactionFilter) for f in target.filters):
            target.addFilter(_TelegramBotTokenRedactionFilter())


_install_telegram_http_log_redaction()

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


def _format_drive_pack_reply(result) -> str:
    """Render a ``DrivePackAnswer`` the same way for every surface that asks a
    drive pack a question (the ``/drive`` command and the nameplate-photo fast
    path below) — plain text, inline ``[Source: ...]`` citations, and the
    metadata footer a technician can use to see this was pack-grounded, not a
    guess."""
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
    return reply


def _drive_pack_meta(entry: str, result, resolution=None) -> dict:
    """The ``conversation_eval.meta`` payload for a drive-pack turn — the labels
    the distillation flywheel mines. ``matched=False`` is the knowledge-gap
    signal (e.g. a technician asking about an undocumented parameter)."""
    d = result.to_dict()
    meta = {
        "surface": "drive_pack",
        "entry": entry,  # "nameplate" | "followup" | "command"
        "pack_id": d.get("pack_id"),
        "matched": d.get("matched"),
        "matched_kind": d.get("matched_kind"),
        "answer_source": d.get("answer_source"),
        "resolved": d.get("resolved"),
    }
    if resolution is not None:
        try:
            r = resolution.to_dict()
            meta["resolution"] = {
                "source": r.get("source"),
                "confidence": r.get("confidence"),
                "ambiguous": r.get("ambiguous"),
            }
        except Exception:  # noqa: BLE001 — resolution meta is best-effort
            pass
    return meta


async def _capture_drive_pack_turn(
    *,
    question: str,
    result,
    update: Update,
    entry: str,
    resolution=None,
) -> None:
    """Capture a drive-pack Q&A turn into ``conversation_eval`` (fail-open, via
    the shared ``log_turn``). Called AFTER the reply is sent, so it never delays
    the technician's answer. Carries drive-pack labels (pack_id / matched /
    matched_kind) so the flywheel can surface knowledge gaps per pack. No LLM,
    no behaviour change to the reply."""
    try:
        _uploader, _captured_at, tenant_id = _intake_meta(update)
    except Exception:  # noqa: BLE001 — tenant is optional metadata
        tenant_id = ""
    meta = _drive_pack_meta(entry, result, resolution)
    if tenant_id:
        meta["tenant_id"] = tenant_id
    await log_turn(
        chat_id=str(update.effective_chat.id),
        user_message=question or "",
        bot_response=_format_drive_pack_reply(result),
        source="telegram",
        intent="drive_pack",
        has_citations=bool(result.citations),
        meta=meta,
    )


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


# --- Per-chat drive-pack context (bot-local; NOT the engine's FSM state) -----
# When a nameplate photo or /drive identifies a drive, remember its pack for
# this chat so a TEXT follow-up ("what is P09.03?") continues in that drive's
# context and answers from the pack — the multi-turn continuity that the
# photo-only fast path deliberately deferred. Deliberately a DEDICATED table,
# separate from the engine's `conversation_state` (no engine.py change), keyed
# by chat_id with a freshness TTL so a stale context can't hijack a new topic.
_DRIVE_CONTEXT_TTL_S = 1800  # 30 min

# A drive-question signal in free text: a dotted parameter id (P09.03 / P01.24),
# a bare Pxxx(x) parameter, or explicit drive vocabulary. Used only to decide
# whether an ALREADY-established drive conversation should stay in-pack when the
# pack itself didn't match the question (e.g. an undocumented parameter → the
# pack's honest "not documented" answer, not the enrollment wall).
_DRIVE_QUESTION_RE = re.compile(
    r"\b[A-Za-z]\d{2}\.\d{2}\b"
    r"|\bP\d{3,4}\b"
    r"|\b(parameter|param|fault|error\s*code|alarm|trip|keypad|register)\b",
    re.IGNORECASE,
)


def _drive_context_db():
    import sqlite3

    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS telegram_drive_context ("
        "chat_id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, updated_at REAL NOT NULL)"
    )
    return db


def _set_drive_context(chat_id: str, pack_id: str) -> None:
    """Remember (or refresh) the drive pack this chat is talking about."""
    import time as _time

    try:
        db = _drive_context_db()
        db.execute(
            "INSERT INTO telegram_drive_context (chat_id, pack_id, updated_at) "
            "VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET "
            "pack_id = excluded.pack_id, updated_at = excluded.updated_at",
            (chat_id, pack_id, _time.time()),
        )
        db.commit()
        db.close()
    except Exception as exc:  # never let a context write break the turn
        logger.warning("drive-context write failed: %s", exc)


def _get_drive_context(chat_id: str, max_age_s: int | None = None) -> str | None:
    """The pack this chat is talking about, if identified within the TTL.

    ``max_age_s`` defaults to the module ``_DRIVE_CONTEXT_TTL_S`` read at call
    time (not bound at definition), so the freshness window stays overridable.
    """
    import time as _time

    max_age = _DRIVE_CONTEXT_TTL_S if max_age_s is None else max_age_s
    try:
        db = _drive_context_db()
        row = db.execute(
            "SELECT pack_id, updated_at FROM telegram_drive_context WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        db.close()
    except Exception:
        return None
    if not row:
        return None
    pack_id, updated_at = row
    if (_time.time() - float(updated_at)) > max_age:
        return None
    return pack_id


async def _try_drive_pack_followup(
    text: str,
    chat_id: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> bool:
    """Continue an established drive conversation on a TEXT turn (read-only,
    cited, no LLM, un-gated — same public-OEM contract as the photo fast path).

    Only claims the turn (returns ``True``) when this chat recently identified a
    drive AND the text either maps to the pack's content OR reads like a drive
    question. Everything else falls through (returns ``False``) to the normal,
    enrollment-gated engine dispatch — so general chat, FSM confirmations
    ("yes"/"no"), and non-drive questions are untouched.
    """
    if not text:
        return False
    pack_id = _get_drive_context(chat_id)
    if not pack_id:
        return False

    result = await asyncio.to_thread(answer_question, pack_id, text)
    if not (result.matched or _DRIVE_QUESTION_RE.search(text)):
        return False

    reply = _format_drive_pack_reply(result)
    await update.message.reply_text(reply)
    _set_drive_context(chat_id, pack_id)  # refresh TTL on continued use
    await _maybe_send_voice(update, context, chat_id, reply)
    await _capture_drive_pack_turn(question=text, result=result, update=update, entry="followup")
    return True


# --- Wiring loop (PR-4): photo -> proposed rows; text -> verified-only cited
# Q&A (`shared/wiring_intake.py`). Additive, fall-through fast paths — mirror
# the drive-pack precedent above. See `shared/wiring_intake.py` module
# docstring for the full doctrine + the mig-026 direct-INSERT decision.
#
# Per-chat wiring-asset memory was deliberately NOT added: the existing
# `telegram_drive_context` table (`_set_drive_context`/`_get_drive_context`,
# above) is keyed `chat_id -> pack_id` with no context-kind column, so it
# cannot be reused for a second concept (a wiring asset) with "a distinct
# key" — that would require either a schema change to that table or a new
# table, and the PR-4 spec says: if trivial reuse isn't available, skip
# memory rather than add one. The asset must be named in the text/caption
# ("CV-101 add this wiring", "CV-101 where does W200 land?") or MIRA asks
# for it (`wiring_intake.MISSING_ASSET_REPLY`) — it never guesses.
def _write_rows_blocking(tenant_id: str, rows: list) -> tuple[int, int]:
    """Sync DB glue for `_try_wiring_intake_reply` (psycopg2 is sync — run in
    a thread via `asyncio.to_thread`). Opens a NeonDB connection, writes the
    PR-2-converted rows through the reused writer seam (always
    `approval_state='proposed'`), commits, and closes.
    """
    conn = wiring_intake.open_neon_conn()
    try:
        with conn.cursor() as cur:
            inserted, skipped = wiring_intake.write_proposed_rows(cur, tenant_id, rows)
        conn.commit()
    finally:
        conn.close()
    return inserted, skipped


def _answer_wiring_blocking(
    tenant_id: str, asset: str, question: str
) -> "wiring_intake.WiringAnswer":
    """Sync DB glue for `_try_wiring_question_reply` — read-only. Loads the
    asset's `MachineWiringProfile` and answers the question from `verified`
    rows only (`shared.wiring_profile.answer_wiring_question`'s gate).
    """
    conn = wiring_intake.open_neon_conn()
    try:
        with conn.cursor() as cur:
            profile = wiring_intake.load_profile(cur, tenant_id, asset=asset)
    finally:
        conn.close()
    return wiring_intake.answer_wiring_question(profile, question)


async def _try_wiring_question_reply(
    text: str,
    chat_id: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> bool:
    """Wiring-question TEXT fast path (read-only, cited, no LLM fallback).

    Only claims the turn (returns ``True``) when ``text`` reads as a wiring
    question per ``wiring_intake.parse_wiring_intent`` — a question marker
    ("where does", "connected to", ...) PLUS a parseable wire/terminal
    token. Answers ONLY from ``verified`` rows; a match that exists only
    among proposed/needs_review/rejected rows is an explicit refusal, never
    an assertion, and an absent record is an honest "no record" — never a
    guess, never a generic LLM fallback. Falls through unchanged (returns
    ``False``) for anything that isn't a wiring question, so the normal
    enrollment-gated engine dispatch in ``handle_message`` is untouched.
    """
    intent = wiring_intake.parse_wiring_intent(text)
    if intent.kind != "question":
        return False

    asset = intent.asset
    if not asset:
        await update.message.reply_text(wiring_intake.MISSING_ASSET_REPLY)
        return True

    tenant_id = chat_tenant.resolve(str(update.effective_user.id))
    answer = await asyncio.to_thread(
        _answer_wiring_blocking, tenant_id, asset, intent.question or text
    )
    await update.message.reply_text(wiring_intake.format_wiring_answer(answer, asset))
    return True


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route text messages through the GSD engine via ChatAdapter."""
    import time as _time

    text = update.message.text
    chat_id = str(update.effective_chat.id)
    logger.info("Received from %s: %s", update.effective_user.first_name, text)

    # Drive-conversation continuity: a text follow-up after a nameplate / /drive
    # identification answers from that pack directly (read-only, cited, un-gated)
    # instead of dropping to the enrollment-gated engine path with no memory of
    # the drive. Falls through unchanged for non-drive text.
    if await _try_drive_pack_followup(text, chat_id, update, context):
        return

    # Commercial PrintSense consent/question turns (PR-B) — claims the turn
    # ONLY while this chat has a pending PrintSense state; otherwise falls
    # through unchanged.
    if await printsense_commercial.try_printsense_text_reply(text, update, context):
        return
    # Wiring Q&A: verified-only, cited answers over `wiring_connections`
    # (PR-4). Falls through unchanged for anything that isn't a wiring
    # question. See `_try_wiring_question_reply` docstring.
    if await _try_wiring_question_reply(text, chat_id, update, context):
        return
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


async def _try_nameplate_drive_pack_reply(
    vision_bytes: bytes,
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> bool:
    """Nameplate-photo -> drive-pack fast path (additive, read-only, no LLM
    fallback). Reuses ``engine.nameplate`` (the same ``NameplateWorker`` the
    Supervisor's own nameplate flow uses) purely to EXTRACT fields, then
    resolves them via ``resolve_service_pack`` — the surface-agnostic
    service-pack contract. Never touches ``engine.process``/the FSM.

    Only short-circuits the normal photo dispatch (returns ``True``) when the
    nameplate signal confidently identifies a LIVE drive pack, or names a
    recognized manufacturer the technician explicitly asked a question about.
    Any photo whose nameplate extraction doesn't identify a known drive family
    falls through unchanged to the existing engine-dispatched photo flow
    (returns ``False``) — non-nameplate photos are untouched by this path.
    """
    photo_b64 = base64.b64encode(vision_bytes).decode()
    try:
        fields = await engine.nameplate.extract(photo_b64)
    except Exception as e:
        logger.warning("nameplate drive-pack extract failed: %s", e)
        return False

    if not isinstance(fields, dict) or "parse_error" in fields:
        return False

    resolution = resolve_service_pack(nameplate=fields)

    # Phase 2 (#2561): preserve the extracted nameplate as a structured Asset
    # Identity Packet (raw OCR kept separate from interpreted fields; nothing
    # fabricated) instead of discarding the fields after routing. Persisting it
    # to a Hub review record is Phase 3 — here it is built + audit-logged so the
    # evidence is not silently dropped. The full raw_text lives on the packet
    # (for a future Hub sink); the log line stays a concise identity summary.
    identity = build_asset_identity(nameplate=fields, resolution=resolution)
    logger.info(
        "nameplate asset identity: manufacturer=%s model=%s sku_prefix=%s "
        "serial=%s candidate_pack=%s approval=%s",
        identity.manufacturer,
        identity.model_number,
        identity.sku_prefix,
        identity.serial_number,
        identity.candidate_pack_id,
        identity.approval_status,
    )

    has_question = bool(caption) and caption != DEFAULT_PHOTO_CAPTION

    if resolution.pack_id is not None:
        pack = load_pack(resolution.pack_id)
        # Remember this drive for the chat so a TEXT follow-up (a parameter or
        # fault question with no photo) continues in this pack's context.
        _set_drive_context(str(update.effective_chat.id), resolution.pack_id)
        if has_question:
            async with typing_action(context, update.effective_chat.id):
                result = await asyncio.to_thread(answer_question, resolution.pack_id, caption)
            await update.message.reply_text(_format_drive_pack_reply(result))
            await _capture_drive_pack_turn(
                question=caption,
                result=result,
                update=update,
                entry="nameplate",
                resolution=resolution,
            )
            return True

        # No question yet — confirm identification, invite one. Per
        # `.claude/rules/train-before-deploy.md` / session discipline this
        # session does NOT stash pack_id for a text follow-up turn: the only
        # per-chat conversation state is the engine's private SQLite
        # `conversation_state` (`_load_state`/`_save_state`, no public
        # accessor) and no clean migration-free per-chat KV exists outside
        # it. Deferred — see the PR description / runbook note.
        await update.message.reply_text(
            f"\U0001f4c7 Identified: {pack.family.manufacturer} {pack.family.series} "
            f'— ask me about it, e.g. "what does CE10 mean?"'
        )
        return True

    if has_question and "recognized manufacturer" in resolution.reason:
        # A drive nameplate was clearly present (we recognized the
        # manufacturer) but the model/series didn't resolve to a live pack —
        # give the honest, actionable refusal instead of guessing or silently
        # falling through to a generic engine answer.
        await update.message.reply_text(resolution.reason)
        return True

    # Nothing recognized at all (not a drive nameplate, or extraction was too
    # thin to tell) — let the existing engine-dispatched photo flow handle it,
    # unchanged.
    return False


async def _try_wiring_intake_reply(
    vision_bytes: bytes,
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> bool:
    """Wiring-photo -> proposed-rows fast path (additive, no LLM fallback).

    Only claims the turn (returns ``True``) when ``caption`` reads as wiring
    INTAKE per ``wiring_intake.parse_wiring_intent`` (e.g. "CV-101 add this
    wiring"). Reuses ``engine._extract_schematic`` — the SAME schematic
    extractor the engine's own ELECTRICAL_PRINT path calls — purely to get
    the KG-shaped payload, then writes it through the merged PR-1/PR-2 seam
    (``wiring_intake.payload_to_proposed_rows`` -> ``write_proposed_rows``)
    as ``approval_state='proposed'`` — NEVER verified; a human must approve
    before MIRA will answer from these rows (see ``wiring_profile``).

    Falls through unchanged (returns ``False``) for any caption that isn't
    wiring intake, so the existing ELECTRICAL_PRINT/PrintWorker photo flow
    in ``_dispatch_single_photo`` is untouched.
    """
    intent = wiring_intake.parse_wiring_intent(caption)
    if intent.kind != "intake":
        return False

    chat_id = str(update.effective_chat.id)
    asset = intent.asset
    if not asset:
        await update.message.reply_text(wiring_intake.MISSING_ASSET_REPLY)
        return True

    tenant_id = chat_tenant.resolve(str(update.effective_user.id))
    photo_b64 = base64.b64encode(vision_bytes).decode()
    payload = await engine._extract_schematic(photo_b64)
    if not payload or not payload.get("relationships"):
        await update.message.reply_text(
            "I couldn't read any wiring connections from that image. "
            "Send a clearer electrical print."
        )
        return True

    rows = wiring_intake.payload_to_proposed_rows(
        payload,
        asset,
        drawing_ref=f"telegram:{chat_id}",
        proposed_by="telegram:wiring_intake",
        source=f"telegram:chat:{chat_id}",
    )
    inserted, skipped = await asyncio.to_thread(_write_rows_blocking, tenant_id, rows)
    await update.message.reply_text(
        wiring_intake.build_intake_preview(payload, inserted, skipped, asset)
    )
    return True


# --- Print Translator: read-only LLM explanation of an electrical print,
# NOT the wiring loop. See `shared/print_translator.py` module docstring for
# the full grounding doctrine (OCR-only, hedged framing, no invention). This
# fast path never writes to `wiring_connections` and never touches control;
# it reads the vision classification + OCR, calls the inference cascade,
# replies, and then persists the turn into the per-chat print workspace
# observation ledger (`shared/print_workspace.py` — best-effort, fail-open).
def _print_interpreter_configured() -> bool:
    """True when the isolated paid PrintSynth interpreter is active
    (``PRINT_VISION_PROVIDER`` + that provider's key — ``interpret.is_configured()``
    is the single source of truth). Used only to decide whether to ack the
    ~30-60 s interpretation; the engine re-checks before calling the paid
    provider and falls back to the cascade when it's off.
    """
    try:
        from printsense import interpret  # noqa: PLC0415 — lazy, image may not ship it
    except ImportError:
        return False
    return interpret.is_configured()


def _schedule_print_autoeval(
    *,
    question: str,
    answer: str,
    vision_data: dict | None,
    branch: str,
    t0: float,
    update: Update,
    raw_bytes: bytes | None = None,
) -> None:
    """Fire-and-forget the per-turn print autoeval AFTER the reply is delivered.

    Usage attribution and latency are captured SYNCHRONOUSLY here — the paid
    interpreter's usage lives in a module-global slot and PTB processes updates
    sequentially, so yielding first would let the next turn clobber it. The
    evaluation + persistence + alert then run as a task so the (2s log_turn +
    10s push worst-case) I/O never holds the update loop. Never raises."""
    import time as _time

    try:
        if not print_autoeval.enabled():
            return
        latency_s = _time.monotonic() - t0
        usage = None
        try:
            from printsense import interpret as _interp

            usage = _interp.pop_last_usage()
        except Exception:  # noqa: BLE001 — attribution is best-effort telemetry
            usage = None
        if usage is None:
            model_str = engine.router.last_model_for(str(update.effective_chat.id))
            if model_str:
                prov, _, mod = model_str.partition("/")
                usage = {"provider": prov, "model": mod}
        asyncio.create_task(
            _autoeval_print_turn(
                question=question,
                answer=answer,
                vision_data=vision_data,
                usage=usage,
                latency_s=latency_s,
                branch=branch,
                interpreter_configured=_print_interpreter_configured(),
                chat_id=str(update.effective_chat.id),
                update=update,
                raw_bytes=raw_bytes,
            )
        )
    except Exception as exc:  # noqa: BLE001 — observability never touches the turn
        logger.warning("PRINT_AUTOEVAL_SCHEDULE_ERROR %s", exc)


async def _autoeval_print_turn(
    *,
    question: str,
    answer: str,
    vision_data: dict | None,
    usage: dict | None,
    latency_s: float,
    branch: str,
    interpreter_configured: bool,
    chat_id: str,
    update: Update,
    raw_bytes: bytes | None = None,
) -> None:
    """Evaluate ($0, truth-free) → persist to conversation_eval → P0 ntfy push.

    Mirrors _capture_drive_pack_turn: called after the reply, fail-open, no LLM,
    no behaviour change to the reply. Design: docs/plans/2026-07-18-print-autoeval-hook.md."""
    try:
        result = print_autoeval.evaluate_print_turn(
            question,
            answer,
            vision_data,
            usage,
            latency_s,
            branch=branch,
            interpreter_configured=interpreter_configured,
        )
        logger.info(
            "PRINT_AUTOEVAL severity=%s flags=%s branch=%s provider=%s cost=%s latency=%.1fs",
            result["severity"],
            [f["class"] for f in result["flags"]],
            branch,
            result.get("provider"),
            result.get("estimated_cost_usd"),
            latency_s,
        )
        meta: dict = {"surface": "print_translator", "autoeval": result}
        try:
            _uploader, _captured_at, tenant_id = _intake_meta(update)
            if tenant_id:
                meta["tenant_id"] = tenant_id
        except Exception:  # noqa: BLE001 — tenant is optional metadata
            pass
        await log_turn(
            chat_id=chat_id,
            user_message=question or "",
            bot_response=answer or "",
            source="telegram",
            intent="print_translator",
            has_citations=(branch == "deterministic_fastpath"),
            response_time_ms=int(latency_s * 1000),
            meta=meta,
        )
        # Print-turn persistence (2026-07-15 operator directive, supersedes
        # PR #2714): every PrintSense request + full reply retrievable from
        # the same SQLite `interactions` table as chat turns. This hook is
        # the choke point the bot fast-path turns flow through (engine-path
        # photo turns already log via engine.process). Provenance is derived
        # at this layer: route from branch+provider, sha of the full-res
        # input; `devices` stays None (the interpreter's graph isn't visible
        # here — quota-dead paid path today). Best-effort, never raises.
        try:
            import hashlib as _hashlib

            provider = (usage or {}).get("provider")
            if branch == "deterministic_fastpath":
                route, fallback_reason = "deterministic_fastpath", None
            elif provider == "openai":
                route, fallback_reason = "printsense", None
            else:
                route = "cascade"
                fallback_reason = (
                    "interpreter_fell_through"
                    if interpreter_configured
                    else "interpreter_not_configured"
                )
            engine._log_interaction(
                chat_id,
                question or "",
                answer or "",
                fsm_state="ELECTRICAL_PRINT",
                intent="print",
                has_photo=True,
                response_time_ms=int(latency_s * 1000),
                route=route,
                model=(usage or {}).get("model"),
                input_sha256=(_hashlib.sha256(raw_bytes).hexdigest() if raw_bytes else None),
                fallback_reason=fallback_reason,
            )
        except Exception as exc:  # noqa: BLE001 — persistence is best-effort
            logger.warning("PRINT_TURN_PERSIST_ERROR %s", type(exc).__name__)
        if print_autoeval.should_alert(result):
            classes = [f["class"] for f in result["flags"] if f["severity"] == "P0"]
            if print_autoeval.ALERT_LIMITER.allow(classes):
                await send_push(
                    message=print_autoeval.format_alert(result),
                    title="MIRA PrintSense autoeval P0",
                    priority="high",
                    tags=["triangular_flag"],
                )
            else:
                logger.warning("AUTOEVAL_ALERT_SUPPRESSED classes=%s", classes)
    except Exception as exc:  # noqa: BLE001 — observability never raises
        logger.warning("PRINT_AUTOEVAL_ERROR %s", type(exc).__name__)


async def _persist_print_workspace_turn(
    update: Update,
    *,
    tenant_id: str,
    raw_bytes: bytes,
    vision_data: dict | None,
    caption: str,
    answer: str,
) -> None:
    """Persist a delivered print turn into the per-chat print workspace
    (Package A spine). Best-effort and fail-open: the reply was already sent,
    so a persistence failure is logged and swallowed — it must never eat,
    duplicate, or delay-fail the turn. When a close-up superseded earlier
    observations, a short enrichment ack tells the technician the print
    model advanced."""
    try:
        outcome = await print_workspace.persist_print_turn(
            chat_id=str(update.effective_chat.id),
            tenant_id=tenant_id,
            raw_bytes=raw_bytes,
            vision_data=vision_data,
            caption=caption,
            answer=answer,
        )
        if outcome and outcome.superseded_ids:
            await _reply_chunked(
                update,
                f"Close-up absorbed: {len(outcome.superseded_ids)} observations updated, "
                "print model revision bumped.",
            )
    except Exception as exc:  # noqa: BLE001 — persistence never touches the turn
        logger.warning("PRINT_WORKSPACE_PERSIST_ERROR %s", type(exc).__name__)


def _print_workspace_tenant(update: Update) -> str:
    """Tenant for print-workspace persistence — chat_tenant mapping when
    available, else the literal ``"default"``. Never raises."""
    try:
        return chat_tenant.resolve(str(update.effective_user.id)) or "default"
    except Exception:  # noqa: BLE001 — tenant resolution must never eat the turn
        return "default"


async def _try_print_translator_reply(
    raw_bytes: bytes,
    vision_bytes: bytes,
    caption: str,
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> bool:
    """Print Translator: an electrical-print photo + any print QUESTION (explain
    / theory of operation, OR a device / wiring / tracing question like "what
    devices are listed in this print?") -> a plain-English, OCR-grounded answer.
    Read-only generation — NO wiring DB writes, NO control writes. After the
    reply is delivered, the turn is persisted (best-effort, fail-open) into the
    per-chat print-workspace observation ledger (``shared/print_workspace.py``).
    Falls through (returns ``False``) for any caption that isn't a print
    question, and for photos the vision worker does NOT classify as
    ``ELECTRICAL_PRINT`` — so non-print photos and the existing nameplate/drive
    and wiring-intake flows are untouched.

    Classification runs on the small ``vision_bytes`` (fast, local qwen), but the
    Anthropic PrintSynth interpreter reads the FULL-RESOLUTION ``raw_bytes`` — the
    print path must not be crushed to 1024 px, or Claude's high-res perception is
    wasted (roadmap Phase 0.1). ``interpret.prepare_print_image`` then auto-uprights
    and resizes it to the 2576 px vision budget.
    """
    if not print_translator.is_print_question(caption):
        return False  # cheap reject, no vision call

    import time as _time

    t0 = _time.monotonic()
    photo_b64 = base64.b64encode(vision_bytes).decode()
    try:
        vision_data = await engine.vision.process(photo_b64, caption)
    except Exception as e:
        logger.warning("print translator vision classify failed: %s", e)
        return False  # a vision hiccup shouldn't eat the turn — fall through

    if (vision_data or {}).get("classification") != "ELECTRICAL_PRINT":
        return False  # not a print → fall through unchanged

    tenant_id = _print_workspace_tenant(update)

    # UNSEEN-1 deterministic fast-path (zero tokens, before ANY model call):
    # closed-form question classes — contact conventions, designation meaning,
    # cross-reference and wire lookups — answered from the deterministic spine
    # with evidence + citation + caveat. Insufficient evidence → fall through
    # to the model path below WITH the extracted evidence injected as
    # grounding. See printsense/deterministic_qa.py + the fast-path rule.
    try:
        from printsense import deterministic_qa as _det_qa
    except ImportError:
        _det_qa = None
    if _det_qa is not None:
        try:
            det = _det_qa.try_deterministic_answer(caption, vision_data)
            if det:
                logger.info("PRINT_DETERMINISTIC_FASTPATH class=%s", det.get("question_class"))
                await _reply_chunked(update, det["reply_text"])
                _schedule_print_autoeval(
                    question=caption,
                    answer=det["reply_text"],
                    vision_data=vision_data,
                    branch="deterministic_fastpath",
                    t0=t0,
                    update=update,
                    raw_bytes=raw_bytes,
                )
                await _persist_print_workspace_turn(
                    update,
                    tenant_id=tenant_id,
                    raw_bytes=raw_bytes,
                    vision_data=vision_data,
                    caption=caption,
                    answer=det["reply_text"],
                )
                return True
            pack = _det_qa.extract_evidence(caption, vision_data)
            if pack.get("lines"):
                vision_data = dict(vision_data or {})
                vision_data["deterministic_evidence"] = pack["lines"]
        except Exception as e:  # noqa: BLE001 — deterministic layer never eats the turn
            logger.warning("print deterministic fast-path error: %s", e)

    # Grounded answer: Anthropic PrintSynth interpreter first (deep, typed,
    # never-invent), else the OCR-verbatim cascade. Both live in
    # engine._grounded_print_reply, which always returns a display-ready string.
    # Ack the paid interpretation (typically ~1-2 min at medium effort; up to
    # ~5 min on multi-page packages at high) so the tech isn't left staring at
    # a silent chat.
    if _print_interpreter_configured():
        await update.message.reply_text(
            "🔍 Reading your electrical print — a full interpretation usually takes 1–2 minutes…"
        )
    interpret_b64 = base64.b64encode(raw_bytes).decode()
    async with typing_action(context, update.effective_chat.id):
        reply = await engine._grounded_print_reply(
            photo_b64,
            caption,
            vision_data,
            str(update.effective_chat.id),
            interpret_b64=interpret_b64,
            graph_sink=print_workspace.graph_sink_for(str(update.effective_chat.id)),
        )
    final_text = reply or print_translator.format_theory_reply("", vision_data.get("drawing_type"))
    await _reply_chunked(update, final_text)
    _schedule_print_autoeval(
        question=caption,
        answer=final_text,
        vision_data=vision_data,
        branch="theory",
        t0=t0,
        update=update,
        raw_bytes=raw_bytes,
    )
    await _persist_print_workspace_turn(
        update,
        tenant_id=tenant_id,
        raw_bytes=raw_bytes,
        vision_data=vision_data,
        caption=caption,
        answer=final_text,
    )
    return True


def _chunk_reply(text: str, limit: int = 4000) -> list[str]:
    """Split a reply into Telegram-deliverable chunks (hard API cap: 4096).

    Splits on line boundaries so sections stay intact — for line-structured
    text, joining the chunks with "\\n" reproduces the original. A single line
    longer than the limit is hard-split (the split points become message
    boundaries); no characters are ever dropped.
    """
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    current = ""
    for line in text.split("\n"):
        while len(line) > limit:  # pathological single line — hard split
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:limit])
            line = line[limit:]
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            chunks.append(current)
            current = line
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


async def _reply_chunked(update: Update, text: str) -> None:
    """Deliver a reply of any length; a delivery failure is logged, never silent.

    The theory path's model reply can exceed Telegram's 4096-char sendMessage
    cap (live-hit 2026-07-18: a 1068-token gemma reply 400'd and the turn died
    silently after the ack). Chunk, and surface any residual send error to the
    technician instead of eating it.
    """
    try:
        for chunk in _chunk_reply(text):
            await update.message.reply_text(chunk)
    except Exception as e:  # noqa: BLE001 — delivery failure must be visible
        logger.warning("print reply delivery failed: %s", e)
        with contextlib.suppress(Exception):
            await update.message.reply_text(
                "⚠️ I built an answer but couldn't deliver it. Try a narrower question."
            )


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

    Before any of that: try the read-only nameplate -> drive-pack fast path
    (see ``_try_nameplate_drive_pack_reply``). It only claims the turn when it
    confidently resolves a LIVE service pack (or a recognized-manufacturer
    refusal) from the nameplate — everything else falls through to the
    unchanged engine dispatch below.
    """
    # Admin test-caption mode (/printsense_grade <question>): pre-empts every
    # rung so an admin probe never leaks into customer flows. Fail-closed.
    if await printsense_testkit.try_printsense_grade_reply(
        raw_bytes, vision_bytes, caption, update, context
    ):
        return

    if await _try_nameplate_drive_pack_reply(vision_bytes, caption, update, context):
        return

    # Wiring intake: propose rows into `wiring_connections` from an
    # electrical-print photo captioned "add this wiring" (PR-4). Falls
    # through unchanged for any other caption. See
    # `_try_wiring_intake_reply` docstring.
    if await _try_wiring_intake_reply(vision_bytes, caption, update, context):
        return

    # Print Translator: read-only LLM explanation of an electrical print for
    # an "explain this / theory of operation" caption. Falls through
    # unchanged for anything else. Passes the full-res raw_bytes so the
    # Anthropic interpreter reads the print at Claude's high-res budget, not
    # the 1024px-crushed vision_bytes. See `_try_print_translator_reply`.
    if await _try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context):
        return

    # Commercial PrintSense concierge (PR-B): explicit-intent only —
    # /printsense state or an "analyze ... print" caption. Everything else
    # falls through unchanged. See printsense_commercial.py.
    if await printsense_commercial.try_printsense_commercial_reply(
        raw_bytes, caption, update, context
    ):
        return

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
        raw_photo_b64 = base64.b64encode(raw_bytes).decode()
        try:
            batch_id, _ = await photo_queue.add_photo_to_burst(
                chat_id=chat_id,
                platform="telegram",
                photo_b64=photo_b64,
                caption=caption,
                ack_message_id=ack.message_id,
                raw_photo_b64=raw_photo_b64,
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


async def _try_multi_photo_printsense_reply(rec: PhotoBatchRecord) -> str | None:
    """Return a PrintSense package reply for all-print albums, else ``None``.

    The generic multi-photo worker is for equipment-photo synthesis. Electrical
    print albums need to stay together as one PrintSense package so cross-page
    references and shared title-block context survive.
    """
    if not rec.photos_b64 or not rec.raw_photos_b64:
        return None

    page_contexts: list[dict] = []
    for idx, photo_b64 in enumerate(rec.photos_b64, start=1):
        try:
            vision_data = await engine.vision.process(photo_b64, rec.caption)
        except Exception as exc:  # noqa: BLE001 — fallback to generic worker
            logger.warning(
                "PHOTO_QUEUE_PRINTSENSE_CLASSIFY_ERROR batch_id=%d page=%d error=%s",
                rec.id,
                idx,
                exc,
            )
            return None
        if (vision_data or {}).get("classification") != "ELECTRICAL_PRINT":
            return None
        page_contexts.append(
            {
                "page": idx,
                "drawing_type": (vision_data or {}).get("drawing_type"),
                "ocr_items": (vision_data or {}).get("ocr_items") or [],
            }
        )

    reply = await engine._interpret_print_anthropic_pages(
        photo_b64s=rec.raw_photos_b64,
        question=rec.caption,
        package_context={
            "source": "telegram_media_group",
            "page_count": len(rec.raw_photos_b64),
            "pages": page_contexts,
        },
    )

    # Persist each classified page into the chat's print workspace (Package A
    # spine) — best-effort, fail-open, no enrichment ack on the batch path.
    # The Q&A answer is recorded once (with the final page) rather than
    # duplicated per page.
    if reply:
        try:
            last_idx = len(rec.raw_photos_b64) - 1
            for idx0, page_b64 in enumerate(rec.raw_photos_b64):
                try:
                    page_bytes = base64.b64decode(page_b64)
                except Exception:  # noqa: BLE001 — skip an undecodable page
                    continue
                page_ctx = dict(page_contexts[idx0]) if idx0 < len(page_contexts) else {}
                # Every page was vision-classified ELECTRICAL_PRINT above —
                # carry that into the evidence row's source_type.
                page_ctx.setdefault("classification", "ELECTRICAL_PRINT")
                await print_workspace.persist_print_turn(
                    chat_id=rec.chat_id,
                    tenant_id="default",
                    raw_bytes=page_bytes,
                    vision_data=page_ctx,
                    caption=rec.caption or "",
                    answer=reply if idx0 == last_idx else "",
                    page_ref=str(idx0 + 1),
                )
        except Exception as exc:  # noqa: BLE001 — persistence never touches the reply
            logger.warning("PRINT_WORKSPACE_BATCH_PERSIST_ERROR %s", type(exc).__name__)

    return reply or None


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
            await _edit_ack(f"📸 Checking {n} photos for electrical-print package…")
            reply = await _try_multi_photo_printsense_reply(rec)
            if not reply:
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

    # Remember this drive for the chat so a plain-text follow-up continues in
    # this pack's context (no need to repeat "/drive gs10 ..." every turn).
    _set_drive_context(str(update.effective_chat.id), pack.pack_id)

    try:
        async with typing_action(context, update.effective_chat.id):
            result = await asyncio.to_thread(answer_question, pack.pack_id, question)
        # Plain text (no parse_mode): the pack answer contains OEM text with
        # unbalanced brackets ("[COM1 Time-out Detection]", "[Source: ...]") that
        # Telegram's legacy Markdown parser rejects with a 400 "can't parse
        # entities" — send it verbatim instead.
        await update.message.reply_text(_format_drive_pack_reply(result))
        await _capture_drive_pack_turn(
            question=question, result=result, update=update, entry="command"
        )
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
    app.add_handler(CommandHandler("printsense", printsense_commercial.printsense_command))
    app.add_handler(CommandHandler("ps_status", printsense_commercial.ps_status_command))
    app.add_handler(CommandHandler("ps_pilot", printsense_commercial.ps_pilot_command))
    app.add_handler(CommandHandler("ps_privacy", printsense_commercial.ps_privacy_command))
    app.add_handler(CommandHandler("ps_survey", printsense_commercial.ps_survey_command))
    app.add_handler(CommandHandler("ps_review", printsense_commercial.ps_review_command))
    app.add_handler(
        CommandHandler("printsense_test", printsense_commercial.printsense_test_command)
    )
    app.add_handler(
        CommandHandler(
            "printsense_grade_session", printsense_commercial.printsense_grade_session_command
        )
    )
    app.add_handler(
        CommandHandler("printsense_compare", printsense_commercial.printsense_compare_command)
    )
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
