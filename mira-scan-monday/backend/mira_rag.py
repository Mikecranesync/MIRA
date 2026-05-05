from __future__ import annotations

import logging
import os

import httpx

from .models import ChatSource, KBResult

logger = logging.getLogger("mira-scan.rag")

MIRA_KB_BASE_URL = os.getenv("MIRA_KB_BASE_URL", "")
MIRA_KB_API_KEY = os.getenv("MIRA_KB_API_KEY", "")
MIRA_KB_TIMEOUT = float(os.getenv("MIRA_KB_TIMEOUT", "30"))


def _auth_headers() -> dict[str, str]:
    if MIRA_KB_API_KEY:
        return {"Authorization": f"Bearer {MIRA_KB_API_KEY}"}
    return {}


async def lookup_asset(make: str, model: str) -> KBResult:
    """Look up an asset in the MIRA knowledge base by make/model.

    Wires to the existing MIRA RAG service when MIRA_KB_BASE_URL is set.
    Returns a stub no-match KBResult when the env var is missing so the
    upsell flow can still be developed locally.
    """
    if not MIRA_KB_BASE_URL:
        logger.info("MIRA_KB_BASE_URL not set — returning stub no-match for %s %s", make, model)
        return KBResult(matched=False, doc_count=0)

    params = {"make": make, "model": model}
    try:
        async with httpx.AsyncClient(timeout=MIRA_KB_TIMEOUT) as client:
            resp = await client.get(
                f"{MIRA_KB_BASE_URL.rstrip('/')}/kb/lookup",
                params=params,
                headers=_auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError:
        logger.exception("MIRA KB lookup failed for %s %s", make, model)
        return KBResult(matched=False, doc_count=0)

    return KBResult(
        matched=bool(data.get("matched")),
        asset_id=data.get("asset_id"),
        doc_count=int(data.get("doc_count") or 0),
    )


async def chat(
    message: str,
    asset_id: str | None,
    history: list[dict],
) -> tuple[str, list[ChatSource]]:
    """Send a chat message to the MIRA RAG and return (reply, sources)."""
    if not MIRA_KB_BASE_URL:
        return (
            "MIRA knowledge base is not configured. Set MIRA_KB_BASE_URL to enable grounded chat.",
            [],
        )

    payload = {
        "asset_id": asset_id,
        "message": message,
        "history": history,
    }
    try:
        async with httpx.AsyncClient(timeout=MIRA_KB_TIMEOUT) as client:
            resp = await client.post(
                f"{MIRA_KB_BASE_URL.rstrip('/')}/chat/message",
                json=payload,
                headers=_auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.exception("MIRA KB chat failed")
        return (f"Chat backend unavailable ({exc.__class__.__name__}).", [])

    reply = str(data.get("reply") or "")
    raw_sources = data.get("sources") or []
    sources = [
        ChatSource(
            title=str(s.get("title") or "source"),
            url=s.get("url"),
            page=s.get("page"),
        )
        for s in raw_sources
        if isinstance(s, dict)
    ]
    return reply, sources
