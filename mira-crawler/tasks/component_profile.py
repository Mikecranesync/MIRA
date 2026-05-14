"""Celery task: extract a structured ComponentProfile from a manual.

Pipeline:
    manual_cache row → download PDF → docling extract → run deterministic
    EquipmentMatch + FaultCodeMatch for hints → Anthropic Messages API call
    via mira-core.component_profiles.extractor → validate → upsert into
    component_profiles table.

Depends on mira-core/component_profiles/ being on PYTHONPATH inside the
worker container. See requirements-celery.txt for the mount/copy note.

Daily Anthropic spend is gated by a Redis counter
`mira:component_profile:spend_today:YYYY-MM-DD` with a $50/day default cap.
Cheap insurance against runaway retry storms.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import redis

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.component_profile")

DOWNLOAD_TIMEOUT = int(os.getenv("CP_DOWNLOAD_TIMEOUT", "60"))
MAX_PDF_BYTES = int(os.getenv("CP_MAX_PDF_BYTES", str(50 * 1024 * 1024)))
MAX_MANUAL_CHARS = int(os.getenv("CP_MAX_MANUAL_CHARS", str(600_000)))  # ~200K tokens

# Daily spend ceiling — abort the task if today's cumulative estimated spend
# has crossed this. Defaults to $50/day. Set CP_DAILY_SPEND_USD_CAP=0 to disable.
DAILY_SPEND_USD_CAP = float(os.getenv("CP_DAILY_SPEND_USD_CAP", "50.0"))

# Sonnet 4.6 pricing per 1M tokens. Used only for the daily-budget estimate —
# real cost is reported by Anthropic in the usage block and tracked separately
# by the org-level dashboard. Override via env if migrating to Opus 4.7 etc.
PRICE_INPUT_PER_M = float(os.getenv("CP_PRICE_INPUT_PER_M", "3.0"))
PRICE_OUTPUT_PER_M = float(os.getenv("CP_PRICE_OUTPUT_PER_M", "15.0"))
PRICE_CACHE_READ_PER_M = float(os.getenv("CP_PRICE_CACHE_READ_PER_M", "0.30"))
PRICE_CACHE_WRITE_PER_M = float(os.getenv("CP_PRICE_CACHE_WRITE_PER_M", "3.75"))


def _estimate_spend_usd(meta_dict: dict) -> float:
    """Rough cost estimate from Anthropic usage tokens."""
    return (
        meta_dict["input_tokens"] * PRICE_INPUT_PER_M
        + meta_dict["output_tokens"] * PRICE_OUTPUT_PER_M
        + meta_dict["cache_read_input_tokens"] * PRICE_CACHE_READ_PER_M
        + meta_dict["cache_creation_input_tokens"] * PRICE_CACHE_WRITE_PER_M
    ) / 1_000_000.0


def _spend_key() -> str:
    return f"mira:component_profile:spend_today:{datetime.now(timezone.utc):%Y-%m-%d}"


def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(
        os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )


def _check_budget(r: redis.Redis) -> tuple[bool, float]:
    """(allowed, spend_today_usd). Fails open on Redis errors."""
    if DAILY_SPEND_USD_CAP <= 0:
        return True, 0.0
    try:
        raw = r.get(_spend_key())
        spent = float(raw) if raw else 0.0
        return spent < DAILY_SPEND_USD_CAP, spent
    except Exception as exc:
        logger.warning("Budget check failed (fail-open): %s", exc)
        return True, 0.0


def _record_spend(r: redis.Redis, usd: float) -> None:
    """Best-effort increment; auto-expire after 36h so the key tidies itself."""
    try:
        key = _spend_key()
        pipe = r.pipeline()
        pipe.incrbyfloat(key, usd)
        pipe.expire(key, 36 * 3600)
        pipe.execute()
    except Exception as exc:
        logger.warning("Spend record failed (non-fatal): %s", exc)


def _load_manual_cache_row(manual_cache_id: int) -> dict | None:
    """Look up one manual_cache row by id. Returns dict or None."""
    from sqlalchemy import text  # type: ignore

    from db.neon import _engine  # type: ignore

    with _engine().connect() as conn:
        row = (
            conn.execute(
                text(
                    "SELECT id, manufacturer, model, manual_url, manual_title, "
                    "source, confidence "
                    "FROM manual_cache WHERE id = :id"
                ),
                {"id": manual_cache_id},
            )
            .mappings()
            .fetchone()
        )
    return dict(row) if row else None


def _download_pdf(url: str) -> bytes:
    """Streamed PDF download with the same size guards as ingest_url."""
    if url.startswith("file://"):
        from urllib.parse import urlparse as _urlparse
        from urllib.request import url2pathname

        local_path = Path(url2pathname(_urlparse(url).path))
        data = local_path.read_bytes()
        if len(data) > MAX_PDF_BYTES:
            raise ValueError(f"file_too_large: {len(data)} bytes")
        return data

    tmp = tempfile.NamedTemporaryFile(prefix="mira-cp-", suffix=".pdf", delete=False)
    tmp_path = Path(tmp.name)
    downloaded = 0
    try:
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "MIRA-ComponentProfileBot/1.0"},
        ) as client:
            with client.stream("GET", url) as resp:
                resp.raise_for_status()
                for chunk in resp.iter_bytes(chunk_size=64 * 1024):
                    downloaded += len(chunk)
                    if downloaded > MAX_PDF_BYTES:
                        tmp.close()
                        tmp_path.unlink(missing_ok=True)
                        raise ValueError(
                            f"file_too_large: exceeded {MAX_PDF_BYTES} bytes mid-stream"
                        )
                    tmp.write(chunk)
        tmp.close()
        return tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)


def _blocks_to_text(blocks: list[dict]) -> str:
    """Flatten docling/converter blocks into one string with page markers.

    Preserves page_num markers as `[p.{n}]` so the model can produce
    page_reference fields in the profile.
    """
    parts: list[str] = []
    for b in blocks:
        text = b.get("text", "").strip()
        if not text:
            continue
        page = b.get("page_num")
        section = (b.get("section") or "").strip()
        prefix_bits: list[str] = []
        if page is not None:
            prefix_bits.append(f"[p.{page}]")
        if section:
            prefix_bits.append(f"§ {section}")
        prefix = " ".join(prefix_bits)
        parts.append(f"{prefix}\n{text}" if prefix else text)
    return "\n\n".join(parts)


def _truncate_manual(manual_text: str) -> str:
    """Soft truncation to keep context spend bounded.

    Sonnet 4.6 has a 1M context window but per-call cost scales with input
    tokens. Default 600K chars (~200K tokens) keeps spend predictable.
    Note: docling preserves manual structure so the head of the doc carries
    nameplate, fault tables, parameters — the part we actually need.
    """
    if len(manual_text) <= MAX_MANUAL_CHARS:
        return manual_text
    truncated = manual_text[:MAX_MANUAL_CHARS]
    logger.warning(
        "Manual truncated %d → %d chars (cap=%d)",
        len(manual_text),
        len(truncated),
        MAX_MANUAL_CHARS,
    )
    return truncated + "\n\n[...manual truncated for extraction budget...]"


def _build_hints(manual_text: str, manual_row: dict) -> dict:
    """Run EquipmentMatch + FaultCodeMatch and assemble extractor hints.

    Falls back to manual_cache fields if the regex extractors find nothing —
    the hints are guidance for Claude, not ground truth.
    """
    head = manual_text[:8000]  # nameplate / cover page should be here

    manufacturer_hint = manual_row.get("manufacturer") or None
    model_hint = manual_row.get("model") or None
    known_codes: list[tuple[str, str, str]] = []

    try:
        from corpus.extractors.equipment import _MFR_PATTERNS  # type: ignore
        # _MFR_PATTERNS is the canonical regex table.
        for pattern, canonical in _MFR_PATTERNS:
            if pattern.search(head):
                manufacturer_hint = manufacturer_hint or canonical
                break
    except ImportError:
        logger.debug("EquipmentMatch regex unavailable in this worker — skipping")

    try:
        from corpus.extractors.fault_codes import _KNOWN_CODES  # type: ignore
        if manufacturer_hint:
            mfr_lower = manufacturer_hint.lower()
            known_codes = [
                (code, mfr, desc)
                for code, (mfr, desc) in _KNOWN_CODES.items()
                if mfr.lower() == mfr_lower
            ]
    except ImportError:
        logger.debug("FaultCodeMatch registry unavailable in this worker — skipping")

    return {
        "manufacturer_hint": manufacturer_hint,
        "model_hint": model_hint,
        "known_fault_codes": known_codes,
    }


@app.task(
    name="component_profile.extract",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=300,
    time_limit=600,
    acks_late=False,
    rate_limit="20/m",
    autoretry_for=(httpx.HTTPError, httpx.TimeoutException),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def extract_component_profile_task(self, manual_cache_id: int) -> dict:
    """Extract one component profile from a manual_cache row.

    Returns:
        {profile_id, confidence, needs_review, model, latency_ms,
         input_tokens, output_tokens, spend_usd}
        — or {error: str} on failure.
    """
    # Imports inside the task body so import errors don't crash the worker
    # at startup if mira-core/component_profiles isn't mounted yet.
    from component_profiles.extractor import (  # type: ignore
        ExtractionError,
        extract_component_profile,
    )
    from component_profiles.schema import CopyrightHandling  # type: ignore
    from db.neon import upsert_component_profile  # type: ignore
    from ingest.converter import extract_from_pdf_with_fallback  # type: ignore

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot extract")
        return {"error": "no_tenant_id"}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY not set — cannot extract")
        return {"error": "no_anthropic_key"}

    r = _redis_client()
    allowed, spend_today = _check_budget(r)
    if not allowed:
        logger.warning(
            "BUDGET_CAP_REACHED today=%.2f cap=%.2f — skipping manual_cache_id=%s",
            spend_today,
            DAILY_SPEND_USD_CAP,
            manual_cache_id,
        )
        return {
            "error": "daily_spend_cap_reached",
            "spend_today_usd": round(spend_today, 4),
        }

    manual_row = _load_manual_cache_row(manual_cache_id)
    if not manual_row:
        return {"error": "manual_cache_row_not_found", "manual_cache_id": manual_cache_id}

    url = manual_row["manual_url"]
    if not url:
        return {"error": "manual_url_missing", "manual_cache_id": manual_cache_id}

    # 1. Download
    try:
        pdf_bytes = _download_pdf(url)
    except ValueError as ve:
        return {"error": str(ve), "url": url[:120]}

    # 2. Extract text + tables (docling under the hood, with fallbacks)
    blocks = extract_from_pdf_with_fallback(pdf_bytes)
    if not blocks:
        return {"error": "no_extractable_text", "url": url[:120]}

    manual_text = _truncate_manual(_blocks_to_text(blocks))

    # 3. Build hints from deterministic extractors
    hints = _build_hints(manual_text, manual_row)

    # 4. Anthropic call
    try:
        profile, meta = extract_component_profile(
            manual_text,
            manufacturer_hint=hints["manufacturer_hint"],
            model_hint=hints["model_hint"],
            known_fault_codes=hints["known_fault_codes"],
            source_title=manual_row.get("manual_title"),
            source_url=url,
            copyright_handling=CopyrightHandling.LINK_ONLY,
        )
    except ExtractionError as ee:
        logger.error("Extraction failed for manual_cache_id=%s: %s", manual_cache_id, ee)
        return {"error": f"extraction_failed: {ee}", "manual_cache_id": manual_cache_id}

    # 5. Record spend
    meta_dict = meta.to_dict()
    spend_usd = _estimate_spend_usd(meta_dict)
    _record_spend(r, spend_usd)

    # 6. Persist
    profile_dict = profile.model_dump(mode="json")
    # If the LLM left the manufacturer empty but the hint had one, fall back to it
    # so the unique-key write doesn't violate NOT NULL.
    manufacturer = profile.manufacturer or hints["manufacturer_hint"]
    if not manufacturer:
        return {
            "error": "manufacturer_undetermined",
            "manual_cache_id": manual_cache_id,
            "spend_usd": round(spend_usd, 4),
        }

    profile_id = upsert_component_profile(
        tenant_id=tenant_id,
        manufacturer=manufacturer,
        component_type=profile.component_type,
        profile=profile_dict,
        series=profile.series,
        model_number=(profile.model_numbers[0] if profile.model_numbers else hints["model_hint"]),
        source_manual_id=None,  # manual_cache has integer ids; manuals table FK is UUID-only
    )

    logger.info(
        "COMPONENT_PROFILE_UPSERTED id=%s manufacturer=%s component_type=%s "
        "confidence=%.2f review=%s spend=$%.4f tokens_in=%d tokens_out=%d cache_read=%d",
        profile_id,
        manufacturer,
        profile.component_type,
        profile.confidence.overall,
        profile.confidence.needs_human_review,
        spend_usd,
        meta_dict["input_tokens"],
        meta_dict["output_tokens"],
        meta_dict["cache_read_input_tokens"],
    )

    return {
        "profile_id": profile_id,
        "manufacturer": manufacturer,
        "component_type": profile.component_type,
        "confidence": profile.confidence.overall,
        "needs_review": profile.confidence.needs_human_review,
        "model": meta_dict["model"],
        "latency_ms": meta_dict["latency_ms"],
        "input_tokens": meta_dict["input_tokens"],
        "output_tokens": meta_dict["output_tokens"],
        "cache_read_input_tokens": meta_dict["cache_read_input_tokens"],
        "cache_creation_input_tokens": meta_dict["cache_creation_input_tokens"],
        "spend_usd": round(spend_usd, 4),
        "retry_attempted": meta_dict["retry_attempted"],
    }
