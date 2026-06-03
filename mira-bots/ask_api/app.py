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

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from shared.engine import Supervisor

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


# --- GS10 decode tables (mirror MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md) ---
# Status word (reg 0x2101) low 2 bits -> run state.
_STATUS_BITS = {0: "STOPPED", 1: "DECEL", 2: "STANDBY", 3: "RUNNING"}
# GS10 fault/error codes (vfd_fault_code, low byte of reg 0x2100) -> short name.
_FAULT_CODES = {
    0: "no active fault",
    4: "GFF ground fault",
    12: "Lvd undervoltage",
    21: "oL overload",
    49: "EF external fault",
    54: "CE1 comm illegal cmd",
    55: "CE2 comm illegal addr",
    56: "CE3 comm illegal data",
    57: "CE4 comm fail",
    58: "CE10 modbus timeout",
}


def _build_status_block(tags: dict | None) -> str:
    """Decode known live conveyor/VFD tags into a human-readable status block.

    Unknown keys are passed through raw. Missing/None values are skipped.
    Returns "" when there is nothing to report.
    """
    if not tags:
        return ""

    lines: list[str] = []
    cmd_word_map = {1: "STOP", 18: "FWD+RUN", 20: "REV+RUN"}

    for key, value in tags.items():
        if value is None:
            continue

        if key == "vfd_frequency":
            lines.append(f"VFD output: {value / 100:.1f} Hz")
        elif key == "vfd_freq_sp":
            lines.append(f"Freq setpoint: {value / 100:.1f} Hz")
        elif key == "vfd_current":
            lines.append(f"Current: {value / 100:.1f} A")
        elif key == "vfd_dc_bus":
            lines.append(f"DC bus: {value / 10:.1f} V")
        elif key == "vfd_cmd_word":
            lines.append(f"Command: {cmd_word_map.get(value, f'cmd {value}')}")
        elif key == "vfd_status_word":
            state = _STATUS_BITS.get(value & 0b11, "?")
            lines.append(f"Drive state: {state} (status word {value})")
        elif key == "vfd_fault_code":
            if value == 0:
                lines.append("no active fault")
            elif value in _FAULT_CODES:
                lines.append(f"FAULT: {_FAULT_CODES[value]} (code {value})")
            else:
                lines.append(f"FAULT code {value} (unmapped)")
        elif key == "vfd_comm_ok":
            lines.append(f"VFD comms {'OK' if value else 'LOST'}")
        elif key == "pe_latched":
            lines.append("PHOTO-EYE JAM LATCHED (soft-stop active)" if value else "photo-eye clear")
        elif key in ("DI_02", "e_stop"):
            lines.append(f"E-stop {'ARMED/OK' if value else 'TRIPPED'}")
        elif key in ("DI_05", "pe_beam"):
            lines.append(f"PE-01 beam {'BLOCKED' if value else 'clear'}")
        elif key in ("DO_02", "mlc"):
            lines.append(f"Main line contactor {'CLOSED/energized' if value else 'OPEN'}")
        else:
            lines.append(f"{key}: {value}")

    if not lines:
        return ""

    return "[LIVE CONVEYOR STATUS]\n" + "\n".join(lines)


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
        )
        return {"answer": reply}
    except Exception as e:  # always return 200 so the HMI shows something
        logger.error("ASK_ERROR error=%s", e, exc_info=True)
        return {"answer": "MIRA error: " + str(e)}
