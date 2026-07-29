from __future__ import annotations

import logging
import os
import re

import httpx

from . import db, vendor_rag
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


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(*parts: str) -> str:
    raw = "-".join(p for p in parts if p)
    return _SLUG_RE.sub("-", raw.lower()).strip("-") or "asset"


def _humanize(make: str, model: str) -> str:
    bits = [b for b in (make.strip(), model.strip()) if b]
    return " ".join(bits) or "Unknown asset"


async def _live_kb_match(make: str, model: str) -> tuple[int, str | None] | None:
    """Search the live kb_chunks table for chunks mentioning this asset.

    Returns (doc_count, manufacturer_hint) on hit, None on miss, and
    None on any DB error so the allowlist fallback can take over.
    """
    if not (make or model):
        return None
    # We require the model token to appear (it's specific) and let the
    # make match either the indexed manufacturer column or the content.
    sql = """
        SELECT COUNT(*) AS hits,
               MAX(manufacturer) AS mfg
          FROM kb_chunks
         WHERE content ILIKE %s
           AND (
                manufacturer ILIKE %s
             OR content      ILIKE %s
           )
    """
    model_pat = f"%{model.strip()}%" if model else "%"
    make_pat = f"%{make.strip()}%" if make else "%"
    try:
        row = await db.fetch_one(sql, (model_pat, make_pat, make_pat))
    except db.DBUnavailable:
        return None
    except Exception:
        logger.exception("live kb_chunks lookup failed for %r %r", make, model)
        return None
    if row is None:
        return None
    hits = int(row[0] or 0)
    if hits <= 0:
        return None
    return hits, (row[1] or None)


async def lookup_asset(make: str, model: str) -> KBResult:
    """Identify an asset against the live MIRA KB, then the curated
    allowlist as a deterministic fallback for known families.
    """
    # 1) live kb_chunks search — picks up anything we've ever ingested
    live = await _live_kb_match(make, model)
    if live is not None:
        hits, mfg_hint = live
        asset_id = _slugify(mfg_hint or make, model)
        label = _humanize(mfg_hint or make, model)
        logger.info("kb live hit: %s (%d chunks) for %r %r", asset_id, hits, make, model)
        return KBResult(matched=True, asset_id=asset_id, asset_label=label, doc_count=hits)

    # 2) curated allowlist — guarantees a clean asset_id + friendly label
    entry = match_equipment(make, model)
    if entry is not None:
        logger.info("kb allowlist hit: %s for %r %r", entry["asset_id"], make, model)
        return KBResult(
            matched=True,
            asset_id=entry["asset_id"],
            asset_label=entry["label"],
            doc_count=1,
        )

    logger.info("kb miss: make=%r model=%r", make, model)
    return KBResult(matched=False, doc_count=0)


_SOURCE_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s*(.+?)\s*$")


def _split_sources(content: str) -> tuple[str, list[ChatSource]]:
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


def _split_make_model(label: str | None, asset_id: str | None) -> tuple[str | None, str | None]:
    """Best-effort split of a label like 'Allen-Bradley PowerFlex 525' into
    (make, model). Falls back to splitting the slugified asset_id."""
    src = (label or "").strip()
    if not src and asset_id:
        src = asset_id.replace("-", " ").strip()
    if not src:
        return None, None
    parts = src.split(None, 1)
    if len(parts) == 1:
        return parts[0], None
    return parts[0], parts[1]


def _system_prompt(asset_id: str | None, asset_label: str | None) -> str:
    base = (
        "You are MIRA, an industrial-maintenance diagnostic assistant. "
        "Answer concisely and cite the OEM manual when you reference one. "
        "If you don't know, say so — don't guess."
    )
    label = asset_label
    if not label and asset_id:
        eq = get_equipment(asset_id)
        if eq:
            label = eq["label"]
    if not label:
        return base
    make, _ = _split_make_model(label, asset_id)
    constraint = (
        f"The user is asking about a {label}. "
        f"Answer ONLY about the {label}. "
    )
    if make:
        constraint += (
            f"Use ONLY documentation, parameter codes, and terminology from {make}. "
            f"Do NOT reference, compare to, or cite documentation from other manufacturers "
            f"(e.g. Yaskawa, ABB, Siemens, Automation Direct, Danfoss, Mitsubishi, Fuji) "
            f"unless the user explicitly asks. "
        )
    constraint += (
        "If the question cannot be answered from the OEM manual for this exact equipment, "
        "say 'I don't have the relevant section of the manual for this' rather than guessing "
        "from a similar product."
    )
    return f"{base} {constraint}"


async def chat(
    message: str,
    asset_id: str | None,
    history: list[dict],
    asset_label: str | None = None,
) -> tuple[str, list[ChatSource]]:
    # Manufacturer-scoped path: when the scan matched a known asset, we
    # retrieve from `knowledge_entries` filtered by manufacturer and call
    # the LLM cascade directly. This stops cross-vendor leakage where
    # mira-pipeline would otherwise pull (e.g.) Yaskawa chunks into a
    # PowerFlex 525 conversation.
    vendor_result = await vendor_rag.vendor_chat(
        message=message,
        asset_id=asset_id,
        asset_label=asset_label,
        history=history,
    )
    if vendor_result is not None:
        return vendor_result

    if not MIRA_KB_BASE_URL:
        return (
            "Grounded chat is not available for this equipment right now. "
            "Contact your MIRA administrator to enable it.",
            [],
        )

    messages: list[dict] = [{"role": "system", "content": _system_prompt(asset_id, asset_label)}]
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    payload = {"model": MIRA_KB_MODEL, "messages": messages, "temperature": 0.2}
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

    return _split_sources(content)
