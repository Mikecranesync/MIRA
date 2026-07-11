"""Read-only drive-pack Q&A HTTP endpoint.

This module exposes the deterministic, pack-grounded answer_question function
from shared.drive_packs.ask over HTTP. The endpoint is consumed by the Hub
asset-chat pre-check (issue #2527) to surface drive-pack intelligence when
available, without invoking the heavy Supervisor engine.

Route: POST /drive-pack/ask
- No live hardware, no LLM fallback, no Ignition connection.
- Pure pack-grounded answers + citations, or honest "not in the pack".
- Always read-only; fallback_used and live_telemetry always False.
- Optional shared-secret auth via X-Mira-Key header (gate read at request time).

Separation: this module defines its own APIRouter so tests can import it WITHOUT
constructing ask_api.app (which builds the heavy Supervisor engine at import time).
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from shared.drive_packs.ask import answer_question
from shared.drive_packs.loader import resolve_pack

logger = logging.getLogger("mira-ask")

router = APIRouter()


class DrivePackAskRequest(BaseModel):
    """Request model for the drive-pack Q&A endpoint.

    Fields:
    - question: the technician's question (required)
    - pack_id: explicit canonical pack ID (optional; if provided, used directly)
    - drive: drive name/alias (optional; resolved to pack_id if pack_id not provided)
    """

    question: str
    pack_id: str | None = None
    drive: str | None = None


_UNRESOLVED = {
    "pack_id": None,
    "resolved": False,
    "matched": False,
    "matched_kind": None,
    "answer": "",
    "citations": [],
    "answer_source": "none",
    "fallback_used": False,
    "live_telemetry": False,
    "read_only": True,
}


@router.post("/drive-pack/ask")
async def drive_pack_ask(req: DrivePackAskRequest, x_mira_key: str = Header(None)):
    """Answer a technician's question grounded ONLY in a drive pack.

    Resolution strategy:
    1. If pack_id is provided, use it directly.
    2. Else if drive is provided, resolve it via resolve_pack(...).
    3. Else resolve the question text itself via resolve_pack(...).
    4. If resolution fails at any step, return the UNRESOLVED shape (HTTP 200).

    Auth (optional): read ASK_API_KEY from environment at request time.
    If set and X-Mira-Key header doesn't match, return 401.
    If not set, allow all requests.

    Error handling: catch unexpected exceptions, log them, return UNRESOLVED.
    Never 500 — the caller must always be able to fall through gracefully.
    """
    # Optional shared-secret gate, read at request time (allows test monkeypatching).
    key = os.environ.get("ASK_API_KEY", "")
    if key and x_mira_key != key:
        raise HTTPException(status_code=401, detail="invalid or missing X-Mira-Key")

    try:
        # Determine the canonical pack_id via resolution.
        pack_id: Optional[str] = None

        if req.pack_id:
            # Explicit pack_id — use directly.
            pack_id = req.pack_id
        else:
            # Prefer a drive named in the question itself; only then fall back
            # to the caller's asset/drive hint. This lets a surface bound to a
            # known asset (e.g. the Hub asset-chat passing the open asset's
            # manufacturer+model as `drive`) answer "what does CE10 mean?"
            # WITHOUT the user typing "gs10" — while a question that DOES name a
            # different drive still wins over the bound asset. (#2527 follow-up.)
            pack = resolve_pack(req.question)
            if pack is None and req.drive:
                pack = resolve_pack(req.drive)
            if pack is None:
                return _UNRESOLVED.copy()
            pack_id = pack.pack_id

        # Answer the question grounded in the resolved pack.
        answer = answer_question(pack_id, req.question)
        return answer.to_dict()

    except Exception as e:  # noqa: BLE001
        logger.error("DRIVE_PACK_ASK_ERROR error=%s", e, exc_info=True)
        return _UNRESOLVED.copy()
