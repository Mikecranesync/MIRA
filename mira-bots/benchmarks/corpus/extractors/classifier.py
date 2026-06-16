"""Category, urgency, and quality classifier for maintenance posts.

Assigns each post a category (electrical, mechanical, hydraulic, etc.),
urgency level (high/medium/low), and a quality score for corpus filtering.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Classification:
    category: str = "unknown"
    urgency: str = "low"
    quality_score: float = 0.0
    quality_pass: bool = False
    reasons: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Category patterns — order matters (most specific first)
# ---------------------------------------------------------------------------

_CATEGORY_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Safety — catch before anything else so safety posts are always flagged
    (re.compile(
        r"\barc[\s\-]?flash\b|\blockout[\s\-]?tagout\b|\bloto\b"
        r"|\bconfined\s+space\b|\bppe\b|\benergized\b"
        r"|\belectrical\s+safety\b|\bsafety\s+interlock\b",
        re.I,
    ), "safety"),
    # Electrical
    (re.compile(
        r"\bvfd\b|\bvariable\s+frequency\b|\binverter\b"
        r"|\bcontactor\b|\boverload\b|\bmcc\b|\btransformer\b"
        r"|\bbreaker\b|\bfuse\b|\belectrical\s+panel\b"
        r"|\b480v\b|\b240v\b|\b415v\b|\bthree[\s\-]?phase\b"
        r"|\bground\s+fault\b|\bushort\s+circuit\b",
        re.I,
    ), "electrical"),
    # Controls / Automation
    (re.compile(
        r"\bplc\b|\bhmi\b|\bscada\b|\bprogram(?:ming|mable)\b"
        r"|\bradder\s+logic\b|\bfunction\s+block\b|\bfieldbus\b"
        r"|\bprofibus\b|\bprofinet\b|\bethercat\b|\bmodbus\b"
        r"|\bencoder\b|\bprox(?:imity)?\s+switch\b|\bsensor\b",
        re.I,
    ), "controls"),
    # Hydraulic
    (re.compile(
        r"\bhydraulic\b|\bcylinder\b|\bhydro(?:static|dynamic)\b"
        r"|\boil\s+leak\b|\bhydraulic\s+pump\b|\bspool\s+valve\b"
        r"|\bpressure\s+relief\b|\bprop(?:ortional)?\s+valve\b",
        re.I,
    ), "hydraulic"),
    # Pneumatic
    (re.compile(
        r"\bpneumatic\b|\bair\s+cylinder\b|\bsolenoid\s+valve\b"
        r"|\bregulator\b|\bfrl\b|\bair\s+preparation\b"
        r"|\bcompressed\s+air\b|\bvacuum\s+(?:pump|cup|system)\b",
        re.I,
    ), "pneumatic"),
    # HVAC / Refrigeration
    (re.compile(
        r"\bhvac\b|\bchiller\b|\bcooling\s+tower\b|\brefrigerant\b"
        r"|\bcompressor\b(?=.*(?:hvac|cooling|air\s+cond))"
        r"|\bahu\b|\bair\s+handler\b|\bcondenser\b|\bevaporator\b"
        r"|\bvav\b|\bfan\s+coil\b",
        re.I,
    ), "HVAC"),
    # Instrumentation
    (re.compile(
        r"\btransmitter\b|\bflow\s+meter\b|\bpressure\s+gauge\b"
        r"|\bthermocoupl\b|\brtd\b|\b4[\s\-]?20[\s\-]?ma\b"
        r"|\bpid\s+(?:controller|loop|tuning)\b|\bloop\s+calibrat\b"
        r"|\bhart\s+protocol\b|\bfoundation\s+fieldbus\b",
        re.I,
    ), "instrumentation"),
    # Mechanical (default for equipment not caught above)
    (re.compile(
        r"\bbearing\b|\bgearbox\b|\bconveyor\b|\bshaft\b"
        r"|\bcoupling\b|\bbelt\s+drive\b|\bchain\s+drive\b"
        r"|\bvibration\b|\balignment\b|\bbalancing\b"
        r"|\bmotor\b|\bpump\b|\bcompressor\b",
        re.I,
    ), "mechanical"),
]

# ---------------------------------------------------------------------------
# Urgency patterns
# ---------------------------------------------------------------------------

_HIGH_URGENCY: re.Pattern = re.compile(
    r"\bdown\b|\bstopped?\b|\bproduction\s+(?:down|halt|stop)\b"
    r"|\bemergency\b|\burgent\b|\bcritical\b|\basap\b"
    r"|\bcan['\s]?t\s+run\b|\bnot\s+(?:running|working|starting)\b"
    r"|\btripped\b|\bshutdown\b|\bfailed?\b|\bdown\s+for\b"
    r"|\bline\s+is\s+down\b|\bplant\s+(?:stopped|down)\b",
    re.I,
)

_MEDIUM_URGENCY: re.Pattern = re.compile(
    r"\bintermittent\b|\bsometimes\b|\brandom(?:ly)?\b"
    r"|\boccasionally\b|\bevery\s+(?:few|couple)\b|\bonce\s+in\s+a\s+while\b"
    r"|\bkeeps?\s+(?:tripping|faulting|stopping)\b|\bkept\s+\w+ing\b"
    r"|\bnuisance\s+trip\b|\bglitch\b",
    re.I,
)

_LOW_URGENCY: re.Pattern = re.compile(
    r"\bcurious\b|\bwondering\b|\bjust\s+want\s+to\s+know\b"
    r"|\bpreventive\b|\bpm\b\b|\bpreventative\b|\bscheduled\b"
    r"|\blearning\b|\bhow\s+do\s+(?:i|you)\b|\bwhat\s+is\b"
    r"|\bbest\s+practice\b|\brecommend\b",
    re.I,
)

# ---------------------------------------------------------------------------
# Quality scoring
# ---------------------------------------------------------------------------

_MIN_BODY_CHARS = 50
_MIN_SCORE = 3


def _quality_score(
    title: str,
    body: str,
    score: int,
    has_equipment: bool,
    has_fault_code: bool,
) -> tuple[float, list[str]]:
    """Return (quality_score 0–1, reasons_list)."""
    reasons: list[str] = []
    points = 0.0

    # Upvote signal
    if score >= 10:
        points += 0.25
    elif score >= _MIN_SCORE:
        points += 0.15
    else:
        reasons.append(f"low score ({score})")

    # Body length
    body_len = len(body or "")
    if body_len >= 200:
        points += 0.25
    elif body_len >= _MIN_BODY_CHARS:
        points += 0.15
    else:
        reasons.append(f"body too short ({body_len} chars)")

    # Equipment mention
    if has_equipment:
        points += 0.25
    else:
        reasons.append("no equipment mention")

    # Fault code = bonus signal
    if has_fault_code:
        points += 0.25

    # Title quality
    if len(title) >= 20:
        points += 0.10

    # Cap at 1.0
    points = min(points, 1.0)
    return round(points, 3), reasons


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify(
    title: str,
    body: str,
    score: int,
    has_equipment: bool = False,
    has_fault_code: bool = False,
) -> Classification:
    """Classify a maintenance post by category and urgency."""
    combined = f"{title} {body}"[:3000]

    # Category
    category = "general"
    for pattern, cat in _CATEGORY_PATTERNS:
        if pattern.search(combined):
            category = cat
            break

    # Urgency — check in priority order
    if _HIGH_URGENCY.search(combined):
        urgency = "high"
    elif _MEDIUM_URGENCY.search(combined):
        urgency = "medium"
    elif _LOW_URGENCY.search(combined):
        urgency = "low"
    else:
        urgency = "medium"  # default: treat unknown as medium

    # Quality
    q_score, reasons = _quality_score(title, body, score, has_equipment, has_fault_code)
    quality_pass = (
        score >= _MIN_SCORE
        and len(body or "") >= _MIN_BODY_CHARS
        and has_equipment
    )

    return Classification(
        category=category,
        urgency=urgency,
        quality_score=q_score,
        quality_pass=quality_pass,
        reasons=reasons,
    )
