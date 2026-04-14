"""Crawl Verification Layer — post-crawl quality gate for Apify results.

Called after every Apify actor run completes. Fetches the dataset items,
computes quality metrics, classifies the outcome, and writes a verification
record to crawl_verifications.sqlite.

Outcome codes (ADR-0009):
    SUCCESS     — real manual content, ready to use
    LOW_QUALITY — pages exist but are listing/index pages, not manual content
    SHELL_ONLY  — pages exist but are JS-rendered shells (Cheerio got nav only)
    EMPTY       — zero usable pages returned
    FAILED      — Apify actor status was not SUCCEEDED
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("mira-ingest")

# ---------------------------------------------------------------------------
# Outcome codes
# ---------------------------------------------------------------------------

OUTCOME_SUCCESS = "SUCCESS"
OUTCOME_LOW_QUALITY = "LOW_QUALITY"
OUTCOME_SHELL_ONLY = "SHELL_ONLY"
OUTCOME_EMPTY = "EMPTY"
OUTCOME_FAILED = "FAILED"

# ---------------------------------------------------------------------------
# Thresholds (tunable without code changes — set via env vars)
# ---------------------------------------------------------------------------

MIN_PAGES_SUCCESS = int(os.getenv("VERIFIER_MIN_PAGES", "3"))
MAX_SHELL_RATIO = float(os.getenv("VERIFIER_MAX_SHELL_RATIO", "0.5"))
MIN_CONTENT_DENSITY = float(os.getenv("VERIFIER_MIN_CONTENT_DENSITY", "0.3"))
# Minimum average text length across all pages — discriminates real manual content
# (10K-50K chars/page) from listing/directory pages (700-3500 chars/page).
# Yaskawa download listing pages: avg ~1500-2500 chars. Real manuals: 5K-50K+.
MIN_AVG_CONTENT_LENGTH = int(os.getenv("VERIFIER_MIN_AVG_CONTENT_LENGTH", "4000"))

# Nav/shell keywords — pages dominated by these are shell pages
_NAV_KEYWORDS = frozenset(
    [
        "home",
        "products",
        "support",
        "contact",
        "about",
        "login",
        "sign in",
        "sign up",
        "register",
        "search",
        "menu",
        "navigation",
        "cookie",
        "privacy policy",
        "terms of service",
        "terms of use",
        "all rights reserved",
        "copyright",
        "subscribe",
        "newsletter",
        "follow us",
        "social media",
    ]
)

# Content-density signals — pages with ≥2 of these are likely real manual content.
# Intentionally excludes generic single terms ("motor", "inverter", "drive") that
# appear on product listing pages — those are low-confidence and cause false positives.
_TECHNICAL_SIGNALS = [
    "fault code",
    "alarm code",
    "alarm list",
    "fault display",
    "error code",
    "parameter setting",
    "parameter table",
    "installation guide",
    "installation manual",
    "wiring diagram",
    "terminal block",
    "troubleshooting",
    "troubleshoot",
    "replacement procedure",
    "datasheet",
    "technical manual",
    "user manual",
    "instruction manual",
    "overcurrent",
    "overvoltage",
    "overload trip",
    "ground fault",
    "encoder feedback",
    "accel time",
    "decel time",
    "carrier frequency",
]

# Deep URL path indicators — present in real documentation paths
_DEEP_URL_RE = re.compile(
    r"/pdf|/manual|/document|/datasheet|/guide|/spec|/installation|"
    r"/user-guide|/download/|/technical|/en/|/sitefinity/|"
    r"\d{4,}|UM\d+|TM\d+|publication",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# SQLite persistence
# ---------------------------------------------------------------------------

_VERIFY_DB_PATH = os.getenv(
    "CRAWL_VERIFY_DB",
    "/opt/mira/data/crawl_verifications.sqlite",
)
_db_initialized = False


def _get_verify_db() -> sqlite3.Connection:
    global _db_initialized
    db_path = Path(_VERIFY_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    if not _db_initialized:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crawl_runs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id          TEXT NOT NULL,
                manufacturer    TEXT NOT NULL,
                model           TEXT NOT NULL,
                apify_actor     TEXT NOT NULL DEFAULT 'apify/website-content-crawler',
                apify_run_id    TEXT,
                apify_dataset_id TEXT,
                outcome         TEXT NOT NULL,
                page_count      INTEGER NOT NULL DEFAULT 0,
                shell_ratio     REAL NOT NULL DEFAULT 0.0,
                content_density REAL NOT NULL DEFAULT 0.0,
                model_keyword_hit REAL NOT NULL DEFAULT 0.0,
                url_depth_ratio REAL NOT NULL DEFAULT 0.0,
                avg_content_length REAL NOT NULL DEFAULT 0.0,
                kb_writes       INTEGER NOT NULL DEFAULT 0,
                kb_write_attempts INTEGER NOT NULL DEFAULT 0,
                started_at      TEXT NOT NULL,
                finished_at     TEXT,
                raw_metrics     TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_crawl_runs_run_id ON crawl_runs(run_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_crawl_runs_outcome ON crawl_runs(outcome)"
        )
        conn.commit()
        _db_initialized = True
    return conn


# ---------------------------------------------------------------------------
# Metric computation
# ---------------------------------------------------------------------------


def _is_shell_page(text: str) -> bool:
    """Return True if a page is essentially empty — a JS-rendered shell.

    Uses only length as the discriminator. Anything < 500 chars is classified
    as a shell: JS-rendered pages where Cheerio got only the bare HTML skeleton.

    Nav keyword counting is intentionally NOT used here. Download listing pages
    may contain nav elements (Home, Products, Login) alongside document titles
    ("V1000 User Manual", "Installation Guide") — counting nav keywords would
    wrongly classify listing pages as shells. The avg_content_length metric in
    _classify() handles the listing-vs-manual discrimination instead.
    """
    return len(text) < 500


def _has_technical_content(text: str) -> bool:
    """Return True if a page contains ≥2 technical manual signals."""
    lower = text.lower()
    hits = sum(1 for sig in _TECHNICAL_SIGNALS if sig in lower)
    return hits >= 2


def _has_model_keyword(text: str, model_tokens: list[str]) -> bool:
    """Return True if page contains ≥1 model-specific token (not just brand name).

    Uses only tokens ≥4 chars to avoid matching common short words.
    """
    lower = text.lower()
    return any(tok in lower for tok in model_tokens if len(tok) >= 4)


def _compute_metrics(
    items: list[dict],
    manufacturer: str,
    model: str,
) -> dict[str, Any]:
    """Compute quality metrics from a list of Apify dataset items.

    Returns a dict with: page_count, shell_ratio, content_density,
    model_keyword_hit, url_depth_ratio, and supporting counts.
    """
    model_tokens = [t.lower() for t in re.split(r"[\s\-_/]+", model) if len(t) >= 3]
    # Exclude the manufacturer name itself from model tokens to avoid false positives
    mfr_lower = manufacturer.lower()
    model_tokens = [t for t in model_tokens if t not in mfr_lower]

    total = len(items)
    if total == 0:
        return {
            "page_count": 0,
            "shell_ratio": 1.0,
            "content_density": 0.0,
            "model_keyword_hit": 0.0,
            "url_depth_ratio": 0.0,
            "shell_count": 0,
            "technical_count": 0,
            "model_hit_count": 0,
            "deep_url_count": 0,
        }

    shell_count = 0
    technical_count = 0
    model_hit_count = 0
    deep_url_count = 0

    for item in items:
        text = item.get("text", "") or item.get("markdown", "") or ""
        url = item.get("url", "")

        if _is_shell_page(text):
            shell_count += 1
        if _has_technical_content(text):
            technical_count += 1
        if model_tokens and _has_model_keyword(text, model_tokens):
            model_hit_count += 1
        if _DEEP_URL_RE.search(url):
            deep_url_count += 1

    # Average content length across all pages (shell and non-shell alike)
    total_chars = sum(
        len(item.get("text", "") or item.get("markdown", "") or "") for item in items
    )
    avg_content_length = total_chars / total

    return {
        "page_count": total,
        "shell_ratio": shell_count / total,
        "content_density": technical_count / total,
        "model_keyword_hit": model_hit_count / total if model_tokens else 0.0,
        "url_depth_ratio": deep_url_count / total,
        "avg_content_length": avg_content_length,
        "shell_count": shell_count,
        "technical_count": technical_count,
        "model_hit_count": model_hit_count,
        "deep_url_count": deep_url_count,
    }


def _classify(metrics: dict[str, Any]) -> str:
    """Map computed metrics to an outcome code.

    Classification logic:
    - EMPTY: no pages at all
    - FAILED: set upstream before calling this function (Apify status ≠ SUCCEEDED)
    - SHELL_ONLY: shell_ratio ≥ threshold — JS-rendered site, Cheerio got nav only
    - SUCCESS: page_count OK + content_density OK + model keyword hit ≥ 1 page
    - LOW_QUALITY: pages exist but either no model keyword hit or insufficient content
      density (listing/index pages, not actual manual content)
    """
    page_count = metrics["page_count"]
    shell_ratio = metrics["shell_ratio"]
    content_density = metrics["content_density"]
    model_hit = metrics["model_keyword_hit"]

    if page_count == 0:
        return OUTCOME_EMPTY

    # All (or nearly all) pages are shell/nav (JS-rendered, Cheerio sees empty HTML)
    if shell_ratio >= MAX_SHELL_RATIO:
        return OUTCOME_SHELL_ONLY

    # Full success: enough pages, enough technical content, AND model-specific keyword
    # present. model_hit > 0 is required to prevent generic listing pages from passing —
    # a download index for a manufacturer will have content_density > 0 (contains words
    # like "installation" in nav links) but won't contain the specific model number.
    avg_content_length = metrics.get("avg_content_length", 0)

    # Full success: enough pages, technical content, model-specific keyword present,
    # AND average content length above the listing-page threshold.
    # The avg_content_length check discriminates real manual content (5K-50K chars)
    # from download listing/directory pages (700-3500 chars) even when both contain
    # technical terms and model numbers.
    if (
        page_count >= MIN_PAGES_SUCCESS
        and content_density >= MIN_CONTENT_DENSITY
        and model_hit > 0
        and avg_content_length >= MIN_AVG_CONTENT_LENGTH
    ):
        return OUTCOME_SUCCESS

    # Pages exist but no model-specific content or insufficient density — listing pages
    return OUTCOME_LOW_QUALITY


# ---------------------------------------------------------------------------
# Apify dataset fetch
# ---------------------------------------------------------------------------


async def _fetch_apify_dataset(dataset_id: str, apify_token: str) -> list[dict]:
    """Fetch all items from an Apify dataset. Returns empty list on error."""
    url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={apify_token}&limit=200"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch Apify dataset %s: %s", dataset_id, exc)
        return []


async def _fetch_apify_run(run_id: str, apify_token: str) -> dict:
    """Fetch Apify run metadata (status, datasetId, stats)."""
    url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={apify_token}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json().get("data", {})
    except Exception as exc:
        logger.warning("Failed to fetch Apify run %s: %s", run_id, exc)
        return {}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def verify_crawl(
    *,
    job_id: str,
    apify_run_id: str,
    manufacturer: str,
    model: str,
    kb_writes: int = 0,
    kb_write_attempts: int = 0,
    started_at: str | None = None,
) -> dict[str, Any]:
    """Verify a completed Apify crawl and write a record to the verification DB.

    Args:
        job_id: Internal mira-ingest job ID (for log correlation).
        apify_run_id: The Apify actor run ID (e.g. "Brgo1xN4QLjhr0Pgc").
        manufacturer: Manufacturer name (from scrape trigger request).
        model: Model number/name (from scrape trigger request).
        kb_writes: Count of successful KB file/add calls (HTTP 200).
        kb_write_attempts: Total KB file/add attempts made.
        started_at: ISO timestamp when the job started. Defaults to now.

    Returns:
        dict with keys: outcome, page_count, shell_ratio, content_density,
        model_keyword_hit, url_depth_ratio, kb_writes, metrics, run_id (DB row id)
    """
    apify_token = os.getenv("APIFY_API_KEY", "")
    started = started_at or datetime.now(timezone.utc).isoformat()
    finished = datetime.now(timezone.utc).isoformat()

    # Fetch run metadata to get dataset ID
    run_data = await _fetch_apify_run(apify_run_id, apify_token)
    apify_status = run_data.get("status", "UNKNOWN")
    dataset_id = run_data.get("defaultDatasetId", "")

    if apify_status != "SUCCEEDED" or not dataset_id:
        outcome = OUTCOME_FAILED
        metrics: dict[str, Any] = {
            "page_count": 0,
            "shell_ratio": 1.0,
            "content_density": 0.0,
            "model_keyword_hit": 0.0,
            "url_depth_ratio": 0.0,
        }
        logger.warning(
            "[%s] CRAWL_VERIFY_FAILED outcome=%s apify_status=%s dataset_id=%r",
            job_id,
            outcome,
            apify_status,
            dataset_id,
        )
    else:
        items = await _fetch_apify_dataset(dataset_id, apify_token)
        metrics = _compute_metrics(items, manufacturer, model)
        outcome = _classify(metrics)

        log_fn = logger.info if outcome == OUTCOME_SUCCESS else logger.warning
        log_fn(
            "[%s] CRAWL_VERIFY outcome=%s pages=%d shell_ratio=%.2f "
            "content_density=%.2f model_hit=%.2f url_depth=%.2f kb_writes=%d/%d",
            job_id,
            outcome,
            metrics["page_count"],
            metrics["shell_ratio"],
            metrics["content_density"],
            metrics["model_keyword_hit"],
            metrics["url_depth_ratio"],
            kb_writes,
            kb_write_attempts,
        )

    # Persist to verification DB
    db_row_id: int | None = None
    try:
        conn = _get_verify_db()
        cur = conn.execute(
            """
            INSERT INTO crawl_runs (
                run_id, manufacturer, model, apify_run_id, apify_dataset_id,
                outcome, page_count, shell_ratio, content_density,
                model_keyword_hit, url_depth_ratio, avg_content_length,
                kb_writes, kb_write_attempts,
                started_at, finished_at, raw_metrics
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                manufacturer,
                model,
                apify_run_id,
                dataset_id,
                outcome,
                metrics.get("page_count", 0),
                metrics.get("shell_ratio", 1.0),
                metrics.get("content_density", 0.0),
                metrics.get("model_keyword_hit", 0.0),
                metrics.get("url_depth_ratio", 0.0),
                metrics.get("avg_content_length", 0.0),
                kb_writes,
                kb_write_attempts,
                started,
                finished,
                json.dumps(metrics),
            ),
        )
        conn.commit()
        db_row_id = cur.lastrowid
        conn.close()
    except Exception as exc:
        logger.error("[%s] Failed to write crawl verification record: %s", job_id, exc)

    return {
        "outcome": outcome,
        "page_count": metrics.get("page_count", 0),
        "shell_ratio": metrics.get("shell_ratio", 1.0),
        "content_density": metrics.get("content_density", 0.0),
        "model_keyword_hit": metrics.get("model_keyword_hit", 0.0),
        "url_depth_ratio": metrics.get("url_depth_ratio", 0.0),
        "avg_content_length": metrics.get("avg_content_length", 0.0),
        "kb_writes": kb_writes,
        "kb_write_attempts": kb_write_attempts,
        "apify_run_id": apify_run_id,
        "apify_dataset_id": dataset_id,
        "metrics": metrics,
        "db_row_id": db_row_id,
    }


def list_verifications(limit: int = 50) -> list[dict]:
    """Return the most recent crawl verification records (newest first)."""
    try:
        conn = _get_verify_db()
        rows = conn.execute(
            """
            SELECT id, run_id, manufacturer, model, apify_run_id, apify_dataset_id,
                   outcome, page_count, shell_ratio, content_density,
                   model_keyword_hit, url_depth_ratio, avg_content_length,
                   kb_writes, kb_write_attempts,
                   started_at, finished_at
            FROM crawl_runs
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.error("Failed to list crawl verifications: %s", exc)
        return []


async def classify_historical(
    *,
    apify_run_id: str,
    manufacturer: str,
    model: str,
    job_id: str = "historical",
) -> dict[str, Any]:
    """Classify a historical Apify run after-the-fact (no KB write tracking).

    Used for retroactive analysis of past crawls (e.g. the Yaskawa V1000 run).
    """
    return await verify_crawl(
        job_id=job_id,
        apify_run_id=apify_run_id,
        manufacturer=manufacturer,
        model=model,
        kb_writes=0,
        kb_write_attempts=0,
    )
