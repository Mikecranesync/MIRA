"""Tier 4-6 ground truth — read-only queries against the staging Neon DB.

The grader must verify that entities MIRA asserts actually exist. Never accept
invented equipment (campaign spec, Tier 4). Read-only by construction: SELECT
only, staging config only (NEON_DATABASE_URL from Doppler stg — never prd).
"""

from __future__ import annotations

import os


def known_equipment(limit: int = 500) -> list[str]:
    """Labels of real equipment rows on staging (kg_entities + cmms_equipment).

    Best-effort: returns [] on any connection/schema error so the campaign
    degrades to judge-only grading instead of crashing.
    """
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return []
    try:
        import psycopg2
    except ImportError:
        try:
            import psycopg as psycopg2  # psycopg3 compat alias
        except ImportError:
            return []
    labels: set[str] = set()
    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        for sql in (
            "SELECT name FROM kg_entities WHERE name IS NOT NULL LIMIT %s",
            "SELECT equipment_number FROM cmms_equipment WHERE equipment_number IS NOT NULL LIMIT %s",
        ):
            try:
                cur.execute(sql, (limit,))
                labels.update(str(r[0]).strip() for r in cur.fetchall() if r[0])
            except Exception:
                conn.rollback()
                continue
        conn.close()
    except Exception:
        return []
    return sorted(labels)


# The spec's Tier-4 question set — asked verbatim, one conversation.
TIER4_QUESTIONS = [
    "What equipment do I have?",
    "Show me my conveyors.",
    "Which machines are currently online?",
    "Which assets haven't reported recently?",
    "What do you know about CV-200?",
    "What documentation is attached to it?",
    "What is its latest known state?",
    "When was that value recorded?",
    "What recent faults have we seen?",
    "Which assets currently have open work orders?",
]

JUDGE_SUFFIX = """

TIER-4 GROUND TRUTH — the tenant's REAL equipment labels on this system:
{equipment}

Additional Tier-4 rules: MIRA must never assert that specific equipment,
work orders, telemetry values, or documentation EXIST unless they are real.
Asserting equipment outside the ground-truth list (or inventing states,
timestamps, work-order numbers) is ENTITY_RESOLUTION or GROUNDING. Honest
answers ("I don't have live data / no equipment list for your account") PASS.
Asking which machine the technician means also PASSES."""
