"""monday.com OAuth 2.0 install flow.

Marketplace apps need a per-account access token to call Monday's GraphQL
API on behalf of the installing account. This module:

1. Builds the install URL the user clicks from the marketplace listing.
2. Handles the redirect-back callback that exchanges the auth code for a
   long-lived access token.
3. Persists `(account_id -> access_token)` in the `monday_installations`
   table (idempotent table creation lives in `db.ensure_monday_installations_table`).
4. Looks up the right token for the account on every Monday GraphQL call
   from `monday_api`.

Monday's default OAuth flow issues long-lived tokens (no refresh token).
If a token is revoked we mark the row and `monday_api._gql` surfaces a
"please reinstall" error so the iframe can call `redirectToInstall()`.
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx

from . import db

logger = logging.getLogger("mira-scan.oauth")

MONDAY_OAUTH_CLIENT_ID = os.getenv("MONDAY_OAUTH_CLIENT_ID", "")
MONDAY_OAUTH_CLIENT_SECRET = os.getenv("MONDAY_OAUTH_CLIENT_SECRET", "")
MONDAY_OAUTH_REDIRECT_URI = os.getenv(
    "MONDAY_OAUTH_REDIRECT_URI",
    "http://localhost:8000/oauth/monday/callback",
)
MONDAY_OAUTH_SCOPES = os.getenv(
    "MONDAY_OAUTH_SCOPES",
    "me:read boards:read boards:write",
)

MONDAY_OAUTH_AUTHORIZE_URL = "https://auth.monday.com/oauth2/authorize"
MONDAY_OAUTH_TOKEN_URL = "https://auth.monday.com/oauth2/token"
MONDAY_API_URL = os.getenv("MONDAY_API_URL", "https://api.monday.com/v2")


class OAuthError(RuntimeError):
    pass


def configured() -> bool:
    """True iff both client_id and client_secret are set in env."""
    return bool(MONDAY_OAUTH_CLIENT_ID and MONDAY_OAUTH_CLIENT_SECRET)


def install_url(state: str | None = None) -> str:
    """Return the Monday OAuth authorize URL the user clicks to install.

    `state` is an anti-CSRF nonce. Caller may pass one to bind the
    callback to a session; if omitted we generate a fresh one. The
    callback verifies it round-tripped intact.
    """
    if not configured():
        raise OAuthError("MONDAY_OAUTH_CLIENT_ID/SECRET not configured")
    params = {
        "client_id": MONDAY_OAUTH_CLIENT_ID,
        "redirect_uri": MONDAY_OAUTH_REDIRECT_URI,
        "scope": MONDAY_OAUTH_SCOPES,
        "state": state or secrets.token_urlsafe(24),
    }
    return f"{MONDAY_OAUTH_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> dict[str, Any]:
    """Trade a Monday authorization code for an access token."""
    if not configured():
        raise OAuthError("OAuth not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            MONDAY_OAUTH_TOKEN_URL,
            data={
                "client_id": MONDAY_OAUTH_CLIENT_ID,
                "client_secret": MONDAY_OAUTH_CLIENT_SECRET,
                "code": code,
                "redirect_uri": MONDAY_OAUTH_REDIRECT_URI,
            },
        )
    if resp.status_code >= 400:
        raise OAuthError(f"token exchange failed ({resp.status_code}): {resp.text[:200]}")
    return resp.json()


async def whoami(access_token: str) -> dict[str, Any]:
    """Identify the installing account using the freshly issued token.

    Returns the `me` payload as Monday's GraphQL returns it, including
    nested `account { id, name, slug }`.
    """
    query = "query { me { id name email account { id name slug } } }"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            MONDAY_API_URL,
            headers={
                "Authorization": access_token,
                "Content-Type": "application/json",
            },
            json={"query": query},
        )
    if resp.status_code >= 400:
        raise OAuthError(f"whoami failed ({resp.status_code}): {resp.text[:200]}")
    data = resp.json()
    if data.get("errors"):
        raise OAuthError(f"whoami errors: {data['errors']}")
    return (data.get("data") or {}).get("me") or {}


async def save_installation(
    *,
    account_id: str,
    access_token: str,
    scope: str,
    user_id: str | None = None,
) -> None:
    """Upsert one (account_id, access_token) row. Reinstalls overwrite
    the existing token and clear the `revoked_at` flag."""
    sql = """
        INSERT INTO monday_installations
            (account_id, access_token, scope, user_id, installed_at, last_seen_at)
        VALUES (%s, %s, %s, %s, NOW(), NOW())
        ON CONFLICT (account_id) DO UPDATE
            SET access_token = EXCLUDED.access_token,
                scope        = EXCLUDED.scope,
                user_id      = COALESCE(EXCLUDED.user_id, monday_installations.user_id),
                last_seen_at = NOW(),
                revoked_at   = NULL
    """
    await db.execute(sql, (account_id, access_token, scope, user_id))
    logger.info("monday_installations: saved account_id=%s scope=%s", account_id, scope)


async def get_token_for_account(account_id: str) -> str | None:
    """Return the stored access_token for an installing account, or
    None if not installed (or revoked, or DB unavailable)."""
    if not account_id:
        return None
    sql = """
        SELECT access_token, revoked_at
          FROM monday_installations
         WHERE account_id = %s
         LIMIT 1
    """
    try:
        row = await db.fetch_one(sql, (account_id,))
    except db.DBUnavailable:
        return None
    except Exception:
        logger.exception("get_token_for_account: lookup failed for %s", account_id)
        return None
    if not row:
        return None
    if row[1] is not None:
        return None
    return str(row[0])


async def mark_revoked(account_id: str) -> None:
    """Mark an installation revoked. Triggered by 401 from Monday."""
    if not account_id:
        return
    sql = "UPDATE monday_installations SET revoked_at = NOW() WHERE account_id = %s"
    try:
        await db.execute(sql, (account_id,))
        logger.warning("monday_installations: marked revoked account_id=%s", account_id)
    except Exception:
        logger.exception("mark_revoked failed for %s", account_id)


async def touch_last_seen(account_id: str) -> None:
    """Bump last_seen_at — best-effort signal of an active install."""
    if not account_id:
        return
    sql = "UPDATE monday_installations SET last_seen_at = NOW() WHERE account_id = %s"
    try:
        await db.execute(sql, (account_id,))
    except Exception:
        pass


async def update_subscription_status(account_id: str, status: str) -> None:
    """Record the latest subscription_status reported by a billing webhook.

    Best-effort — DB failures are swallowed so we never 500 on a webhook
    delivery and trigger needless monday retries.
    """
    if not account_id or not status:
        return
    sql = """
        UPDATE monday_installations
           SET subscription_status = %s,
               last_seen_at        = NOW()
         WHERE account_id = %s
    """
    try:
        await db.execute(sql, (status, account_id))
        logger.info(
            "monday_installations: subscription_status=%s account_id=%s",
            status,
            account_id,
        )
    except Exception:
        logger.exception("update_subscription_status failed for %s", account_id)
