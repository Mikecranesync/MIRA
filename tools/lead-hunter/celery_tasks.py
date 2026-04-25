"""Celery tasks for MIRA Lead Hunter — hourly discovery + enrichment.

Worker: plugs into mira-crawler's Celery app (broker=Redis).
Schedule: top of every hour via Celery Beat.

Start worker (from MIRA root):
    celery -A mira_crawler.celery_app worker -Q lead_hunter --loglevel=info

Register beat (add to mira-crawler/celeryconfig.py beat_schedule):
    from celery.schedules import crontab
    beat_schedule = {
        'lead-hunter-hourly': {
            'task': 'lead_hunter.discover_and_enrich',
            'schedule': crontab(minute=0),
            'options': {'queue': 'lead_hunter'},
        },
    }

Standalone run (no Celery):
    python3 tools/lead-hunter/run_hourly.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("lead-hunter.celery")

# ---------------------------------------------------------------------------
# State: rotate through cities each run
# ---------------------------------------------------------------------------

STATE_FILE = Path(__file__).parent / ".hourly_state.json"
RUNS_LOG = Path(__file__).parent.parent.parent / "marketing" / "prospects" / "hourly-runs.log"

DISCOVERY_RATE = {
    "max_facilities_per_run": 50,
    "max_enrichments_per_run": 20,
    "max_requests_per_run": 120,
    "daily_request_budget": 500,
}


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"city_index": 0, "requests_today": 0, "last_date": "", "total_discovered": 0}


def _save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def _check_daily_budget(state: dict) -> bool:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get("last_date") != today:
        state["requests_today"] = 0
        state["last_date"] = today
    return state["requests_today"] < DISCOVERY_RATE["daily_request_budget"]


# ---------------------------------------------------------------------------
# Core hourly task
# ---------------------------------------------------------------------------

def run_discover_and_enrich() -> dict:
    """Execute one hourly discovery + enrichment cycle. Returns run stats."""
    import httpx

    # Import here to allow running without Celery
    sys.path.insert(0, str(Path(__file__).parent))
    import hunt
    import discover
    import enrich

    state = _load_state()
    if not _check_daily_budget(state):
        log.info("Daily request budget exhausted — skipping this hour")
        return {"skipped": True, "reason": "daily_budget"}

    db_url = os.environ.get("NEON_DATABASE_URL", "")
    hunter_key = os.environ.get("HUNTER_API_KEY", "")
    hs_token = os.environ.get("HUBSPOT_ACCESS_TOKEN") or os.environ.get("HUBSPOT_API_KEY", "")

    # Apply schema if DB available
    if db_url:
        try:
            hunt.apply_schema(db_url)
        except Exception as e:
            log.warning("Schema apply (non-fatal): %s", e)

    # Pick city for this run (rotate)
    cities = hunt.CITIES
    city_idx = state.get("city_index", 0) % len(cities)
    city_name, city_lat, city_lon, city_dist = cities[city_idx]
    state["city_index"] = (city_idx + 1) % len(cities)

    log.info("=== HOURLY RUN — %s (%dmi) ===", city_name, city_dist)
    new_facilities: dict[str, hunt.Facility] = {}
    requests_used = 0

    # Phase 1a: MSCA directory (run every 24th hour, city_idx == 0)
    if city_idx == 0:
        log.info("Running MSCA directory scrape...")
        with httpx.Client(timeout=20) as client:
            msca_facs = discover.scrape_msca(client)
            requests_used += 1
            for f in msca_facs:
                if f.key not in new_facilities:
                    new_facilities[f.key] = f

    # Phase 1b: DuckDuckGo medium-biz queries for this city
    log.info("DDG medium-biz queries for %s...", city_name)
    ddg_fails = [0]
    with httpx.Client(timeout=20) as client:
        facs, _ = discover.search_ddg_medium(
            city_name, city_lat, city_lon, client,
            ddg_fails=ddg_fails,
        )
        requests_used += len(discover.MEDIUM_BIZ_QUERIES)
        for f in facs:
            if f.key not in new_facilities:
                new_facilities[f.key] = f

    # Phase 1c: Standard queries for this city (reuse existing search logic)
    if requests_used < DISCOVERY_RATE["max_requests_per_run"] and ddg_fails[0] < 5:
        log.info("Standard DDG queries for %s...", city_name)
        ddg_dead = False
        with httpx.Client(timeout=20) as client:
            for qt in hunt.QUERY_TEMPLATES:
                if ddg_fails[0] >= 5:
                    ddg_dead = True
                    break
                if requests_used >= DISCOVERY_RATE["max_requests_per_run"]:
                    break
                query = qt.format(city=city_name)
                results = discover._ddg_search(query, client)
                requests_used += 1
                if results is None:
                    ddg_fails[0] += 1
                    time.sleep(hunt.RATE_LIMIT_SECS)
                    continue
                ddg_fails[0] = 0
                new_facs = hunt.extract_facilities_from_results(results, city_name, city_lat, city_lon, query)
                for f in new_facs:
                    if f.key not in new_facilities:
                        new_facilities[f.key] = f
                time.sleep(hunt.RATE_LIMIT_SECS)

    # Cap to max_facilities_per_run
    fac_list = list(new_facilities.values())[:DISCOVERY_RATE["max_facilities_per_run"]]
    log.info("Discovered %d new facilities", len(fac_list))

    # Phase 2: Enrich top un-enriched facilities
    if db_url:
        enriched_count = _enrich_unenriched(db_url, hunter_key, DISCOVERY_RATE["max_enrichments_per_run"])
    else:
        enriched_count = 0

    # Persist to DB — retry on transient NeonDB errors (cold start, network blip)
    from hardening import with_retries

    inserted = 0
    if db_url and fac_list:
        try:
            inserted = with_retries(
                lambda: hunt.upsert_facilities(fac_list, db_url),
                name="upsert_facilities",
                retries=3,
                backoff=2.0,
            )
            log.info("DB: %d new, %d updated", inserted, len(fac_list) - inserted)
        except Exception as e:
            log.error("DB upsert failed after retries: %s", e)

    # HubSpot push — bounded retries on transient 5xx / network
    hs_pushed = 0
    hs_qualified = 0
    if hs_token and fac_list:
        qualified = [f for f in fac_list if f.icp_score >= 10]
        hs_qualified = len(qualified)
        if qualified:
            try:
                stats = with_retries(
                    lambda: hunt.push_to_hubspot(qualified, hs_token),
                    name="push_to_hubspot",
                    retries=2,
                    backoff=3.0,
                )
                hs_pushed = stats.get("companies_created", 0) + stats.get("companies_updated", 0)
            except Exception as e:
                log.error("HubSpot push failed after retries: %s", e)

    # Update state
    state["requests_today"] = state.get("requests_today", 0) + requests_used
    state["total_discovered"] = state.get("total_discovered", 0) + len(fac_list)
    _save_state(state)

    run_result = {
        "city": city_name,
        "discovered": len(fac_list),
        "inserted": inserted,
        "enriched": enriched_count,
        "hs_qualified": hs_qualified if hs_token and fac_list else 0,
        "hs_pushed": hs_pushed,
        "requests_used": requests_used,
        "requests_today": state["requests_today"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Append to log
    RUNS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(RUNS_LOG, "a") as fh:
        fh.write(json.dumps(run_result) + "\n")

    log.info("Run complete: %s", run_result)
    return run_result


def _enrich_unenriched(db_url: str, hunter_key: str, limit: int) -> int:
    """Enrich facilities that have a website but no contacts yet."""
    import psycopg2
    import httpx
    import hunt
    import enrich

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT f.id, f.name, f.city, f.website, f.phone, f.icp_score, f.notes
        FROM prospect_facilities f
        LEFT JOIN prospect_contacts c ON c.facility_id = f.id
        WHERE f.website IS NOT NULL AND f.website != ''
          AND c.id IS NULL
          AND f.icp_score >= 6
        ORDER BY f.icp_score DESC
        LIMIT %s
        """,
        (limit,),
    )
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return 0

    enriched = 0
    with httpx.Client(timeout=15) as client:
        for row in rows:
            fid, name, city, website, phone, icp_score, notes = row
            f = hunt.Facility(
                name=name, city=city, website=website or "",
                phone=phone or "", icp_score=icp_score or 0, notes=notes or "",
            )
            try:
                log.info("Enriching: %s (%s)", name[:50], (website or "")[:40])
                result = enrich.scrape_facility_deep(f, client)
                enrich.apply_enrichment(f, result, hunter_key, client)
                f.icp_score = hunt.score_facility(f)

                # Save enrichment back to DB
                conn2 = psycopg2.connect(db_url)
                cur2 = conn2.cursor()
                if f.phone:
                    cur2.execute(
                        "UPDATE prospect_facilities SET phone=%s, updated_at=NOW() WHERE id=%s",
                        (f.phone, fid),
                    )
                if "vfd_keywords_found" in f.notes:
                    cur2.execute(
                        "UPDATE prospect_facilities SET notes=%s, icp_score=%s, updated_at=NOW() WHERE id=%s",
                        (f.notes, f.icp_score, fid),
                    )
                if f.contacts:
                    for c in f.contacts:
                        cur2.execute(
                            """
                            INSERT INTO prospect_contacts (facility_id, name, title, email, phone, source, confidence)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT DO NOTHING
                            """,
                            (fid, c.get("name"), c.get("title"), c.get("email"),
                             c.get("phone"), c.get("source", "website"), c.get("confidence", "low")),
                        )
                conn2.commit()
                conn2.close()
                enriched += 1
            except Exception as e:
                log.debug("Enrich failed %s: %s", name, e)

    return enriched


# ---------------------------------------------------------------------------
# Celery task registration (optional — works without Celery too)
# ---------------------------------------------------------------------------

try:
    from celery import shared_task

    @shared_task(name="lead_hunter.discover_and_enrich", bind=True, max_retries=2)
    def discover_and_enrich(self):
        """Celery task: hourly lead discovery + enrichment."""
        try:
            return run_discover_and_enrich()
        except Exception as exc:
            log.error("Hourly task failed: %s", exc)
            raise self.retry(exc=exc, countdown=300)

except ImportError:
    # Celery not installed — task available only via run_hourly.py
    pass


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    result = run_discover_and_enrich()
    print(result)
