"""Contact enrichment for MIRA Lead Hunter.

Sources (in order of quality):
  1. Website scraping — /contact, /about, /team pages
  2. Hunter.io API — if HUNTER_API_KEY in env
  3. Email pattern generation — first.last@domain etc.
  4. DNS MX verification — confirm domain accepts email

All functions are self-contained and safe to call independently.
"""
from __future__ import annotations

import logging
import os
import re
import socket
import subprocess
import time
from typing import Optional
from urllib.parse import urlparse

import httpx

from hunt import Facility, USER_AGENTS, EMAIL_RE, PHONE_RE, MAINT_TITLES, VFD_KWS

log = logging.getLogger("lead-hunter.enrich")

HUNTER_API = "https://api.hunter.io/v2"

EMAIL_PATTERNS = [
    "{f}.{l}@{domain}",
    "{f}{l}@{domain}",
    "{f}@{domain}",
    "{fi}{l}@{domain}",
    "{l}@{domain}",
    "{f}.{l[0]}@{domain}",
]

CONFIDENCE_LEVELS = {
    "hunter_verified": "high",
    "hunter_pattern": "medium",
    "site_found": "medium",
    "pattern_dns_ok": "low",
    "pattern_no_dns": "very_low",
}


# ---------------------------------------------------------------------------
# Hunter.io
# ---------------------------------------------------------------------------

def find_contacts_hunter(domain: str, api_key: str, client: httpx.Client) -> list[dict]:
    """Query Hunter.io domain search. Returns list of contact dicts."""
    if not domain or not api_key:
        return []
    try:
        resp = client.get(
            f"{HUNTER_API}/domain-search",
            params={"domain": domain, "api_key": api_key, "limit": 10, "type": "personal"},
            timeout=10,
        )
        if resp.status_code == 401:
            log.warning("Hunter.io 401 — invalid key")
            return []
        if resp.status_code == 429:
            log.warning("Hunter.io rate limit hit")
            return []
        resp.raise_for_status()
        data = resp.json().get("data", {})
        contacts = []
        for email_data in data.get("emails", []):
            first = email_data.get("first_name", "")
            last = email_data.get("last_name", "")
            email = email_data.get("value", "")
            position = email_data.get("position", "")
            if email and _is_maintenance_role(position):
                contacts.append({
                    "name": f"{first} {last}".strip(),
                    "title": position,
                    "email": email,
                    "source": "hunter.io",
                    "confidence": "high" if email_data.get("verification", {}).get("status") == "valid" else "medium",
                })
        return contacts
    except Exception as e:
        log.debug("Hunter.io error for %s: %s", domain, e)
        return []


def _is_maintenance_role(title: str) -> bool:
    title_l = title.lower()
    return any(t in title_l for t in [
        "maintenance", "facilities", "plant manager", "plant engineer",
        "reliability", "operations manager", "chief engineer", "facility",
        "mechanical", "electrical engineer",
    ])


# ---------------------------------------------------------------------------
# Email pattern generation
# ---------------------------------------------------------------------------

def generate_email_patterns(first: str, last: str, domain: str) -> list[dict]:
    """Generate candidate email addresses for a person at a domain."""
    if not first or not last or not domain:
        return []

    first = _clean_name(first)
    last = _clean_name(last)
    if not first or not last:
        return []

    f = first.lower()
    l = last.lower()
    fi = f[0]

    patterns = []
    templates = [
        (f"{f}.{l}@{domain}", "first.last"),
        (f"{f}{l}@{domain}", "firstlast"),
        (f"{f}@{domain}", "first"),
        (f"{fi}{l}@{domain}", "flast"),
        (f"{l}@{domain}", "last"),
        (f"{f}.{l[0]}@{domain}", "first.li"),
        (f"{fi}.{l}@{domain}", "f.last"),
    ]
    for email, pattern_name in templates:
        patterns.append({"email": email, "pattern": pattern_name, "source": "pattern"})
    return patterns


def _clean_name(s: str) -> str:
    return re.sub(r"[^a-zA-Z\-]", "", s).strip("-")


# ---------------------------------------------------------------------------
# DNS verification
# ---------------------------------------------------------------------------

