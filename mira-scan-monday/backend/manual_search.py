"""Real-time manual search for scan misses.

ManualsLib's search is fully client-side rendered (Vue.js, confirmed in
the existing manualslib_scraper.py docstring), so static HTTP scraping
doesn't work. DuckDuckGo HTML returns 202 / CAPTCHA from VPS IPs.

Solution: use Serper (google.serper.dev) — a thin Google Search wrapper
that returns clean JSON. The key is already in Doppler `factorylm/prd`
as SERPER_API_KEY (the lead-hunter tool uses it too).

Search strategy (multi-pass to beat SEO spam):

    1. site-scoped:    `"{make} {model}" manual filetype:pdf site:{oem_domain}`
    2. filetype:pdf:   `{make} {model} manual filetype:pdf`
    3. wider net:      `{make} {model} manual pdf`

Each query feeds into a single ranked candidate pool. The top candidate
is then HEAD-validated (`Content-Type: application/pdf` or `%PDF-` magic
bytes) before we promote it to `manual_url` and hand it to the crawler
bridge — protects against query results that 404 or redirect to HTML.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

import httpx

from . import crawler_bridge, scan_queue

logger = logging.getLogger("mira-scan.search")

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
SERPER_URL = os.getenv("SERPER_URL", "https://google.serper.dev/search")
SEARCH_TIMEOUT = float(os.getenv("MANUAL_SEARCH_TIMEOUT", "15"))
HEAD_TIMEOUT = float(os.getenv("MANUAL_HEAD_TIMEOUT", "8"))

# Manufacturer → primary download/support hosts. The first entry is also
# used as the `site:` filter for the high-precision pass. Aliases on the
# left side (lowercased) keep the lookup robust to common OCR variations
# of the make string (Allen-Bradley vs AB vs Rockwell, etc.).
_OEM_DOMAINS: dict[str, tuple[str, ...]] = {
    "beckhoff": (
        "download.beckhoff.com",
        "infosys.beckhoff.com",
        "beckhoff.com",
    ),
    "rockwell": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "rockwell automation": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "allen-bradley": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "allen bradley": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
        "rockwellautomation.com",
    ),
    "ab": (
        "literature.rockwellautomation.com",
        "ab.rockwellautomation.com",
    ),
    "siemens": (
        "support.industry.siemens.com",
        "cache.industry.siemens.com",
        "industry.siemens.com",
    ),
    "abb": (
        "library.e.abb.com",
        "new.abb.com",
        "abb.com",
    ),
    "yaskawa": (
        "yaskawa.com",
        "yaskawa.eu.com",
    ),
    "automationdirect": (
        "cdn.automationdirect.com",
        "automationdirect.com",
    ),
    "automation direct": (
        "cdn.automationdirect.com",
        "automationdirect.com",
    ),
    "schneider": ("se.com", "schneider-electric.com"),
    "schneider electric": ("se.com", "schneider-electric.com"),
    "square d": ("se.com",),
    "square-d": ("se.com",),
    "omron": ("automation.omron.com", "omron.com"),
    "phoenix contact": ("phoenixcontact.com",),
    "phoenix-contact": ("phoenixcontact.com",),
    "mitsubishi": ("mitsubishielectric.com", "mitsubishifa.co.jp"),
    "mitsubishi electric": ("mitsubishielectric.com",),
    "danfoss": ("danfoss.com",),
    "lenze": ("lenze.com",),
    "sew": ("sew-eurodrive.com",),
    "sew eurodrive": ("sew-eurodrive.com",),
    "eaton": ("eaton.com",),
    "eaton-bussmann": ("eaton.com",),
    "fluke": ("fluke.com",),
    "panduit": ("panduit.com",),
    "idec": ("idec.com",),
    "meanwell": ("meanwell.com",),
    "mean well": ("meanwell.com",),
    "baldor": ("baldor.com", "abb.com"),
    "weg": ("weg.net",),
    "festo": ("festo.com",),
    "smc": ("smcusa.com",),
    "ifm": ("ifm.com",),
    "balluff": ("balluff.com",),
    "banner": ("bannerengineering.com",),
    "pepperl": ("pepperl-fuchs.com",),
    "pepperl+fuchs": ("pepperl-fuchs.com",),
}

# Domains whose `.pdf` URLs are SEO spam, third-party scrapes, or random
# Webflow CDN dumps that should NEVER be promoted to manual_url. They get
# filtered out before scoring.
_DENY_HOSTS: frozenset[str] = frozenset(
    {
        "cdn.prod.website-files.com",
        "uploads-ssl.webflow.com",
        "assets.website-files.com",
        "global-uploads.webflow.com",
        "pdfslide.net",
        "pdfcoffee.com",
        "studylib.net",
        "studocu.com",
        "academia.edu",
        "scribd.com",
        "issuu.com",
        "yumpu.com",
        "dokumen.tips",
        "researchgate.net",
        "slideshare.net",
        "kupdf.net",
        "pdf4pro.com",
        "vdocuments.net",
    }
)

# Score boost for results hosted on known OEM CDNs / curated repositories.
# Higher = preferred. Only domains here can earn the trusted-domain
# bonus; the OEM map above is consulted *additionally* with a make-aware
# bonus so e.g. Beckhoff results get the boost without us having to
# pre-list every Beckhoff subdomain in here.
_TRUSTED_DOMAINS: tuple[tuple[str, int], ...] = (
    ("literature.rockwellautomation.com", 100),
    ("cache.industry.siemens.com", 100),
    ("support.industry.siemens.com", 100),
    ("library.e.abb.com", 100),
    ("download.beckhoff.com", 100),
    ("infosys.beckhoff.com", 100),
    ("new.abb.com", 80),
    ("yaskawa.com", 80),
    ("automationdirect.com", 90),
    ("cdn.automationdirect.com", 90),
    ("rockwellautomation.com", 75),
    ("docs.rs-online.com", 50),
)


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _oem_domains_for(make: str) -> tuple[str, ...]:
    return _OEM_DOMAINS.get(_norm(make), ())


def _is_oem_host(host: str, make: str) -> bool:
    """True if `host` (case-insensitive) is on the OEM list for `make`."""
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in _oem_domains_for(make))


def _is_denied(host: str) -> bool:
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in _DENY_HOSTS)


def _model_tokens(model: str) -> list[str]:
    """Generate progressively-shorter substrings of the model number so
    EK1100 still matches an OEM PDF named ek110x_ek15xx_en.pdf — the OEM
    family wildcard."""
    m = _norm(model)
    if not m:
        return []
    tokens = [m]
    # If the model has a digit prefix, also accept the family-prefix:
    # "EK1100" → "ek110", "EK1101" → "ek110", "ACS580" → "acs58".
    if len(m) >= 5:
        tokens.append(m[: len(m) - 1])
    if len(m) >= 6:
        tokens.append(m[: len(m) - 2])
    return tokens


def _score(url: str, title: str, make: str, model: str) -> int:
    """Heuristic relevance: deny-list, OEM domain, .pdf, model tokens, title."""
    if not url:
        return 0
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if _is_denied(host):
        return -1  # filtered out

    score = 0
    if _is_oem_host(host, make):
        score += 120  # outranks _TRUSTED_DOMAINS — manufacturer's own host
    else:
        for domain, boost in _TRUSTED_DOMAINS:
            if host == domain or host.endswith("." + domain):
                score += boost
                break

    path = (parsed.path or "").lower()
    if path.endswith(".pdf"):
        score += 30
    elif "pdf" in path or "format=pdf" in (parsed.query or "").lower():
        score += 15

    title_lc = (title or "").lower()
    if any(
        t in title_lc
        for t in (
            "manual",
            "datasheet",
            "data sheet",
            "user guide",
            "instruction",
            "operating",
        )
    ):
        score += 10

    haystack = f"{title_lc} {url.lower()}"
    for tok in _model_tokens(model):
        if tok and tok in haystack:
            # Full token worth more than a family-prefix.
            score += 25 if tok == _norm(model) else 10
            break
    return score


def _is_direct_pdf(url: str) -> bool:
    if not url:
        return False
    p = urlparse(url)
    if (p.path or "").lower().endswith(".pdf"):
        return True
    # Siemens supports format=pdf query param on teddatasheet endpoints.
    return "format=pdf" in (p.query or "").lower()


def _guess_doc_type(title: str, url: str) -> str:
    text = f"{title} {url}".lower()
    if "data sheet" in text or "datasheet" in text:
        return "technical_data"
    if "installation" in text:
        return "installation_manual"
    if "user manual" in text or "user guide" in text:
        return "user_manual"
    if "quick start" in text or "getting started" in text:
        return "quick_start"
    return "installation_manual"


def _clean_title(title: str) -> str:
    t = (title or "").strip()
    if t.startswith("[PDF]"):
        t = t[5:]
    return t.strip(" -|")


async def _serper_search(query: str, num: int = 10) -> list[dict]:
    if not SERPER_API_KEY:
        raise RuntimeError("SERPER_API_KEY is not configured")
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    body = {"q": query, "num": num}
    async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
        resp = await client.post(SERPER_URL, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json().get("organic", []) or []


async def _validate_pdf(url: str) -> bool:
    """Confirm the URL actually serves a PDF.

    Strategy: HEAD first, fall back to Range GET (some CDNs don't honour
    HEAD or strip Content-Type). Returns False on any error so a flaky
    OEM CDN doesn't crash the search.
    """
    try:
        async with httpx.AsyncClient(
            timeout=HEAD_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; mira-scan/0.3)"},
        ) as client:
            try:
                r = await client.head(url)
                ct = (r.headers.get("content-type") or "").lower()
                if "pdf" in ct and r.status_code < 400:
                    return True
            except httpx.HTTPError:
                pass

            # Some hosts 405 on HEAD or strip Content-Type — pull the
            # first 8 bytes and look for the PDF magic number.
            r = await client.get(
                url, headers={"Range": "bytes=0-7"}, timeout=HEAD_TIMEOUT
            )
            if r.status_code >= 400:
                return False
            ct = (r.headers.get("content-type") or "").lower()
            if "pdf" in ct:
                return True
            return r.content[:5] == b"%PDF-"
    except Exception:
        logger.info("PDF validation failed for %s — skipping", url[:120])
        return False


def _collect(organic: list[dict], make: str, model: str) -> list[dict]:
    out: list[dict] = []
    for hit in organic:
        url = hit.get("link") or ""
        title = hit.get("title") or ""
        if not url:
            continue
        s = _score(url, title, make, model)
        if s <= 0:
            continue
        out.append(
            {
                "url": url,
                "title": _clean_title(title),
                "host": urlparse(url).netloc,
                "score": s,
                "doc_type": _guess_doc_type(title, url),
                "is_direct_pdf": _is_direct_pdf(url),
            }
        )
    return out


async def search(make: str, model: str) -> dict | None:
    """Multi-pass real-time search for a (make, model) manual.

    Returns the best HEAD-validated PDF candidate, or None.
    """
    make = (make or "").strip()
    model = (model or "").strip()
    if not (make or model):
        return None

    candidates: list[dict] = []

    # Pass 1: site-scoped PDF — highest precision.
    oem_domains = _oem_domains_for(make)
    if oem_domains:
        q1 = f'"{model}" manual filetype:pdf site:{oem_domains[0]}'
        try:
            candidates.extend(_collect(await _serper_search(q1), make, model))
        except Exception:
            logger.exception("Serper q1 (site-scoped) failed")

    # Pass 2: typed PDF — broader, still PDFs only.
    if not any(c["is_direct_pdf"] for c in candidates):
        q2 = f"{make} {model} manual filetype:pdf"
        try:
            candidates.extend(_collect(await _serper_search(q2), make, model))
        except Exception:
            logger.exception("Serper q2 (filetype:pdf) failed")

    # Pass 3: widest fallback — accept landing pages too if nothing above.
    if not candidates:
        q3 = f"{make} {model} manual pdf"
        try:
            candidates.extend(_collect(await _serper_search(q3), make, model))
        except Exception:
            logger.exception("Serper q3 (wide) failed")

    if not candidates:
        return None

    # Dedupe on URL while preserving order, then sort by score desc.
    seen: set[str] = set()
    deduped: list[dict] = []
    for c in candidates:
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        deduped.append(c)
    deduped.sort(key=lambda c: c["score"], reverse=True)

    # HEAD-validate the top few; first one that confirms PDF wins.
    for c in deduped[:5]:
        if not c["is_direct_pdf"]:
            # Direct PDF preferred for ingest, but a verified PDF served
            # from a non-.pdf URL still counts.
            pass
        if await _validate_pdf(c["url"]):
            c["validated"] = True
            return c

    # Nothing validated — return the top scorer as a candidate so the
    # operator can review it (mark_found will downgrade to status=
    # 'candidate' since is_direct_pdf may be False and we won't promote
    # to manual_url without validation).
    deduped[0]["validated"] = False
    return deduped[0]


async def run_search_and_update(make: str, model: str) -> dict | None:
    """Background task: mark searching, run search, mark result."""
    try:
        await scan_queue.mark_searching(make, model)
        best = await search(make, model)
        if best is None:
            await scan_queue.mark_no_match(
                make, model, notes="No relevant manuals found in web search."
            )
            logger.info("manual search: no match for %s %s", make, model)
            return None

        # Promote to manual_url ONLY when the candidate is a direct PDF
        # AND HEAD-validated. Anything else is flagged 'candidate' for
        # human review — never auto-fed to the ingest pipeline.
        promote = bool(best.get("is_direct_pdf") and best.get("validated"))
        manual_url = best["url"] if promote else None

        await scan_queue.mark_found(
            make,
            model,
            manual_url=manual_url,
            title=best["title"],
            host=best["host"],
            doc_type=best["doc_type"],
        )
        logger.info(
            "manual search: %s for %s %s -> %s (score=%d, direct_pdf=%s, validated=%s)",
            "PROMOTED" if promote else "candidate",
            make,
            model,
            best["url"],
            best["score"],
            best["is_direct_pdf"],
            best.get("validated"),
        )

        if manual_url:
            handoff = await crawler_bridge.record_scan_discovery(
                manufacturer=make,
                model=model,
                manual_url=manual_url,
                manual_title=best["title"],
                manual_type=best["doc_type"],
            )
            logger.info("crawler bridge: %s", handoff)
        return best
    except Exception as exc:
        logger.exception("manual search task crashed for %s %s", make, model)
        try:
            await scan_queue.mark_failed(make, model, str(exc))
        except Exception:
            logger.exception("could not even mark queue row as failed")
        return None
