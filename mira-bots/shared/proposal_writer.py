"""Helpers to write LLM-derived proposals into ai_suggestions (mig-027).

Per ADR-0017, LLM proposals land in ai_suggestions as the Hub-facing work queue.
This module provides writer functions per suggestion_type, all following the same
pattern: emit one ai_suggestions row per proposal, with extracted_data pointing at
the target row's id and populated title/body/confidence/risk_level at write time
(not render time).

Currently implemented:
  - propose_wiring_connection(): write a wiring_connections row header to ai_suggestions
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

logger = logging.getLogger("mira.proposal_writer")


def map_function_class_to_risk_level(function_class: Optional[str]) -> str:
    """Map wiring function_class to ai_suggestions risk_level.

    function_class (wiring_connections CHECK):
      'power', 'signal', 'safety', 'comm', 'ground', 'unknown'

    risk_level (ai_suggestions CHECK):
      'low', 'medium', 'high', 'safety_critical'
    """
    if not function_class:
        return "low"
    fc = function_class.lower().strip()
    if fc == "safety":
        return "safety_critical"
    elif fc == "power":
        return "high"
    elif fc in ("comm", "ground"):
        return "medium"
    else:  # 'signal', 'unknown', or invalid
        return "low"


def propose_wiring_connection(
    cursor: Any,
    tenant_id: str,
    wiring_connection_id: str,
    source_terminal: str,
    dest_terminal: str,
    function_class: Optional[str],
    drawing_reference: Optional[str],
    proposed_by: str,
    confidence: float = 0.7,
) -> str:
    """Write an ai_suggestions row for a proposed wiring_connection (PR #2605).

    The wiring_connections row is already inserted (in proposed state). This
    function creates the Hub-facing ai_suggestions header so the row can appear
    in `/api/proposals` for review/approval.

    Args:
        cursor: Live DB cursor in the caller's transaction (RLS-scoped).
        tenant_id: The owning tenant UUID (matches wiring_connections.tenant_id).
        wiring_connection_id: The UUID of the already-inserted wiring_connections row.
        source_terminal: Human-readable source terminal (for title).
        dest_terminal: Human-readable destination terminal (for title).
        function_class: wiring_connections.function_class value
          ('power'/'signal'/'safety'/'comm'/'ground'/'unknown').
        drawing_reference: wiring_connections.drawing_reference (for body).
        proposed_by: mira-hub ai_suggestions.proposed_by value
          (e.g. 'llm:schematic_intelligence', 'human:user_xxx').
        confidence: 0.0-1.0, default 0.7. Scales with function_class certainty.

    Returns:
        The inserted ai_suggestions.id UUID (string).

    Raises:
        Exception: If the INSERT fails (caller should handle / log).
    """
    risk_level = map_function_class_to_risk_level(function_class)

    # Compute confidence: scale down for unknown/signal (less certain about
    # exact terminal matching); scale up for safety/power (high stakes).
    adjusted_confidence = confidence
    if function_class == "safety":
        adjusted_confidence = min(1.0, confidence + 0.2)
    elif function_class == "power":
        adjusted_confidence = min(1.0, confidence + 0.1)
    elif function_class in ("unknown", "signal"):
        adjusted_confidence = max(0.0, confidence - 0.1)

    # Title and body for the Hub feed (no per-type component needed).
    title = f"Wiring: {source_terminal} → {dest_terminal} [{function_class or 'unknown'}]"
    body = f"Drawing: {drawing_reference or 'unspecified'}. Function: {function_class or 'unknown'}"

    # extracted_data payload (schema-on-read by the decide endpoint).
    extracted_data = {
        "wiring_connection_id": wiring_connection_id,
        "source_terminal": source_terminal,
        "dest_terminal": dest_terminal,
        "function_class": function_class,
    }

    sql = """
    INSERT INTO ai_suggestions
        (tenant_id, suggestion_type, extracted_data, title, body,
         confidence, risk_level, status, proposed_by, created_at, updated_at)
    VALUES
        ($1::uuid, 'wiring_connection', $2::jsonb, $3, $4,
         $5, $6, 'pending', $7, now(), now())
    RETURNING id
    """

    cursor.execute(
        sql,
        (
            tenant_id,
            json.dumps(extracted_data),
            title,
            body,
            adjusted_confidence,
            risk_level,
            proposed_by,
        ),
    )

    row = cursor.fetchone()
    if not row:
        raise ValueError(f"Failed to insert ai_suggestions for wiring {wiring_connection_id}")

    suggestion_id = str(row[0])
    logger.info(
        "proposed wiring_connection",
        extra={
            "wiring_id": wiring_connection_id,
            "suggestion_id": suggestion_id,
            "risk_level": risk_level,
            "function_class": function_class,
        },
    )
    return suggestion_id
