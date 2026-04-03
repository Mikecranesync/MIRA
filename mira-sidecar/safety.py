"""MIRA Safety Guardrails — keyword detection and safety banner.

Runs BEFORE the query reaches the LLM. If safety keywords are detected,
the system prompt is modified and SAFETY_BANNER is prepended to the response.

Keywords ported from mira-bots/shared/guardrails.py (21 original) plus
additional terms from PRD v2 §4 Layer 3.
"""

from __future__ import annotations

import re

# 28 safety trigger phrases — match as case-insensitive substrings.
# Phrases (not single words) to reduce false positives.
SAFETY_KEYWORDS: list[str] = [
    # Original 21 from mira-bots/shared/guardrails.py
    "exposed wire",
    "energized conductor",
    "arc flash",
    "lockout",
    "tagout",
    "loto",
    "smoke",
    "burn mark",
    "melted insulation",
    "electrical fire",
    "shock hazard",
    "rotating hazard",
    "pinch point",
    "entanglement",
    "confined space",
    "pressurized",
    "caught in",
    "crush hazard",
    "fall hazard",
    "chemical spill",
    "gas leak",
    # PRD v2 additions
    "high voltage",
    "electrical hazard",
    "pressure release",
    "hydraulic failure",
    "ammonia",
    "chlorine",
    "asphyxiation",
]

# Precompile a single regex for fast matching
_SAFETY_RE = re.compile(
    "|".join(re.escape(kw) for kw in SAFETY_KEYWORDS),
    re.IGNORECASE,
)

SAFETY_BANNER = (
    "⚠️ **SAFETY WARNING** — The situation you described may involve "
    "an immediate safety hazard. **STOP work and ensure the area is safe "
    "before proceeding.** De-energize equipment, follow your facility's "
    "lockout/tagout procedure, and consult a qualified technician if you "
    "are unsure whether it is safe to continue."
)


def detect_safety(text: str) -> bool:
    """Return True if the text contains any safety trigger keyword."""
    return bool(_SAFETY_RE.search(text))
