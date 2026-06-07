"""MIRA Ask API — HTTP front door to the MIRA Q&A engine for the Ignition HMI.

A technician on the garage-conveyor Ignition dashboard clicks "? Ask MIRA",
types a question, and the gateway POSTs { question, tags, session_id } here.
We prepend a human-readable "[LIVE CONVEYOR STATUS]" block decoded from the
live PLC/VFD tags, then call the same Supervisor.process() the Telegram bot
uses, and return { "answer": <reply> }.

Mirrors the construction/import style of mira-bots/whatsapp/bot.py exactly.

Run: uvicorn ask_api.app:app --host 0.0.0.0 --port 8011
"""

import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from shared.engine import Supervisor
from shared.live_snapshot import normalize, render_status_block

from ask_api.machine_context import MACHINE_CONTEXT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-ask")

MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "default")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
KNOWLEDGE_COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")
ASK_API_KEY = os.environ.get("ASK_API_KEY", "")

# Module-level engine, constructed exactly like whatsapp/bot.py (same env vars).
# Built at import time — the proven pattern. mcp_base_url / mcp_api_key are
# additionally wired from MCP_BASE_URL / MCP_REST_API_KEY (Supervisor falls back
# to those same env vars internally, but we pass them explicitly for parity).
engine = Supervisor(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
    mcp_base_url=os.environ.get("MCP_BASE_URL", ""),
    mcp_api_key=os.environ.get("MCP_REST_API_KEY", ""),
)

app = FastAPI(title="MIRA Ask API", docs_url=None, redoc_url=None)


class AskRequest(BaseModel):
    question: str
    tags: dict | None = None
    session_id: str | None = None


def _build_status_block(tags: dict | None) -> str:
    """Decode live conveyor/VFD tags into a human-readable status block.

    Thin wrapper over ``shared.live_snapshot`` (the single source of the
    GS10/Micro820 decode tables, mirroring the machine card) so this kiosk and
    the engine share one decoder. Kept as a function so the /ask call site is
    unchanged. Adds ``[STALE]`` markers when ``vfd_comm_ok`` is false. Returns
    "" when there is nothing to report.
    """
    snaps = normalize(tags, "", source="ignition", ts=datetime.now(timezone.utc).isoformat())
    return render_status_block(snaps)


@app.get("/health")
async def health():
    return {"status": "ok", "platform": "ignition"}


@app.post("/ask")
async def ask(req: AskRequest, x_mira_key: str = Header(None)):
    # Optional shared-secret gate: only enforced when ASK_API_KEY is configured.
    if ASK_API_KEY and x_mira_key != ASK_API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-Mira-Key")

    try:
        status_block = _build_status_block(req.tags)
        parts = [MACHINE_CONTEXT]
        if status_block:
            parts.append(status_block)
        parts.append("[QUESTION]\n" + req.question)
        enriched = "\n\n".join(parts)

        # Clean retrieval query (#1766 follow-up): keyword/BM25/fault-code/product
        # extraction must key off the QUESTION + decoded live-status block, NOT the
        # static ~440-token MACHINE_CONTEXT card. Otherwise every token of the card
        # feeds _extract_fault_codes / _extract_product_names / _recall_bm25 — the
        # card alone yields ~12 fault codes + 3 product names, firing ~9 sequential
        # NeonDB round-trips per /ask (the ~10s recall block). The embedding still
        # uses the full enriched text (semantic context); only the lexical streams
        # use this trimmed query. The fault code lives in the status block
        # (vfd_fault_code → CExx), so it MUST be included here, not just the question.
        retrieval_parts = []
        if status_block:
            retrieval_parts.append(status_block)
        retrieval_parts.append(req.question)
        retrieval_query = "\n".join(retrieval_parts)

        chat_id = req.session_id or ("ignition:" + uuid.uuid4().hex)

        # platform="ignition": process() accepts platform as a plain str and only
        # forwards it to _log_interaction (also a plain str) — it is NOT validated
        # against the NormalizedChatEvent platform Literal in shared/chat/types.py,
        # so "ignition" is safe and never triggers a validation error.
        reply = await engine.process(
            chat_id=chat_id,
            message=enriched,
            platform="ignition",
            tenant_id=engine.tenant_id or os.getenv("MIRA_TENANT_ID", ""),
            mira_user_id="ignition:kiosk",
            retrieval_query=retrieval_query,
        )
        return {"answer": reply}
    except Exception as e:  # always return 200 so the HMI shows something
        logger.error("ASK_ERROR error=%s", e, exc_info=True)
        return {"answer": "MIRA error: " + str(e)}
