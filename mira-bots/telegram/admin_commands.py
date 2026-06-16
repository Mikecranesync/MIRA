"""Admin command handlers for the Telegram bot: /invite, /team, /revoke, /invite_status.

Each handler takes the standard PTB (update, context) plus injected dependencies
(engine, auth, tenant_id) so the same code is testable without booting the bot.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from shared.tenant.authorizer import Authorizer
from shared.tenant.invites import mint_invite
from sqlalchemy import text
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("mira-bot")

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


async def invite_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/invite <email> [Display Name]  →  returns t.me/MIRABot?start=<token>."""
    user_id = update.effective_user.id
    if not auth.is_admin(user_id):
        logger.warning("INVITE_REFUSED non-admin from=%s", user_id)
        await update.message.reply_text(
            "Sorry, only admins can mint invites. Ask an existing admin to add you."
        )
        return

    if not context.args:
        await update.message.reply_text(
            "Usage: /invite <email> [Display Name]\nExample: /invite alice@acme.com Alice Smith"
        )
        return

    email = context.args[0]
    if not _EMAIL_RE.match(email):
        await update.message.reply_text(f"That doesn't look like an email: {email}")
        return

    display_name = " ".join(context.args[1:])

    try:
        token = mint_invite(
            engine,
            tenant_id=tenant_id,
            email=email,
            minted_by=str(user_id),
            display_name=display_name,
        )
    except Exception as exc:
        logger.error("MINT_FAILED tenant=%s email=%s err=%s", tenant_id, email, exc)
        await update.message.reply_text(f"Could not mint invite: {exc}")
        return

    bot_username = context.bot.username or "MIRABot"
    url = f"https://t.me/{bot_username}?start={token}"
    await update.message.reply_text(
        f"Invite for {email} (valid 72h):\n{url}\n\n"
        "Send this link to them in any chat — they tap it and they're enrolled."
    )


async def team_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/team — list enrolled members in this tenant."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT u.display_name, u.email, l.external_user_id "
                "FROM mira_users u JOIN identity_links l ON l.mira_user_id = u.id "
                "WHERE u.tenant_id = :tid AND l.platform = 'telegram' "
                "ORDER BY u.display_name"
            ),
            {"tid": tenant_id},
        ).fetchall()
    if not rows:
        await update.message.reply_text("No enrolled members yet.")
        return
    lines = [f"Team ({len(rows)} members):"]
    for name, email, ext_id in rows:
        lines.append(f"• {name or '(no name)'} — {email or '(no email)'} — telegram:{ext_id}")
    await update.message.reply_text("\n".join(lines))


async def revoke_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/revoke <telegram_user_id> — drop the user's identity_links row."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    if not context.args:
        await update.message.reply_text("Usage: /revoke <telegram_user_id>")
        return
    target = context.args[0].lstrip("@")
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "DELETE FROM identity_links "
                "WHERE platform = 'telegram' AND external_user_id = :ext "
                "  AND tenant_id = :tid"
            ),
            {"ext": target, "tid": tenant_id},
        )
        conn.commit()
    if result.rowcount:
        await update.message.reply_text(f"Revoked telegram user {target}.")
    else:
        await update.message.reply_text(f"No mapping found for telegram user {target}.")


async def invite_status_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    engine: Any,
    auth: Authorizer,
    tenant_id: str,
) -> None:
    """/invite_status — list outstanding/expired/consumed invites for this tenant."""
    if not auth.is_admin(update.effective_user.id):
        await update.message.reply_text("Admins only.")
        return
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT email, expires_at, consumed_at "
                "FROM tenant_invites WHERE tenant_id = :tid "
                "ORDER BY minted_at DESC LIMIT 20"
            ),
            {"tid": tenant_id},
        ).fetchall()
    if not rows:
        await update.message.reply_text("No invites yet.")
        return
    lines = ["Last 20 invites:"]
    for email, exp, consumed in rows:
        if consumed:
            tag = f"consumed {consumed}"
        elif str(exp) < str(datetime.utcnow()):
            tag = "expired"
        else:
            tag = f"outstanding (expires {exp})"
        lines.append(f"• {email} — {tag}")
    await update.message.reply_text("\n".join(lines))
