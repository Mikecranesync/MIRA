from __future__ import annotations

import html
import logging
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, Cookie, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from . import (
    db,
    manual_search,
    mira_rag,
    monday_api,
    oauth,
    rate_limit,
    scan_queue,
    session,
    usage,
    vision,
    webhooks,
)
from .models import (
    AssetPlate,
    ChatMessageRequest,
    ChatMessageResponse,
    KBResult,
    ManualRequestQueueRequest,
    ManualRequestQueueResponse,
    MondayColumnUpdate,
    MondayUpdateResponse,
    QueueAck,
    QueueStatusResponse,
    ScanRequest,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("mira-scan")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.ensure_scan_queue_table()
    await db.ensure_monday_installations_table()
    await db.ensure_account_usage_table()
    yield


app = FastAPI(title="MIRA Scan", version="0.2.0", lifespan=lifespan)

_allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://*.monday.com,http://localhost:5173",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.monday\.com",
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, Any]:
    """Config-state probe — never returns secret values, only boolean
    "did this env var get populated?" flags.

    Used to verify the docker-compose env-plumbing fix (PR #1557) landed
    correctly without having to dump live container env (which would
    leak production secrets into a transcript). Read post-deploy:

        curl -s https://app.factorylm.com/api/scanbe/readyz | jq

    Any `false` here is a deploy-config bug, not a code bug.
    """
    return {
        "status": "ok",
        "monday_oauth_configured": oauth.configured(),
        "monday_signing_secret_present": bool(session.MONDAY_SIGNING_SECRET),
        "monday_webhook_secret_present": bool(webhooks.MONDAY_WEBHOOK_SIGNING_SECRET),
        "monday_api_token_fallback_present": bool(monday_api.MONDAY_API_TOKEN),
        "monday_oauth_redirect_uri": oauth.MONDAY_OAUTH_REDIRECT_URI,
        "neon_database_url_present": bool(os.getenv("NEON_DATABASE_URL", "")),
        "openai_api_key_present": bool(os.getenv("OPENAI_API_KEY", "")),
        "serper_api_key_present": bool(os.getenv("SERPER_API_KEY", "")),
        "mira_kb_base_url_present": bool(os.getenv("MIRA_KB_BASE_URL", "")),
        "free_tier_monthly_cap": usage.FREE_TIER_MONTHLY_CAP,
        "free_tier_monthly_chat_cap": usage.FREE_TIER_MONTHLY_CHAT_CAP,
        "chat_rate_limit_per_window": rate_limit.CHAT_RATE_LIMIT_PER_WINDOW,
        "chat_rate_limit_window_seconds": rate_limit.CHAT_RATE_LIMIT_WINDOW_SECONDS,
    }


# ── OAuth install flow ─────────────────────────────────────────────────────
# When a customer installs the app from monday.com's marketplace, Monday
# redirects them through these two endpoints. The install URL is what
# Monday calls; the callback exchanges the code for a per-account access
# token we persist in `monday_installations`.


@app.get("/oauth/monday/install")
async def oauth_install(state: str = "") -> RedirectResponse:
    """Redirect to Monday's consent screen.

    Mainly used for the reinstall flow when a token has been revoked
    (frontend `redirectToInstall()` lands here). Marketplace installs
    typically jump straight to /oauth/monday/callback with a code from
    Monday's authorize endpoint, but exposing /install lets us issue
    the same URL for manual or automated reinstalls.

    Sets a short-lived `mira_oauth_state` cookie so /callback can verify
    the round-tripped state matches (CSRF defense in depth). The cookie
    is HTTPOnly + SameSite=Lax so it survives Monday's redirect back.
    """
    if not oauth.configured():
        raise HTTPException(
            status_code=503,
            detail="OAuth is not configured (MONDAY_OAUTH_CLIENT_ID/SECRET missing)",
        )
    state_value = state or secrets.token_urlsafe(24)
    redirect = RedirectResponse(oauth.install_url(state=state_value), status_code=302)
    redirect.set_cookie(
        key="mira_oauth_state",
        value=state_value,
        max_age=600,  # 10 min — generous window for slow consent flows
        httponly=True,
        # Plain HTTP only in local dev (set MIRA_DEV_MODE=1).
        secure=os.getenv("MIRA_DEV_MODE") != "1",
        samesite="lax",
        path="/oauth/monday/",
    )
    return redirect


