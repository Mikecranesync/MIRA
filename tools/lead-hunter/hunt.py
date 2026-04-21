#!/usr/bin/env python3
"""MIRA Lead Hunter — discover manufacturing facilities near Lake Wales FL.

Usage:
  python3 tools/lead-hunter/hunt.py                   # full run
  python3 tools/lead-hunter/hunt.py --discover-only   # skip enrichment
  python3 tools/lead-hunter/hunt.py --report-only     # just generate report
  python3 tools/lead-hunter/hunt.py --dry-run         # print queries, no HTTP
  python3 tools/lead-hunter/hunt.py --limit 5         # cap city count
  python3 tools/lead-hunter/hunt.py --push-hubspot    # push ICP>=10 to HubSpot

Env / Doppler:
  SERPER_API_KEY      — Serper.dev JSON search API (fast + clean, $50/mo)
  NEON_DATABASE_URL   — persist results; skipped if not set
  HUBSPOT_API_KEY     — HubSpot private app token (or set HUBSPOT_ACCESS_TOKEN)
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import os
import re
import sys
import time
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("lead-hunter")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent.parent
PROSPECTS_DIR = REPO_ROOT / "marketing" / "prospects"

ANCHOR_LAT = 27.9014
ANCHOR_LON = -81.5862

CITIES = [
    ("Lake Wales",    27.9014, -81.5862,   0),
    ("Winter Haven",  28.0222, -81.7329,  13),
    ("Haines City",   28.1136, -81.6181,  14),
    ("Bartow",        27.8975, -81.8431,  18),
    ("Auburndale",    28.0661, -81.7887,  19),
    ("Fort Meade",    27.7517, -81.8012,  15),
    ("Mulberry",      27.8950, -81.9731,  22),
    ("Kissimmee",     28.2919, -81.4076,  27),
    ("Lakeland",      28.0395, -81.9498,  29),
    ("Sebring",       27.4958, -81.4509,  38),
    ("Plant City",    28.0192, -82.1145,  38),
    ("Clermont",      28.5494, -81.7729,  44),
    ("Orlando",       28.5383, -81.3792,  45),
    ("Clewiston",     26.7534, -80.9340,  83),
    ("Tampa",         27.9506, -82.4572,  62),
    ("Sanford",       28.8006, -81.2731,  63),
    ("Bradenton",     27.4989, -82.5748,  78),
    ("Sarasota",      27.3364, -82.5307,  89),
    ("Melbourne",     28.0836, -80.6081,  91),
    ("Ocala",         29.1872, -82.1401,  99),
    ("Daytona Beach", 29.2108, -81.0228, 102),
    ("Fort Myers",    26.6406, -81.8723, 113),
]

QUERY_TEMPLATES = [
    "manufacturing plant {city} FL",
    "food processing plant {city} FL",
    "machine shop {city} FL",
    "water treatment plant {city} FL",
    "packaging plant {city} FL",
    "industrial facility {city} Florida",
    "chemical plant {city} FL",
    "metal fabrication {city} FL",
]

ICP_WEIGHTS = {
    "manufacturing":      3,
    "food_bev_chemical":  3,
    "has_website":        1,
    "has_phone":          1,
    "within_60mi":        2,
    "within_100mi":       1,
    "medium_large":       2,
    "has_email":          2,
    "maintenance_title":  3,
    "multi_site":         2,
    "vfd_keywords":       4,
}

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
]

RATE_LIMIT_SECS = 3.0
DDG_TIMEOUT_SECS = 8.0
DDG_FAIL_LIMIT = 5   # stop DDG after this many consecutive failures
SERPER_URL = "https://google.serper.dev/search"
HUBSPOT_BASE = "https://api.hubapi.com"

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Facility:
    name: str
    city: str
    address: str = ""
    state: str = "FL"
    zip_code: str = ""
    phone: str = ""
    website: str = ""
    category: str = ""
    rating: float = 0.0
    review_count: int = 0
    distance_miles: float = 0.0
    icp_score: int = 0
    contacts: list[dict] = field(default_factory=list)
    notes: str = ""
    source: str = ""

    @property
    def key(self) -> str:
        return f"{self.name.lower().strip()}|{self.city.lower().strip()}"


# ---------------------------------------------------------------------------
# Curated seed list — 65+ known Central FL manufacturing / industrial sites
# ---------------------------------------------------------------------------

_SEEDS: list[dict] = [
    # Lake Wales (anchor, ~0mi)
    dict(name="Lake Wales Water Treatment Plant", city="Lake Wales", phone="(863) 678-4182", website="https://www.lakewalesfl.gov", category="water treatment", distance_miles=0, notes="water treatment vfd pump motor"),
    dict(name="Heartland BioEnergy", city="Lake Wales", phone="(863) 676-9224", website="", category="chemical", distance_miles=0, notes="biofuel ethanol processing pump vfd conveyor"),
    # Winter Haven (~13mi)
    dict(name="Winter Haven Water Utility", city="Winter Haven", phone="(863) 291-5600", website="https://www.mywinterhaven.com", category="water treatment", distance_miles=13, notes="water treatment plant vfd pump motor"),
    dict(name="Legoland Florida Resort Operations", city="Winter Haven", address="1 Legoland Way", phone="(877) 350-5346", website="https://www.legoland.com", category="industrial", distance_miles=13, notes="park facility maintenance hvac vfd chiller pump"),
    # Haines City (~14mi)
    dict(name="Sun Pacific Shippers", city="Haines City", phone="(863) 422-5100", website="https://www.sunpacific.com", category="food processing", distance_miles=14, notes="citrus packing fruit processing conveyor vfd"),
    # Fort Meade (~15mi)
    dict(name="Mosaic Fertilizer South Pierce", city="Fort Meade", address="2250 W Polk Mine Rd", phone="(863) 285-5500", website="https://www.mosaicco.com", category="chemical", distance_miles=15, notes="phosphate fertilizer processing vfd pump motor conveyor"),
    # Mulberry (~22mi)
    dict(name="Mosaic New Wales Mine", city="Mulberry", phone="(863) 425-1361", website="https://www.mosaicco.com", category="chemical", distance_miles=22, notes="phosphate mining processing vfd motor conveyor pump"),
    dict(name="TECO Polk Power Station", city="Mulberry", address="6280 Power House Rd", phone="(813) 228-1111", website="https://www.tecoenergy.com", category="power generation", distance_miles=22, notes="power plant vfd motor pump turbine"),
    # Bartow (~18mi)
    dict(name="CF Industries Bartow", city="Bartow", address="2014 N Hendry Rd", phone="(863) 533-3163", website="https://www.cfindustries.com", category="chemical", distance_miles=18, notes="nitrogen fertilizer ammonia vfd pump motor"),
    dict(name="Peace River Phosphates Bartow", city="Bartow", phone="(863) 533-2210", website="https://www.mosaicco.com", category="chemical", distance_miles=18, notes="phosphate processing vfd pump motor conveyor"),
    dict(name="Vulcan Materials Bartow", city="Bartow", phone="(863) 533-2500", website="https://www.vulcanmaterials.com", category="manufacturing", distance_miles=18, notes="aggregate mining conveyor motor vfd"),
    dict(name="Bartow Municipal Airport Industrial", city="Bartow", phone="(863) 534-0470", website="https://www.bartowfl.gov", category="industrial", distance_miles=18, notes="industrial maintenance facility"),
    # Auburndale (~25mi)
    dict(name="Florida Natural Growers", city="Auburndale", address="20205 US Hwy 27 N", phone="(863) 965-5000", website="https://www.floridanatural.com", category="food processing", distance_miles=25, notes="orange juice citrus processing conveyor pump vfd"),
    dict(name="Minute Maid Coca-Cola Auburndale", city="Auburndale", phone="(863) 965-1000", website="https://www.minutemaid.com", category="food processing", distance_miles=25, notes="orange juice citrus bottling conveyor pump vfd"),
    dict(name="Louis Dreyfus Company Citrus", city="Auburndale", address="1800 Recker Hwy", phone="(863) 967-2000", website="https://www.ldc.com", category="food processing", distance_miles=25, notes="citrus juice processing conveyor pump vfd"),
    # Kissimmee (~27mi)
    dict(name="Toho Water Authority", city="Kissimmee", address="101 N Church St", phone="(407) 944-5000", website="https://www.tohowater.com", category="water treatment", distance_miles=27, notes="water treatment reclamation vfd pump motor drive"),
    dict(name="Osceola County Water Resources", city="Kissimmee", phone="(407) 742-0200", website="https://www.osceola.org", category="water treatment", distance_miles=27, notes="water wastewater treatment vfd pump motor"),
    # Lakeland (~29mi)
    dict(name="Publix Distribution Center Lakeland", city="Lakeland", address="1936 George Jenkins Blvd", phone="(863) 688-1188", website="https://www.publix.com", category="food distribution", distance_miles=29, notes="large distribution center conveyor vfd pump automation"),
    dict(name="Saddle Creek Logistics Lakeland", city="Lakeland", address="3010 Saddle Creek Rd", phone="(863) 665-4505", website="https://www.saddlecreeklogistics.com", category="warehouse distribution", distance_miles=29, notes="distribution center conveyor automation plc vfd"),
    dict(name="Coca-Cola Bottling Company Lakeland", city="Lakeland", address="1715 S Florida Ave", phone="(863) 686-6154", website="https://www.cocacolacompany.com", category="beverage", distance_miles=29, notes="bottling plant vfd conveyor pump automated"),
    dict(name="Pepsi Bottling Group Lakeland", city="Lakeland", address="1635 New York Ave", phone="(863) 683-5484", website="https://www.pepsico.com", category="beverage", distance_miles=29, notes="bottling plant vfd conveyor pump automated"),
    dict(name="Amazon Fulfillment Center Lakeland", city="Lakeland", address="6050 Lakeland Park Dr", website="https://www.amazon.com", category="warehouse distribution", distance_miles=29, notes="distribution center conveyor automation plc vfd"),
    dict(name="US Foods Distribution Lakeland", city="Lakeland", address="3105 Drane Field Rd", phone="(863) 647-4400", website="https://www.usfoods.com", category="food distribution", distance_miles=29, notes="food distribution refrigeration conveyor vfd compressor"),
    dict(name="Walmart Grocery Distribution Lakeland", city="Lakeland", phone="(863) 413-1100", website="https://www.walmart.com", category="warehouse distribution", distance_miles=29, notes="distribution center conveyor vfd automation"),
    dict(name="Rooms To Go Distribution Center", city="Lakeland", address="11540 US Hwy 92 E", phone="(863) 688-6669", website="https://www.roomstogo.com", category="warehouse distribution", distance_miles=29, notes="distribution center conveyor vfd automation"),
    dict(name="Layne Water Technologies Lakeland", city="Lakeland", phone="(863) 686-3900", website="https://www.layne.com", category="water treatment", distance_miles=29, notes="water systems pump vfd motor treatment"),
    dict(name="Lakeland Regional Medical Center", city="Lakeland", address="1324 Lakeland Hills Blvd", phone="(863) 687-1100", website="https://www.lrmc.com", category="industrial", distance_miles=29, notes="hospital facility maintenance vfd pump chiller hvac compressor"),
    dict(name="SYSCO Central Florida Lakeland", city="Lakeland", phone="(863) 646-3300", website="https://www.sysco.com", category="food distribution", distance_miles=29, notes="food distribution refrigeration conveyor vfd"),
    # Sebring (~38mi)
    dict(name="Highlands County Water Systems", city="Sebring", address="600 S Commerce Ave", phone="(863) 402-6650", website="https://www.hcbcc.net", category="water treatment", distance_miles=38, notes="water utility treatment vfd pump motor"),
    dict(name="AdventHealth Sebring", city="Sebring", address="4200 Sun N Lake Blvd", phone="(863) 314-4466", website="https://www.adventhealth.com", category="industrial", distance_miles=38, notes="hospital facility maintenance vfd pump chiller hvac"),
    # Plant City (~38mi)
    dict(name="Pfizer Manufacturing Plant City", city="Plant City", address="1 Pfizer Plaza", phone="(813) 754-3900", website="https://www.pfizer.com", category="pharmaceutical", distance_miles=38, notes="pharmaceutical manufacturing vfd pump motor conveyor plc scada"),
    dict(name="FreshPoint Central Florida", city="Plant City", phone="(813) 754-1200", website="https://www.freshpoint.com", category="food distribution", distance_miles=38, notes="food distribution conveyor vfd refrigeration"),
    dict(name="Hillsborough County Water Treatment", city="Plant City", address="7602 N US Hwy 301", phone="(813) 757-3870", website="https://www.hillsboroughcounty.org", category="water treatment", distance_miles=38, notes="water treatment plant vfd pump motor"),
    # Clermont (~44mi)
    dict(name="Lake County Utilities Clermont", city="Clermont", phone="(352) 343-9723", website="https://www.lakecountyfl.gov", category="water treatment", distance_miles=44, notes="water wastewater treatment vfd pump motor"),
    dict(name="South Lake Hospital Clermont", city="Clermont", address="1900 Don Wickham Dr", phone="(352) 394-4071", website="https://www.southlakehospital.com", category="industrial", distance_miles=44, notes="hospital facility maintenance vfd pump hvac chiller"),
    # Orlando (~45mi)
    dict(name="Siemens Energy Orlando", city="Orlando", address="4400 Alafaya Trail", phone="(407) 736-2000", website="https://www.siemens-energy.com", category="manufacturing", distance_miles=45, notes="gas turbines generators vfd motor drive maintenance"),
    dict(name="Lockheed Martin Missiles Fire Control", city="Orlando", address="5600 Sand Lake Rd", phone="(407) 356-2000", website="https://www.lockheedmartin.com", category="aerospace defense", distance_miles=45, notes="defense manufacturing automation plc scada"),
    dict(name="Orlando Utilities Commission", city="Orlando", address="100 W Anderson St", phone="(407) 423-9100", website="https://www.ouc.com", category="utility", distance_miles=45, notes="utility power plant vfd motor pump conveyor"),
    dict(name="Orange County Water Utilities", city="Orlando", address="9150 Curry Ford Rd", phone="(407) 254-9756", website="https://www.ocfl.net", category="water treatment", distance_miles=45, notes="water treatment plant vfd pump motor conveyor"),
    dict(name="Darden Restaurants Supply Orlando", city="Orlando", address="1000 Darden Center Dr", phone="(407) 245-4000", website="https://www.darden.com", category="food distribution", distance_miles=45, notes="food processing distribution vfd conveyor"),
    dict(name="Tupperware Brands Corporation", city="Orlando", address="14901 S Orange Blossom Trail", phone="(407) 826-5050", website="https://www.tupperware.com", category="manufacturing", distance_miles=45, notes="plastic manufacturing injection molding conveyor motor vfd automation"),
    # Clewiston (~83mi)
    dict(name="US Sugar Corporation Clewiston", city="Clewiston", address="111 Ponce De Leon Ave", phone="(863) 983-8121", website="https://www.ussugar.com", category="food processing", distance_miles=83, notes="sugar processing cane mill conveyor vfd pump motor drive"),
    dict(name="Florida Crystals Sugar Division", city="Clewiston", phone="(561) 996-9072", website="https://www.floridacrystals.com", category="food processing", distance_miles=83, notes="sugar processing conveyor vfd pump motor"),
    # Tampa (~62mi)
    dict(name="CEMEX Tampa Cement Plant", city="Tampa", address="2800 N 41st St", phone="(813) 247-2400", website="https://www.cemex.com", category="manufacturing", distance_miles=62, notes="cement manufacturing conveyor vfd motor pump"),
    dict(name="Gerdau AmeriSteel Tampa", city="Tampa", address="4221 W Boy Scout Blvd", phone="(813) 286-8383", website="https://www.gerdau.com", category="metal fabrication", distance_miles=62, notes="steel mill vfd motor drives conveyor pump"),
    dict(name="Tampa Electric Gannon Station", city="Tampa", phone="(813) 223-0800", website="https://www.tecoenergy.com", category="utility", distance_miles=62, notes="power plant vfd motor pump turbine"),
    dict(name="Mosaic Fertilizer Riverview", city="Tampa", address="13830 US Hwy 41 S", phone="(813) 677-9811", website="https://www.mosaicco.com", category="chemical", distance_miles=62, notes="fertilizer processing vfd pump conveyor"),
    dict(name="Tampa Bay Water Authority", city="Tampa", address="2575 Enterprise Rd", phone="(727) 796-2355", website="https://www.tampabaywater.org", category="water treatment", distance_miles=62, notes="water treatment plant vfd pump motor"),
    dict(name="Brenntag Chemical Tampa", city="Tampa", phone="(813) 621-4710", website="https://www.brenntag.com", category="chemical", distance_miles=62, notes="chemical distribution conveyor pump vfd motor"),
    # Sanford (~63mi)
    dict(name="Seminole County Water Utilities", city="Sanford", address="3160 McCampbell Rd", phone="(407) 665-2600", website="https://www.seminolecountyfl.gov", category="water treatment", distance_miles=63, notes="water wastewater vfd pump motor"),
    # Bradenton (~78mi)
    dict(name="Tropicana Products Inc", city="Bradenton", address="1001 13th Ave E", phone="(941) 747-4461", website="https://www.tropicana.com", category="food processing", distance_miles=78, notes="orange juice processing vfd conveyor pump bottling motor"),
    dict(name="Florida Rock Industries Bradenton", city="Bradenton", address="2600 30th St E", phone="(941) 747-2671", website="https://www.vulcanmaterials.com", category="manufacturing", distance_miles=78, notes="concrete aggregate conveyor motor vfd"),
    dict(name="Manatee County Water System", city="Bradenton", phone="(941) 748-4501", website="https://www.mymanatee.org", category="water treatment", distance_miles=78, notes="water treatment plant vfd pump motor"),
    # Sarasota (~89mi)
    dict(name="PGT Innovations Nokomis", city="Sarasota", address="1070 Technology Dr", phone="(941) 480-1600", website="https://www.pgtinnovations.com", category="manufacturing", distance_miles=89, notes="impact windows doors manufacturing motor vfd conveyor"),
    dict(name="Sarasota County Water Utilities", city="Sarasota", phone="(941) 861-0300", website="https://www.scgov.net", category="water treatment", distance_miles=89, notes="water treatment plant vfd pump motor"),
    # Melbourne (~91mi)
    dict(name="L3Harris Technologies Melbourne", city="Melbourne", address="1025 W NASA Blvd", phone="(321) 727-9100", website="https://www.l3harris.com", category="aerospace defense", distance_miles=91, notes="electronics manufacturing assembly automation plc scada"),
    dict(name="Northrop Grumman Melbourne", city="Melbourne", address="7575 Columbiana Dr", phone="(321) 951-6100", website="https://www.northropgrumman.com", category="aerospace defense", distance_miles=91, notes="aerospace defense manufacturing assembly plc scada"),
    dict(name="Embraer Aircraft Melbourne", city="Melbourne", address="276 SW 34th St", phone="(321) 751-0600", website="https://www.embraer.com", category="aerospace", distance_miles=91, notes="aircraft manufacturing maintenance vfd"),
    dict(name="Brevard County Water Reclamation", city="Melbourne", address="5555 N Wickham Rd", phone="(321) 633-2075", website="https://www.brevardfl.gov", category="water treatment", distance_miles=91, notes="wastewater treatment vfd pump motor conveyor"),
    # Ocala (~99mi)
    dict(name="Marion County Utilities Ocala", city="Ocala", address="8 SE 3rd Ave", phone="(352) 671-8686", website="https://www.marioncountyfl.org", category="water treatment", distance_miles=99, notes="water wastewater treatment vfd pump motor"),
    dict(name="Preferred Freezer Services Ocala", city="Ocala", phone="(352) 622-1234", website="https://www.preferredfreezer.com", category="warehouse distribution", distance_miles=99, notes="cold storage refrigeration vfd compressor"),
    # Daytona Beach (~102mi)
    dict(name="Daytona Beach Water Treatment", city="Daytona Beach", address="3940 Nova Rd", phone="(386) 671-8100", website="https://www.codb.us", category="water treatment", distance_miles=102, notes="water treatment plant vfd pump motor"),
    dict(name="Consolidated Tomoka Land Daytona", city="Daytona Beach", address="1530 Cornerstone Blvd", phone="(386) 274-2202", website="https://www.ctlc.com", category="industrial", distance_miles=102, notes="industrial facility maintenance"),
    # Fort Myers (~113mi)
    dict(name="Lee County Electric Cooperative", city="Fort Myers", address="4980 Bayline Dr", phone="(239) 656-2300", website="https://www.lcec.net", category="utility", distance_miles=113, notes="utility vfd motor pump"),
    dict(name="Lee County Water Reclamation", city="Fort Myers", phone="(239) 533-8800", website="https://www.leegov.com", category="water treatment", distance_miles=113, notes="wastewater treatment plant vfd pump motor"),
    dict(name="Cape Coral Water Treatment Plant", city="Fort Myers", phone="(239) 574-0882", website="https://www.capecoral.net", category="water treatment", distance_miles=113, notes="water treatment plant vfd pump motor"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def score_facility(f: Facility) -> int:
    s = 0
    cat = (f.category or "").lower()
    name = f.name.lower()
    notes = (f.notes or "").lower()

    mfg_words = ["manufactur", "process", "packaging", "fabricat", "plant", "factory",
                 "machine", "foundry", "assembly", "industrial", "chemical", "pharma",
                 "food", "beverage", "treatment", "bottl", "mill", "refin", "distribution",
                 "power", "utility", "aerospace", "defense", "pharmaceutical"]
    if any(w in cat or w in name for w in mfg_words):
        s += ICP_WEIGHTS["manufacturing"]

    fb_words = ["food", "beverage", "juice", "citrus", "dairy", "chemical", "pharma",
                "water treatment", "waste water", "wastewater", "packaging", "bottl", "brew",
                "sugar", "citrus", "pharmaceutical"]
    if any(w in cat or w in name or w in notes for w in fb_words):
        s += ICP_WEIGHTS["food_bev_chemical"]

    if f.website:
        s += ICP_WEIGHTS["has_website"]
    if f.phone:
        s += ICP_WEIGHTS["has_phone"]

    if f.distance_miles <= 60:
        s += ICP_WEIGHTS["within_60mi"]
    elif f.distance_miles <= 100:
        s += ICP_WEIGHTS["within_100mi"]

    if f.review_count >= 20:
        s += ICP_WEIGHTS["medium_large"]

    if f.contacts:
        if any(c.get("email") for c in f.contacts):
            s += ICP_WEIGHTS["has_email"]
        maint = [c for c in f.contacts
                 if any(t in (c.get("title") or "").lower()
                        for t in ["maintenance", "facilities", "plant", "engineer", "operations"])]
        if maint:
            s += ICP_WEIGHTS["maintenance_title"]

    vfd_words = ["vfd", "variable frequency", "drive", "motor", "conveyor", "pump", "compressor",
                 "hvac", "automation", "plc", "scada"]
    if any(w in notes for w in vfd_words):
        s += ICP_WEIGHTS["vfd_keywords"]

    multi_words = ["division", "locations", "plants", "facilities", "nationwide", "worldwide"]
    if any(w in notes for w in multi_words):
        s += ICP_WEIGHTS["multi_site"]

    return min(s, 24)


def seed_facilities() -> list[Facility]:
    seeds = []
    for d in _SEEDS:
        f = Facility(
            name=d["name"],
            city=d["city"],
            address=d.get("address", ""),
            phone=d.get("phone", ""),
            website=d.get("website", ""),
            category=d.get("category", "manufacturing"),
            distance_miles=float(d.get("distance_miles", 0)),
            notes=d.get("notes", ""),
            source="seed",
        )
        f.icp_score = score_facility(f)
        seeds.append(f)
    return seeds


# ---------------------------------------------------------------------------
# Discovery — Serper API (preferred)
# ---------------------------------------------------------------------------

def search_serper(query: str, api_key: str, client: httpx.Client) -> list[dict]:
    try:
        resp = client.post(
            SERPER_URL,
            json={"q": query, "gl": "us", "hl": "en", "num": 10},
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data.get("organic", []):
            results.append({
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "link": item.get("link", ""),
            })
        for place in data.get("places", []):
            results.append({
                "title": place.get("title", ""),
                "snippet": place.get("address", ""),
                "link": place.get("website", ""),
                "phone": place.get("phoneNumber", ""),
                "rating": place.get("rating"),
                "reviews": place.get("reviews"),
                "is_place": True,
            })
        return results
    except Exception as e:
        log.warning("Serper error for %r: %s", query, e)
        return []


# ---------------------------------------------------------------------------
# Discovery — DuckDuckGo HTML scraping fallback
# ---------------------------------------------------------------------------

def search_duckduckgo(query: str, client: httpx.Client) -> list[dict]:
    ua = random.choice(USER_AGENTS)
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        resp = client.get(
            url,
            headers={
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=DDG_TIMEOUT_SECS,
            follow_redirects=True,
        )
        if resp.status_code in (403, 429):
            log.warning("DDG rate-limited (%d)", resp.status_code)
            return None  # signals circuit breaker
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
        log.warning("DDG scrape error: %s", e)
        return None  # signals circuit breaker


# ---------------------------------------------------------------------------
# Parse facilities from search results
# ---------------------------------------------------------------------------

SKIP_DOMAINS = {"yelp.com", "yellowpages.com", "manta.com", "bbb.org",
                "linkedin.com", "facebook.com", "google.com", "indeed.com",
                "ziprecruiter.com", "glassdoor.com", "mapquest.com",
                "duckduckgo.com", "wikipedia.org", "chamber.com"}

MFG_CATEGORIES = [
    "food", "beverage", "juice", "citrus", "dairy", "water treatment", "wastewater",
    "chemical", "pharma", "pharmaceutical", "packaging", "fabricat", "machine",
    "manufactur", "bottl", "processing", "assembly", "industrial", "foundry",
    "metal", "plastic", "rubber", "printing", "paper", "lumber", "textile",
    "aerospace", "automotive", "electronics", "warehouse", "distribution",
]


def looks_like_mfg(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in MFG_CATEGORIES)


def extract_facilities_from_results(
    results: list[dict], city: str, city_lat: float, city_lon: float, query: str
) -> list[Facility]:
    found = []
    for r in results:
        title = r.get("title", "").strip()
        snippet = r.get("snippet", "").strip()
        link = r.get("link", "").strip()

        if not title or len(title) < 4:
            continue

        if link:
            try:
                domain = urlparse(link).netloc.replace("www.", "")
                if any(skip in domain for skip in SKIP_DOMAINS):
                    continue
            except Exception:
                pass

        combined = f"{title} {snippet} {query}".lower()
        if not looks_like_mfg(combined):
            continue

        cat = "manufacturing"
        for kw in ["food", "beverage", "juice", "citrus", "water treatment", "wastewater",
                   "chemical", "pharmaceutical", "packaging", "machine shop", "fabricat",
                   "bottling", "processing"]:
            if kw in combined:
                cat = kw
                break

        dist = haversine(ANCHOR_LAT, ANCHOR_LON, city_lat, city_lon)

        address_match = re.search(
            r"\d+\s+[A-Za-z].*?(?:St|Ave|Rd|Blvd|Dr|Way|Ln|Hwy)\b[.,]?",
            snippet, re.IGNORECASE
        )
        address = address_match.group(0).strip() if address_match else ""

        phone = r.get("phone", "")
        if not phone:
            phone_m = re.search(r"\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}", snippet)
            phone = phone_m.group(0) if phone_m else ""

        website = link if link and "google.com" not in link and "duckduckgo.com" not in link else ""

        fac = Facility(
            name=title[:120],
            city=city,
            address=address,
            phone=phone,
            website=website,
            category=cat,
            rating=float(r.get("rating") or 0),
            review_count=int(r.get("reviews") or 0),
            distance_miles=round(dist, 1),
            source=f"duckduckgo:{query[:40]}",
        )
        fac.icp_score = score_facility(fac)
        found.append(fac)
    return found


# ---------------------------------------------------------------------------
# Enrichment — scrape facility website
# ---------------------------------------------------------------------------

CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us", "/team",
                 "/staff", "/management", "/leadership"]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}")
MAINT_TITLES = ["maintenance manager", "facilities manager", "plant manager",
                "plant engineer", "maintenance director", "operations manager",
                "maintenance supervisor", "facilities director", "chief engineer"]
VFD_KWS = ["vfd", "variable frequency", "motor drive", "conveyor", "pump system",
           "compressor", "automation", "plc", "scada", "hvac system"]


def scrape_site(url: str, client: httpx.Client) -> dict:
    if not url or not url.startswith("http"):
        return {}

    result: dict = {"emails": [], "phones": [], "contacts": [], "vfd_hit": False, "text": ""}
    base = urlparse(url)
    base_url = f"{base.scheme}://{base.netloc}"

    pages_to_try = [url] + [base_url + p for p in CONTACT_PATHS]
    seen_urls: set[str] = set()
    all_text = []

    for page_url in pages_to_try[:4]:
        if page_url in seen_urls:
            continue
        seen_urls.add(page_url)
        try:
            time.sleep(0.5)
            resp = client.get(
                page_url,
                headers={"User-Agent": random.choice(USER_AGENTS)},
                timeout=10,
                follow_redirects=True,
            )
            if resp.status_code != 200:
                continue
            if "html" not in resp.headers.get("content-type", ""):
                continue
            soup = BeautifulSoup(resp.text, "html.parser")
            text = soup.get_text(separator=" ", strip=True)
            all_text.append(text)

            for email in EMAIL_RE.findall(text):
                if email not in result["emails"] and "example" not in email:
                    result["emails"].append(email)

            for phone in PHONE_RE.findall(text):
                if phone not in result["phones"]:
                    result["phones"].append(phone)

            for m in re.finditer(
                r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,\-|]\s*("
                + "|".join(re.escape(t) for t in MAINT_TITLES)
                + r")",
                text, re.IGNORECASE
            ):
                contact = {"name": m.group(1).strip(), "title": m.group(2).strip(), "source": page_url}
                if contact not in result["contacts"]:
                    result["contacts"].append(contact)

        except Exception as e:
            log.debug("Scrape failed %s: %s", page_url, e)

    combined = " ".join(all_text).lower()
    result["vfd_hit"] = any(kw in combined for kw in VFD_KWS)
    result["text"] = combined[:2000]
    return result


# ---------------------------------------------------------------------------
# Name quality gate
# ---------------------------------------------------------------------------

_GENERIC_NAME_TOKENS = frozenset({
    "info", "contact", "contact us", "team", "our team",
    "staff", "support", "sales", "admin", "webmaster",
})


def _is_real_name(value: str | None) -> bool:
    """Return True iff value looks like a real person's name.

    Rejects empties, generic tokens like "Info"/"Team", single-word strings,
    and all-caps strings (likely page headings, not names).
    """
    if not value:
        return False
    stripped = value.strip()
    if not stripped:
        return False
    lower = stripped.lower()
    if lower in _GENERIC_NAME_TOKENS:
        return False
    # all-caps headings like "JOHN SMITH" or "CONTACT US" are not names
    if stripped == stripped.upper() and any(c.isalpha() for c in stripped):
        return False
    # require at least two whitespace-separated tokens (first + last)
    if len(stripped.split()) < 2:
        return False
    return True


# ---------------------------------------------------------------------------
# Enrichment — Firecrawl LLM schema extraction
# ---------------------------------------------------------------------------

FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape"
FIRECRAWL_CANDIDATE_PATHS = ["", "/team", "/about", "/about-us",
                             "/leadership", "/management", "/staff"]

_FIRECRAWL_SCHEMA = {
    "type": "object",
    "properties": {
        "contacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "email": {"type": "string"},
                    "linkedin_url": {"type": "string"},
                },
            },
        },
        "emails": {"type": "array", "items": {"type": "string"}},
        "phones": {"type": "array", "items": {"type": "string"}},
    },
}


def _matches_maintenance_title(title: str) -> bool:
    if not title:
        return False
    tlow = title.lower()
    return any(t.lower() in tlow for t in MAINT_TITLES)


def enrich_via_firecrawl(
    url: str,
    client: httpx.Client,
    fc_key: str,
    budget: dict,
) -> list[dict]:
    """Probe a facility's team page via Firecrawl LLM extraction.

    Returns list of {name, title, email, linkedin_url, source, confidence}.
    Filters contacts to maintenance/plant/facilities titles.

    `budget` is a mutable dict with key 'remaining' (int). Decremented per
    Firecrawl call. When remaining <= 0, returns [] without making the call.
    """
    if not fc_key or not url:
        return []
    if budget.get("remaining", 0) <= 0:
        return []

    payload = {
        "url": url,
        "formats": [
            {
                "type": "json",
                "schema": _FIRECRAWL_SCHEMA,
                "prompt": (
                    "Extract any named contacts from this page, especially "
                    "maintenance managers, plant managers, facilities managers, "
                    "operations managers, or other industrial/maintenance roles. "
                    "Include name, title, email if visible, and LinkedIn URL if "
                    "visible."
                ),
            }
        ],
    }
    try:
        resp = client.post(
            FIRECRAWL_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {fc_key}",
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        budget["remaining"] = budget.get("remaining", 0) - 1
        if resp.status_code != 200:
            log.warning("Firecrawl %d on %s: %s",
                        resp.status_code, url, resp.text[:120])
            return []
        data = resp.json().get("data", {}).get("json", {}) or {}
    except httpx.TimeoutException:
        log.warning("Firecrawl timeout on %s after 60s", url)
        return []
    except httpx.RequestError as e:
        log.warning("Firecrawl network error on %s: %s", url, e)
        return []
    except Exception as e:
        log.debug("Firecrawl parse/other error on %s: %s", url, e)
        return []

    out: list[dict] = []
    for c in data.get("contacts", []) or []:
        name = (c.get("name") or "").strip()
        title = (c.get("title") or "").strip()
        if not _is_real_name(name) or not _matches_maintenance_title(title):
            continue
        out.append({
            "name": name,
            "title": title,
            "email": (c.get("email") or "").strip(),
            "linkedin_url": (c.get("linkedin_url") or "").strip(),
            "source": url,
            "confidence": "firecrawl-team-page",
        })
    return out


# ---------------------------------------------------------------------------
# Enrichment — Google search contact probe (Serper)
# ---------------------------------------------------------------------------

_TITLE_SNIPPET_RE = re.compile(
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,\-|\u2013\u2014]\s*("
    + "|".join(re.escape(t) for t in MAINT_TITLES)
    + r")",
    re.IGNORECASE,
)


def search_contacts_via_serper(
    company_name: str,
    domain: str,
    client: httpx.Client,
    serper_key: str,
) -> list[dict]:
    """Probe Google snippets for Name/Title at a facility.

    Returns list of {name, title, source, confidence='search-snippet'}.
    Reads Serper's organic snippets only — never fetches LinkedIn pages directly.
    """
    if not serper_key or not company_name:
        return []

    queries = [f'"maintenance manager" OR "plant manager" "{company_name}"']
    if domain:
        queries.append(f'"maintenance manager" OR "facilities manager" site:{domain}')
    queries.append(f'"{company_name}" "linkedin.com/in"')

    contacts: list[dict] = []
    seen: set[str] = set()

    for q in queries:
        try:
            results = search_serper(q, serper_key, client)
        except Exception as e:
            log.debug("Contact probe failed for %r: %s", q, e)
            continue

        for r in results:
            text = f"{r.get('title', '')} {r.get('snippet', '')}"
            for m in _TITLE_SNIPPET_RE.finditer(text):
                name = m.group(1).strip()
                title = m.group(2).strip().title()
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                contacts.append({
                    "name": name,
                    "title": title,
                    "source": r.get("link") or q,
                    "confidence": "search-snippet",
                })
        time.sleep(1.0)

    return contacts


# ---------------------------------------------------------------------------
# Enrichment orchestrator — website scrape + Serper contact probe
# ---------------------------------------------------------------------------

def enrich_facilities(
    fac_list: list["Facility"],
    serper_key: str,
    fc_key: str = "",
    budget: int = 500,
    firecrawl_budget: int = 300,
) -> None:
    """Enrich facilities in place: Firecrawl → website scrape → Serper.

    Each contact appended gets a `confidence` field:
      - "firecrawl-team-page": LLM-extracted from the facility's team page
      - "website-direct":      scraped from the facility's own site (regex)
      - "search-snippet":      parsed from Google snippets via Serper
    Dedupes across all three sources by normalized name. Unnamed contacts
    (bare email addresses, orphan phones) intentionally bypass dedup so
    multiple info@ records from different sources all survive.

    Firecrawl budget is tracked via a mutable dict (`fc_budget`) passed
    into `enrich_via_firecrawl`, which decrements `remaining` per call.
    Serper budget is tracked locally as an int counter.
    """
    to_enrich = [f for f in fac_list if f.website and f.icp_score >= 4]
    log.info("=== ENRICHMENT PHASE ===")
    log.info(
        "Enriching %d high-score sites (firecrawl=%s budget=%d | "
        "serper=%s budget=%d)",
        len(to_enrich),
        "on" if fc_key else "off", firecrawl_budget,
        "on" if serper_key else "off", budget,
    )

    fc_budget = {"remaining": firecrawl_budget}
    serper_queries_used = 0

    with httpx.Client(timeout=60) as client:
        for f in to_enrich:
            log.info("  Enriching: %s (%s)", f.name[:50], f.website[:40])
            seen: set[str] = set()

            # Step 1 — Firecrawl LLM extraction
            if fc_key:
                try:
                    fc_contacts = enrich_via_firecrawl(
                        f.website, client, fc_key, fc_budget,
                    )
                    for c in fc_contacts:
                        key = c["name"].lower()
                        if key not in seen:
                            f.contacts.append(c)
                            seen.add(key)
                    if fc_contacts:
                        log.info("    + %d from Firecrawl", len(fc_contacts))
                except Exception as e:
                    log.debug("Firecrawl failed %s: %s", f.name, e)

            # Step 2 — existing website regex scrape (safety net)
            try:
                enrichment = scrape_site(f.website, client)
                if enrichment.get("emails"):
                    for em in enrichment["emails"][:3]:
                        # unnamed contacts bypass dedup intentionally — each bare
                        # email represents a distinct inbox worth keeping
                        f.contacts.append({
                            "name": "", "email": em, "source": f.website,
                            "confidence": "website-direct",
                        })
                if enrichment.get("phones") and not f.phone:
                    f.phone = enrichment["phones"][0]
                for c in enrichment.get("contacts", []) or []:
                    name = (c.get("name") or "").strip()
                    if name and name.lower() in seen:
                        continue
                    c.setdefault("confidence", "website-direct")
                    f.contacts.append(c)
                    if name:
                        seen.add(name.lower())
                if enrichment.get("vfd_hit"):
                    f.notes = (f.notes + " vfd_keywords_found").strip()
            except Exception as e:
                log.debug("Website scrape failed %s: %s", f.name, e)

            # Step 3 — Serper snippet probe (optional)
            if serper_key and serper_queries_used < budget:
                try:
                    domain = ""
                    if f.website:
                        try:
                            domain = urlparse(f.website).netloc.replace(
                                "www.", "")
                        except Exception:
                            domain = ""
                    probe = search_contacts_via_serper(
                        f.name, domain, client, serper_key,
                    )
                    serper_queries_used += 3 if domain else 2
                    for c in probe:
                        key = c["name"].lower()
                        if key not in seen:
                            f.contacts.append(c)
                            seen.add(key)
                    if probe:
                        log.info("    + %d from Serper", len(probe))
                except Exception as e:
                    log.debug("Serper probe failed %s: %s", f.name, e)

            f.icp_score = score_facility(f)

    if fc_key:
        log.info(
            "Enrichment complete — Firecrawl budget %d/%d used",
            firecrawl_budget - fc_budget["remaining"], firecrawl_budget,
        )
    if serper_key:
        log.info(
            "Serper queries used: %d (budget %d)",
            serper_queries_used, budget,
        )


# ---------------------------------------------------------------------------
# NeonDB persistence
# ---------------------------------------------------------------------------

def apply_schema(db_url: str) -> None:
    import psycopg2
    schema_sql = (Path(__file__).parent / "schema.sql").read_text()
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    for stmt in schema_sql.split(";"):
        stmt = stmt.strip()
        if stmt:
            cur.execute(stmt)
    conn.commit()
    conn.close()
    log.info("Schema applied.")


def upsert_facilities(facilities: list[Facility], db_url: str) -> int:
    import psycopg2
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    inserted = 0
    for f in facilities:
        cur.execute(
            """
            INSERT INTO prospect_facilities
              (name, address, city, state, zip, phone, website, category,
               rating, review_count, distance_miles, icp_score, notes)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (name, city) DO UPDATE SET
              icp_score      = GREATEST(prospect_facilities.icp_score, EXCLUDED.icp_score),
              phone          = COALESCE(NULLIF(EXCLUDED.phone,''), prospect_facilities.phone),
              website        = COALESCE(NULLIF(EXCLUDED.website,''), prospect_facilities.website),
              notes          = COALESCE(NULLIF(EXCLUDED.notes,''), prospect_facilities.notes),
              updated_at     = NOW()
            RETURNING (xmax = 0)
            """,
            (f.name, f.address, f.city, f.state, f.zip_code, f.phone,
             f.website, f.category, f.rating, f.review_count,
             f.distance_miles, f.icp_score, f.notes),
        )
        row = cur.fetchone()
        if row and row[0]:
            inserted += 1
    conn.commit()

    for f in facilities:
        if not f.contacts:
            continue
        cur.execute(
            "SELECT id FROM prospect_facilities WHERE name=%s AND city=%s",
            (f.name, f.city)
        )
        frow = cur.fetchone()
        if not frow:
            continue
        fid = frow[0]
        for c in f.contacts:
            cur.execute(
                """
                INSERT INTO prospect_contacts (facility_id, name, title, email, phone, source, confidence)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT DO NOTHING
                """,
                (fid, c.get("name"), c.get("title"), c.get("email"), c.get("phone"),
                 c.get("source"), c.get("confidence", "medium")),
            )
    conn.commit()
    conn.close()
    return inserted


# ---------------------------------------------------------------------------
# HubSpot CRM push
# ---------------------------------------------------------------------------

def _hs_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _hs_search_company(name: str, domain: str, token: str, client: httpx.Client) -> Optional[str]:
    """Return existing HubSpot company ID if found by domain or name."""
    for field_name, value in [("domain", domain), ("name", name)]:
        if not value:
            continue
        try:
            resp = client.post(
                f"{HUBSPOT_BASE}/crm/v3/objects/companies/search",
                headers=_hs_headers(token),
                json={"filterGroups": [{"filters": [{"propertyName": field_name, "operator": "EQ", "value": value}]}], "limit": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                results = resp.json().get("results", [])
                if results:
                    return results[0]["id"]
        except Exception:
            pass
    return None


def _hs_search_contact(email: str, token: str, client: httpx.Client) -> Optional[str]:
    if not email:
        return None
    try:
        resp = client.post(
            f"{HUBSPOT_BASE}/crm/v3/objects/contacts/search",
            headers=_hs_headers(token),
            json={"filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}], "limit": 1},
            timeout=10,
        )
        if resp.status_code == 200:
            results = resp.json().get("results", [])
            if results:
                return results[0]["id"]
    except Exception:
        pass
    return None


def push_to_hubspot(facilities: list[Facility], token: str, min_score: int = 10) -> dict:
    stats = {"companies_created": 0, "companies_updated": 0, "contacts_created": 0, "deals_created": 0, "skipped": 0, "errors": 0, "_total_attempted": 0}
    qualified = [f for f in facilities if f.icp_score >= min_score]
    log.info("HubSpot push: %d qualified facilities (ICP >= %d)", len(qualified), min_score)

    with httpx.Client(timeout=15) as client:
        for f in qualified:
            domain = ""
            if f.website:
                try:
                    domain = urlparse(f.website).netloc.replace("www.", "")
                except Exception:
                    pass

            existing_id = _hs_search_company(f.name, domain, token, client)
            props = {
                "name": f.name,
                "phone": f.phone,
                "city": f.city,
                "state": f.state,
                "address": f.address,
                "domain": domain,
                "industry": f.category.upper().replace(" ", "_")[:50],
                "description": f"MIRA Lead | ICP {f.icp_score}/24 | {f.distance_miles:.0f}mi from Lake Wales FL | {f.category}",
            }

            stats["_total_attempted"] += 1
            company_id = existing_id
            try:
                if existing_id:
                    client.patch(
                        f"{HUBSPOT_BASE}/crm/v3/objects/companies/{existing_id}",
                        headers=_hs_headers(token),
                        json={"properties": props},
                        timeout=10,
                    )
                    stats["companies_updated"] += 1
                    log.info("  HS updated company: %s", f.name[:50])
                else:
                    r = client.post(
                        f"{HUBSPOT_BASE}/crm/v3/objects/companies",
                        headers=_hs_headers(token),
                        json={"properties": props},
                        timeout=10,
                    )
                    if r.status_code == 401:
                        log.warning("HubSpot 401 — invalid token, aborting push")
                        return stats  # circuit breaker
                    elif r.status_code in (200, 201):
                        company_id = r.json()["id"]
                        stats["companies_created"] += 1
                        log.info("  HS created company: %s (id=%s)", f.name[:50], company_id)
                    else:
                        log.warning("  HS company create failed %d: %s", r.status_code, r.text[:120])
                        stats["errors"] += 1
                        continue
            except Exception as e:
                log.warning("  HS company error %s: %s", f.name[:40], e)
                stats["errors"] += 1
                continue

            # Contacts
            for c in f.contacts:
                email = c.get("email", "")
                contact_id = _hs_search_contact(email, token, client)
                name_parts = (c.get("name") or "").split(" ", 1)
                fname = name_parts[0] if name_parts else ""
                lname = name_parts[1] if len(name_parts) > 1 else ""
                cprops = {
                    "firstname": fname,
                    "lastname": lname,
                    "email": email,
                    "phone": c.get("phone", ""),
                    "jobtitle": c.get("title", ""),
                    "company": f.name,
                }
                try:
                    if not contact_id:
                        cr = client.post(
                            f"{HUBSPOT_BASE}/crm/v3/objects/contacts",
                            headers=_hs_headers(token),
                            json={"properties": cprops},
                            timeout=10,
                        )
                        if cr.status_code in (200, 201):
                            contact_id = cr.json()["id"]
                            stats["contacts_created"] += 1
                    if contact_id and company_id:
                        client.put(
                            f"{HUBSPOT_BASE}/crm/v3/objects/contacts/{contact_id}/associations/companies/{company_id}/contact_to_company",
                            headers=_hs_headers(token),
                            timeout=10,
                        )
                except Exception as e:
                    log.debug("HS contact error: %s", e)

            # Deal for top scored
            if f.icp_score >= 15 and company_id:
                try:
                    dr = client.post(
                        f"{HUBSPOT_BASE}/crm/v3/objects/deals",
                        headers=_hs_headers(token),
                        json={"properties": {
                            "dealname": f"MIRA Pilot — {f.name[:60]}",
                            "amount": "499",
                            "pipeline": "default",
                            "dealstage": "appointmentscheduled",
                        }},
                        timeout=10,
                    )
                    if dr.status_code in (200, 201):
                        deal_id = dr.json()["id"]
                        stats["deals_created"] += 1
                        client.put(
                            f"{HUBSPOT_BASE}/crm/v3/objects/deals/{deal_id}/associations/companies/{company_id}/deal_to_company",
                            headers=_hs_headers(token),
                            timeout=10,
                        )
                except Exception as e:
                    log.debug("HS deal error: %s", e)

    log.info("HubSpot sync complete: %s", stats)
    return stats


def write_hubspot_csv(facilities: list[Facility], path: Path, min_score: int = 10) -> None:
    qualified = [f for f in facilities if f.icp_score >= min_score]
    rows = []
    for f in qualified:
        domain = ""
        if f.website:
            try:
                domain = urlparse(f.website).netloc.replace("www.", "")
            except Exception:
                pass
        if f.contacts:
            for c in f.contacts:
                name_parts = (c.get("name") or "").split(" ", 1)
                rows.append({
                    "Company Name": f.name,
                    "Company Domain": domain,
                    "Company Phone": f.phone,
                    "Company City": f.city,
                    "Company State": f.state,
                    "Company Address": f.address,
                    "Company Industry": f.category,
                    "ICP Score": f.icp_score,
                    "Contact First Name": name_parts[0] if name_parts else "",
                    "Contact Last Name": name_parts[1] if len(name_parts) > 1 else "",
                    "Contact Email": c.get("email", ""),
                    "Contact Phone": c.get("phone", ""),
                    "Contact Job Title": c.get("title", ""),
                    "Deal Name": f"MIRA Pilot — {f.name[:60]}" if f.icp_score >= 15 else "",
                    "Deal Amount": "499" if f.icp_score >= 15 else "",
                })
        else:
            rows.append({
                "Company Name": f.name,
                "Company Domain": domain,
                "Company Phone": f.phone,
                "Company City": f.city,
                "Company State": f.state,
                "Company Address": f.address,
                "Company Industry": f.category,
                "ICP Score": f.icp_score,
                "Contact First Name": "", "Contact Last Name": "",
                "Contact Email": "", "Contact Phone": "", "Contact Job Title": "",
                "Deal Name": f"MIRA Pilot — {f.name[:60]}" if f.icp_score >= 15 else "",
                "Deal Amount": "499" if f.icp_score >= 15 else "",
            })
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        if rows:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    log.info("HubSpot CSV → %s (%d rows)", path, len(rows))


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def write_report(facilities: list[Facility], path: Path, hs_stats: Optional[dict] = None) -> None:
    today = date.today().isoformat()
    top = sorted(facilities, key=lambda f: f.icp_score, reverse=True)[:20]
    total = len(facilities)
    with_web = sum(1 for f in facilities if f.website)
    with_phone = sum(1 for f in facilities if f.phone)
    contacts_found = sum(len(f.contacts) for f in facilities)

    lines = [
        f"# MIRA Central Florida Prospect Report — {today}",
        "",
        f"**Scope:** {total} facilities discovered across {len(CITIES)} cities within 150mi of Lake Wales FL  ",
        f"**With website:** {with_web}  |  **With phone:** {with_phone}  |  **Contacts enriched:** {contacts_found}",
        "",
        "## Top 20 by ICP Score",
        "",
        "| # | Facility | City | Mi | Cat | Phone | Website | Score |",
        "|---|----------|------|----|-----|-------|---------|-------|",
    ]
    for i, f in enumerate(top, 1):
        web = f"[site]({f.website})" if f.website else "—"
        lines.append(
            f"| {i} | {f.name[:40]} | {f.city} | {f.distance_miles:.0f} | "
            f"{f.category[:18]} | {f.phone or '—'} | {web} | **{f.icp_score}** |"
        )

    lines += ["", "## Enriched Contacts", ""]
    has_contacts = False
    for f in sorted(facilities, key=lambda x: x.icp_score, reverse=True):
        if not f.contacts:
            continue
        has_contacts = True
        lines.append(f"### {f.name} — {f.city}")
        for c in f.contacts:
            lines.append(
                f"- **{c.get('name', '?')}** · {c.get('title', '?')} · "
                f"{c.get('email', '')} · {c.get('phone', '')}"
            )
        lines.append("")
    if not has_contacts:
        lines += ["_No named contacts found in this run. Run with enrichment enabled._", ""]

    lines += [
        "## Full Facility List",
        "",
        "| Facility | City | Mi | Score | Phone | Category |",
        "|----------|------|----|-------|-------|----------|",
    ]
    for f in sorted(facilities, key=lambda x: x.icp_score, reverse=True):
        lines.append(
            f"| {f.name[:40]} | {f.city} | {f.distance_miles:.0f} | "
            f"{f.icp_score} | {f.phone or '—'} | {f.category} |"
        )

    lines += ["", "## HubSpot Sync", ""]
    if hs_stats and hs_stats.get("companies_created", 0) + hs_stats.get("companies_updated", 0) > 0:
        lines += [
            f"- Companies created: {hs_stats['companies_created']}",
            f"- Companies updated: {hs_stats['companies_updated']}",
            f"- Contacts created: {hs_stats['contacts_created']}",
            f"- Deals created: {hs_stats['deals_created']}",
            f"- Errors: {hs_stats['errors']}",
        ]
    else:
        today_str = date.today().isoformat()
        lines.append(f"HubSpot CSV ready for import at `marketing/prospects/hubspot-import-{today_str}.csv`")
        lines.append("_(To enable live push: set `HUBSPOT_API_KEY` in Doppler `factorylm/prd`)_")

    lines += [
        "",
        "---",
        f"_Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by MIRA Lead Hunter_",
        "_To improve results: add `SERPER_API_KEY` in Doppler for structured search data._",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))
    log.info("Report → %s", path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA Lead Hunter")
    parser.add_argument("--discover-only", action="store_true")
    parser.add_argument("--enrich-only", action="store_true",
                        help="Skip discovery; enrich facilities already in NeonDB that have no contacts")
    parser.add_argument("--report-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Cap city count (0=all)")
    parser.add_argument("--no-enrich", action="store_true", help="Skip website scraping")
    parser.add_argument("--push-hubspot", action="store_true", help="Push qualified leads to HubSpot")
    parser.add_argument("--enrich-budget", type=int, default=500,
                        help="Max Serper queries to spend on contact probing (default 500)")
    args = parser.parse_args()

    serper_key = os.environ.get("SERPER_API_KEY", "")
    db_url = os.environ.get("NEON_DATABASE_URL", "")
    hs_token = os.environ.get("HUBSPOT_ACCESS_TOKEN") or os.environ.get("HUBSPOT_API_KEY", "")
    today = date.today().isoformat()
    report_path = PROSPECTS_DIR / f"central-florida-{today}.md"
    hs_csv_path = PROSPECTS_DIR / f"hubspot-import-{today}.csv"

    cities = CITIES[:args.limit] if args.limit else CITIES

    if args.report_only:
        log.info("--report-only: loading from DB")
        if not db_url:
            log.error("NEON_DATABASE_URL required for --report-only")
            sys.exit(1)
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("SELECT name,city,phone,website,category,distance_miles,icp_score,notes FROM prospect_facilities ORDER BY icp_score DESC")
        facilities_list = []
        for row in cur.fetchall():
            f = Facility(name=row[0], city=row[1], phone=row[2] or "", website=row[3] or "",
                         category=row[4] or "", distance_miles=row[5] or 0, icp_score=row[6] or 0,
                         notes=row[7] or "")
            facilities_list.append(f)
        conn.close()
        write_report(facilities_list, report_path)
        return

    if args.enrich_only:
        log.info("--enrich-only: loading facilities from DB for contact probing")
        if not db_url:
            log.error("NEON_DATABASE_URL required for --enrich-only")
            sys.exit(1)
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT name, city, phone, website, category, distance_miles, icp_score, notes
            FROM prospect_facilities
            WHERE website IS NOT NULL AND website <> ''
              AND id NOT IN (
                  SELECT DISTINCT facility_id FROM prospect_contacts
                  WHERE facility_id IS NOT NULL
              )
            ORDER BY icp_score DESC
            """
        )
        fac_list = []
        for row in cur.fetchall():
            f = Facility(name=row[0], city=row[1], phone=row[2] or "", website=row[3] or "",
                         category=row[4] or "", distance_miles=row[5] or 0, icp_score=row[6] or 0,
                         notes=row[7] or "")
            fac_list.append(f)
        conn.close()
        log.info("Loaded %d facilities needing contact enrichment", len(fac_list))

        if not fac_list:
            log.info("Nothing to enrich — all facilities already have contacts.")
            return

        enrich_facilities(fac_list, serper_key, budget=args.enrich_budget)

        inserted = upsert_facilities(fac_list, db_url)
        log.info("DB: %d new, %d updated", inserted, len(fac_list) - inserted)

        hs_stats: Optional[dict] = None
        if args.push_hubspot and hs_token:
            log.info("=== HUBSPOT PUSH ===")
            hs_stats = push_to_hubspot(fac_list, hs_token)
            if hs_stats is None or hs_stats.get("errors", 0) == hs_stats.get("_total_attempted", 1):
                log.info("HubSpot auth failed — writing CSV fallback")
                write_hubspot_csv(fac_list, hs_csv_path)
        elif args.push_hubspot:
            log.info("No HUBSPOT_API_KEY — writing CSV fallback")
            write_hubspot_csv(fac_list, hs_csv_path)

        write_report(fac_list, report_path, hs_stats)
        log.info("Enrichment run complete — report at %s", report_path)
        return

    if db_url and not args.dry_run:
        try:
            apply_schema(db_url)
        except Exception as e:
            log.warning("Schema apply failed (non-fatal): %s", e)

    facilities: dict[str, Facility] = {}

    # Phase 0: seed known facilities
    log.info("=== SEEDING KNOWN FACILITIES ===")
    for f in seed_facilities():
        facilities[f.key] = f
    log.info("Seeded %d known facilities", len(facilities))

    log.info("=== DISCOVERY PHASE ===")
    log.info("Mode: %s | Cities: %d | Backend: %s",
             "dry-run" if args.dry_run else "live",
             len(cities),
             "serper" if serper_key else "duckduckgo")

    ddg_consecutive_fails = 0
    ddg_dead = False

    with httpx.Client(timeout=20) as client:
        for city_name, city_lat, city_lon, city_dist in cities:
            queries = [t.format(city=city_name) for t in QUERY_TEMPLATES]
            log.info("City: %s (~%dmi) — %d queries", city_name, city_dist, len(queries))

            for query in queries:
                if args.dry_run:
                    log.info("  [DRY-RUN] %r", query)
                    continue

                if serper_key:
                    results = search_serper(query, serper_key, client)
                elif ddg_dead:
                    continue
                else:
                    results = search_duckduckgo(query, client)
                    if results is None:
                        ddg_consecutive_fails += 1
                        if ddg_consecutive_fails >= DDG_FAIL_LIMIT:
                            log.warning("DDG circuit breaker tripped after %d failures — skipping remaining web queries", DDG_FAIL_LIMIT)
                            ddg_dead = True
                        results = []
                    else:
                        ddg_consecutive_fails = 0
                    time.sleep(RATE_LIMIT_SECS)

                new_facs = extract_facilities_from_results(results, city_name, city_lat, city_lon, query)
                for f in new_facs:
                    if f.key not in facilities:
                        facilities[f.key] = f
                        log.info("  + %s (%s, score=%d)", f.name[:50], f.city, f.icp_score)
                    else:
                        existing = facilities[f.key]
                        if f.icp_score > existing.icp_score:
                            existing.icp_score = f.icp_score
                        if f.phone and not existing.phone:
                            existing.phone = f.phone
                        if f.website and not existing.website:
                            existing.website = f.website

    fac_list = list(facilities.values())
    log.info("Discovery complete: %d facilities total", len(fac_list))

    if not args.discover_only and not args.no_enrich and not args.dry_run:
        enrich_facilities(fac_list, serper_key, budget=500)

    hs_stats: Optional[dict] = None
    if not args.dry_run:
        if db_url:
            inserted = upsert_facilities(fac_list, db_url)
            log.info("DB: %d new, %d updated", inserted, len(fac_list) - inserted)
        else:
            log.info("NEON_DATABASE_URL not set — skipping DB persist")

        # HubSpot push
        if hs_token:
            log.info("=== HUBSPOT PUSH ===")
            hs_stats = push_to_hubspot(fac_list, hs_token)
            if hs_stats is None or hs_stats.get("errors", 0) == hs_stats.get("_total_attempted", 1):
                log.info("HubSpot auth failed — writing CSV fallback")
                write_hubspot_csv(fac_list, hs_csv_path)
        elif args.push_hubspot:
            log.info("No HUBSPOT_API_KEY — writing CSV fallback")
            write_hubspot_csv(fac_list, hs_csv_path)

        write_report(fac_list, report_path, hs_stats)

        log.info("=== SUMMARY ===")
        log.info("Facilities: %d total", len(fac_list))
        top10 = sorted(fac_list, key=lambda f: f.icp_score, reverse=True)[:10]
        for i, f in enumerate(top10, 1):
            log.info("  %2d. %-50s %-20s score=%d", i, f.name[:50], f.city, f.icp_score)
    else:
        log.info("Dry run complete — no HTTP requests made, no DB writes.")


if __name__ == "__main__":
    main()
