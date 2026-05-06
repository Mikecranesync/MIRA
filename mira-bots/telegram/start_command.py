"""/start handler — consumes invite tokens or shows the invite-only message.

Pattern matches python-telegram-bot's deep-linking example:
    https://docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html
"""

from __future__ import annotations

import logging
from typing import Any

from shared.tenant.invites import (
    InviteAlreadyConsumed,
    InviteExpired,
    InviteNotFound,
    consume_invite,
)
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("mira-bot")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE, *, engine: Any) -> None:
    """Handle /start, with optional invite token in context.args[0]."""
    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Hi — I'm MIRA, your team's maintenance assistant. "
            "I'm invite-only. Ask your admin to send you an enrollment link."
        )
        return

    token = args[0]
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
