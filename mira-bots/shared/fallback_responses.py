"""MIRA fallback responses — user-facing messages for every failure mode.

All strings are i18n-ready: callers pass them through the i18n layer when the
hub is involved.  Keep messages actionable: tell the tech what to do next.
"""

from __future__ import annotations

RAG_FAILURE = (
    "I'm having trouble accessing the equipment knowledge base right now. "
    "You can search OEM documentation directly — most major manufacturers "
    "have a support portal (e.g. rockwellautomation.com/support, "
    "siemens.com/support). Try again in a moment."
)

INFERENCE_EXHAUSTED = (
    "All AI providers are temporarily unavailable. "
    "Your message has been logged and I'll respond as soon as service resumes. "
    "For urgent faults, call your supervisor or check the equipment manual directly."
)

NEON_FAILURE = (
    "I can't access the knowledge base right now, but I can still help with "
    "basic troubleshooting. What's the fault code or symptom you're seeing?"
)

PHOTO_FAILURE = (
    "I couldn't analyze that photo. "
    "Could you try again with better lighting — ideally with the nameplate or "
    "fault display clearly visible? Or describe what you're seeing and I'll help."
)

WORK_ORDER_FAILURE_TEMPLATE = (
    "I diagnosed the issue but couldn't create the work order automatically "
    "(CMMS error). Here's what to log manually:\n\n{summary}\n\n"
    "I'll retry the work order creation next time you confirm."
)

TIMEOUT_WARNING = (
    "This is taking longer than usual — I'm still working on it. "
    "You'll get a response within 2 minutes. "
    "If it doesn't arrive, try sending the message again."
)

GENERIC_ENGINE_ERROR = (
    "MIRA ran into an unexpected problem. "
    "Please try sending your message again. "
    "If the issue persists, describe the fault code and equipment manually."
)

PHOTO_LOW_QUALITY = (
    "I can see something but the photo is too dark or blurry for a "
    "reliable diagnosis. Can you send a clearer photo — ideally with "
    "the nameplate or fault display visible?"
)


def work_order_failure(summary: str) -> str:
    """Return the WO failure message with the diagnosis summary filled in."""
    return WORK_ORDER_FAILURE_TEMPLATE.format(summary=summary or "No summary available")
