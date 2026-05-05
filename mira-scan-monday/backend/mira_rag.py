from __future__ import annotations

import logging
import os
import re

import httpx

from .known_equipment import get_equipment, match_equipment
from .models import ChatSource, KBResult

logger = logging.getLogger("mira-scan.rag")

MIRA_KB_BASE_URL = os.getenv("MIRA_KB_BASE_URL", "")
MIRA_KB_API_KEY = os.getenv("MIRA_KB_API_KEY", "")
MIRA_KB_TIMEOUT = float(os.getenv("MIRA_KB_TIMEOUT", "30"))
MIRA_KB_MODEL = os.getenv("MIRA_KB_MODEL", "mira-diagnostic")


def _auth_headers() -> dict[str, str]:
    if MIRA_KB_API_KEY:
        return {"Authorization": f"Bearer {MIRA_KB_API_KEY}"}
    return {}


async def lookup_asset(make: str, model: str) -> KBResult:
    """Match (make, model) against the curated MIRA KB allowlist.

    Curated rather than live-queried: the MIRA KB schema/endpoint isn't
    yet stable enough to safely hit on every scan, and the allowlist
    covers the equipment families that actually have OEM manuals
    ingested today (PowerFlex, Yaskawa, ABB, Siemens, etc.). Add new
    families in `known_equipment.py` as the KB grows.
    """
    entry = match_equipment(make, model)
    if entry is None:
        logger.info("kb lookup miss: make=%r model=%r", make, model)
        return KBResult(matched=False, doc_count=0)

    logger.info("kb lookup hit: %s for %r %r", entry["asset_id"], make, model)
    return KBResult(matched=True, asset_id=entry["asset_id"], doc_count=1)


_SOURCE_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s*(.+?)\s*$")


def _split_sources(content: str) -> tuple[str, list[ChatSource]]:
    """mira-pipeline embeds citations in the assistant content as a
    `--- Sources ---` block followed by `[N] title` lines. Pull them out
    so the frontend can render structured source tags."""
    if not content:
        return "", []
    parts = re.split(r"\n\s*-{3,}\s*Sources\s*-{3,}\s*\n", content, maxsplit=1)
    reply = parts[0].strip()
    sources: list[ChatSource] = []
    if len(parts) > 1:
        for line in parts[1].splitlines():
            m = _SOURCE_LINE_RE.match(line)
            if m:
                sources.append(ChatSource(title=m.group(2)))
    return reply, sources


def _system_prompt(asset_id: str | None) -> str:
    base = (
        "You are MIRA, an industrial-maintenance diagnostic assistant. "
        "Answer concisely and cite the OEM manual when you reference one. "
        "If you don't know, say so — don't guess."
    )
    if not asset_id:
        return base
    eq = get_equipment(asset_id)
    if not eq:
        return base
    return (
        f"{base} The user is asking about a {eq['label']} "
        f"({eq['category']}). Scope all retrieval and reasoning to that "
        "equipment family unless the user explicitly asks otherwise."
    )


async def chat(
    message: str,
    asset_id: str | None,
    history: list[dict],
) -> tuple[str, list[ChatSource]]:
    """Send a chat message to mira-pipeline (`/v1/chat/completions`)."""
    if not MIRA_KB_BASE_URL:
        return (
            "MIRA knowledge base is not configured. Set MIRA_KB_BASE_URL to enable grounded chat.",
            [],
        )

    messages: list[dict] = [{"role": "system", "content": _system_prompt(asset_id)}]
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    payload = {
        "model": MIRA_KB_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {"Content-Type": "application/json", **_auth_headers()}

    try:
        async with httpx.AsyncClient(timeout=MIRA_KB_TIMEOUT) as client:
            resp = await client.post(
                f"{MIRA_KB_BASE_URL.rstrip('/')}/v1/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.exception("mira-pipeline chat failed")
        return (f"Chat backend unavailable ({exc.__class__.__name__}).", [])

    try:
        content = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        logger.warning("unexpected mira-pipeline payload: %r", data)
        return ("Chat backend returned an unexpected response.", [])

    reply, sources = _split_sources(content)
    return reply, sources
