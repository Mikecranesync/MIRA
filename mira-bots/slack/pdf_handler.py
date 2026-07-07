# MIRA FactoryLM — Apache 2.0
"""PDF/document intake — routes Slack uploads through the citable Hub folder door.

Slack uploads are ingested via mira-hub's `/api/uploads/folder` route
(Bearer ``HUB_INGEST_TOKEN`` + header ``X-Mira-Tenant-Id``, multipart raw file) —
the SAME citable door MiraDrop uses (``tools/mira-drop-watcher/main.py``). That
path lands the file in per-tenant ``knowledge_entries`` (``is_private=true``) on the
Hub RAG path, which IS citable on the NodeChat surface.

Previously this handler wrote directly into an Open WebUI knowledge collection
(``/api/v1/files/`` -> ``/api/v1/knowledge/{id}/file/add``). Per
``.claude/rules/knowledge-entries-tenant-scoping.md`` the Open-WebUI-KB door is
NOT citable on the Hub RAG path -- it was a second, divergent ingestion system
that competed with the system-of-record. Reuse the folder door; don't fork it.
"""

from __future__ import annotations

import io
import logging
import os

import httpx

logger = logging.getLogger("mira-slack-pdf")

# Hub folder-door config -- consistent with tools/mira-drop-watcher/main.py.
HUB_URL = os.environ.get("HUB_URL", "http://127.0.0.1:3101").rstrip("/")
# mira-hub runs under basePath=/hub (next.config.ts) with trailingSlash=true.
HUB_BASE_PATH = os.environ.get("HUB_BASE_PATH", "/hub").rstrip("/")
HUB_INGEST_TOKEN = os.environ.get("HUB_INGEST_TOKEN", "")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")

# MIME allowlist -- PDFs + images only (mirrors the Slack adapter allowlist and
# the security-boundaries rule). Extension -> MIME for the multipart part.
_ALLOWED_MIME: dict[str, str] = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Size cap -- matches the Telegram 20 MB PDF limit (docs security-boundaries).
MAX_UPLOAD_BYTES = int(os.environ.get("SLACK_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


def _mime_for(filename: str) -> str | None:
    """Return the allowlisted MIME for a filename, or None if not allowed."""
    _, _, ext = filename.rpartition(".")
    return _ALLOWED_MIME.get(f".{ext.lower()}") if ext else None


async def ingest_pdf(file_bytes: bytes, filename: str) -> str:
    """Ingest a Slack document through the citable Hub folder door.

    Uploads to mira-hub ``/api/uploads/folder`` (Bearer + tenant header), landing
    the file in per-tenant ``knowledge_entries`` (``is_private=true``) on the
    citable Hub RAG path. Returns a user-facing status message. Never raises --
    the Slack handler stays graceful even when the Hub env is unset.
    """
    mime = _mime_for(filename)
    if mime is None:
        return f"Sorry — I can only ingest PDFs and images. *{filename}* isn't a supported type."

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES / (1024 * 1024)
        return f"*{filename}* is too large — the limit is {limit_mb:.0f} MB."

    if not HUB_INGEST_TOKEN or not MIRA_TENANT_ID:
        logger.warning(
            "Hub ingest not configured (HUB_INGEST_TOKEN/MIRA_TENANT_ID unset) — "
            "skipping ingest of '%s'",
            filename,
        )
        return (
            "Document intake isn't configured right now, so I couldn't file "
            f"*{filename}*. Please let an admin know."
        )

    url = f"{HUB_URL}{HUB_BASE_PATH}/api/uploads/folder/"
    headers = {
        "Authorization": f"Bearer {HUB_INGEST_TOKEN}",
        "X-Mira-Tenant-Id": MIRA_TENANT_ID,
    }
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                url,
                headers=headers,
                files={"file": (filename, io.BytesIO(file_bytes), mime)},
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        body = e.response.text[:200]
        logger.error(
            "Hub folder-door rejected '%s': HTTP %s %s", filename, e.response.status_code, body
        )
        return f"Could not file *{filename}* ({e.response.status_code}). Please try again."
    except httpx.HTTPError as e:
        logger.error("Hub folder-door transport error for '%s': %s", filename, e)
        return f"Could not upload *{filename}* right now. Please try again."

    upload_id = ""
    try:
        upload_id = str(resp.json().get("id", ""))
    except Exception:  # noqa: BLE001 -- response body is informational only
        pass

    logger.info(
        "Ingested '%s' via Hub folder door (%d bytes, upload_id=%s)",
        filename,
        len(file_bytes),
        upload_id or "?",
    )
    return (
        f"Got it — I've filed *{filename}* into your facility's knowledge base. "
        "Ask me anything about it."
    )
