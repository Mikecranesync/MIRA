"""NeonDB helpers for the MIRA Lead Hunter."""
from __future__ import annotations

import logging
import os

import psycopg2
import psycopg2.extras

logger = logging.getLogger("lead-hunter.db")


def get_conn():
    url = os.environ["NEON_DATABASE_URL"]
    return psycopg2.connect(url, sslmode="require")


def upsert_facility(conn, facility: dict) -> str | None:
    """Insert or update a facility row. Returns UUID string or None."""
    sql = """
        INSERT INTO prospect_facilities
            (name, address, city, state, zip, phone, website, google_maps_url,
             category, rating, review_count, distance_miles, notes)
        VALUES
            (%(name)s, %(address)s, %(city)s, %(state)s, %(zip)s, %(phone)s,
             %(website)s, %(google_maps_url)s, %(category)s, %(rating)s,
             %(review_count)s, %(distance_miles)s, %(notes)s)
        ON CONFLICT (name, address) DO UPDATE SET
            phone           = COALESCE(EXCLUDED.phone, prospect_facilities.phone),
            website         = COALESCE(EXCLUDED.website, prospect_facilities.website),
            google_maps_url = COALESCE(EXCLUDED.google_maps_url, prospect_facilities.google_maps_url),
            rating          = COALESCE(EXCLUDED.rating, prospect_facilities.rating),
            review_count    = COALESCE(EXCLUDED.review_count, prospect_facilities.review_count),
            updated_at      = NOW()
        RETURNING id
    """
    defaults = {
        "name": "", "address": None, "city": None, "state": "FL", "zip": None,
        "phone": None, "website": None, "google_maps_url": None,
        "category": None, "rating": None, "review_count": None,
        "distance_miles": None, "notes": None,
    }
    row = {**defaults, **facility}
    with conn.cursor() as cur:
        cur.execute(sql, row)
        result = cur.fetchone()
        conn.commit()
        return str(result[0]) if result else None


def upsert_contact(conn, contact: dict) -> str | None:
    sql = """
        INSERT INTO prospect_contacts
            (facility_id, name, title, email, phone, linkedin_url, source, confidence)
        VALUES
            (%(facility_id)s, %(name)s, %(title)s, %(email)s, %(phone)s,
             %(linkedin_url)s, %(source)s, %(confidence)s)
        ON CONFLICT (facility_id, email) DO NOTHING
        RETURNING id
    """
    defaults = {
        "facility_id": None, "name": None, "title": None, "email": None,
        "phone": None, "linkedin_url": None, "source": "website", "confidence": "low",
    }
    row = {**defaults, **contact}
    with conn.cursor() as cur:
        cur.execute(sql, row)
        result = cur.fetchone()
        conn.commit()
        return str(result[0]) if result else None


def get_facilities_by_status(conn, status: str, limit: int = 500) -> list[dict]:
    sql = """
        SELECT id, name, address, city, zip, phone, website, category,
               rating, review_count, distance_miles, icp_score, status, notes
        FROM prospect_facilities
        WHERE status = %s
        ORDER BY icp_score DESC, review_count DESC NULLS LAST
        LIMIT %s
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (status, limit))
        return [dict(r) for r in cur.fetchall()]


def set_facility_status(conn, facility_id: str, status: str, enriched: bool = False):
    sql = """
        UPDATE prospect_facilities
        SET status = %s, updated_at = NOW()
            {extra}
        WHERE id = %s
    """.format(extra=", enriched_at = NOW()" if enriched else "")
    with conn.cursor() as cur:
        cur.execute(sql, (status, facility_id))
        conn.commit()


def update_icp_score(conn, facility_id: str, score: int, notes: str | None = None):
    sql = """
        UPDATE prospect_facilities
        SET icp_score = %s, updated_at = NOW()
            {extra}
        WHERE id = %s
    """.format(extra=", notes = %s" if notes else "")
    params = (score, notes, facility_id) if notes else (score, facility_id)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        conn.commit()


def get_top_prospects(conn, limit: int = 50) -> list[dict]:
    sql = """
        SELECT f.id, f.name, f.address, f.city, f.zip, f.phone, f.website,
               f.category, f.rating, f.review_count, f.distance_miles,
               f.icp_score, f.employee_estimate, f.notes,
               COUNT(c.id) AS contact_count
        FROM prospect_facilities f
        LEFT JOIN prospect_contacts c ON c.facility_id = f.id
        WHERE f.status != 'disqualified'
        GROUP BY f.id
        ORDER BY f.icp_score DESC, f.review_count DESC NULLS LAST
        LIMIT %s
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (limit,))
        return [dict(r) for r in cur.fetchall()]


def get_contacts_for_facility(conn, facility_id: str) -> list[dict]:
    sql = """
        SELECT name, title, email, phone, linkedin_url, source, confidence
        FROM prospect_contacts
        WHERE facility_id = %s
        ORDER BY confidence DESC
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (facility_id,))
        return [dict(r) for r in cur.fetchall()]


def count_facilities(conn) -> dict:
    sql = "SELECT status, COUNT(*) FROM prospect_facilities GROUP BY status"
    with conn.cursor() as cur:
        cur.execute(sql)
        return {row[0]: row[1] for row in cur.fetchall()}
