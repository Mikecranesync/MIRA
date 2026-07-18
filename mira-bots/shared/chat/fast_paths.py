"""Adapter-agnostic grounded fast-path router (Slack/Telegram parity).

Given a NormalizedChatEvent + a Supervisor engine, returns a NormalizedChatResponse
if a grounded fast-path claims the turn, else None (caller falls through to the
FSM/LLM dispatcher). Fast-paths are read-only or `proposed`-write, cited, and never
invoke the LLM. A safety turn is handed straight to the engine (SAFETY_ALERT).

Precedence mirrors the Telegram adapter:
  photo: nameplate-drive-pack -> wiring-intake -> None
  text : drive-pack-followup  -> wiring-question -> None
"""

from __future__ import annotations

import asyncio
import logging
import re

from shared import chat_tenant, wiring_intake
from shared.chat.drive_context import get_drive_context, set_drive_context
from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse
from shared.drive_packs import answer_question
from shared.guardrails import classify_intent

logger = logging.getLogger("fast-paths")

DEFAULT_PHOTO_CAPTION = "Analyze this equipment photo"

# A drive-question signal in free text (verbatim from telegram/bot.py:510).
DRIVE_QUESTION_RE = re.compile(
    r"\b[A-Za-z]\d{2}\.\d{2}\b"
    r"|\bP\d{3,4}\b"
    r"|\b(parameter|param|fault|error\s*code|alarm|trip|keypad|register)\b",
    re.IGNORECASE,
)


def _session_key(event: NormalizedChatEvent) -> str:
    return f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"


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


def _answer_wiring_blocking(tenant_id: str, asset: str, question: str):
    """Sync DB glue — read-only verified-rows answer. Mirrors telegram/bot.py."""
    conn = wiring_intake.open_neon_conn()
    try:
        with conn.cursor() as cur:
            profile = wiring_intake.load_profile(cur, tenant_id, asset=asset)
    finally:
        conn.close()
    return wiring_intake.answer_wiring_question(profile, question)


def _resp(event: NormalizedChatEvent, text: str) -> NormalizedChatResponse:
    return NormalizedChatResponse(text=text, thread_id=event.external_thread_id)


async def _try_drive_pack_followup(event: NormalizedChatEvent) -> NormalizedChatResponse | None:
    text = event.text or ""
    if not text:
        return None
    pack_id = get_drive_context(event.platform, _session_key(event))
    if not pack_id:
        return None
    result = await asyncio.to_thread(answer_question, pack_id, text)
    if not (result.matched or DRIVE_QUESTION_RE.search(text)):
        return None
    set_drive_context(event.platform, _session_key(event), pack_id)  # refresh TTL
    return _resp(event, _format_drive_pack_reply(result))


async def _try_wiring_question(event: NormalizedChatEvent) -> NormalizedChatResponse | None:
    text = event.text or ""
    intent = wiring_intake.parse_wiring_intent(text)
    if intent.kind != "question":
        return None
    if not intent.asset:
        return _resp(event, wiring_intake.MISSING_ASSET_REPLY)
    tenant_id = chat_tenant.resolve(event.external_user_id)
    answer = await asyncio.to_thread(
        _answer_wiring_blocking, tenant_id, intent.asset, intent.question or text
    )
    return _resp(event, wiring_intake.format_wiring_answer(answer, intent.asset))


async def try_fast_paths(event: NormalizedChatEvent, engine) -> NormalizedChatResponse | None:
    # Safety turns always go to the engine (SAFETY_ALERT).
    if classify_intent(event.text or "") == "safety":
        return None

    has_photo = any(getattr(a, "kind", "") == "image" and a.data for a in event.attachments)

    if has_photo:
        # Photo paths added in Task 3.
        return None

    for handler in (_try_drive_pack_followup, _try_wiring_question):
        try:
            resp = await handler(event)
        except Exception as exc:  # a broken fast-path degrades to the engine, never errors the turn
            logger.warning("fast-path %s failed: %s", handler.__name__, exc)
            resp = None
        if resp is not None:
            return resp
    return None
