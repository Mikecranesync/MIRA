"""Deterministic, rule-based signal categorization (NO LLM) for the asset compiler's review report.

Maps a signal NAME (+ optional description) to ISA-style categories via pure name patterns -- the
same camelCase/underscore/`e_stop`-aware boundary matcher the analysis layer uses (`analyze._kw`),
so `MotorRun`, `motor_run`, and `e_stop_active` all classify. Categories are auditable and stable:
the rule that fired is just a keyword set. Safety / fault / command signals gate human review.
"""
from __future__ import annotations

from .analyze import _kw

# (category, name/description keyword pattern). A signal may match several categories.
_CATEGORY_PATS = [
    ("safety", _kw(["e[_ -]?stop", "emergency", "guard", "interlock", "lockout", "loto", "safety"])),
    ("fault", _kw(["fault", "alarm", "trip", "fail", "err", "error", "overload", "jam"])),
    ("motion", _kw(["run", "running", "motor", "conveyor", "conv", "jog"])),
    ("temperature", _kw(["temp", "temperature"])),
    ("pressure", _kw(["pressure", "psi"])),
    ("speed", _kw(["speed", "rpm", "freq", "frequency", "hz"])),
    ("torque", _kw(["torque"])),
    ("current", _kw(["current", "amp", "amps", "iout"])),
    ("voltage", _kw(["voltage", "volt", "vdc", "bus"])),
    ("sensor", _kw(["photoeye", "sensor", "prox", "limit", "switch"])),
    ("command", _kw(["command", "cmd", "enable", "permit", "setpoint"])),
]

# categories that require a human to sign off before the asset agent is trusted.
REVIEW_CATEGORIES = {"safety", "fault", "command"}


def categorize(name: str, description: str = "") -> list[str]:
    """Sorted list of categories matching a signal's name (+ description). Empty if none match."""
    hay = (name or "") + " " + (description or "")
    return sorted({cat for cat, pat in _CATEGORY_PATS if pat.search(hay)})


def needs_review(categories) -> bool:
    return bool(set(categories) & REVIEW_CATEGORIES)