@app.get("/oauth/monday/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: str = "",
    state: str = "",
    mira_oauth_state: str | None = Cookie(default=None),
) -> HTMLResponse:
    """Trade Monday's auth code for an access token, persist by account_id.

    CSRF defense: when state was set via /install, verify the round-
    tripped value matches the cookie. Marketplace-direct callbacks
    (Monday → /callback without going through /install) won't have a
    cookie; that path is allowed since Monday originates the redirect
    and the auth code itself is single-use + bound to our client_id.
    """
    if not code:
        raise HTTPException(status_code=400, detail="missing 'code' query parameter")

    # CSRF check — only enforced when /install set a cookie (i.e. when
    # the user came through our reinstall flow). Marketplace installs
    # land here directly with no cookie; that's a legitimate path.
    if mira_oauth_state:
        if not state:
            raise HTTPException(
                status_code=400,
                detail="state cookie set but query 'state' missing — flow corrupted",
            )
        if not secrets.compare_digest(state, mira_oauth_state):
            raise HTTPException(
                status_code=400,
                detail="state mismatch — possible CSRF attempt",
            )

    try:
        token_data = await oauth.exchange_code_for_token(code)
    except oauth.OAuthError as exc:
        raise HTTPException(status_code=400, detail=f"token exchange failed: {exc}") from exc

    access_token = token_data.get("access_token")
    scope = token_data.get("scope", "")
    if not access_token:
        raise HTTPException(
            status_code=502,
            detail=f"monday returned no access_token: {token_data!r}",
        )

    try:
        me = await oauth.whoami(access_token)
    except oauth.OAuthError as exc:
        raise HTTPException(status_code=502, detail=f"whoami failed: {exc}") from exc

    account = (me or {}).get("account") or {}
    account_id = str(account.get("id") or "")
    user_id = str(me.get("id") or "") or None
    slug = str(account.get("slug") or "app")
    if not account_id:
        raise HTTPException(
            status_code=500,
            detail="could not resolve installing account id from Monday whoami response",
        )

    try:
        await oauth.save_installation(
            account_id=account_id,
            access_token=access_token,
            scope=scope,
            user_id=user_id,
        )
    except db.DBUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail="cannot persist installation: NEON_DATABASE_URL not configured",
        ) from exc

    # Sanitize before interpolating into the HTML response. Monday's
    # slug + account_id should already be safe (slug matches [a-z0-9_-]+
    # and id is numeric) but we cheaply escape both for defense in depth.
    safe_slug = html.escape(slug, quote=True)
    safe_account = html.escape(account_id, quote=True)
    redirect_back = f"https://{safe_slug}.monday.com/apps/installed_apps"
    return HTMLResponse(
        f"""<!doctype html>
<html><head>
<title>MIRA Scan installed</title>
<meta http-equiv="refresh" content="2; url={redirect_back}">
<style>body{{font-family:system-ui,sans-serif;padding:2rem;text-align:center}}</style>
</head><body>
<h2>MIRA Scan installed ✓</h2>
<p>Account: <code>{safe_account}</code></p>
<p>Redirecting back to monday.com…</p>
<p><a href="{redirect_back}">Go now</a></p>
</body></html>"""
    )


@app.post("/scan/extract", response_model=AssetPlate)
async def scan_extract(req: ScanRequest, request: Request) -> AssetPlate:
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")

    account_id = session.account_id_from_headers(request.headers)

    # Free-tier quota gate — only enforced when authenticated via Monday.
    # Standalone path (no header → no account_id) is exempt. Fail-open
    # on DB error: usage.month_scan_count returns 0 silently when NeonDB
    # is unavailable, so a transient outage never locks paying users out.
    if account_id:
        used = await usage.month_scan_count(account_id)
        if used >= usage.FREE_TIER_MONTHLY_CAP:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "quota_exceeded",
                    "message": (
                        f"Free-tier limit of {usage.FREE_TIER_MONTHLY_CAP} scans/month "
                        "reached. Email support@factorylm.com to upgrade."
                    ),
                    "used": used,
                    "cap": usage.FREE_TIER_MONTHLY_CAP,
                },
            )

    try:
        plate = await vision.extract_asset_plate(req.image_base64, req.mime_type)
    except Exception as exc:
        logger.exception("vision extract failed")
        raise HTTPException(status_code=502, detail=f"vision extract failed: {exc}") from exc

    # Per-account billing signal — only count successful scans. Fire and
    # forget; counter writes are best-effort and never block the response.
    if account_id:
        await usage.bump_scan_count(account_id)
    return plate


