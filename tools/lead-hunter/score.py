"""
Layer 3 — ICP scoring engine.
Max possible score = 24. Scores all facilities in DB.
"""
from __future__ import annotations

import logging

import psycopg2.extras

from db import get_conn, update_icp_score

logger = logging.getLogger("lead-hunter.score")

MANUFACTURING_KEYWORDS = [
    "manufactur", "fabricat", "machining", "machine shop", "assembly",
    "production", "processing", "industrial", "plant", "bottling",
    "packaging", "stamping", "casting", "welding", "plastics",
    "chemical", "concrete", "lumber", "food process", "beverage",
    "pharmaceutical", "printing", "cnc", "metal work",
]

FOOD_BEV_CHEM_KEYWORDS = [
    "food", "beverage", "drink", "dairy", "meat", "poultry", "seafood",
    "citrus", "juice", "brew", "chemical", "pharmaceutical", "fertilizer",
    "agricultural", "agri", "packag",
]

VFD_KEYWORDS = [
    "vfd", "variable frequency", "variable speed", "inverter drive",
    "plc", "scada", "hmi", "automation", "conveyor", "pump system",
    "motor control", "servo", "robotics", "allen-bradley", "siemens",
    "rockwell", "schneider electric",
]

CMMS_KEYWORDS = [
    "upkeep", "limble", "fiix", "maximo", "cmms", "mpulse",
    "maintenance software", "work order system", "preventive maintenance",
]


def _has(text: str | None, keywords: list[str]) -> bool:
    if not text:
        return False
    t = text.lower()
    return any(kw in t for kw in keywords)


def score_facility(row: dict) -> tuple[int, list[str]]:
    """Return (score, reasons) for a single facility row."""
    score = 0
    reasons = []

    cat = (row.get("category") or "").lower()
    notes = (row.get("notes") or "").lower()
    combined = f"{cat} {notes}"

    if row.get("website"):
        score += 1
        reasons.append("has_website")

    if row.get("phone"):
        score += 1
        reasons.append("has_phone")

    if _has(combined, MANUFACTURING_KEYWORDS):
        score += 3
        reasons.append("manufacturing_category")

    if _has(combined, FOOD_BEV_CHEM_KEYWORDS):
        score += 3
        reasons.append("food_bev_chemical")

    emp = (row.get("employee_estimate") or "").lower()
    if any(x in emp for x in ["51-200", "201-500", "501+", "500+", "100+", "200+"]):
        score += 3
        reasons.append("employee_50_plus")
    elif any(x in emp for x in ["11-50", "50+"]):
        score += 1
        reasons.append("small_team")

    if _has(notes, VFD_KEYWORDS):
        score += 5
        reasons.append("uses_vfds_motors_plcs")

    pain_match = [p for p in notes.split("|") if "pain_signals:" in p]
    if pain_match:
        try:
            pain_count = int(pain_match[0].split(":")[1].strip())
            if pain_count >= 5:
                score += 4
                reasons.append("high_pain_signal")
            elif pain_count >= 2:
                score += 2
                reasons.append("some_pain_signal")
        except (ValueError, IndexError):
            pass

    dist = row.get("distance_miles")
    if dist is not None:
        if dist <= 60:
            score += 2
            reasons.append("within_1hr_drive")
        elif dist <= 120:
            score += 1
            reasons.append("within_2hr_drive")

    if _has(notes, CMMS_KEYWORDS):
        score += 1
        reasons.append("has_cmms_mentioned")

    reviews = row.get("review_count") or 0
    if reviews >= 20:
        score += 1
        reasons.append("high_review_count")

    return score, reasons


def score_all() -> dict:
    """Score every facility in the DB. Returns stats."""
    conn = get_conn()

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, website, phone, category, employee_estimate,
                   notes, distance_miles, review_count
            FROM prospect_facilities
            WHERE status != 'disqualified'
        """)
        rows = [dict(r) for r in cur.fetchall()]

    logger.info("Scoring %d facilities", len(rows))
    score_dist: dict[str, int] = {}

    for row in rows:
        fid = str(row["id"])
        score, reasons = score_facility(row)
        reason_str = ", ".join(reasons)
        update_icp_score(conn, fid, score, notes=reason_str if reasons else None)
        bucket = f"{(score // 5) * 5}+"
        score_dist[bucket] = score_dist.get(bucket, 0) + 1

    conn.close()
    return {"scored": len(rows), "distribution": score_dist}
