"""Seed the MIRA knowledge base with the 80% reference corpus.

Fires scrape-trigger jobs for the 9 reference sources that cover ~80% of
industrial maintenance tech questions. All sources are free OEM downloads
or open-source materials (CC BY / Public Domain).

Usage:
    doppler run --project factorylm --config prd -- python3 tools/seed_80pct_kb.py
    doppler run --project factorylm --config prd -- python3 tools/seed_80pct_kb.py --dry-run
    doppler run --project factorylm --config prd -- python3 tools/seed_80pct_kb.py --vendor yaskawa

The script posts to POST /ingest/scrape-trigger on the mira-ingest service.
By default it targets the VPS address via MIRA_SERVER_BASE_URL. Override with
MIRA_INGEST_URL for local testing.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed-80pct")

# 80% reference corpus — ordered by coverage priority
SOURCES = [
    {
        "vendor": "yaskawa",
        "equipment_id": "Yaskawa A1000 CIMR-AU",
        "manufacturer": "Yaskawa",
        "model": "A1000 CIMR-AU",
        "context": "Full technical manual SIEP C710600 13A — fault codes F01 OC, F02 OV, F04 UV, A-series alarms, parameters A1-E7, thermal protection oH, encoder PG",
        "coverage": "~25% of VFD market",
    },
    {
        "vendor": "siemens",
        "equipment_id": "Siemens SINAMICS G120",
        "manufacturer": "Siemens",
        "model": "SINAMICS G120",
        "context": "Operating instructions 6SL3097-4AP00-0BP6 — fault codes F0001-F0395, overcurrent, phase loss, DC bus faults, parameters P0304-P0311, STO safety",
        "coverage": "~20% of industrial market",
    },
    {
        "vendor": "abb",
        "equipment_id": "ABB ACS580",
        "manufacturer": "ABB",
        "model": "ACS580",
        "context": "Firmware manual 3AUA0000062711 Rev E — fault codes 2xxx series (2310=overcurrent), parameter groups 01-99, thermal model, motor speed controller tuning",
        "coverage": "~15% of industrial VFD market",
    },
    {
        "vendor": "mitsubishi",
        "equipment_id": "Mitsubishi FR-E700",
        "manufacturer": "Mitsubishi",
        "model": "FR-E700",
        "context": "Instruction manual IB-0600162 — fault codes OC1-OC3, OV1-OV3, IPF (instantaneous power failure), THT (thermal), parameters Pr.0-Pr.999",
        "coverage": "~10% of VFD market, strong in food/packaging",
    },
    {
        "vendor": "sew",
        "equipment_id": "SEW MOVITRAC LTE-B",
        "manufacturer": "SEW",
        "model": "MOVITRAC LTE-B",
        "context": "Operating instructions doc 26428543 — alarm codes A1.x-A7.x, parameters P1xx-P8xx, motor protection, brake control",
        "coverage": "~8% market, dominant in EU food/pharma",
    },
    {
        "vendor": "yaskawa",
        "equipment_id": "Yaskawa GA700",
        "manufacturer": "Yaskawa",
        "model": "GA700",
        "context": "Technical manual for GA700/GA500 series — advanced fault diagnosis, encoder feedback, closed-loop vector control",
        "coverage": "Complements A1000 — covers newer GA series",
    },
    {
        "vendor": "siemens",
        "equipment_id": "Siemens 3RU2 Thermal Overload Relay",
        "manufacturer": "Siemens",
        "model": "3RU2",
        "context": "Thermal overload relay manual — trip thresholds, reset procedures, Class 10/20, thermal class, current dial settings",
        "coverage": "Backs thermal trip/reset questions across all equipment types",
    },
    {
        "vendor": "kuphaldt",
        "equipment_id": "Kuphaldt Lessons in Industrial Instrumentation",
        "manufacturer": "Kuphaldt",
        "model": "Lessons in Industrial Instrumentation",
        "context": "CC BY 4.0 open textbook ibiblio.org/kuphaldt/electricianscience — 3-phase power, motor FLA, thermal class, nameplate reading, VFD fundamentals. Foundation for all VFD fault interpretation.",
        "coverage": "Foundational electrical theory — backs all vendor-specific answers",
    },
    {
        "vendor": "osha",
        "equipment_id": "OSHA 1910.147 Lockout Tagout",
        "manufacturer": "OSHA",
        "model": "1910.147",
        "context": "Public domain OSHA standard — lockout/tagout procedures, de-energization, arc flash boundaries, PPE requirements. Backs every safety escalation response.",
        "coverage": "Safety escalation — 4% of questions, 100% of STOP responses",
    },
]


def _ingest_url(base: str) -> str:
    return base.rstrip("/") + "/ingest/scrape-trigger"


def _fire(ingest_url: str, source: dict, tenant_id: str, dry_run: bool) -> dict:
    payload = {
        "equipment_id": source["equipment_id"],
        "manufacturer": source["manufacturer"],
        "model": source["model"],
        "tenant_id": tenant_id,
        "context": source["context"],
    }
    if dry_run:
        logger.info("[DRY-RUN] Would POST %s", source["equipment_id"])
        return {"status": "dry-run", "vendor": source["vendor"]}

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(ingest_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            logger.info(
                "Queued: %-45s → job_id=%s",
                source["equipment_id"][:45],
                data.get("job_id", "?"),
            )
            return data
    except httpx.HTTPStatusError as e:
        logger.error("HTTP %d for %s: %s", e.response.status_code, source["equipment_id"], e.response.text[:200])
        return {"status": "error", "vendor": source["vendor"]}
    except Exception as e:
        logger.error("Failed to queue %s: %s", source["equipment_id"], e)
        return {"status": "error", "vendor": source["vendor"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed MIRA 80% reference KB")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without firing")
    parser.add_argument("--vendor", help="Only fire jobs for this vendor (e.g. yaskawa)")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between requests (default 2)")
    args = parser.parse_args()

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    if not tenant_id and not args.dry_run:
        logger.error("MIRA_TENANT_ID not set — run with doppler or set manually")
        sys.exit(1)

    # Prefer explicit override, then VPS base URL, then localhost
    server_base = os.getenv("MIRA_SERVER_BASE_URL", "").rstrip("/")
    base_url = (
        os.getenv("MIRA_INGEST_URL")
        or (f"{server_base}:8002" if server_base.startswith("http") else "")
        or "http://localhost:8002"
    )
    ingest_url = _ingest_url(base_url)

    sources = SOURCES
    if args.vendor:
        sources = [s for s in SOURCES if s["vendor"].lower() == args.vendor.lower()]
        if not sources:
            logger.error("No sources found for vendor %r", args.vendor)
            sys.exit(1)

    logger.info("Firing %d scrape jobs → %s", len(sources), ingest_url if not args.dry_run else "DRY-RUN")
    logger.info("")

    results = []
    for i, source in enumerate(sources):
        logger.info("[%d/%d] %s — %s", i + 1, len(sources), source["equipment_id"], source["coverage"])
        result = _fire(ingest_url, source, tenant_id, args.dry_run)
        results.append(result)
        if i < len(sources) - 1:
            time.sleep(args.delay)

    queued = sum(1 for r in results if r.get("status") not in ("error",))
    errors = sum(1 for r in results if r.get("status") == "error")
    logger.info("")
    logger.info("Done: %d queued, %d errors", queued, errors)
    logger.info("Jobs run in background — check mira-ingest logs or crawl-verifications endpoint")
    logger.info("  docker compose logs -f mira-ingest")
    logger.info("  curl %s/ingest/crawl-verifications | python3 -m json.tool", base_url)


if __name__ == "__main__":
    main()
