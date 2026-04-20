"""
Layer 2 — Enrich facilities via Firecrawl website scraping.
Extracts emails, contact names, maintenance/engineering signals.
"""
from __future__ import annotations

import logging
import os
import re
import time

import httpx

from db import get_conn, get_facilities_by_status, set_facility_status, upsert_contact

logger = logging.getLogger("lead-hunter.enrich")

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")

MAINTENANCE_TITLES = [
    "maintenance manager", "maintenance director", "maintenance supervisor",
    "plant manager", "operations manager", "facilities manager",
    "reliability engineer", "maintenance engineer", "electrical engineer",
    "controls engineer", "automation engineer", "industrial engineer",
    "chief engineer", "plant engineer", "production manager",
    "vp operations", "director of operations", "director of maintenance",
]

CONTACT_PAGES = ["/contact", "/contact-us", "/about", "/about-us", "/team",
                 "/our-team", "/staff", "/leadership", "/management"]

PAIN_KEYWORDS = [
    "vfd", "variable frequency drive", "variable speed drive",
    "plc", "programmable logic", "hmi", "scada", "allen-bradley",
    "rockwell", "siemens", "schneider", "fanuc", "servo",
    "conveyor", "pump", "compressor", "motor", "gearbox",
    "maintenance", "downtime", "preventive maintenance", "cmms",
    "upkeep", "limble", "fiix", "maximo", "work order",
]


def firecrawl_scrape(url: str, api_key: str) -> str | None:
    """Scrape a URL via Firecrawl and return markdown content."""
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{FIRECRAWL_BASE}/scrape",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"url": url, "formats": ["markdown"], "onlyMainContent": False},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", {}).get("markdown") or data.get("markdown") or None
    except Exception as exc:
        logger.debug("Firecrawl error for %s: %s", url, exc)
        return None


def extract_emails(text: str) -> list[str]:
    emails = EMAIL_RE.findall(text)
    filtered = []
    skip_domains = {"example.com", "sentry.io", "domain.com", "yourcompany.com",
                    "email.com", "test.com", "placeholder.com"}
    for e in emails:
        domain = e.split("@")[-1].lower()
        if domain not in skip_domains and not domain.startswith("sentry"):
            filtered.append(e.lower())
    return list(dict.fromkeys(filtered))


def extract_contacts_from_markdown(text: str, company_domain: str) -> list[dict]:
    """Parse markdown for name+title pairs near emails or maintenance keywords."""
    contacts = []
    lines = text.split("\n")

    for i, line in enumerate(lines):
        line_lower = line.lower()
        for title in MAINTENANCE_TITLES:
            if title in line_lower:
                context = "\n".join(lines[max(0, i - 3): i + 4])
                emails = extract_emails(context)
                phones = PHONE_RE.findall(context)
                name = _guess_name_near_title(lines, i, title)
                contacts.append({
                    "name": name,
                    "title": title.title(),
                    "email": emails[0] if emails else None,
                    "phone": phones[0] if phones else None,
                    "source": "website",
                    "confidence": "medium" if emails else "low",
                })
                break

    # Also capture any plain emails even without a title
    all_emails = extract_emails(text)
    existing = {c["email"] for c in contacts if c.get("email")}
    for email in all_emails:
        if email not in existing:
            contacts.append({
                "name": None,
                "title": None,
                "email": email,
                "phone": None,
                "source": "website",
                "confidence": "low",
            })
    return contacts


def _guess_name_near_title(lines: list[str], title_line: int, title: str) -> str | None:
    """Heuristic: look for a capitalized name in nearby lines."""
    name_re = re.compile(r"\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\b")
    for i in range(max(0, title_line - 3), min(len(lines), title_line + 3)):
        if i == title_line:
            # strip the title itself from the line before matching
            candidate = lines[i].lower().replace(title, "").strip()
            m = name_re.search(lines[i])
        else:
            m = name_re.search(lines[i])
        if m:
            return m.group(0)
    return None


def count_pain_signals(text: str) -> int:
    text_lower = text.lower()
    return sum(1 for kw in PAIN_KEYWORDS if kw in text_lower)


def enrich_facility(conn, facility: dict, api_key: str) -> dict:
    """Scrape a facility website and extract contacts + pain signals."""
    fid = str(facility["id"])
    website = facility.get("website")

    if not website:
        set_facility_status(conn, fid, "enriched", enriched=True)
        return {"contacts": 0, "pain_signals": 0}

    if not website.startswith("http"):
        website = f"https://{website}"

    domain = website.split("/")[2] if "//" in website else website
    all_contacts = []
    pain_score = 0

    # Scrape homepage
    logger.debug("  Scraping homepage: %s", website)
    text = firecrawl_scrape(website, api_key)
    if text:
        pain_score += count_pain_signals(text)
        all_contacts.extend(extract_contacts_from_markdown(text, domain))
        time.sleep(1)

    # Try contact/about pages
    for path in CONTACT_PAGES[:4]:
        url = f"https://{domain}{path}"
        page_text = firecrawl_scrape(url, api_key)
        if page_text:
            pain_score += count_pain_signals(page_text)
            all_contacts.extend(extract_contacts_from_markdown(page_text, domain))
            time.sleep(1)

    # Deduplicate contacts by email
    seen_emails: set[str] = set()
    unique_contacts = []
    for c in all_contacts:
        key = c.get("email") or f"no-email-{len(unique_contacts)}"
        if key not in seen_emails:
            seen_emails.add(key)
            unique_contacts.append(c)

    saved = 0
    for contact in unique_contacts:
        contact["facility_id"] = fid
        try:
            upsert_contact(conn, contact)
            saved += 1
        except Exception as exc:
            logger.debug("  Contact save error: %s", exc)

    # Store pain signal count in notes
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE prospect_facilities
               SET notes = CONCAT(COALESCE(notes, ''), %s),
                   employee_estimate = COALESCE(employee_estimate, %s),
                   updated_at = NOW()
               WHERE id = %s""",
            (f" | pain_signals:{pain_score}", None, fid),
        )
        conn.commit()

    set_facility_status(conn, fid, "enriched", enriched=True)
    return {"contacts": saved, "pain_signals": pain_score}


def enrich(top: int = 50) -> dict:
    """Enrich top-N discovered facilities. Returns summary stats."""
    api_key = os.environ["FIRECRAWL_API_KEY"]
    conn = get_conn()

    facilities = get_facilities_by_status(conn, "discovered", limit=top)
    logger.info("Enriching %d facilities (top %d by score)", len(facilities), top)

    total_contacts = 0
    total_pain = 0

    for i, f in enumerate(facilities, 1):
        logger.info("[%d/%d] %s (%s)", i, len(facilities), f["name"], f.get("city") or "?")
        result = enrich_facility(conn, f, api_key)
        total_contacts += result["contacts"]
        total_pain += result["pain_signals"]
        logger.info("  contacts=%d pain=%d", result["contacts"], result["pain_signals"])
        time.sleep(1)

    conn.close()
    return {"enriched": len(facilities), "contacts": total_contacts, "pain_signals": total_pain}
