"""Route Fallback Registry — ADR-0009 Phase 2.

When the Phase 1 crawl verifier returns LOW_QUALITY, SHELL_ONLY, or EMPTY
for an Apify cheerio crawl, this module picks the next strategy from
config/crawl_routes.yaml and re-runs the crawl + verification until
SUCCESS or the per-request budget is exhausted.

Strategies implemented:
    apify_cheerio       — existing cheerio path (wrapped for uniformity)
    apify_playwright    — Chromium JS rendering via Apify, handles SPAs
    duckduckgo_site_search — DDG site-scoped search, extract top PDF URLs
    llm_discover_url    — LLM finds the direct manual PDF URL
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.parse as _up
from pathlib import Path
from typing import Any

import httpx
import yaml

logger = logging.getLogger("mira-ingest")

# Config file is co-located in the same directory (mira-core/mira-ingest/)
# so it can be inside the Docker build context.
# Canonical source: config/crawl_routes.yaml in repo root (symlinked copy here).
_ROUTES_PATH = Path(__file__).parent / "crawl_routes.yaml"
_ROUTES_CONFIG: dict | None = None

RETRY_ON = {"LOW_QUALITY", "SHELL_ONLY", "EMPTY"}
SKIP_ON_RETRY = {"apify_cheerio"}  # don't re-run the strategy that just failed

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


def _load_routes() -> dict:
    global _ROUTES_CONFIG
    if _ROUTES_CONFIG is None:
        try:
            with open(_ROUTES_PATH) as f:
                _ROUTES_CONFIG = yaml.safe_load(f)
        except Exception as exc:
            logger.warning("Could not load crawl_routes.yaml: %s — using defaults", exc)
            _ROUTES_CONFIG = {
                "_default": ["apify_playwright", "duckduckgo_site_search", "llm_discover_url"],
                "budget": {"max_strategies_per_request": 3, "max_cost_usd": 0.20},
            }
    return _ROUTES_CONFIG


def _strategy_list(manufacturer: str) -> list[str]:
    """Return the prioritized strategy list for this manufacturer."""
    cfg = _load_routes()
    overrides: dict = cfg.get("overrides", {})
    mfr_lower = manufacturer.lower()
    for vendor_key, strategies in overrides.items():
        if vendor_key in mfr_lower or mfr_lower in vendor_key:
            return list(strategies)
    return list(cfg.get("_default", ["apify_playwright", "duckduckgo_site_search", "llm_discover_url"]))


def _budget() -> dict:
    cfg = _load_routes()
    return cfg.get("budget", {"max_strategies_per_request": 3, "max_cost_usd": 0.20})


def _strategy_params(name: str) -> dict:
    cfg = _load_routes()
    return cfg.get("strategies", {}).get(name, {})


# ---------------------------------------------------------------------------
# Strategy: apify_playwright
# ---------------------------------------------------------------------------


async def _run_apify_playwright(
    job_id: str,
    base_url: str,
    manufacturer: str,
    model: str,
) -> tuple[list[dict], str]:
    """Crawl with Apify Playwright (JS-rendered Chromium).

    Returns (docs, apify_run_id).
    """
    params = _strategy_params("apify_playwright")
    model_tokens = [t.lower() for t in re.split(r"[\s\-_/]+", model) if len(t) >= 3]
    globs = [{"glob": f"**/*{_up.quote(t)}*"} for t in model_tokens[:3]]

    run_input = {
        "startUrls": [{"url": base_url}],
        "maxCrawlDepth": params.get("maxCrawlDepth", 2),
        "maxCrawlPages": params.get("maxCrawlPages", 20),
        "crawlerType": params.get("crawlerType", "playwright:chrome"),
        "outputFormats": ["markdown"],
        "globs": globs or [{"glob": "**/*manual*"}, {"glob": "**/*.pdf"}],
    }

    apify_key = os.getenv("APIFY_API_KEY", "")
    if not apify_key:
        logger.warning("[%s] APIFY_API_KEY not set — playwright strategy unavailable", job_id)
        return [], ""

    def _run_sync() -> tuple[list, str]:
        from apify_client import ApifyClient  # type: ignore

        client = ApifyClient(apify_key)
        run = client.actor("apify/website-content-crawler").call(
            run_input=run_input, timeout_secs=params.get("timeout_secs", 300)
        )
        run_id = (run or {}).get("id", "")
        dataset_id = (run or {}).get("defaultDatasetId")
        if not dataset_id:
            return [], run_id
        items = list(client.dataset(dataset_id).list_items().items)
        return items, run_id

    loop = asyncio.get_event_loop()
    try:
        items, apify_run_id = await loop.run_in_executor(None, _run_sync)
    except Exception as exc:
        logger.error("[%s] Playwright crawl failed: %s", job_id, exc)
        return [], ""

    # Convert to docs — same shape as main.py's _apify_items_to_docs
    docs = []
    for item in items:
        content = item.get("markdown") or item.get("text") or ""
        url = item.get("url", "")
        if len(content) < 100:
            continue
        slug = re.sub(r"[^a-z0-9_\-]", "_", url.split("/")[-1].lower())[:40] or "doc"
        fname = f"{model[:20]}_{slug}.txt".replace(" ", "_")
        docs.append({"filename": fname, "content": content, "source_url": url})

    logger.info("[%s] Playwright crawl returned %d usable docs", job_id, len(docs))
    return docs[:5], apify_run_id


# ---------------------------------------------------------------------------
# Strategy: duckduckgo_site_search
# ---------------------------------------------------------------------------

_DDG_HTML_URL = "https://html.duckduckgo.com/html/"
_URL_RE = re.compile(r"https?://[^\s\"'>]+(?:\.pdf|/manual|/user-guide|/installation|document)", re.IGNORECASE)


async def _run_duckduckgo_search(
    job_id: str,
    manufacturer: str,
    model: str,
) -> tuple[list[dict], str]:
    """Search DuckDuckGo for site-scoped manual URLs, scrape top results.

    Returns (docs, run_id="ddg" as sentinel — no Apify run involved).
    """
    params = _strategy_params("duckduckgo_site_search")
    query = f'"{manufacturer}" "{model}" manual filetype:pdf user manual installation guide'
    encoded = _up.urlencode({"q": query})

    logger.info("[%s] DDG search: %s", job_id, query[:100])

    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "MIRA/2.5 (industrial docs crawler)"}) as client:
            resp = await client.get(f"{_DDG_HTML_URL}?{encoded}")
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.error("[%s] DDG search request failed: %s", job_id, exc)
        return [], "ddg-failed"

    # Extract URLs from DDG HTML response
    found_urls = _URL_RE.findall(html)
    # Also extract result links via simple heuristic
    href_re = re.compile(r'href="(https?://[^"]+)"', re.IGNORECASE)
    hrefs = [u for u in href_re.findall(html) if not u.startswith("https://duckduckgo.com")]

    # Combine and deduplicate, prioritize PDF and doc-looking URLs
    all_urls: list[str] = []
    seen: set[str] = set()
    for url in found_urls + hrefs:
        url = url.rstrip("/")
        if url not in seen and len(url) > 20:
            seen.add(url)
            all_urls.append(url)

    pdf_urls = [u for u in all_urls if ".pdf" in u.lower()]
    doc_urls = [u for u in all_urls if u not in pdf_urls and any(
        s in u.lower() for s in ["/manual", "/user-guide", "/installation", "document", "download"]
    )]
    ordered = (pdf_urls + doc_urls + [u for u in all_urls if u not in pdf_urls + doc_urls])
    target_urls = ordered[: params.get("max_results", 8)]

    logger.info("[%s] DDG found %d candidate URLs (%d PDFs)", job_id, len(target_urls), len(pdf_urls))

    # Scrape each URL and return content
    docs: list[dict] = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": "MIRA/2.5"}) as client:
        for url in target_urls:
            if len(docs) >= params.get("max_scrape_per_result", 1) * len(target_urls):
                break
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                content_type = resp.headers.get("content-type", "").lower()
                # Skip binary PDFs (can't extract text with requests alone)
                if "pdf" in content_type:
                    logger.info("[%s] DDG: skipping binary PDF %s", job_id, url[:80])
                    continue
                text = resp.text
                if len(text) < 200:
                    continue
                # Strip HTML tags minimally
                clean = re.sub(r"<[^>]+>", " ", text)
                clean = re.sub(r"\s+", " ", clean).strip()
                if len(clean) < 200:
                    continue
                slug = re.sub(r"[^a-z0-9_\-]", "_", url.split("/")[-1].lower())[:40] or "ddg_doc"
                fname = f"{model[:20]}_{slug}.txt".replace(" ", "_")
                docs.append({"filename": fname, "content": clean, "source_url": url})
                logger.info("[%s] DDG scraped %s (%d chars)", job_id, url[:80], len(clean))
            except Exception as exc:
                logger.debug("[%s] DDG scrape failed for %s: %s", job_id, url[:80], exc)

    logger.info("[%s] DDG strategy produced %d docs", job_id, len(docs))
    return docs[:5], "ddg"


# ---------------------------------------------------------------------------
# Strategy: llm_discover_url
# ---------------------------------------------------------------------------

_LLM_PROMPT = (
    "You are a technical documentation assistant. Return the direct URL to the user manual PDF "
    "or main documentation page for the following industrial equipment. "
    "Respond with JSON only: {{\"url\": \"https://...\", \"confidence\": \"high|medium|low\"}}. "
    "If you don't know, respond {{\"url\": null, \"confidence\": \"low\"}}. "
    "Equipment: {manufacturer} {model}"
)


async def _run_llm_discover_url(
    job_id: str,
    manufacturer: str,
    model: str,
) -> tuple[list[dict], str]:
    """Ask an LLM to discover the direct URL for a manual PDF.

    Validates the URL with an HTTP HEAD request before attempting to ingest.
    Returns (docs, "llm") as sentinel — no Apify run involved.
    """
    # Try providers in order: Gemini → Groq → Anthropic
    prompt = _LLM_PROMPT.format(manufacturer=manufacturer, model=model)

    discovered_url: str | None = None
    confidence: str = "low"

    # --- Gemini ---
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    if gemini_key and not discovered_url:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_key}",
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                if resp.status_code == 200:
                    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                    text = re.sub(r"```json|```", "", text).strip()
                    parsed = json.loads(text)
                    discovered_url = parsed.get("url")
                    confidence = parsed.get("confidence", "low")
                    logger.info("[%s] LLM (Gemini) discovered URL: %s (%s)", job_id, discovered_url, confidence)
        except Exception as exc:
            logger.debug("[%s] Gemini URL discovery failed: %s", job_id, exc)

    # --- Groq ---
    groq_key = os.getenv("GROQ_API_KEY", "")
    groq_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    if groq_key and not discovered_url:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}"},
                    json={
                        "model": groq_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "response_format": {"type": "json_object"},
                        "max_tokens": 200,
                    },
                )
                if resp.status_code == 200:
                    text = resp.json()["choices"][0]["message"]["content"]
                    parsed = json.loads(text)
                    discovered_url = parsed.get("url")
                    confidence = parsed.get("confidence", "low")
                    logger.info("[%s] LLM (Groq) discovered URL: %s (%s)", job_id, discovered_url, confidence)
        except Exception as exc:
            logger.debug("[%s] Groq URL discovery failed: %s", job_id, exc)

    # --- Anthropic ---
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    claude_model = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
    if anthropic_key and not discovered_url:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": anthropic_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": claude_model,
                        "max_tokens": 200,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                if resp.status_code == 200:
                    text = resp.json()["content"][0]["text"]
                    text = re.sub(r"```json|```", "", text).strip()
                    # Find JSON in response
                    m = re.search(r"\{.*\}", text, re.DOTALL)
                    if m:
                        parsed = json.loads(m.group())
                        discovered_url = parsed.get("url")
                        confidence = parsed.get("confidence", "low")
                        logger.info("[%s] LLM (Claude) discovered URL: %s (%s)", job_id, discovered_url, confidence)
        except Exception as exc:
            logger.debug("[%s] Anthropic URL discovery failed: %s", job_id, exc)

    if not discovered_url or confidence == "low":
        logger.info("[%s] LLM URL discovery returned null or low-confidence", job_id)
        return [], "llm-null"

    # Validate URL with HTTP HEAD before attempting ingest
    params = _strategy_params("llm_discover_url")
    timeout_s = params.get("timeout_s", 15)
    try:
        async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=True) as client:
            head_resp = await client.head(discovered_url)
            if head_resp.status_code not in (200, 206):
                logger.warning(
                    "[%s] LLM-discovered URL HEAD check failed: %d %s",
                    job_id,
                    head_resp.status_code,
                    discovered_url[:80],
                )
                return [], "llm-url-invalid"
            content_type = head_resp.headers.get("content-type", "").lower()
            is_pdf = "pdf" in content_type or discovered_url.lower().endswith(".pdf")
    except Exception as exc:
        logger.warning("[%s] LLM URL HEAD check error: %s", job_id, exc)
        return [], "llm-url-unreachable"

    logger.info("[%s] LLM URL validated: %s (pdf=%s)", job_id, discovered_url[:80], is_pdf)

    if is_pdf:
        # Can't extract PDF text inline — return a stub doc pointing to the URL
        # The actual PDF ingestion would require sending to Open WebUI's /api/v1/files/
        # For now: return a doc with the URL as content so it gets KB-written as a reference
        fname = f"{model[:20]}_llm_discovered.txt".replace(" ", "_")
        stub = (
            f"Discovered manual URL for {manufacturer} {model} (high confidence):\n"
            f"Source: {discovered_url}\n\n"
            f"To ingest the full PDF, send this file directly to MIRA or use:\n"
            f"curl -X POST /ingest/document-kb -F 'file=@manual.pdf'"
        )
        return [{"filename": fname, "content": stub, "source_url": discovered_url}], "llm"
    else:
        # Fetch HTML content
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(discovered_url)
                resp.raise_for_status()
                text = re.sub(r"<[^>]+>", " ", resp.text)
                text = re.sub(r"\s+", " ", text).strip()
                if len(text) < 200:
                    return [], "llm-empty-page"
                fname = f"{model[:20]}_llm_discovered.txt".replace(" ", "_")
                return [{"filename": fname, "content": text, "source_url": discovered_url}], "llm"
        except Exception as exc:
            logger.error("[%s] LLM URL fetch failed: %s", job_id, exc)
            return [], "llm-fetch-failed"


# ---------------------------------------------------------------------------
# Public orchestrator
# ---------------------------------------------------------------------------


async def run_fallback(
    *,
    job_id: str,
    manufacturer: str,
    model: str,
    base_url: str | None,
    prev_verification: dict[str, Any],
    ingest_fn: Any,  # callable: async (filename, content, equipment_type, run_id) -> bool
    verify_fn: Any,  # callable: async (job_id, apify_run_id, manufacturer, model, kb_writes, kb_write_attempts, started_at) -> dict
    started_at: str,
) -> dict[str, Any]:
    """Try alternative crawl strategies until SUCCESS or budget exhausted.

    Args:
        job_id: Ingest job ID for correlation.
        manufacturer: Manufacturer name from scrape trigger.
        model: Model number from scrape trigger.
        base_url: Primary manufacturer doc URL (if known). Some strategies need it.
        prev_verification: Outcome dict from Phase 1 verifier.
        ingest_fn: `_ingest_scraped_text` from main.py.
        verify_fn: `verify_crawl` from crawl_verifier.py.
        started_at: ISO timestamp the job started.

    Returns:
        dict with keys: final_outcome, strategies_tried, last_verification
    """
    budget = _budget()
    max_strategies = budget.get("max_strategies_per_request", 3)
    strategy_list = _strategy_list(manufacturer)

    # Remove strategies that were already tried (for now: always skip apify_cheerio since
    # the caller already ran it; in future this could track which strategies were tried)
    remaining = [s for s in strategy_list if s not in SKIP_ON_RETRY]

    strategies_tried: list[str] = []
    last_verification = prev_verification
    fallback_job_counter = 0

    logger.info(
        "[%s] FALLBACK_START prev_outcome=%s strategies=%s",
        job_id,
        prev_verification.get("outcome"),
        remaining[:max_strategies],
    )

    for strategy in remaining[:max_strategies]:
        fallback_job_counter += 1
        fallback_job_id = f"{job_id}-fb{fallback_job_counter}"
        strategies_tried.append(strategy)

        logger.info("[%s] FALLBACK_ATTEMPT strategy=%s", job_id, strategy)

        docs: list[dict] = []
        apify_run_id = ""

        try:
            if strategy == "apify_playwright":
                url = base_url or f"https://www.{manufacturer.lower().replace(' ', '')}.com/"
                docs, apify_run_id = await _run_apify_playwright(
                    fallback_job_id, url, manufacturer, model
                )
            elif strategy == "duckduckgo_site_search":
                docs, apify_run_id = await _run_duckduckgo_search(fallback_job_id, manufacturer, model)
            elif strategy == "llm_discover_url":
                docs, apify_run_id = await _run_llm_discover_url(fallback_job_id, manufacturer, model)
            else:
                logger.warning("[%s] Unknown strategy %r — skipping", job_id, strategy)
                continue
        except Exception as exc:
            logger.error("[%s] Strategy %s failed with exception: %s", job_id, strategy, exc)
            continue

        if not docs:
            logger.info("[%s] Strategy %s returned no docs", job_id, strategy)
            continue

        # Ingest docs from this strategy
        kb_writes = 0
        kb_write_attempts = 0
        for doc in docs[:3]:
            content = doc.get("content", "")
            fname = doc.get("filename", f"{model[:20]}_fallback.txt")
            if len(content) < 100:
                continue
            kb_write_attempts += 1
            try:
                ok = await ingest_fn(fname, content, equipment_type=model[:40], run_id=apify_run_id or fallback_job_id)
                if ok:
                    kb_writes += 1
            except Exception as exc:
                logger.error("[%s] Fallback ingest failed: %s", job_id, exc)

        # Verify this strategy's outcome
        if apify_run_id and not apify_run_id.startswith("ddg") and not apify_run_id.startswith("llm"):
            try:
                verification = await verify_fn(
                    job_id=fallback_job_id,
                    apify_run_id=apify_run_id,
                    manufacturer=manufacturer,
                    model=model,
                    kb_writes=kb_writes,
                    kb_write_attempts=kb_write_attempts,
                    started_at=started_at,
                )
                last_verification = verification
                outcome = verification.get("outcome", "UNKNOWN")
            except Exception as exc:
                logger.error("[%s] Fallback verification failed: %s", job_id, exc)
                outcome = "UNKNOWN"
        else:
            # Non-Apify strategies — heuristic verification from docs
            if kb_writes > 0:
                outcome = "SUCCESS" if len(docs) >= 1 else "LOW_QUALITY"
            else:
                outcome = "EMPTY"
            last_verification = {"outcome": outcome, "strategy": strategy, "kb_writes": kb_writes}

        logger.info(
            "[%s] FALLBACK_RESULT strategy=%s outcome=%s kb_writes=%d/%d",
            job_id,
            strategy,
            outcome,
            kb_writes,
            kb_write_attempts,
        )

        if outcome == "SUCCESS":
            logger.info("[%s] FALLBACK_SUCCESS strategy=%s", job_id, strategy)
            return {
                "final_outcome": "SUCCESS",
                "winning_strategy": strategy,
                "strategies_tried": strategies_tried,
                "last_verification": last_verification,
            }

    logger.warning(
        "[%s] FALLBACK_EXHAUSTED strategies_tried=%s",
        job_id,
        strategies_tried,
    )
    return {
        "final_outcome": last_verification.get("outcome", "EMPTY"),
        "winning_strategy": None,
        "strategies_tried": strategies_tried,
        "last_verification": last_verification,
    }