def domain_has_mx(domain: str) -> bool:
    """Check if domain has MX records (domain accepts email)."""
    try:
        result = subprocess.run(
            ["dig", "+short", "MX", domain],
            capture_output=True, text=True, timeout=5,
        )
        return bool(result.stdout.strip())
    except Exception:
        # Fallback: check if domain resolves at all
        try:
            socket.getaddrinfo(domain, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            return True
        except Exception:
            return False


def verify_patterns_dns(patterns: list[dict], domain: str) -> list[dict]:
    """Add DNS confidence to email patterns."""
    has_mx = domain_has_mx(domain)
    confidence = "low" if has_mx else "very_low"
    for p in patterns:
        p["confidence"] = confidence
        p["mx_verified"] = has_mx
    return patterns


# ---------------------------------------------------------------------------
# Website deep scrape
# ---------------------------------------------------------------------------

CONTACT_PATHS = [
    "/contact", "/contact-us", "/about", "/about-us",
    "/team", "/staff", "/leadership", "/management",
    "/careers", "/jobs",
]


def scrape_facility_deep(f: Facility, client: httpx.Client) -> dict:
    """Deep scrape facility website for contacts, emails, phones, VFD keywords."""
    if not f.website or not f.website.startswith("http"):
        return {}

    result: dict = {
        "emails": [],
        "phones": [],
        "contacts": [],
        "vfd_hit": False,
        "job_descriptions": [],
        "employee_count_hint": None,
    }

    base = urlparse(f.website)
    base_url = f"{base.scheme}://{base.netloc}"
    pages_to_try = [f.website] + [base_url + p for p in CONTACT_PATHS]
    seen: set[str] = set()
    all_text = []

    for page_url in pages_to_try[:5]:
        if page_url in seen:
            continue
        seen.add(page_url)
        try:
            time.sleep(0.8)
            resp = client.get(
                page_url,
                headers={"User-Agent": USER_AGENTS[0]},
                timeout=12,
                follow_redirects=True,
            )
            if resp.status_code != 200:
                continue
            if "html" not in resp.headers.get("content-type", ""):
                continue

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, "html.parser")
            text = soup.get_text(separator=" ", strip=True)
            all_text.append(text)

            # Emails
            for email in EMAIL_RE.findall(text):
                if (email not in result["emails"]
                        and "example" not in email
                        and not email.endswith(".png")
                        and not email.endswith(".jpg")):
                    result["emails"].append(email)

            # Phones
            for phone in PHONE_RE.findall(text):
                if phone not in result["phones"]:
                    result["phones"].append(phone)

            # Named contacts with maintenance titles
            for m in re.finditer(
                r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,\-–|]\s*("
                + "|".join(re.escape(t) for t in MAINT_TITLES)
                + r")",
                text, re.IGNORECASE,
            ):
                contact = {
                    "name": m.group(1).strip(),
                    "title": m.group(2).strip(),
                    "source": page_url,
                    "confidence": "medium",
                }
                if contact not in result["contacts"]:
                    result["contacts"].append(contact)

            # Employee count hints
            emp_match = re.search(
                r"(\d{1,4})\+?\s+(?:employees|associates|team members|staff|people)",
                text, re.IGNORECASE,
            )
            if emp_match:
                result["employee_count_hint"] = int(emp_match.group(1))

        except Exception as e:
            log.debug("Scrape failed %s: %s", page_url, e)

    combined = " ".join(all_text).lower()
    result["vfd_hit"] = any(kw in combined for kw in VFD_KWS)
    result["text"] = combined[:2000]
    return result


def apply_enrichment(f: Facility, enrichment: dict, hunter_key: str = "", client: Optional[httpx.Client] = None) -> None:
    """Apply enrichment results to facility in-place. Optionally run Hunter.io."""
    if enrichment.get("emails"):
        for em in enrichment["emails"][:3]:
            c = {"email": em, "source": f.website, "confidence": "medium"}
            if c not in f.contacts:
                f.contacts.append(c)

    if enrichment.get("phones") and not f.phone:
        f.phone = enrichment["phones"][0]

    for c in enrichment.get("contacts", []):
        if c not in f.contacts:
            f.contacts.append(c)

    if enrichment.get("vfd_hit"):
        f.notes = (f.notes + " vfd_keywords_found").strip()

    # Employee count → size hint
    emp = enrichment.get("employee_count_hint")
    if emp and 20 <= emp <= 500:
        # Medium-size bonus: update review_count as proxy (triggers ICP medium_large weight)
        if f.review_count < 20:
            f.review_count = 20

    # Hunter.io for enriched contacts: generate email patterns
    if hunter_key and client:
        domain = ""
        if f.website:
            try:
                domain = urlparse(f.website).netloc.replace("www.", "")
            except Exception:
                pass
        if domain:
            hunter_contacts = find_contacts_hunter(domain, hunter_key, client)
            for c in hunter_contacts:
                if c not in f.contacts:
                    f.contacts.append(c)

    # For any named contacts without email: generate patterns
    domain = ""
    if f.website:
        try:
            domain = urlparse(f.website).netloc.replace("www.", "")
        except Exception:
            pass

    if domain:
        has_mx = None  # lazy check
        for c in f.contacts:
            if not c.get("email") and c.get("name"):
                parts = c["name"].split(" ", 1)
                if len(parts) == 2:
                    if has_mx is None:
                        has_mx = domain_has_mx(domain)
                    patterns = generate_email_patterns(parts[0], parts[1], domain)
                    if patterns and has_mx:
                        c["email"] = patterns[0]["email"]
                        c["email_confidence"] = "low"
                        c["email_pattern"] = patterns[0]["pattern"]
