"""Derive HMI-facing UNS confirmation-gate fields from a persisted session state.

Pure + dependency-free so it is unit-testable without constructing the Supervisor
or the FastAPI app. The /ask handler calls derive_uns_gate(engine._load_state(chat_id))
after engine.process() and merges the result into the JSON response, so the Ignition
Perspective HMI can render a distinct confirm panel instead of plain markdown.

The backend gate (mira-bots/shared/engine.py) already sets FSM state
AWAITING_UNS_CONFIRMATION and stores context.pending_uns_confirm.candidate; this
only exposes that state to the frontend. No gate logic lives here.
"""

from __future__ import annotations


def derive_uns_gate(state: dict | None) -> dict:
    """Map a persisted session-state dict to the three HMI gate fields.

    Returns:
        {
          "uns_gate_state": "awaiting_confirmation" | "answered",
          "candidate_asset": str,   # asset MIRA wants confirmed (gate firing)
          "confirmed_asset": str,   # asset already confirmed (normal answer)
        }
    """
    state = state or {}
    if (state.get("state") or "") == "AWAITING_UNS_CONFIRMATION":
        pending = (state.get("context") or {}).get("pending_uns_confirm") or {}
        return {
            "uns_gate_state": "awaiting_confirmation",
            "candidate_asset": pending.get("candidate") or "",
            "confirmed_asset": "",
        }
    return {
        "uns_gate_state": "answered",
        "candidate_asset": "",
        "confirmed_asset": state.get("asset_identified") or "",
    }
