"""MIRA Ops Dashboard — Content & Social Fleet operations UI.

FastAPI + Jinja2 + htmx. Single container serving API and UI.
Connects to NeonDB for content tracking and Redis for Celery task dispatch.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from celery import Celery
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logger = logging.getLogger("mira-ops")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://mira-redis:6379/0")

app = FastAPI(title="MIRA Ops Dashboard", version="0.1.0")
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))

celery_app = Celery("mira_crawler", broker=CELERY_BROKER_URL)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_engine():
    if not NEON_DATABASE_URL:
        return None
    return create_engine(
        NEON_DATABASE_URL, poolclass=NullPool, connect_args={"sslmode": "require"}
    )


def query_db(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query against NeonDB, return list of row dicts."""
    engine = get_engine()
    if not engine:
        return []
    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql), params or {})
            return [dict(row._mapping) for row in result]
    except Exception as e:
        logger.error("DB query failed: %s", e)
        return []


def execute_db(sql: str, params: dict | None = None) -> bool:
    """Run a write query against NeonDB."""
    engine = get_engine()
    if not engine:
        return False
    try:
        with engine.connect() as conn:
            conn.execute(text(sql), params or {})
            conn.commit()
            return True
    except Exception as e:
        logger.error("DB execute failed: %s", e)
        return False


