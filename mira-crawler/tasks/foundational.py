"""Foundational technician knowledge targets.

Content every maintenance tech needs regardless of their specific equipment:
- Industrial instrumentation fundamentals (Kuphaldt CC-BY)
- OSHA safety standards (public domain)
- Vibration analysis basics (SKF, Emerson)
- Bearing maintenance (SKF)
- Motor starting/sizing (ABB, Rockwell)
- Test equipment usage (Fluke)
- Maintenance best practices (ReliabilityWeb, PlantServices)
- VFD theory + troubleshooting (ABB, Rockwell, AutomationDirect)

Scheduled monthly via Celery Beat. Safe to re-run — dedup prevents duplicate chunks.
"""

from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.foundational")

# ---------------------------------------------------------------------------
# Direct PDF/HTML targets (no Apify needed — known stable URLs)
# ---------------------------------------------------------------------------

DIRECT_TARGETS = [
    # ── TIER 1: Foundational textbooks (CC-BY) ──────────────────────
    {
        "name": "kuphaldt_liii",
        "url": "https://ibiblio.org/kuphaldt/socratic/sinst/book/liii_2v32.pdf",
        "source_type": "curriculum",
        "manufacturer": "",
        "description": "Lessons In Industrial Instrumentation v2.32 (~1800 pages)",
    },
    # ── TIER 2: Government / Public Domain ──────────────────────────
    {
        "name": "osha_loto",
        "url": "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147",
        "source_type": "standard",
        "manufacturer": "",
        "description": "OSHA Lockout/Tagout (LOTO) standard",
    },
    {
        "name": "osha_machine_guarding",
        "url": "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.212",
        "source_type": "standard",
        "manufacturer": "",
        "description": "OSHA Machine Guarding standard",
    },
    {
        "name": "osha_electrical",
        "url": "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.303",
        "source_type": "standard",
        "manufacturer": "",
        "description": "OSHA Electrical — General Requirements",
    },
    {
        "name": "osha_etool_electrical",
        "url": "https://www.osha.gov/etools/electrical-contractors",
        "source_type": "standard",
        "manufacturer": "",
        "description": "OSHA eTool — Electrical Safety",
    },
    # ── TIER 5: Technical reference PDFs ────────────────────────────
    {
        "name": "abb_motor_nameplate",
        "url": "https://library.e.abb.com/public/3273bae2fc1e49f080b9bc1f8e242ebb/9AKK108388.pdf",
        "source_type": "reference",
        "manufacturer": "ABB",
        "description": "How to Read a NEMA Motor Nameplate",
    },
    {
        "name": "skf_vibration_guide",
        "url": "https://forums.ni.com/attachments/ni/170/107329/1/CM5003%20Vibration%20Guide1.pdf",
        "source_type": "reference",
        "manufacturer": "SKF",
        "description": "SKF CM5003 Vibration Diagnostic Guide",
    },
    {
        "name": "abb_softstarter_handbook",
        "url": "https://library.e.abb.com/public/6b4e1a3530814df0c12579bb0030e58b/1SFC132060M0201.pdf",
        "source_type": "reference",
        "manufacturer": "ABB",
        "description": "Softstarter Handbook — starting methods, torque/current",
    },
    {
        "name": "rockwell_wye_delta",
        "url": "https://literature.rockwellautomation.com/idc/groups/literature/documents/at/150-at005_-en-p.pdf",
        "source_type": "reference",
        "manufacturer": "Rockwell",
        "description": "Wye-Delta and Solid-State Starters application guide",
    },
    {
        "name": "abb_motor_starting_solutions",
        "url": "https://library.e.abb.com/public/86d98d43ec394d63841658bf28be428c/1SFC100125C0346_en_A_Solution%20Guide_%20Motor%20Starting%20Solutions.pdf",
        "source_type": "reference",
        "manufacturer": "ABB",
        "description": "Motor Starting Solutions — DOL, star-delta, soft starter, VFD",
    },
    {
        "name": "abb_vfd_inrush_current",
        "url": "https://library.e.abb.com/public/71d5526a71b34360bb3a258c950acb8a/LVD-EOTN151U-EN_VFDs_And_Maximum-Inrush-Current.pdf",
        "source_type": "reference",
        "manufacturer": "ABB",
        "description": "VFDs and Maximum Inrush Current technical note",
    },
    {
        "name": "skf_bearing_motor_handbook",
        "url": "https://cdn.skfmediahub.skf.com/api/public/0901d19680056c36/pdf_preview_medium/0901d19680056c36_pdf_preview_medium.pdf",
        "source_type": "reference",
        "manufacturer": "SKF",
        "description": "SKF Bearing Handbook for Electric Motors",
    },
]

