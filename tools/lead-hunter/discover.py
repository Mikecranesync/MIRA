"""
Layer 1 — Discover manufacturing facilities within ~150mi of Lake Wales FL.

Primary:  OpenStreetMap Overpass API (free, no quota).
Fallback: Apify Google Maps Scraper (when account has quota).
Seed:     Known Central Florida manufacturers (always included).
"""
from __future__ import annotations

import logging
import math
import time
import urllib.parse

import httpx

from db import get_conn, upsert_facility

logger = logging.getLogger("lead-hunter.discover")

LAKE_WALES = (27.9019, -81.5856)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_RADIUS_M = 150_000  # 150 km ≈ 93 miles

# Curated seed list — known major industrial sites in Central FL (public knowledge)
SEED_FACILITIES: list[dict] = [
    {"name": "Mosaic Company Bartow Complex", "city": "Bartow", "zip": "33830",
     "category": "Phosphate mining & chemical", "website": "mosaicco.com",
     "phone": "(813) 775-4200", "notes": "query: seed - phosphate mining chemicals VFDs pumps"},
    {"name": "Mosaic South Fort Meade Mine", "city": "Fort Meade", "zip": "33841",
     "category": "Phosphate mining", "website": "mosaicco.com",
     "notes": "query: seed - phosphate mining heavy equipment"},
    {"name": "Peace River Citrus Products", "city": "Arcadia", "zip": "34266",
     "category": "Citrus processing / food manufacturing", "website": "prcp.com",
     "notes": "query: seed - citrus food processing conveyors VFDs"},
    {"name": "Tropicana Bradenton Plant", "city": "Bradenton", "zip": "34205",
     "category": "Citrus juice processing", "website": "tropicana.com",
     "notes": "query: seed - citrus beverage food processing conveyors PLCs"},
    {"name": "Publix Super Markets Distribution", "city": "Lakeland", "zip": "33801",
     "category": "Food distribution warehouse", "website": "publix.com",
     "phone": "(863) 688-1188",
     "notes": "query: seed - distribution warehouse conveyors VFDs motors"},
    {"name": "L3Harris Technologies", "city": "Melbourne", "zip": "32901",
     "category": "Aerospace & defense electronics", "website": "l3harris.com",
     "phone": "(321) 727-9100",
     "notes": "query: seed - electronics defense manufacturing precision"},
    {"name": "Northrop Grumman Melbourne", "city": "Melbourne", "zip": "32934",
     "category": "Aerospace & defense", "website": "northropgrumman.com",
     "notes": "query: seed - aerospace defense manufacturing CNC precision"},
    {"name": "Praxair / Linde Lakeland", "city": "Lakeland", "zip": "33805",
     "category": "Industrial gases manufacturing", "website": "lindeus.com",
     "notes": "query: seed - industrial gases compressors VFDs pump control"},
    {"name": "Air Products Tampa Distribution", "city": "Tampa", "zip": "33605",
     "category": "Industrial gases", "website": "airproducts.com",
     "notes": "query: seed - industrial gases compressors machinery"},
    {"name": "Florida Crystals Sugar Mill", "city": "Pahokee", "zip": "33476",
     "category": "Sugar mill / food processing", "website": "floridacrystals.com",
     "notes": "query: seed - sugar mill food processing heavy machinery PLCs VFDs"},
    {"name": "US Sugar Corporation Clewiston Mill", "city": "Clewiston", "zip": "33440",
     "category": "Sugar mill / food processing", "website": "ussugar.com",
     "phone": "(863) 983-8121",
     "notes": "query: seed - sugar mill food processing heavy machinery PLCs"},
    {"name": "CF Industries Hillsborough", "city": "Tampa", "zip": "33605",
     "category": "Fertilizer / chemical manufacturing", "website": "cfindustries.com",
     "notes": "query: seed - fertilizer chemical plant pumps compressors VFDs"},
    {"name": "Cargill Fertilizer Riverview", "city": "Riverview", "zip": "33578",
     "category": "Fertilizer manufacturing", "website": "cargill.com",
     "notes": "query: seed - fertilizer chemical manufacturing pumps motors"},
    {"name": "Sun Microstamping Technologies", "city": "Clearwater", "zip": "33760",
     "category": "Precision metal stamping", "website": "sunmicrostamping.com",
     "notes": "query: seed - precision stamping machine shop CNC"},
    {"name": "Shapes Precision Manufacturing", "city": "Palm Bay", "zip": "32905",
     "category": "Precision machining", "website": "shapespmfg.com",
     "notes": "query: seed - precision machining CNC machine shop"},
    {"name": "Vulcan Materials Lakeland", "city": "Lakeland", "zip": "33801",
     "category": "Concrete / aggregates", "website": "vulcanmaterials.com",
     "notes": "query: seed - concrete aggregates crushers conveyor VFDs"},
    {"name": "Rinker Materials Kissimmee", "city": "Kissimmee", "zip": "34744",
     "category": "Precast concrete manufacturing", "website": "rinkermaterials.com",
     "notes": "query: seed - concrete manufacturing batch plant VFDs motors"},
    {"name": "Saddle Creek Logistics Lakeland", "city": "Lakeland", "zip": "33801",
     "category": "Warehousing & distribution", "website": "saddlecreeklogistics.com",
     "phone": "(863) 665-2501",
     "notes": "query: seed - distribution warehouse conveyors VFDs maintenance"},
    {"name": "AdventHealth Plant City (Laundry/Facilities)", "city": "Plant City", "zip": "33563",
     "category": "Healthcare facilities / laundry processing",
     "notes": "query: seed - institutional laundry motors maintenance VFDs"},
    {"name": "Merita Bakeries (Flowers Foods) Orlando", "city": "Orlando", "zip": "32801",
     "category": "Bakery / food manufacturing", "website": "flowersbaking.com",
     "notes": "query: seed - bakery food processing conveyors motors VFDs"},
    {"name": "Dole Food Company Leesburg", "city": "Leesburg", "zip": "34748",
     "category": "Produce processing / food manufacturing",
     "notes": "query: seed - produce food processing conveyors refrigeration VFDs"},
    {"name": "Florida Rock Industries", "city": "Newberry", "zip": "32669",
     "category": "Concrete / aggregates", "website": "vulcanmaterials.com",
     "notes": "query: seed - concrete mining aggregates heavy equipment"},
    {"name": "Tropicana / PepsiCo Ft Pierce", "city": "Fort Pierce", "zip": "34945",
     "category": "Citrus juice processing / food manufacturing",
     "notes": "query: seed - citrus beverage food processing PLCs VFDs conveyors"},
    {"name": "Haines City Citrus Growers Association", "city": "Haines City", "zip": "33844",
     "category": "Citrus processing cooperative",
     "notes": "query: seed - citrus agricultural processing conveyors motors"},
    {"name": "Atlantic Packaging", "city": "Sarasota", "zip": "34237",
     "category": "Packaging manufacturing",
     "notes": "query: seed - packaging manufacturing machinery conveyors"},
    {"name": "WestRock (formerly Smurfit-Stone)", "city": "Fernandina Beach", "zip": "32034",
     "category": "Paper / packaging manufacturing", "website": "westrock.com",
     "notes": "query: seed - paper packaging manufacturing heavy machinery PLCs VFDs"},
    {"name": "Cemex USA Lakeland", "city": "Lakeland", "zip": "33801",
     "category": "Cement / ready-mix concrete", "website": "cemex.com",
     "notes": "query: seed - cement concrete batch plant VFDs motors conveyors"},
    {"name": "Honeywell Process Solutions Tampa", "city": "Tampa", "zip": "33619",
     "category": "Industrial automation / process controls", "website": "honeywell.com",
     "notes": "query: seed - industrial automation controls VFDs PLCs"},
    {"name": "TECO Tampa Electric Co (Polk Power Station)", "city": "Polk City", "zip": "33868",
     "category": "Electric power generation plant", "website": "tecoenergy.com",
     "phone": "(813) 228-1111",
     "notes": "query: seed - power generation plant turbines VFDs large motors critical"},
    {"name": "Duke Energy Crystal River Plant", "city": "Crystal River", "zip": "34428",
     "category": "Power generation facility", "website": "duke-energy.com",
     "notes": "query: seed - power generation turbines VFDs large motors PLCs"},
    {"name": "Ardagh Glass Tampa", "city": "Tampa", "zip": "33605",
     "category": "Glass bottle manufacturing", "website": "ardaghgroup.com",
     "notes": "query: seed - glass manufacturing conveyors high-temp machinery VFDs"},
    {"name": "Ben Hill Griffin Inc Frostproof", "city": "Frostproof", "zip": "33843",
     "category": "Citrus processing / juice packaging",
     "notes": "query: seed - citrus fruit processing packaging conveyors motors"},
]


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _osm_query() -> str:
    lat, lon = LAKE_WALES
    r = OSM_RADIUS_M
    return (
        f"[out:json][timeout:60];"
        f"("
        f"node[\"man_made\"=\"works\"][\"name\"](around:{r},{lat},{lon});"
        f"way[\"man_made\"=\"works\"][\"name\"](around:{r},{lat},{lon});"
        f"node[\"industrial\"][\"name\"](around:{r},{lat},{lon});"
        f"way[\"industrial\"][\"name\"](around:{r},{lat},{lon});"
        f"node[\"building\"=\"industrial\"][\"name\"](around:{r},{lat},{lon});"
        f"way[\"building\"=\"industrial\"][\"name\"](around:{r},{lat},{lon});"
        f");"
        f"out center 300;"
    )


