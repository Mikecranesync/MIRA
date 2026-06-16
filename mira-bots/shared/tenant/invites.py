"""tenant.invites — mint and consume Telegram deep-link invites.

Tokens are 32 chars of base64url, well within Telegram's 64-char start-parameter
ceiling. See https://core.telegram.org/bots/features#deep-linking.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("mira.invites")


class InviteNotFound(LookupError):
    """Token doesn't exist in tenant_invites."""


class InviteExpired(RuntimeError):
    """Token exists but expires_at has passed."""


class InviteAlreadyConsumed(RuntimeError):
    """Token was already used."""


@dataclass
class InvitedUser:
    id: str
    tenant_id: str
    display_name: str
    email: str


def mint_invite(
    engine: Any,
    *,
    tenant_id: str,
    email: str,
    minted_by: str,
    display_name: str = "",
    ttl_hours: int = 72,
) -> str:
    """Create a new invite row and return the opaque token."""
    token = secrets.token_urlsafe(24)  # 24 random bytes → 32-char base64url
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    with engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO tenant_invites "
                "(token, tenant_id, email, display_name, minted_by, expires_at) "
                "VALUES (:token, :tid, :email, :name, :minted_by, :exp)"
            ),
            {
                "token": token,
                "tid": tenant_id,
                "email": email,
                "name": display_name,
                "minted_by": minted_by,
                "exp": expires_at,
            },
        )
        conn.commit()
    logger.info(
        "INVITE_MINTED tenant=%s email=%s minted_by=%s ttl=%dh",
        tenant_id,
        email,
        minted_by,
        ttl_hours,
    )
    return token


def consume_invite(
    engine: Any,
    *,
    token: str,
    telegram_user_id: str,
    display_name: str,
) -> InvitedUser:
    """Validate token, create mira_user + identity_link, mark invite consumed.

    All steps run in one transaction. Raises InviteNotFound / InviteExpired /
    InviteAlreadyConsumed for the three rejection paths.
    """
    now = datetime.now(timezone.utc)

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT tenant_id, email, display_name, expires_at, consumed_at "
                "FROM tenant_invites WHERE token = :t"
            ),
            {"t": token},
        ).fetchone()
        if row is None:
            raise InviteNotFound(f"Unknown invite token (truncated: {token[:8]}...)")

        tenant_id, email, invite_name, expires_at, consumed_at = row

        # SQLite returns strings for TIMESTAMP, Postgres returns datetime — normalize
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at).replace(tzinfo=timezone.utc)
        elif expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if consumed_at is not None:
            raise InviteAlreadyConsumed(f"Invite for {email} was already consumed at {consumed_at}")
        if expires_at < now:
            raise InviteExpired(f"Invite for {email} expired at {expires_at}")

        final_name = display_name or invite_name or ""

        # Create the user
        user_id = str(uuid.uuid4())
        conn.execute(
            text(
                "INSERT INTO mira_users (id, tenant_id, display_name, email) "
                "VALUES (:id, :tid, :name, :email)"
            ),
            {"id": user_id, "tid": tenant_id, "name": final_name, "email": email},
        )
        # Create the identity link
        conn.execute(
            text(
                "INSERT INTO identity_links "
                "(id, mira_user_id, platform, external_user_id, tenant_id) "
                "VALUES (:id, :uid, 'telegram', :ext, :tid)"
            ),
            {
                "id": str(uuid.uuid4()),
                "uid": user_id,
                "ext": telegram_user_id,
                "tid": tenant_id,
            },
        )
        # Mark the invite consumed
        conn.execute(
            text(
                "UPDATE tenant_invites SET consumed_at = :now, consumed_by = :tg WHERE token = :t"
            ),
            {"now": now, "tg": telegram_user_id, "t": token},
        )
        conn.commit()

    logger.info(
        "INVITE_CONSUMED tenant=%s email=%s telegram_user_id=%s mira_user_id=%s",
        tenant_id,
        email,
        telegram_user_id,
        user_id,
    )
    return InvitedUser(id=user_id, tenant_id=tenant_id, display_name=final_name, email=email)
