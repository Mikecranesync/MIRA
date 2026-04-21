"""Auto-suggest follow-up PM after a corrective work order is created.

After _handle_cmms_pending creates a WO, call suggest_followup_pm() to get
a PM recommendation. Present to the user; on "yes" create a PM WO in Atlas.

Usage in engine.py (after WO confirmed and created):
    from shared.integrations.pm_suggestions import suggest_followup_pm, create_pm_wo
    suggestion = suggest_followup_pm(fault_category, asset)
    # Present suggestion to user; on confirmation:
    wo = await create_pm_wo(cmms_client, suggestion, asset_id)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger("mira-pm-suggestions")


@dataclass
class PMSuggestion:
    fault_category: str
    action: str
    days: int
    asset: str = ""

    def prompt_text(self) -> str:
        return (
            f"I'd recommend scheduling a follow-up check: "
            f"**{self.action}** within **{self.days} days**. "
            "Want me to add it to the CMMS?"
        )

    def wo_title(self) -> str:
        asset_part = f" — {self.asset}" if self.asset else ""
        return f"PM: {self.action}{asset_part}"

    def wo_description(self) -> str:
        return (
            f"Follow-up preventive maintenance recommended after corrective WO.\n"
            f"Trigger: {self.fault_category} fault\n"
            f"Action: {self.action}\n"
            f"Due within: {self.days} days"
        )


# Fault category → PM recommendation
FAULT_TO_PM: dict[str, dict] = {
    "overcurrent": {"action": "Check motor coupling alignment", "days": 30},
    "power": {"action": "Check motor coupling alignment", "days": 30},
    "overheating": {"action": "Inspect cooling system and ventilation", "days": 14},
    "thermal": {"action": "Inspect cooling system and ventilation", "days": 14},
    "bearing": {"action": "Replace or inspect bearing", "days": 60},
    "mechanical": {"action": "Balance check and coupling inspection", "days": 14},
    "vibration": {"action": "Balance check and coupling inspection", "days": 14},
    "voltage": {"action": "Check power supply connections and grounding", "days": 7},
    "electrical": {"action": "Check power supply connections and grounding", "days": 7},
    "comms": {"action": "Inspect network wiring and terminations", "days": 7},
    "communication": {"action": "Inspect network wiring and terminations", "days": 7},
    "hydraulic": {"action": "Check fluid levels and filter condition", "days": 30},
    "default": {"action": "Follow-up inspection", "days": 30},
}

# Keywords that indicate user accepted the PM suggestion
_PM_ACCEPT_WORDS = frozenset(
    "yes yeah yep sure ok okay add schedule create do it please go ahead".split()
)
# Keywords that indicate user declined
_PM_DECLINE_WORDS = frozenset("no nope skip pass not now later".split())


def suggest_followup_pm(fault_category: str, asset: str = "") -> PMSuggestion | None:
    """Return a PM suggestion for this fault, or None if fault_category is unknown."""
    category = (fault_category or "").lower().strip()
    spec = FAULT_TO_PM.get(category) or FAULT_TO_PM.get("default")
    if not spec:
        return None
    return PMSuggestion(
        fault_category=category,
        action=spec["action"],
        days=spec["days"],
        asset=asset,
    )


def is_pm_acceptance(message: str) -> bool:
    """Return True if the user's message is a PM acceptance."""
    words = set(message.lower().split())
    return bool(words & _PM_ACCEPT_WORDS) and not bool(words & _PM_DECLINE_WORDS)


def is_pm_decline(message: str) -> bool:
    """Return True if the user explicitly declined the PM suggestion."""
    words = set(message.lower().split())
    return bool(words & _PM_DECLINE_WORDS)


async def create_pm_wo(
    cmms_client,  # AtlasCMMSClient instance
    suggestion: PMSuggestion,
    asset_id: int = 0,
) -> dict:
    """Create a PREVENTIVE WO in Atlas for this PM suggestion. Never raises."""
    try:
        from datetime import datetime, timedelta, timezone

        due_str = (datetime.now(timezone.utc) + timedelta(days=suggestion.days)).strftime(
            "%Y-%m-%d"
        )

        result = await cmms_client.create_work_order(
            title=suggestion.wo_title(),
            description=f"{suggestion.wo_description()}\nDue by: {due_str}",
            priority="LOW",
            asset_id=asset_id,
            category="PREVENTIVE",
        )
        logger.info(
            "PM_WO created wo_id=%s asset=%r action=%r days=%d",
            result.get("id", "?"),
            suggestion.asset,
            suggestion.action,
            suggestion.days,
        )
        return result
    except Exception as exc:
        logger.error("PM_WO creation failed: %s", exc)
        return {"error": str(exc)}