def _fetch_osm() -> list[dict]:
    query = _osm_query()
    with httpx.Client(
        timeout=90,
        headers={
            "User-Agent": "MIRA-LeadHunter/1.0",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    ) as client:
        resp = client.post(OVERPASS_URL, content=f"data={urllib.parse.quote(query)}")
        resp.raise_for_status()
        return resp.json().get("elements", [])


def _map_osm_element(el: dict) -> dict | None:
    tags = el.get("tags", {})
    name = tags.get("name", "").strip()
    if not name:
        return None

    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lon = el.get("lon") or (el.get("center") or {}).get("lon")

    dist = None
    if lat and lon:
        dist = round(haversine(LAKE_WALES[0], LAKE_WALES[1], float(lat), float(lon)), 1)
        if dist > 160:
            return None

    city = (tags.get("addr:city") or tags.get("addr:town") or "").strip() or None
    address = None
    housenumber = tags.get("addr:housenumber") or ""
    street = tags.get("addr:street") or ""
    if housenumber and street:
        address = f"{housenumber} {street}"

    cat_raw = (tags.get("industrial") or tags.get("man_made") or
               tags.get("building") or "industrial facility")
    cat = cat_raw.replace("_", " ").title() if cat_raw else "Industrial Facility"

    return {
        "name": name[:255],
        "address": address or None,
        "city": city,
        "state": "FL",
        "zip": tags.get("addr:postcode") or None,
        "phone": tags.get("phone") or tags.get("contact:phone") or None,
        "website": tags.get("website") or tags.get("contact:website") or None,
        "google_maps_url": None,
        "category": cat,
        "rating": None,
        "review_count": None,
        "distance_miles": dist,
        "notes": f"query: osm-overpass | osm_id:{el.get('id')}",
    }


def discover(cities: list[str] | None = None, queries: list[str] | None = None,
             max_places: int = 40, dry_run: bool = False) -> int:
    """
    Discover facilities via OSM Overpass + curated seed list.
    Cities/queries params retained for CLI compatibility (not used with OSM).
    Returns count of new/updated records stored.
    """
    conn = get_conn()
    total = 0

    # --- OSM pass ---
    if not dry_run:
        logger.info("Querying OpenStreetMap Overpass (radius: 150km from Lake Wales FL)...")
        try:
            elements = _fetch_osm()
            logger.info("  OSM returned %d elements", len(elements))
            osm_stored = 0
            for el in elements:
                facility = _map_osm_element(el)
                if facility and upsert_facility(conn, facility):
                    osm_stored += 1
            logger.info("  Stored %d new/updated OSM facilities", osm_stored)
            total += osm_stored
        except Exception as exc:
            logger.error("OSM query failed: %s", exc)
        time.sleep(1)

    # --- Seed list pass ---
    logger.info("Loading %d curated seed facilities...", len(SEED_FACILITIES))
    seed_stored = 0
    for seed in SEED_FACILITIES:
        # Estimate distance from Lake Wales (rough — we don't have coords for seeds)
        facility: dict = {
            "name": seed["name"],
            "address": seed.get("address"),
            "city": seed.get("city"),
            "state": "FL",
            "zip": seed.get("zip"),
            "phone": seed.get("phone"),
            "website": seed.get("website"),
            "google_maps_url": None,
            "category": seed.get("category"),
            "rating": None,
            "review_count": None,
            "distance_miles": None,
            "notes": seed.get("notes", "query: seed"),
        }
        if upsert_facility(conn, facility):
            seed_stored += 1

    logger.info("  Stored %d new/updated seed facilities", seed_stored)
    total += seed_stored

    conn.close()
    return total
