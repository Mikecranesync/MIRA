"""monday.com app-lifecycle webhook handler.

When a customer installs, uninstalls, or changes their subscription on
the marketplace listing, monday.com POSTs a JWT-signed event to the
webhook URL registered in the Developer Center → Build → Webhooks tab.

This module verifies the JWT, parses the event, and updates the
`monday_installations` row for that account. Verification mirrors
`session.py:verify_session_token` — same algorithm (HS256), same key
material (the app's OAuth client_secret) by default, with an explicit
`MONDAY_WEBHOOK_SIGNING_SECRET` override if monday ever splits them.

Supported event types:
  - install                       → upsert row (idempotent on retry)
  - uninstall                     → mark `revoked_at`
  - app_subscription_created      → set `subscription_status`
  - app_subscription_changed      → set `subscription_status`
  - app_subscription_renewed      → set `subscription_status`
  - app_subscription_cancelled    → set `subscription_status`

Unknown event types are logged and accepted (200) so monday doesn't
flag the webhook as failing during their backwards-compat changes.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import jwt

from . import oauth

logger = logging.getLogger("mira-scan.webhooks")

# Monday signs lifecycle webhook deliveries with the app's OAuth
# client_secret. We allow a dedicated MONDAY_WEBHOOK_SIGNING_SECRET to
# override only if/when monday splits them — same fallback discipline as
# session.MONDAY_SIGNING_SECRET.
MONDAY_WEBHOOK_SIGNING_SECRET = os.getenv(
    "MONDAY_WEBHOOK_SIGNING_SECRET",
    os.getenv("MONDAY_OAUTH_CLIENT_SECRET", ""),
)

INSTALL_EVENTS = {"install", "app_installed"}
UNINSTALL_EVENTS = {"uninstall", "app_uninstalled"}
SUBSCRIPTION_EVENTS = {
    "app_subscription_created",
    "app_subscription_changed",
    "app_subscription_renewed",
    "app_subscription_cancelled",
    "app_subscription_renewal_status_changed",
}


class WebhookInvalid(RuntimeError):
    pass


def _signing_secret() -> str:
    if not MONDAY_WEBHOOK_SIGNING_SECRET:
        raise WebhookInvalid("webhook signing secret not configured")
    return MONDAY_WEBHOOK_SIGNING_SECRET


def verify_webhook_jwt(authorization_header: str | None) -> dict[str, Any]:
    """Decode + verify the Authorization JWT monday sends with each delivery.

    Returns the JWT claims on success. Raises `WebhookInvalid` on any
    decode/signature failure or empty header.
    """
    if not authorization_header:
        raise WebhookInvalid("missing Authorization header")
    token = authorization_header.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise WebhookInvalid("empty token")
    try:
        return jwt.decode(
            token,
            _signing_secret(),
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise WebhookInvalid(f"jwt decode failed: {exc}") from exc


def _extract_account_id(claims: dict[str, Any], body: dict[str, Any]) -> str | None:
    """Pull account_id out of either the JWT claims or the JSON body.

    monday's payload format has shifted across docs revisions — sometimes
    `aid` lives at the top level of the JWT, sometimes nested under `dat`,
    sometimes only in the body's `data.account_id`. Check all of them.
    """
    aid = claims.get("aid")
    if aid is None:
        dat = claims.get("dat") or {}
        aid = dat.get("account_id")
    if aid is None and isinstance(body, dict):
        data = body.get("data") or {}
        aid = data.get("account_id") or body.get("account_id")
    return str(aid) if aid is not None else None


def _extract_event_type(claims: dict[str, Any], body: dict[str, Any]) -> str | None:
    """Pull the event type out of body first, then JWT claims as fallback."""
    if isinstance(body, dict):
        t = body.get("type") or (body.get("data") or {}).get("type")
        if t:
            return str(t)
    t = claims.get("type")
    if t:
        return str(t)
    return None


async def handle_event(
    *,
    authorization_header: str | None,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Verify and dispatch a single webhook delivery.

    Returns a small dict for logging (`{"status": "ok", "type": "...", "account_id": "..."}`).
    Raises `WebhookInvalid` on signature failure (caller maps to 401).
    """
    claims = verify_webhook_jwt(authorization_header)
    event_type = _extract_event_type(claims, body)
    account_id = _extract_account_id(claims, body)

    if not event_type:
        logger.warning("webhook: missing event type, claims=%s", claims)
        return {"status": "ignored", "reason": "missing_type"}

    if not account_id:
        logger.warning("webhook: missing account_id for type=%s", event_type)
        return {"status": "ignored", "reason": "missing_account_id", "type": event_type}

    if event_type in INSTALL_EVENTS:
        data = body.get("data") if isinstance(body, dict) else None
        user_id = None
        scope = ""
        access_token = ""
        if isinstance(data, dict):
            user_id = data.get("user_id")
            scope = data.get("scope") or ""
        # Lifecycle webhooks don't carry an access_token — that arrives
        # via the OAuth callback. The install event just records that an
        # install happened. If we already have a token row from the
        # callback, this becomes a touch_last_seen no-op.
        existing_token = await oauth.get_token_for_account(account_id)
        if existing_token:
            await oauth.touch_last_seen(account_id)
        else:
            # First-touch from webhook before/without OAuth callback —
            # save a placeholder row so we have an install record. The
            # OAuth callback will overwrite access_token on first user click.
            await oauth.save_installation(
                account_id=account_id,
                access_token=access_token or "",
                scope=str(scope),
                user_id=str(user_id) if user_id is not None else None,
            )
        logger.info("webhook: install account_id=%s", account_id)
        return {"status": "ok", "type": event_type, "account_id": account_id}

    if event_type in UNINSTALL_EVENTS:
        await oauth.mark_revoked(account_id)
        logger.info("webhook: uninstall account_id=%s", account_id)
        return {"status": "ok", "type": event_type, "account_id": account_id}

    if event_type in SUBSCRIPTION_EVENTS:
        status = _subscription_status_from_event(event_type, body)
        await oauth.update_subscription_status(account_id, status)
        logger.info(
            "webhook: %s account_id=%s status=%s",
            event_type,
            account_id,
            status,
        )
        return {
            "status": "ok",
            "type": event_type,
            "account_id": account_id,
            "subscription_status": status,
        }

    logger.info("webhook: ignoring unknown event type=%s account_id=%s", event_type, account_id)
    return {"status": "ignored", "reason": "unknown_type", "type": event_type}


def _subscription_status_from_event(event_type: str, body: dict[str, Any]) -> str:
    """Map a subscription event to a `subscription_status` string.

    monday's payload includes the new plan/status under `data.subscription`
    when available; we default to a plausible status per event_type when
    it doesn't.
    """
    data = body.get("data") if isinstance(body, dict) else None
    if isinstance(data, dict):
        sub = data.get("subscription") or {}
        status = sub.get("status") or sub.get("plan_id")
        if status:
            return str(status)
    if event_type == "app_subscription_cancelled":
        return "cancelled"
    if event_type == "app_subscription_renewed":
        return "active"
    if event_type == "app_subscription_renewal_status_changed":
        return "past_due"
    return "active"
