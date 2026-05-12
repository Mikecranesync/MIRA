"""UNS/ISA-95 compliant work order model for MIRA.

UNS topic schema: FactoryLM/{site}/{area}/{line}/{asset}/maintenance/work_orders/{wo_id}
Ref: issue #327 — Unified Namespace MQTT topic design.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("mira-gsd")

_HIGH_PRIORITY_FAULTS = {"power", "thermal", "hydraulic", "emergency", "fire"}

# Prefixes that identify MIRA meta-messages (WO previews, failure notices) that
# must not be treated as diagnostic resolution text or fault descriptions.
_WO_META_PREFIXES = (
    "📋",
    "I wasn't able to create",
    "Work order #",
    "Understood — no work order",
    "Updated.",
    "Got it —",
    "Log this work order",
    "To correct any field",
    "Say **yes** to log",
    "I need a few more details",
    "Please confirm",
)

# Short confirmations / WO-flow responses that should never be captured as the
# fault description from conversation history.
_SKIP_MSG_RE = re.compile(
    r"^(?:yes|no|yeah|yep|yup|ok|okay|hi|hello|hey|sure|thanks|thank\s+you|"
    r"long|log|do\s+it|go\s+ahead|confirm|submit|skip|cancel|abort|"
    r"nope|never\s+mind|nevermind|please)\b",
    re.IGNORECASE,
)

_UNS_EVENTS_PATH = os.getenv("UNS_EVENTS_PATH", "/opt/mira/data/uns_events.ndjson")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class UNSWorkOrder:
    """Work order structured per ISA-95 hierarchy + UNS topic convention.

    UNS topic: FactoryLM/{site}/{area}/{line}/{asset}/maintenance/work_orders/{wo_id}
    """

    # ISA-95 hierarchy
    site: str = ""
    area: str = ""
    line: str = ""
    asset: str = ""

    # Work order fields
    wo_type: str = "CORRECTIVE"
    priority: str = "MEDIUM"
    title: str = ""
    fault_description: str = ""
    resolution: str = ""
    parts_used: str = ""
    technician_id: str = ""
    technician_name: str = ""

    # Timestamps
    reported_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    resolved_at: str = ""

    # Metadata
    source: str = "mira-chat"
    chat_id: str = ""
    fsm_state_at_creation: str = ""

    @property
    def uns_topic(self) -> str:
        parts = ["FactoryLM"]
        for segment in (self.site, self.area, self.line, self.asset):
            if segment:
                parts.append(segment)
        parts.append("maintenance/work_orders")
        return "/".join(parts)

    @property
    def is_valid(self) -> bool:
        return bool(self.asset and self.title and self.fault_description)

    @property
    def missing_fields(self) -> list[str]:
        missing = []
        if not self.asset:
            missing.append("asset")
        if not self.title:
            missing.append("title")
        if not self.fault_description:
            missing.append("fault_description")
        return missing

    def to_dict(self) -> dict:
        return asdict(self)

    def to_uns_payload(self) -> dict:
        return {
            "topic": self.uns_topic,
            "timestamp": self.reported_at,
            "payload": self.to_dict(),
        }

    def to_atlas_description(self) -> str:
        """Build a rich description string for the Atlas CMMS API."""
        lines = ["MIRA Diagnostic Session"]
        if self.site:
            lines.append(f"Site: {self.site}")
        if self.area:
            lines.append(f"Area: {self.area}")
        if self.line:
            lines.append(f"Line: {self.line}")
        lines.append(f"Asset: {self.asset}")
        lines.append(f"UNS topic: {self.uns_topic}")
        lines.append("")
        lines.append(f"Fault: {self.fault_description}")
        if self.resolution:
            lines.append(f"Resolution: {self.resolution}")
        if self.parts_used:
            lines.append(f"Parts used: {self.parts_used}")
        return "\n".join(lines)[:2000]


# ---------------------------------------------------------------------------
# Module-level helpers used by engine.py
# ---------------------------------------------------------------------------


def format_wo_preview(wo: UNSWorkOrder) -> str:
    """Render a UNSWorkOrder as a structured chat message for tech confirmation."""
    lines = ["📋 **Work Order Preview (UNS format):**", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"]
    if wo.site:
        lines.append(f"📍 Site: {wo.site}")
    if wo.area:
        lines.append(f"🏭 Area: {wo.area}")
    if wo.line:
        lines.append(f"⚙️ Line: {wo.line}")
    lines.append(f"🔧 Asset: {wo.asset or '(unknown — please specify)'}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"Type: {wo.wo_type}")
    lines.append(f"Priority: {wo.priority}")
    if wo.fault_description:
        lines.append(f"Fault: {wo.fault_description[:200]}")
    if wo.resolution:
        lines.append(f"Resolution: {wo.resolution[:200]}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append("")
    lines.append("Log this work order to the CMMS? (yes/no)")
    lines.append(
        "To correct any field: *change priority to HIGH*, *asset is Pump-A3*, *line is Line 1*"
    )
    return "\n".join(lines)


_EDIT_PATTERNS: list[tuple[str, str]] = [
    (r"\bpriority\b.{0,20}\b(LOW|MEDIUM|HIGH|CRITICAL)\b", "priority"),
    (r"\b(?:type|wo_type)\b.{0,20}\b(CORRECTIVE|PREVENTIVE|EMERGENCY)\b", "wo_type"),
    (r"\b(?:asset|equipment)\s+(?:is|:)\s*(.+?)(?:\s*\.|$)", "asset"),
    (r"\bsite\s+(?:is|:)\s*(.+?)(?:\s*\.|$)", "site"),
    (r"\barea\s+(?:is|:)\s*(.+?)(?:\s*\.|$)", "area"),
    (r"\bline\s+(?:is|:)\s*(.+?)(?:\s*\.|$)", "line"),
    (r"\b(?:resolution|fix|solution)\s+(?:is|:)\s*(.+?)(?:\s*\.|$)", "resolution"),
    (
        r"\b(?:fault(?:\s+description)?|problem|issue|description)\s+(?:is|:)\s*(.+?)(?:\s*\.|$)",
        "fault_description",
    ),
]


def apply_wo_edit(draft: dict, message: str) -> Optional[dict]:
    """Parse an edit instruction against a WO draft dict.

    Returns an updated copy if any field was changed, or None if no edit detected.
    """
    updated = dict(draft)
    changed = False

    for pattern, field_name in _EDIT_PATTERNS:
        m = re.search(pattern, message, re.IGNORECASE)
        if not m:
            continue
        value = m.group(1).strip()[:200]
        if field_name in ("priority", "wo_type"):
            value = value.upper()
        if updated.get(field_name) != value:
            updated[field_name] = value
            changed = True

    return updated if changed else None


def log_uns_event(wo: UNSWorkOrder) -> None:
    """Log UNS event to structured logger + local NDJSON backlog for future MQTT replay."""
    payload = wo.to_uns_payload()
    logger.info(
        "UNS_WO_EVENT topic=%s payload=%s",
        payload["topic"],
        json.dumps(payload["payload"]),
    )
    try:
        os.makedirs(os.path.dirname(_UNS_EVENTS_PATH), exist_ok=True)
        with open(_UNS_EVENTS_PATH, "a") as fh:
            fh.write(json.dumps(payload) + "\n")
    except OSError as exc:
        logger.warning("UNS event file write failed (non-fatal): %s", exc)


def build_uns_wo_from_state(state: dict) -> UNSWorkOrder:
    """Extract UNSWorkOrder fields from a resolved FSM state dict."""
    ctx = state.get("context") or {}
    sc = ctx.get("session_context") or {}

    asset_raw = (state.get("asset_identified") or "").strip()
    fault = (state.get("fault_category") or "corrective").strip()

    # Build fault_description: prefer session_context summary, otherwise scan history
    # for the first substantive user message that looks like a fault report — skipping
    # short acknowledgements and WO-flow responses.
    fault_desc = sc.get("symptom_summary", "")
    if not fault_desc:
        history = ctx.get("history", [])
        for turn in history:
            if turn.get("role") == "user":
                content = (turn.get("content") or "").strip()
                if (
                    len(content) > 15
                    and not _SKIP_MSG_RE.match(content)
                    and not any(content.startswith(p) for p in _WO_META_PREFIXES)
                ):
                    fault_desc = content[:500]
                    break

    # Resolution: prefer session_context summary, otherwise last substantive assistant
    # turn — explicitly skip WO preview / failure notice messages.
    resolution = sc.get("diagnosis_summary", "")
    if not resolution:
        history = ctx.get("history", [])
        asst_turns = [
            t.get("content", "")[:300]
            for t in reversed(history[-8:])
            if t.get("role") == "assistant"
            and not any((t.get("content") or "").strip().startswith(p) for p in _WO_META_PREFIXES)
        ]
        resolution = asst_turns[0] if asst_turns else ""

    priority = "HIGH" if fault in _HIGH_PRIORITY_FAULTS else "MEDIUM"
    title = f"[MIRA] {asset_raw[:60]} — {fault} action" if asset_raw else "[MIRA] corrective action"

    return UNSWorkOrder(
        site=sc.get("site", sc.get("facility_name", "")),
        area=sc.get("area", ""),
        line=sc.get("line", ""),
        asset=asset_raw[:80],
        wo_type="CORRECTIVE",
        priority=priority,
        title=title[:100],
        fault_description=fault_desc[:500],
        resolution=resolution[:500],
        chat_id=str(state.get("chat_id", "")),
        fsm_state_at_creation=state.get("state", "RESOLVED"),
        source="mira-chat",
    )