@app.get("/kb/lookup", response_model=KBResult)
async def kb_lookup(
    background: BackgroundTasks,
    request: Request,
    make: str = "",
    model: str = "",
) -> KBResult:
    """Identify the scanned asset against the live KB + curated allowlist.

    On miss we enqueue (make, model) into mira_scan_queue AND fire a
    background task that runs a real-time web search for the manual.
    The frontend polls `/queue/status?make=&model=` for progress.

    The KB itself stays shared (cooperative-by-design per NORTH_STAR.md);
    `account_id` only stamps the queue row so we know which install the
    miss came from.
    """
    if not make and not model:
        raise HTTPException(status_code=400, detail="make or model is required")

    account_id = session.account_id_from_headers(request.headers)
    result = await mira_rag.lookup_asset(make=make, model=model)
    if not result.matched:
        ack = await scan_queue.enqueue(
            make=make,
            model=model,
            source="mira-scan",
            tenant_id=account_id,
            notes="auto-enqueued from /kb/lookup miss",
        )
        if ack:
            result.queued = QueueAck(**ack)
            # Don't block the scan response on a 5–15s search.
            background.add_task(manual_search.run_search_and_update, make, model)
    return result


@app.post("/queue/search-now", response_model=ManualRequestQueueResponse)
async def queue_search_now(
    req: ManualRequestQueueRequest, request: Request
) -> ManualRequestQueueResponse:
    """Synchronous variant of the background search.

    Enqueues if needed, runs the search inline, and returns the final
    queue row state so the caller can render the result without
    polling. Slower (~5–15s) but useful for shell scripts and tests.
    """
    if not (req.make.strip() and req.model.strip()):
        raise HTTPException(status_code=400, detail="make and model are required")

    account_id = session.account_id_from_headers(request.headers)
    await scan_queue.enqueue(
        make=req.make,
        model=req.model,
        serial=req.serial,
        source=req.source or "mira-scan",
        tenant_id=account_id,
        notes=req.notes,
    )
    await manual_search.run_search_and_update(req.make, req.model)
    row = await scan_queue.find_one(req.make, req.model)
    if row is None:
        return ManualRequestQueueResponse(ok=False, error="queue row missing after search")
    return ManualRequestQueueResponse(
        ok=True,
        queued=QueueAck(
            id=row["id"],
            status=row["status"],
            times_seen=row["times_seen"],
            first_seen=row["first_seen"],
        ),
        item=row,
    )


@app.post("/chat/message", response_model=ChatMessageResponse)
async def chat_message(req: ChatMessageRequest, request: Request) -> ChatMessageResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    # Chat is downstream of scan — bump last_seen so we know the install
    # is active, but don't bump scan_count (that would double-count).
    account_id = session.account_id_from_headers(request.headers)
    rate = await rate_limit.check_and_record(account_id)
    if not rate.allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "used": rate.used,
                "limit": rate.limit,
                "window_seconds": rate.window_seconds,
                "retry_after": rate.retry_after,
                "message": (
                    f"Too many requests — limit is {rate.limit} per "
                    f"{rate.window_seconds}s. Retry in {rate.retry_after}s."
                ),
            },
            headers={"Retry-After": str(rate.retry_after)},
        )
    if account_id:
        await oauth.touch_last_seen(account_id)
        used = await usage.month_chat_count(account_id)
        if used >= usage.FREE_TIER_MONTHLY_CHAT_CAP:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "quota_exceeded",
                    "used": used,
                    "cap": usage.FREE_TIER_MONTHLY_CHAT_CAP,
                    "message": (
                        f"Free-tier limit of {usage.FREE_TIER_MONTHLY_CHAT_CAP} "
                        "AI messages/month reached."
                    ),
                },
            )
    _max_turns = int(os.getenv("MIRA_MAX_CHAT_HISTORY_TURNS", "20"))
    trimmed_history = (req.history or [])[-_max_turns:]
    reply, sources = await mira_rag.chat(
        message=req.message,
        asset_id=req.asset_id,
        asset_label=req.asset_label,
        history=trimmed_history,
    )
    if account_id:
        await usage.bump_chat_count(account_id)
    return ChatMessageResponse(reply=reply, sources=sources)


