"""Real-time manual search for scan misses.

ManualsLib's search is fully client-side rendered (Vue.js, confirmed in
the existing manualslib_scraper.py docstring), so static HTTP scraping
doesn't work. DuckDuckGo HTML returns 202 / CAPTCHA from VPS IPs.

Solution: use Serper (google.serper.dev) — a thin Google Search wrapper
that returns clean JSON. The key is already in Doppler `factorylm/prd`
as SERPER_API_KEY.

The scan queue is updated as the search progresses:

    pending  → searching → found / no_match / failed

`found` carries `manual_url` (a direct PDF URL when possible) and
`notes` (the result title). The bridge into `mira-crawler/cron/manual_queue.json`
remains operator-driven for now — this module's job is discovery, not
ingest.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

import httpx

from . import scan_queue

logger = logging.getLogger("mira-scan.search")

SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
SERPER_URL = os.getenv("SERPER_URL", "https://google.serper.dev/search")
SEARCH_TIMEOUT = float(os.getenv("MANUAL_SEARCH_TIMEOUT", "15"))

# Score boost for results hosted on known OEM CDNs / curated repositories.
# Higher = preferred. Direct PDFs from manufacturer infrastructure are the
# only thing we want to feed into the ingest pipeline; everything else gets
# logged but not auto-promoted to a manual_url.
_TRUSTED_DOMAINS: tuple[tuple[str, int], ...] = (
    ("literature.rockwellautomation.com", 100),
    ("cache.industry.siemens.com", 100),
    ("support.industry.siemens.com", 100),
    ("library.e.abb.com", 100),
    ("new.abb.com", 80),
    ("yaskawa.com", 80),
    ("automationdirect.com", 90),
    ("cdn.automationdirect.com", 90),
    ("rockwellautomation.com", 75),
    ("docs.rs-online.com", 60),
    ("ideadigitalcontent.com", 50),
    ("manualslib.com", 40),
    ("manualsdir.com", 30),
    ("manualowl.com", 30),
)


def _score(url: str, title: str, model: str) -> int:
    """Heuristic relevance: trusted domain, .pdf, model token, manual-ish title."""
    if not url:
        return 0
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    score = 0
    for domain, boost in _TRUSTED_DOMAINS:
        if host == domain or host.endswith("." + domain):
            score += boost
            break
    path = (parsed.path or "").lower()
    if path.endswith(".pdf") or "pdf" in path:
        score += 30
    title_lc = (title or "").lower()
    if any(
        t in title_lc for t in ("manual", "datasheet", "data sheet", "user guide", "instruction")
    ):
        score += 10
    if model and model.lower() in (title_lc + " " + url.lower()):
        score += 25
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


async def _serper_search(query: str, num: int = 8) -> list[dict]:
    if not SERPER_API_KEY:
        raise RuntimeError("SERPER_API_KEY is not configured")
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    body = {"q": query, "num": num}
    async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
        resp = await client.post(SERPER_URL, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json().get("organic", []) or []


async def search(make: str, model: str) -> dict | None:
    """Run a real-time search for a (make, model) manual.

    Returns the best candidate dict (url, title, doc_type, score, host)
    or None if nothing reasonable was found. Caller decides whether to
    promote it to manual_url on the queue row.
    """
    make = (make or "").strip()
    model = (model or "").strip()
    if not (make or model):
        return None

    query = f"{make} {model} manual pdf".strip()
    try:
        organic = await _serper_search(query)
    except Exception:
        logger.exception("Serper search failed for %r", query)
        return None

    candidates: list[dict] = []
    for hit in organic:
        url = hit.get("link") or ""
        title = hit.get("title") or ""
        if not url:
            continue
        s = _score(url, title, model)
        if s <= 0:
            continue
        candidates.append(
            {
                "url": url,
                "title": title.lstrip("[PDF]").strip(" -"),
                "host": urlparse(url).netloc,
                "score": s,
                "doc_type": _guess_doc_type(title, url),
                "is_direct_pdf": _is_direct_pdf(url),
            }
        )
    if not candidates:
        return None
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[0]


async def run_search_and_update(make: str, model: str) -> dict | None:
    """Background task: mark searching, run search, mark result.

    Always swallows exceptions — the queue row will reflect 'failed' so
    the frontend has something coherent to render.
    """
    try:
        await scan_queue.mark_searching(make, model)
        best = await search(make, model)
        if best is None:
            await scan_queue.mark_no_match(
                make, model, notes="No relevant manuals found in web search."
            )
            logger.info("manual search: no match for %s %s", make, model)
            return None
        # Only promote to manual_url when we have a direct PDF on a
        # trusted host — otherwise it's a candidate, not an ingest target.
        manual_url = best["url"] if best["is_direct_pdf"] else None
        await scan_queue.mark_found(
            make,
            model,
            manual_url=manual_url,
            title=best["title"],
            host=best["host"],
            doc_type=best["doc_type"],
        )
        logger.info(
            "manual search: hit %s for %s %s -> %s (score=%d, direct_pdf=%s)",
            best["host"],
            make,
            model,
            best["url"],
            best["score"],
            best["is_direct_pdf"],
        )
        return best
    except Exception as exc:
        logger.exception("manual search task crashed for %s %s", make, model)
        try:
            await scan_queue.mark_failed(make, model, str(exc))
        except Exception:
            logger.exception("could not even mark queue row as failed")
        return None
