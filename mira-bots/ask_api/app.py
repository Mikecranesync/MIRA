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
from shared.live_snapshot import _FAULT_CODES, normalize, render_status_block

from ask_api.drive_pack import router as drive_pack_router
from ask_api.gate_state import derive_uns_gate
from ask_api.machine_context import MACHINE_CONTEXT
from ask_api.readonly_guard import enforce_readonly_kiosk_reply
from ask_api.workspace import router as workspace_router

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
app.include_router(drive_pack_router)
app.include_router(workspace_router)


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

        # Clean retrieval query (#1766): the lexical streams (BM25 / fault-code /
        # product-name extraction) and the embedding key off this, NOT the static
        # ~440-token MACHINE_CONTEXT card. Feed it the QUESTION plus the ACTIVE
        # fault code only — never the full human-readable status block. The block
        # contains tokens like "PE-01 beam clear" / "A-DC" that _extract_fault_codes
        # mis-reads as fault codes; none hit the structured fault table, so recall
        # falls through to an ILIKE %pattern% seq-scan over 83K rows (~+2s on every
        # status turn — RAG_STAGE_TIMING showed recall_ms 4323 vs 2161). Including
        # only the real decoded fault code (e.g. "CE10 modbus timeout" when
        # vfd_fault_code != 0) preserves CE10/fault grounding without the junk
        # tokens. Status turns (vfd_fault_code == 0) then carry no fake codes → no
        # ILIKE. The LLM still sees the full status block via `enriched`.
        retrieval_parts = [req.question]
        try:
            fault_raw = int((req.tags or {}).get("vfd_fault_code") or 0)
        except (TypeError, ValueError):
            fault_raw = 0
        if fault_raw and fault_raw in _FAULT_CODES:
            retrieval_parts.append(_FAULT_CODES[fault_raw])
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
        reply = enforce_readonly_kiosk_reply(reply)
        # Surface the UNS confirmation-gate state so the Perspective HMI can render
        # a distinct Yes/No confirm panel + location breadcrumb instead of treating
        # the gate prompt as a plain answer. Best-effort: never break the response.
        gate = {"uns_gate_state": "answered", "candidate_asset": "", "confirmed_asset": ""}
        try:
            gate = derive_uns_gate(engine._load_state(chat_id))
        except Exception as exc:  # noqa: BLE001
            logger.debug("ASK_GATE_STATE_MISS error=%s", exc)
        return {"answer": reply, "session_id": chat_id, **gate}
    except Exception as e:  # always return 200 so the HMI shows something
        logger.error("ASK_ERROR error=%s", e, exc_info=True)
        return {"answer": "MIRA error: " + str(e)}