# ---------------------------------------------------------------------------
# Routes — Dashboard
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main dashboard overview."""
    stats = _get_stats()
    recent = query_db(
        "SELECT id, content_type, audience, topic, title, status, created_at "
        "FROM content_items ORDER BY created_at DESC LIMIT 10"
    )
    return templates.TemplateResponse(request, "dashboard.html", {
        "stats": stats,
        "recent": recent,
        "now": datetime.now(timezone.utc),
    })


# ---------------------------------------------------------------------------
# Routes — Content Management
# ---------------------------------------------------------------------------

@app.get("/content", response_class=HTMLResponse)
async def content_list(request: Request):
    """List all content items."""
    items = query_db(
        "SELECT id, content_type, audience, topic, title, slug, status, "
        "word_count, created_at, published_at "
        "FROM content_items ORDER BY created_at DESC LIMIT 50"
    )
    return templates.TemplateResponse(request, "content.html", {
        "items": items,
    })


@app.post("/content/{item_id}/approve", response_class=HTMLResponse)
async def approve_content(item_id: int):
    """Approve a content item."""
    execute_db(
        "UPDATE content_items SET status = 'approved' WHERE id = :id",
        {"id": item_id},
    )
    return HTMLResponse(
        '<span class="badge badge-approved">approved</span>'
    )


@app.post("/content/{item_id}/reject", response_class=HTMLResponse)
async def reject_content(item_id: int):
    """Reject a content item."""
    execute_db(
        "UPDATE content_items SET status = 'rejected' WHERE id = :id",
        {"id": item_id},
    )
    return HTMLResponse(
        '<span class="badge badge-rejected">rejected</span>'
    )


@app.post("/content/{item_id}/publish", response_class=HTMLResponse)
async def publish_content(item_id: int):
    """Mark a content item as published."""
    execute_db(
        "UPDATE content_items SET status = 'published', published_at = NOW() WHERE id = :id",
        {"id": item_id},
    )
    return HTMLResponse(
        '<span class="badge badge-published">published</span>'
    )


# ---------------------------------------------------------------------------
# Routes — Social Management
# ---------------------------------------------------------------------------

@app.get("/social", response_class=HTMLResponse)
async def social_list(request: Request):
    """List all social items."""
    items = query_db(
        "SELECT id, content_item_id, platform, body_text, char_count, "
        "status, buffer_post_id, scheduled_for, created_at "
        "FROM social_items ORDER BY created_at DESC LIMIT 50"
    )
    return templates.TemplateResponse(request, "social.html", {
        "items": items,
    })


@app.post("/social/{item_id}/approve", response_class=HTMLResponse)
async def approve_social(item_id: int):
    """Approve a social item for Buffer scheduling."""
    execute_db(
        "UPDATE social_items SET status = 'approved' WHERE id = :id",
        {"id": item_id},
    )
    return HTMLResponse(
        '<span class="badge badge-approved">approved</span>'
    )


# ---------------------------------------------------------------------------
# Routes — Manual Generation Triggers
# ---------------------------------------------------------------------------

@app.post("/generate/blog")
async def generate_blog(request: Request):
    """Trigger manual blog post generation."""
    celery_app.send_task(
        "mira_crawler.tasks.content.generate_blog_post",
        args=["maintenance_tech"],
        queue="content",
    )
    logger.info("Manually triggered blog post generation")
    return RedirectResponse(url="/?flash=blog_queued", status_code=303)


@app.post("/generate/social")
async def generate_social(request: Request):
    """Trigger manual social batch generation."""
    celery_app.send_task(
        "mira_crawler.tasks.content.generate_social_batch",
        args=["maintenance_tech"],
        queue="content",
    )
    logger.info("Manually triggered social batch generation")
    return RedirectResponse(url="/?flash=social_queued", status_code=303)


@app.post("/generate/video")
async def generate_video(request: Request):
    """Trigger manual video script generation."""
    celery_app.send_task(
        "mira_crawler.tasks.content.generate_weekly_video_script",
        args=["maintenance_tech"],
        queue="content",
    )
    logger.info("Manually triggered video script generation")
    return RedirectResponse(url="/?flash=video_queued", status_code=303)


# ---------------------------------------------------------------------------
# Routes — Worker Health
# ---------------------------------------------------------------------------

@app.get("/workers", response_class=HTMLResponse)
async def workers_page(request: Request):
    """Celery worker health and queue info."""
    worker_info = _get_worker_info()
    return templates.TemplateResponse(request, "workers.html", {
        "workers": worker_info,
    })


# ---------------------------------------------------------------------------
# Routes — API (JSON for htmx polling)
# ---------------------------------------------------------------------------

@app.get("/api/stats")
async def api_stats():
    """JSON stats endpoint for htmx auto-refresh."""
    return JSONResponse(_get_stats())


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "mira-ops", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_stats() -> dict:
    """Aggregate content/social stats from NeonDB."""
    content_stats = query_db(
        "SELECT status, COUNT(*) as cnt FROM content_items GROUP BY status"
    )
    social_stats = query_db(
        "SELECT status, COUNT(*) as cnt FROM social_items GROUP BY status"
    )
    today_count = query_db(
        "SELECT COUNT(*) as cnt FROM content_items WHERE created_at::date = CURRENT_DATE"
    )

    stats = {
        "content": {row["status"]: row["cnt"] for row in content_stats},
        "social": {row["status"]: row["cnt"] for row in social_stats},
        "today": today_count[0]["cnt"] if today_count else 0,
        "total_content": sum(row["cnt"] for row in content_stats),
        "total_social": sum(row["cnt"] for row in social_stats),
    }
    stats["pending"] = stats["content"].get("draft", 0) + stats["social"].get("draft", 0)
    stats["approved"] = stats["content"].get("approved", 0) + stats["social"].get("approved", 0)
    stats["published"] = stats["content"].get("published", 0) + stats["social"].get("published", 0)
    return stats


def _get_worker_info() -> dict:
    """Query Celery worker status via inspect."""
    try:
        inspector = celery_app.control.inspect(timeout=3)
        return {
            "active": inspector.active() or {},
            "scheduled": inspector.scheduled() or {},
            "reserved": inspector.reserved() or {},
            "stats": inspector.stats() or {},
            "connected": True,
        }
    except Exception as e:
        logger.error("Celery inspect failed: %s", e)
        return {"active": {}, "scheduled": {}, "reserved": {}, "stats": {}, "connected": False}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8500)
