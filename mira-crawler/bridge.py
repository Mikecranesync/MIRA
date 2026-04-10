"""Task Bridge API — HTTP-to-Celery gateway for Trigger.dev Cloud.

Translates POST /tasks/{task_name} → Celery .delay() so Trigger.dev Cloud
can schedule and trigger all 24/7 ingest pipeline tasks over HTTP.

Port: 8003 (separate from mira-ingest :8002 and mira-mcp :8001).

Auth: Bearer token via TASK_BRIDGE_API_KEY env var.
      All POST and status endpoints require auth. GET /health is public.

Usage:
    uvicorn bridge:app --host 0.0.0.0 --port 8003
"""

from __future__ import annotations

import hmac
import importlib
import json
import logging
import os

import redis as redis_lib
from celery.result import AsyncResult
from fastapi import Depends, FastAPI, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from mira_crawler.celery_app import app as celery_app
except ImportError:
    from celery_app import app as celery_app

logger = logging.getLogger("mira-crawler.bridge")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TASK_BRIDGE_API_KEY = os.getenv("TASK_BRIDGE_API_KEY", "")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")

if not TASK_BRIDGE_API_KEY:
    logger.warning("TASK_BRIDGE_API_KEY not set — all POST endpoints will reject requests")

# ---------------------------------------------------------------------------
# Task registry — maps task_name → (module_path, function_name)
# Both mira_crawler.* (Docker) and tasks.* (local dev) paths are tried.
# ---------------------------------------------------------------------------

TASK_REGISTRY: dict[str, tuple[str, str]] = {
    "discover": ("tasks.discover", "discover_all_manufacturers"),
    "ingest": ("tasks.ingest", "ingest_all_pending"),
    "foundational": ("tasks.foundational", "ingest_foundational_kb"),
    "rss": ("tasks.rss", "poll_rss_feeds"),
    "sitemaps": ("tasks.sitemaps", "check_sitemaps"),
    "youtube": ("tasks.youtube", "ingest_youtube_channels"),
    "reddit": ("tasks.reddit", "scrape_forums"),
    "patents": ("tasks.patents", "scrape_patents"),
    "gdrive": ("tasks.gdrive", "sync_google_drive"),
    "freshness": ("tasks.freshness", "audit_stale_content"),
    "photos": ("tasks.foundational", "ingest_foundational_kb"),
    "report": ("tasks.report", "generate_ingest_report"),
}

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MIRA Task Bridge",
    description="HTTP-to-Celery gateway for Trigger.dev Cloud scheduling",
    version="1.0.0",
)

_bearer_scheme = HTTPBearer(auto_error=False)


def _require_auth(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> None:
    """Dependency: validates Bearer token against TASK_BRIDGE_API_KEY."""
    if not TASK_BRIDGE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TASK_BRIDGE_API_KEY not configured on server",
        )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not hmac.compare_digest(credentials.credentials, TASK_BRIDGE_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _resolve_task(module_path: str, func_name: str) -> object:
    """Dynamically load a Celery task function by module path + function name.

    Tries mira_crawler.{module_path} first (Docker), falls back to {module_path}
    (local dev). Returns the task callable or raises ImportError.
    """
    prefixed = f"mira_crawler.{module_path}"
    for mod_name in (prefixed, module_path):
        try:
            mod = importlib.import_module(mod_name)
            task_fn = getattr(mod, func_name, None)
            if task_fn is not None:
                return task_fn
        except ImportError:
            continue

    raise ImportError(
        f"Cannot import {func_name} from {module_path!r} (tried {prefixed!r} and {module_path!r})"
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", summary="Health check — pings Redis broker")
def health() -> dict:
    """Public health endpoint. Pings Redis to verify broker connectivity."""
    broker_url = CELERY_BROKER_URL
    try:
        # Parse host/port from redis://host:port/db
        import urllib.parse

        parsed = urllib.parse.urlparse(broker_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 6379
        r = redis_lib.Redis(host=host, port=port, socket_connect_timeout=2)
        r.ping()
        redis_status = "ok"
    except Exception as exc:
        logger.warning("Redis health check failed: %s", exc)
        redis_status = f"error: {exc}"

    return {
        "status": "ok" if redis_status == "ok" else "degraded",
        "redis": redis_status,
        "broker_url": broker_url,
    }


@app.post(
    "/tasks/{task_name}",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger a named Celery task",
    dependencies=[Depends(_require_auth)],
)
async def trigger_task(task_name: str, request: Request) -> dict:
    """Looks up task_name in registry, calls .delay(**kwargs), returns task_id.

    Optional JSON object body is forwarded as kwargs to .delay().
    Returns 404 if task_name is unknown.
    Returns 400 if body is present but not a JSON object.
    Returns 415 if body is present but not valid JSON.
    Returns 422 if the task module cannot be imported (stub not yet implemented).
    """
    if task_name not in TASK_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown task: {task_name!r}. "
            f"Available: {sorted(TASK_REGISTRY.keys())}",
        )

    # Parse optional JSON body and forward as kwargs
    try:
        body_bytes = await request.body()
        kwargs = json.loads(body_bytes) if body_bytes else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Invalid JSON body: {exc}",
        ) from exc
    if not isinstance(kwargs, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JSON body must be an object",
        )

    module_path, func_name = TASK_REGISTRY[task_name]

    try:
        task_fn = _resolve_task(module_path, func_name)
    except ImportError as exc:
        logger.error("Task import failed for %s: %s", task_name, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Task {task_name!r} module could not be imported: {exc}",
        ) from exc

    async_result = task_fn.delay(**kwargs) if kwargs else task_fn.delay()
    task_id = async_result.id

    logger.info("Queued task=%s id=%s fn=%s.%s", task_name, task_id, module_path, func_name)

    return {
        "task_id": task_id,
        "task_name": task_name,
        "status": "queued",
    }


@app.get(
    "/tasks/status/{task_id}",
    summary="Poll Celery task status by ID",
    dependencies=[Depends(_require_auth)],
)
def task_status(task_id: str) -> dict:
    """Returns the current state and result (if ready) for a Celery task."""
    result = AsyncResult(task_id, app=celery_app)

    payload: dict = {
        "task_id": task_id,
        "status": result.state,
    }

    if result.ready():
        if result.successful():
            payload["result"] = result.result
        elif result.failed():
            payload["error"] = str(result.result)

    return payload
