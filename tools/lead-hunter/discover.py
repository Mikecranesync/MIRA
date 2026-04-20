"""Additional discovery sources for MIRA Lead Hunter.

Sources:
  - MSCA FL member directory (static HTML, scraped directly)
  - DuckDuckGo medium-business targeted queries
  - Florida chamber directories (where accessible)

All functions return list[Facility] and are safe to call from any context.
"""
from __future__ import annotations

import logging
import random
import re
import time
from urllib.parse import quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

# Import shared types — hunt.py must be on sys.path
from hunt import (
    ANCHOR_LAT, ANCHOR_LON, CITIES, DDG_TIMEOUT_SECS, RATE_LIMIT_SECS,
    USER_AGENTS, Facility, extract_facilities_from_results, haversine, looks_like_mfg, score_facility,
)

log = logging.getLogger("lead-hunter.discover")

# ---------------------------------------------------------------------------
# Medium-business targeted query templates
# ---------------------------------------------------------------------------

MEDIUM_BIZ_QUERIES = [
    "{city} FL machine shop",
    "{city} FL metal fabrication shop",
    "{city} FL sheet metal fabrication",
    "{city} FL injection molding manufacturer",
    "{city} FL plastic manufacturer",
    "{city} FL contract manufacturer",
    "{city} FL CNC machining",
    "{city} FL industrial equipment repair",
    "{city} FL precision manufacturing",
    "{city} FL industrial maintenance company",
    "{city} FL food manufacturer",
    "{city} FL packaging manufacturer",
    "{city} FL welding fabrication shop",
    "{city} FL hydraulics pneumatics",
]

# ---------------------------------------------------------------------------
# MSCA Florida member directory
# ---------------------------------------------------------------------------

MSCA_URL = "https://mscafl.com/msca-member-directory/"

MSCA_MFG_KEYWORDS = [
    "manufactur", "fabricat", "machining", "cnc", "machine shop", "weld",
    "pump", "processing", "packaging", "plastic", "fiberglass", "steel",
    "metal", "industrial", "assembly", "production", "plant", "bottling",
    "distribution", "infusion", "equipment", "tool", "mold",
]

MSCA_SKIP_NAMES = {
    "staffing", "consulting", "insurance", "airport", "electric", "college",
    "vision", "payroll", "accounting", "transportation", "staffing", "development",
    "council", "commerce", "workforce", "recruiting", "forged paths",
}


def scrape_msca(client: httpx.Client) -> list[Facility]:
    """Scrape MSCA FL member directory → Facility list."""
    try:
        resp = client.get(
            MSCA_URL,
            headers={
                "User-Agent": random.choice(USER_AGENTS),
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=15,
            follow_redirects=True,
        )
        if resp.status_code != 200:
            log.warning("MSCA returned %d", resp.status_code)
            return []
    except Exception as e:
        log.warning("MSCA fetch failed: %s", e)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    blocks = soup.select("div.et_pb_text_inner")
    facilities = []

    for block in blocks:
        lines = [l.strip() for l in block.get_text(separator="\n").split("\n") if l.strip()]
        if len(lines) < 2:
            continue

        name = lines[0]
        if len(name) < 4 or len(name) > 120:
            continue

        # Skip non-manufacturing members
        if any(skip in name.lower() for skip in MSCA_SKIP_NAMES):
            continue

        description = " ".join(lines[1:])
        combined = f"{name} {description}".lower()
        if not any(kw in combined for kw in MSCA_MFG_KEYWORDS):
            continue

        # Extract website link
        link_el = block.find("a", href=re.compile(r"^https?://"))
        website = ""
        if link_el:
            href = link_el["href"]
            if not any(skip in href for skip in ["mscafl.com", "facebook.com", "linkedin.com"]):
                website = href.rstrip("/")

        # Infer category from description
        cat = _infer_category(combined)

        # All MSCA members are Lakeland-area unless description says otherwise
        city = "Lakeland"
        for c_name, c_lat, c_lon, _ in CITIES:
            if c_name.lower() in combined:
                city = c_name
                break

        city_lat, city_lon = 28.0395, -81.9498  # Lakeland default
        for c_name, c_lat, c_lon, _ in CITIES:
            if c_name == city:
                city_lat, city_lon = c_lat, c_lon
                break

        dist = haversine(ANCHOR_LAT, ANCHOR_LON, city_lat, city_lon)

        f = Facility(
            name=name,
            city=city,
            website=website,
            category=cat,
            distance_miles=round(dist, 1),
            notes=description[:300],
            source="msca_directory",
        )
        f.icp_score = score_facility(f)
        facilities.append(f)
        log.info("  MSCA: %s (%s, score=%d)", name[:50], city, f.icp_score)

    log.info("MSCA: extracted %d manufacturing members", len(facilities))
    return facilities


def _infer_category(text: str) -> str:
    for kw, cat in [
        ("fiberglass", "manufacturing"),
        ("plastic", "manufacturing"),
        ("steel", "metal fabrication"),
        ("metal", "metal fabrication"),
        ("machining", "machine shop"),
        ("machine shop", "machine shop"),
        ("cnc", "machine shop"),
        ("fabricat", "metal fabrication"),
        ("pump", "industrial"),
        ("food", "food processing"),
        ("packag", "packaging"),
        ("distribution", "warehouse distribution"),
        ("infusion", "pharmaceutical"),
        ("bottl", "beverage"),
    ]:
        if kw in text:
            return cat
    return "manufacturing"


# ---------------------------------------------------------------------------
# DuckDuckGo — medium-business targeted queries
# ---------------------------------------------------------------------------

def search_ddg_medium(
    city: str,
    city_lat: float,
    city_lon: float,
    client: httpx.Client,
    queries: list[str] | None = None,
    ddg_fails: list[int] | None = None,
) -> tuple[list[Facility], int]:
    """Run medium-business DDG queries for a city. Returns (facilities, consecutive_fails)."""
    if queries is None:
        queries = [q.format(city=city) for q in MEDIUM_BIZ_QUERIES]

    fails = ddg_fails[0] if ddg_fails else 0
    found: dict[str, Facility] = {}

    for query in queries:
        if fails >= 5:
            log.warning("DDG circuit breaker — skipping remaining medium-biz queries")
            break

        results = _ddg_search(query, client)
        if results is None:
            fails += 1
            time.sleep(RATE_LIMIT_SECS)
            continue

        fails = 0
        new_facs = extract_facilities_from_results(results, city, city_lat, city_lon, query)
        for f in new_facs:
            if f.key not in found:
                found[f.key] = f
        time.sleep(RATE_LIMIT_SECS)

    if ddg_fails is not None:
        ddg_fails[0] = fails
    return list(found.values()), fails


def _ddg_search(query: str, client: httpx.Client) -> list[dict] | None:
    ua = random.choice(USER_AGENTS)
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        resp = client.get(
            url,
            headers={"User-Agent": ua, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"},
            timeout=DDG_TIMEOUT_SECS,
            follow_redirects=True,
        )
        if resp.status_code in (403, 429):
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for r in soup.select(".result"):
            title_el = r.select_one(".result__title")
            snippet_el = r.select_one(".result__snippet")
            link_el = r.select_one(".result__title a")
            if not title_el:
                continue
            link = ""
            if link_el:
                href = link_el.get("href", "")
                if "uddg=" in href:
                    link = unquote(href.split("uddg=")[1].split("&")[0])
                elif href.startswith("http"):
                    link = href
            results.append({
                "title": title_el.get_text(strip=True),
                "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                "link": link,
            })
        return results[:10]
    except Exception as e:
        log.warning("DDG error for %r: %s", query, e)
        return None