@app.post("/queue/manual-request", response_model=ManualRequestQueueResponse)
async def queue_manual_request(
    req: ManualRequestQueueRequest, request: Request
) -> ManualRequestQueueResponse:
    if not (req.make.strip() and req.model.strip()):
        raise HTTPException(status_code=400, detail="make and model are required")
    account_id = session.account_id_from_headers(request.headers)
    ack = await scan_queue.enqueue(
        make=req.make,
        model=req.model,
        serial=req.serial,
        source=req.source or "mira-scan",
        tenant_id=account_id,
        notes=req.notes,
    )
    if ack is None:
        return ManualRequestQueueResponse(
            ok=False,
            error="queue unavailable (NEON_DATABASE_URL unset or DB unreachable)",
        )
    return ManualRequestQueueResponse(ok=True, queued=QueueAck(**ack))


@app.get("/queue/status", response_model=QueueStatusResponse)
async def queue_status(
    limit: int = 50,
    make: str = "",
    model: str = "",
) -> QueueStatusResponse:
    """Queue summary, or — when both `make` and `model` are provided —
    a single-row lookup so the upsell screen can poll for live updates."""
    if make and model:
        row = await scan_queue.find_one(make=make, model=model)
        items = [row] if row else []
        return QueueStatusResponse(available=row is not None, counts={}, items=items)
    data = await scan_queue.status(limit=limit)
    return QueueStatusResponse(**data)


@app.post("/monday/update-item", response_model=MondayUpdateResponse)
async def monday_update_item(
    req: MondayColumnUpdate,
    request: Request,
) -> MondayUpdateResponse:
    if not req.item_id or not req.board_id:
        raise HTTPException(status_code=400, detail="item_id and board_id are required")
    if not req.columns:
        raise HTTPException(status_code=400, detail="columns must not be empty")

    account_id = session.account_id_from_headers(request.headers)
    if account_id:
        await oauth.touch_last_seen(account_id)

    try:
        new_id = await monday_api.update_item_columns(
            board_id=req.board_id,
            item_id=req.item_id,
            columns=req.columns,
            account_id=account_id,
        )
    except monday_api.MondayTokenRevoked as exc:
        # Specific code so the frontend can branch to redirectToInstall().
        logger.warning("monday install revoked for account_id=%s: %s", account_id, exc)
        return MondayUpdateResponse(ok=False, error=f"reinstall_required: {exc}")
    except monday_api.MondayError as exc:
        logger.warning("monday update failed: %s", exc)
        return MondayUpdateResponse(ok=False, error=str(exc))
    except Exception as exc:
        logger.exception("monday update unexpected error")
        return MondayUpdateResponse(ok=False, error=f"{exc.__class__.__name__}: {exc}")
    return MondayUpdateResponse(ok=True, monday_item_id=new_id)


# ── monday.com app-lifecycle webhook ───────────────────────────────────────
# Configured in Developer Center → Build → Webhooks. Subscribed to:
# install, uninstall, app_subscription_*. Verification mirrors the
# session-token JWT pattern in `session.verify_session_token`.
@app.post("/monday/webhook")
async def monday_webhook(request: Request) -> dict[str, Any]:
    raw = await request.body()
    try:
        body = await request.json() if raw else {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid json body") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a json object")

    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    try:
        result = await webhooks.handle_event(authorization_header=auth, body=body)
    except webhooks.WebhookInvalid as exc:
        logger.warning("webhook signature invalid: %s", exc)
        raise HTTPException(status_code=401, detail="invalid webhook signature") from exc
    return result
