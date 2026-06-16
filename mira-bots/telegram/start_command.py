"""/start handler — invite-token consumption + QR-scan asset deep-linking.

Two flows live behind ``/start <payload>``:

1. ``/start <invite_token>`` — original behaviour, consumes a one-time invite
   token and enrols the Telegram user (see ``shared/tenant/invites.py``).

2. ``/start asset_<tag>`` — Telegram deep-link from a QR code on a piece of
   equipment. The mobile landing page at ``/m/{tag}`` includes a button that
   opens this URL. We look the asset up by ``equipment_number`` in the Hub
   NeonDB, seed the conversation state with ``asset_identified`` so the
   first follow-up message has context, and greet the technician with the
   make/model they're standing in front of.

Pattern matches python-telegram-bot's deep-linking example:
    https://docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

import psycopg2
from shared.tenant.invites import (
    InviteAlreadyConsumed,
    InviteExpired,
    InviteNotFound,
    consume_invite,
)
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("mira-bot")

ASSET_PAYLOAD_PREFIX = "asset_"


@dataclass
class AssetContext:
    """Subset of cmms_equipment used to greet a QR-scanning technician."""

    tag: str
    name: str
    manufacturer: Optional[str]
    model: Optional[str]
    location: Optional[str]


def _resolve_tenant_for_telegram_user(cur, telegram_user_id: str) -> Optional[str]:
    """Return the tenant_id linked to this Telegram user, or None.

    Mirrors the hub's auth check: a Telegram user can only see assets in
    the tenant they were enrolled into via the invite flow.
    """
    cur.execute(
        """SELECT tenant_id
             FROM identity_links
            WHERE platform = 'telegram'
              AND external_user_id = %s
            LIMIT 1""",
        (telegram_user_id,),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def _lookup_asset_by_tag(tag: str, telegram_user_id: str) -> Optional[AssetContext]:
    """Look up an asset by ``equipment_number`` scoped to the user's tenant.

    The technician must already be enrolled (invite flow) for this lookup
    to resolve — the same authorization rule the hub's /m/{tag} page
    enforces for browser scans. Returns ``None`` on any DB error, miss,
    or cross-tenant access attempt. The caller falls back to a generic
    "couldn't find that tag" message; we never reveal that the tag
    belongs to another tenant.
    """
    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        logger.warning("ASSET_LOOKUP_SKIP: NEON_DATABASE_URL not set")
        return None
    try:
        conn = psycopg2.connect(url)
        try:
            with conn.cursor() as cur:
                tenant_id = _resolve_tenant_for_telegram_user(cur, telegram_user_id)
                if not tenant_id:
                    logger.info("ASSET_LOOKUP_NO_TENANT telegram_user_id=%s", telegram_user_id)
                    return None
                cur.execute(
                    """SELECT equipment_number, manufacturer, model_number,
                              equipment_type, description, location
                         FROM cmms_equipment
                        WHERE equipment_number = %s AND tenant_id = %s
                        ORDER BY qr_generated_at ASC NULLS LAST, created_at ASC
                        LIMIT 1""",
                    (tag, tenant_id),
                )
                row = cur.fetchone()
        finally:
            conn.close()
    except Exception as exc:
        logger.error("ASSET_LOOKUP_FAILED tag=%s err=%s", tag, exc)
        return None

    if not row:
        return None

    equipment_number, manufacturer, model_number, equipment_type, description, location = row
    parts = [p for p in (manufacturer, model_number, equipment_type) if p]
    name = description or " ".join(parts) or equipment_number
    return AssetContext(
        tag=equipment_number,
        name=name,
        manufacturer=manufacturer,
        model=model_number,
        location=location,
    )


def _greet_for_asset(asset: AssetContext) -> str:
    bits = []
    if asset.manufacturer or asset.model:
        bits.append(f" ({' '.join(b for b in (asset.manufacturer, asset.model) if b)})")
    location_line = f"\nLocation: {asset.location}" if asset.location else ""
    return (
        f"I see you're at {asset.name}{''.join(bits)}.{location_line}\n\n"
        "How can I help? You can describe the symptom, send a photo of the "
        "fault, or ask about the manual."
    )


async def _handle_asset_deep_link(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    diagnostic_engine: Any,
    payload: str,
) -> None:
    """Resolve an ``asset_<tag>`` /start payload and seed conversation state."""
    tag = payload[len(ASSET_PAYLOAD_PREFIX) :].strip()
    if not tag:
        await update.message.reply_text(
            "That QR code didn't include an asset tag. Try scanning again."
        )
        return

    telegram_user_id = str(update.effective_user.id)
    asset = _lookup_asset_by_tag(tag, telegram_user_id)
    chat_id = str(update.effective_chat.id)

    # Wipe stale state regardless of whether the lookup succeeds — a fresh QR
    # scan is always a new context.
    if diagnostic_engine is not None:
        try:
            diagnostic_engine.reset(chat_id)
        except Exception as exc:
            logger.warning("ASSET_DEEPLINK_RESET_FAILED chat_id=%s err=%s", chat_id, exc)

    if not asset:
        logger.info("ASSET_DEEPLINK_MISS tag=%s chat_id=%s", tag, chat_id)
        await update.message.reply_text(
            f"I couldn't find an asset with tag `{tag}`. "
            "Send me a description of the equipment and the symptom and I'll help anyway.",
            parse_mode="Markdown",
        )
        return

    # Seed asset_identified so the first user message inherits context.
    if diagnostic_engine is None:
        await update.message.reply_text(_greet_for_asset(asset))
        return
    try:
        identifier = " ".join(b for b in (asset.manufacturer, asset.model) if b) or asset.name
        state = diagnostic_engine._load_state(chat_id)
        state["asset_identified"] = identifier
        state.setdefault("context", {})
        state["context"]["asset_tag"] = asset.tag
        state["context"]["asset_source"] = "qr_scan"
        diagnostic_engine._save_state(chat_id, state)
    except Exception as exc:
        # Seeding is a best-effort optimisation; the greeting still works
        # without it, the user just has to repeat the make/model.
        logger.warning("ASSET_DEEPLINK_SEED_FAILED chat_id=%s err=%s", chat_id, exc)

    logger.info(
        "ASSET_DEEPLINK_HIT tag=%s chat_id=%s mfr=%s model=%s",
        asset.tag,
        chat_id,
        asset.manufacturer,
        asset.model,
    )
    await update.message.reply_text(_greet_for_asset(asset))


async def start_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    diagnostic_engine: Optional[Any] = None,
) -> None:
    """Handle /start.

    ``engine`` is the SQLAlchemy admin engine (used for invite consumption).
    ``diagnostic_engine`` is the Supervisor instance (used to seed FSM state
    on QR-scan deep-links). When the QR flow is dispatched without a
    diagnostic engine the greeting still works, just without the seeded
    asset_identified context.
    """
    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Hi — I'm MIRA, your team's maintenance assistant. "
            "I'm invite-only. Ask your admin to send you an enrollment link."
        )
        return

    payload = args[0]

    # QR-scan deep-link from /m/{tag} → pre-load equipment context.
    if payload.startswith(ASSET_PAYLOAD_PREFIX):
        await _handle_asset_deep_link(
            update,
            context,
            diagnostic_engine=diagnostic_engine,
            payload=payload,
        )
        return

    # Otherwise treat as an invite token (original flow).
    token = payload
    telegram_user_id = str(update.effective_user.id)
    display_name = update.effective_user.full_name or ""

    try:
        user = consume_invite(
            engine,
            token=token,
            telegram_user_id=telegram_user_id,
            display_name=display_name,
        )
    except InviteNotFound:
        await update.message.reply_text(
            "That invite link isn't valid. Ask your admin for a fresh one."
        )
        return
    except InviteExpired:
        await update.message.reply_text("That invite has expired. Ask your admin for a fresh one.")
        return
    except InviteAlreadyConsumed:
        await update.message.reply_text(
            "That invite was already used. If this wasn't you, tell your admin."
        )
        return
    except Exception as exc:
        logger.error("START_CONSUME_FAILED telegram_id=%s err=%s", telegram_user_id, exc)
        await update.message.reply_text("Something went wrong. Please try again later.")
        return

    await update.message.reply_text(
        f"Welcome to MIRA, {user.display_name or 'there'}. "
        f"You're connected. Try sending me a maintenance question or a photo."
    )