# ---------------------------------------------------------------------------
# Apify crawl targets (article portals, knowledge bases)
# ---------------------------------------------------------------------------

APIFY_TARGETS = [
    {
        "name": "reliability_web",
        "start_url": "https://reliabilityweb.com/articles",
        "crawler_type": "cheerio",
        "max_pages": 500,
        "source_type": "knowledge_article",
        "manufacturer": "",
        "description": "Maintenance best practices, RCM, predictive maintenance",
    },
    {
        "name": "plant_services",
        "start_url": "https://www.plantservices.com/articles",
        "crawler_type": "cheerio",
        "max_pages": 300,
        "source_type": "knowledge_article",
        "manufacturer": "",
        "description": "Plant maintenance strategy, operations, reliability",
    },
    {
        "name": "maintenance_phoenix",
        "start_url": "https://maintenancephoenix.com/blog",
        "crawler_type": "cheerio",
        "max_pages": 200,
        "source_type": "knowledge_article",
        "manufacturer": "",
        "description": "CMMS best practices, maintenance management",
    },
    {
        "name": "skf_knowledge_centre",
        "start_url": "https://www.skf.com/group/knowledge-centre",
        "crawler_type": "playwright",
        "max_pages": 300,
        "source_type": "reference",
        "manufacturer": "SKF",
        "description": "Bearing selection, lubrication, vibration, condition monitoring",
    },
    {
        "name": "fluke_application_notes",
        "start_url": "https://www.fluke.com/en-us/learn/blog",
        "crawler_type": "cheerio",
        "max_pages": 200,
        "source_type": "knowledge_article",
        "manufacturer": "Fluke",
        "description": "Multimeter usage, thermal imaging, power quality",
    },
    {
        "name": "emerson_reliability",
        "start_url": "https://www.emerson.com/en-us/automation/measurement-instrumentation",
        "crawler_type": "playwright",
        "max_pages": 200,
        "source_type": "reference",
        "manufacturer": "Emerson",
        "description": "Vibration analysis, machinery health, condition monitoring",
    },
]


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


@app.task
def ingest_foundational_kb():
    """Master task: queue all foundational KB sources for ingest.

    Direct targets are queued as ingest_url tasks immediately.
    Apify targets are queued as discover_and_ingest tasks (crawl → ingest).
    Safe to re-run — dedup prevents duplicate chunks.
    """
    try:
        from mira_crawler.tasks.discover import discover_manufacturer
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.discover import discover_manufacturer
        from tasks.ingest import ingest_url

    queued_direct = 0
    queued_apify = 0

    # Direct PDFs and HTML pages
    for target in DIRECT_TARGETS:
        ingest_url.delay(
            url=target["url"],
            manufacturer=target.get("manufacturer", ""),
            model="",
            source_type=target["source_type"],
        )
        queued_direct += 1

    # Apify crawl targets
    for target in APIFY_TARGETS:
        discover_manufacturer.delay(
            manufacturer=target.get("manufacturer", target["name"]),
            start_url=target["start_url"],
            crawler_type=target["crawler_type"],
            max_pages=target["max_pages"],
        )
        queued_apify += 1

    logger.info(
        "Foundational KB ingest queued: %d direct + %d Apify targets",
        queued_direct, queued_apify,
    )
    return {
        "direct_queued": queued_direct,
        "apify_queued": queued_apify,
        "total_targets": len(DIRECT_TARGETS) + len(APIFY_TARGETS),
    }
