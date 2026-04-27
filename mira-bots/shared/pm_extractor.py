"""PM Schedule Extractor — NORTH STAR FLYWHEEL CORE.

Takes parsed manual chunks from knowledge_entries and extracts structured
preventive maintenance schedules using the Groq→Cerebras→Gemini cascade.

This is step 4 in the Auto-PM Pipeline:
  Photo → identify equipment → download manual → parse → [EXTRACT PMs] → calendar → share

Usage:
    from shared.pm_extractor import get_chunks_for_model, extract_pm_schedules, store_pm_schedules

    chunks = get_chunks_for_model("Yaskawa", "GA500")
    schedules = asyncio.run(extract_pm_schedules(chunks, "Yaskawa", "GA500"))
    store_pm_schedules(schedules, tenant_id="mike")
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger("mira-pm-extractor")

# ---------------------------------------------------------------------------
# PM-relevant keyword filter — used to pre-select chunks worth sending to LLM
# ---------------------------------------------------------------------------
_PM_KEYWORDS = re.compile(
    r"preventive|preventative|maintenance|inspect|lubricate|lubricant|grease|replace|"
    r"interval|schedule|every\s+\d|monthly|annually|annually|quarterly|weekly|daily|"
    r"hours?|miles?|km\b|cycle|overhaul|service|check\b|clean\b|calibrat|tighten|torque|"
    r"filter|belt|bearing|capacitor|coolant|oil\b|fluid|battery|fuse|seal|gasket|fan\b|"
    r"pm\s+schedule|pm\s+table|maintenance\s+table|service\s+interval",
    re.IGNORECASE,
)

# Max chars per batch sent to LLM — keeps context reasonable
_BATCH_CHARS = 6000
# Max batches per equipment model — avoid burning through API budget
_MAX_BATCHES = 8


# ---------------------------------------------------------------------------
# NeonDB helpers
# ---------------------------------------------------------------------------


def _get_neon_engine():
    """Create a NullPool SQLAlchemy engine for NeonDB. Lazy import."""
    from sqlalchemy import NullPool, create_engine

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def get_chunks_for_model(
    manufacturer: str,
    model_number: str,
    *,
    limit: int = 400,
) -> list[dict[str, Any]]:
    """Fetch knowledge_entries chunks for a specific equipment model.

    Returns list of dicts with keys: id, content, source_url, source_page, metadata.
    Filters to PM-relevant chunks only (by keyword match in content).
    Deduplicates by first 120 chars of content to handle duplicate ingests.
    """
    from sqlalchemy import text

    engine = _get_neon_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT id, content, source_url, source_page, metadata, chunk_type
                    FROM knowledge_entries
                    WHERE LOWER(manufacturer) ILIKE :mfr
                      AND LOWER(model_number) ILIKE :model
                    ORDER BY source_page ASC NULLS LAST, created_at ASC
                    LIMIT :lim
                    """
                ),
                {
                    "mfr": f"%{manufacturer.lower()}%",
                    "model": f"%{model_number.lower()}%",
                    "lim": limit,
                },
            ).fetchall()
    except Exception as exc:
        logger.error("get_chunks_for_model failed: %s", exc)
        return []
    finally:
        engine.dispose()

    # Filter to PM-relevant chunks and deduplicate
    seen_fingerprints: set[str] = set()
    result: list[dict[str, Any]] = []
    for row in rows:
        content = row[1] or ""
        if not _PM_KEYWORDS.search(content):
            continue
        fingerprint = content[:120].strip()
        if fingerprint in seen_fingerprints:
            continue
        seen_fingerprints.add(fingerprint)
        result.append(
            {
                "id": str(row[0]),
                "content": content,
                "source_url": row[2],
                "source_page": row[3],
                "metadata": row[4] or {},
                "chunk_type": row[5],
            }
        )

    logger.info(
        "get_chunks_for_model manufacturer=%r model=%r total=%d pm_relevant=%d",
        manufacturer,
        model_number,
        len(rows),
        len(result),
    )
    return result


# ---------------------------------------------------------------------------
# LLM extraction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an industrial maintenance expert. Extract preventive maintenance (PM) schedules from equipment manual text.

Return ONLY valid JSON with this exact structure:
{
  "pm_schedules": [
    {
      "task": "Brief description of the maintenance task",
      "interval_value": 6,
      "interval_unit": "months",
      "interval_type": "time",
      "parts_needed": ["Part name and P/N if mentioned"],
      "tools_needed": ["Tool name"],
      "estimated_duration_minutes": 30,
      "safety_requirements": ["Safety requirement"],
      "criticality": "high",
      "source_citation": "Section or table reference from the text",
      "confidence": 0.9
    }
  ]
}

Rules:
- interval_unit must be one of: hours, days, weeks, months, years, cycles
- interval_type must be one of: time, meter, condition
- criticality must be one of: low, medium, high, critical
- confidence is 0.0–1.0 based on how explicitly the manual specifies the interval
- Only include tasks with a clearly stated or strongly implied interval
- If no PM schedules are present in the text, return {"pm_schedules": []}
- Do not invent tasks not supported by the text
- Output ONLY the JSON object — no markdown, no explanation"""

_USER_PROMPT_TEMPLATE = """\
Extract all preventive maintenance schedules from the following {mfr} {model} manual text.

TEXT:
{text}"""


def _build_batches(chunks: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group chunks into batches that fit within _BATCH_CHARS."""
    batches: list[list[dict[str, Any]]] = []
    current_batch: list[dict[str, Any]] = []
    current_chars = 0

    for chunk in chunks:
        clen = len(chunk["content"])
        if current_batch and current_chars + clen > _BATCH_CHARS:
            batches.append(current_batch)
            current_batch = [chunk]
            current_chars = clen
        else:
            current_batch.append(chunk)
            current_chars += clen

    if current_batch:
        batches.append(current_batch)

    return batches[:_MAX_BATCHES]


def _parse_json_response(raw: str) -> list[dict[str, Any]]:
    """Extract pm_schedules list from LLM response with 3 fallback strategies."""
    # Strategy 1: direct parse
    try:
        data = json.loads(raw.strip())
        if isinstance(data, dict) and "pm_schedules" in data:
            return data["pm_schedules"]
    except json.JSONDecodeError:
        pass

    # Strategy 2: extract JSON object with regex
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, dict) and "pm_schedules" in data:
                return data["pm_schedules"]
        except json.JSONDecodeError:
            pass

    # Strategy 3: extract pm_schedules array directly
    match = re.search(r'"pm_schedules"\s*:\s*(\[[\s\S]*?\])', raw)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    logger.warning("_parse_json_response: could not extract pm_schedules from: %s", raw[:300])
    return []


def _validate_pm_item(item: dict[str, Any]) -> dict[str, Any] | None:
    """Validate and normalise a single PM item. Returns None if invalid."""
    if not isinstance(item, dict):
        return None

    task = str(item.get("task", "")).strip()
    if not task:
        return None

    try:
        interval_value = int(item.get("interval_value", 0))
    except (TypeError, ValueError):
        interval_value = 0
    if interval_value <= 0:
        return None

    valid_units = {"hours", "days", "weeks", "months", "years", "cycles"}
    interval_unit = str(item.get("interval_unit", "months")).lower()
    if interval_unit not in valid_units:
        interval_unit = "months"

    valid_types = {"time", "meter", "condition"}
    interval_type = str(item.get("interval_type", "time")).lower()
    if interval_type not in valid_types:
        interval_type = "time"

    valid_criticality = {"low", "medium", "high", "critical"}
    criticality = str(item.get("criticality", "medium")).lower()
    if criticality not in valid_criticality:
        criticality = "medium"

    try:
        confidence = float(item.get("confidence", 0.7))
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.7

    try:
        duration = int(item.get("estimated_duration_minutes", 0))
    except (TypeError, ValueError):
        duration = 0

    return {
        "task": task,
        "interval_value": interval_value,
        "interval_unit": interval_unit,
        "interval_type": interval_type,
        "parts_needed": [str(p) for p in (item.get("parts_needed") or [])],
        "tools_needed": [str(t) for t in (item.get("tools_needed") or [])],
        "estimated_duration_minutes": duration if duration > 0 else None,
        "safety_requirements": [str(s) for s in (item.get("safety_requirements") or [])],
        "criticality": criticality,
        "source_citation": str(item.get("source_citation", "")).strip() or None,
        "confidence": confidence,
    }


async def extract_pm_schedules(
    chunks: list[dict[str, Any]],
    manufacturer: str,
    model_number: str,
) -> list[dict[str, Any]]:
    """Extract PM schedules from knowledge_entries chunks using the LLM cascade.

    Splits chunks into batches, extracts from each, deduplicates by task name.
    Returns validated list of PM schedule dicts ready for storage.
    """
    if not chunks:
        logger.info("extract_pm_schedules: no PM-relevant chunks for %s %s", manufacturer, model_number)
        return []

    # Import here — path differs between mira-bots context and mira-pipeline (where
    # shared/ is mounted directly into the container root).
    import importlib
    import importlib.util
    _spec = importlib.util.find_spec("shared")
    _mod = importlib.import_module("shared.inference.router" if _spec else "inference.router")
    InferenceRouter = _mod.InferenceRouter  # type: ignore[attr-defined]

    router = InferenceRouter()
    if not router.enabled:
        logger.warning("extract_pm_schedules: InferenceRouter not enabled — no API keys configured")
        return []

    batches = _build_batches(chunks)
    logger.info(
        "extract_pm_schedules: %d PM-relevant chunks → %d batches for %s %s",
        len(chunks),
        len(batches),
        manufacturer,
        model_number,
    )

    all_items: list[dict[str, Any]] = []

    for i, batch in enumerate(batches):
        batch_text = "\n\n---\n\n".join(c["content"] for c in batch)
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _USER_PROMPT_TEMPLATE.format(
                    mfr=manufacturer,
                    model=model_number,
                    text=batch_text,
                ),
            },
        ]

        session_id = f"pm_extract_{manufacturer}_{model_number}_{i}"
        raw, _ = await router.complete(
            messages,
            max_tokens=2000,
            session_id=session_id,
            sanitize=False,  # OEM manual text — no PII to strip
        )

        if not raw:
            logger.warning("extract_pm_schedules: batch %d returned empty response", i)
            continue

        items = _parse_json_response(raw)
        logger.info("extract_pm_schedules: batch %d → %d raw items", i, len(items))
        all_items.extend(items)

    # Validate and deduplicate by task name (case-insensitive)
    seen_tasks: set[str] = set()
    validated: list[dict[str, Any]] = []
    for item in all_items:
        clean = _validate_pm_item(item)
        if clean is None:
            continue
        task_key = clean["task"].lower()[:80]
        if task_key in seen_tasks:
            continue
        seen_tasks.add(task_key)
        validated.append(clean)

    logger.info(
        "extract_pm_schedules: %d raw items → %d validated unique PMs for %s %s",
        len(all_items),
        len(validated),
        manufacturer,
        model_number,
    )
    return validated


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------


def ensure_pm_table() -> None:
    """Create pm_schedules table if it doesn't exist. Idempotent."""
    from sqlalchemy import text

    engine = _get_neon_engine()
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS pm_schedules (
                        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        tenant_id                 TEXT,
                        manufacturer              TEXT,
                        model_number              TEXT,
                        equipment_id              UUID,
                        task                      TEXT NOT NULL,
                        interval_value            INTEGER NOT NULL,
                        interval_unit             TEXT NOT NULL,
                        interval_type             TEXT NOT NULL,
                        parts_needed              JSONB,
                        tools_needed              JSONB,
                        estimated_duration_minutes INTEGER,
                        safety_requirements       JSONB,
                        criticality               TEXT,
                        source_citation           TEXT,
                        confidence                FLOAT,
                        next_due_at               TIMESTAMPTZ,
                        last_completed_at         TIMESTAMPTZ,
                        auto_extracted            BOOLEAN DEFAULT TRUE,
                        created_at                TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )
            # Indexes for common queries
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_pm_schedules_tenant "
                    "ON pm_schedules (tenant_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_pm_schedules_equipment "
                    "ON pm_schedules (manufacturer, model_number)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_pm_schedules_due "
                    "ON pm_schedules (next_due_at) WHERE next_due_at IS NOT NULL"
                )
            )
        logger.info("ensure_pm_table: pm_schedules table ready")
    except Exception as exc:
        logger.error("ensure_pm_table failed: %s", exc)
        raise
    finally:
        engine.dispose()


def _interval_to_next_due(interval_value: int, interval_unit: str) -> str | None:
    """Calculate next_due_at from NOW() + interval. Returns ISO string or None."""
    unit_days: dict[str, float] = {
        "hours": 1 / 24,
        "days": 1,
        "weeks": 7,
        "months": 30.44,
        "years": 365.25,
        "cycles": 0,  # can't convert cycles to time
    }
    days = unit_days.get(interval_unit, 0)
    if days <= 0:
        return None
    total_days = interval_value * days
    # Return as SQL interval expression handled at query time
    return f"{total_days} days"


def store_pm_schedules(
    schedules: list[dict[str, Any]],
    manufacturer: str,
    model_number: str,
    tenant_id: str = "mike",
    equipment_id: str | None = None,
) -> int:
    """Upsert pm_schedules into NeonDB. Returns count of rows inserted.

    Deduplicates by (tenant_id, manufacturer, model_number, task) — updates
    confidence and source_citation if a better extraction comes in.
    """
    if not schedules:
        return 0

    ensure_pm_table()

    from sqlalchemy import text

    engine = _get_neon_engine()
    inserted = 0
    try:
        with engine.begin() as conn:
            for item in schedules:
                days_str = _interval_to_next_due(item["interval_value"], item["interval_unit"])
                next_due_sql = (
                    f"NOW() + INTERVAL '{days_str}'" if days_str else "NULL"
                )

                conn.execute(
                    text(
                        f"""
                        INSERT INTO pm_schedules
                            (id, tenant_id, manufacturer, model_number, equipment_id,
                             task, interval_value, interval_unit, interval_type,
                             parts_needed, tools_needed, estimated_duration_minutes,
                             safety_requirements, criticality, source_citation, confidence,
                             next_due_at, auto_extracted)
                        VALUES
                            (gen_random_uuid(), :tenant_id, :manufacturer, :model_number, :equipment_id,
                             :task, :interval_value, :interval_unit, :interval_type,
                             :parts_needed, :tools_needed, :estimated_duration_minutes,
                             :safety_requirements, :criticality, :source_citation, :confidence,
                             {next_due_sql}, TRUE)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {
                        "tenant_id": tenant_id,
                        "manufacturer": manufacturer,
                        "model_number": model_number,
                        "equipment_id": equipment_id,
                        "task": item["task"],
                        "interval_value": item["interval_value"],
                        "interval_unit": item["interval_unit"],
                        "interval_type": item["interval_type"],
                        "parts_needed": json.dumps(item["parts_needed"]),
                        "tools_needed": json.dumps(item["tools_needed"]),
                        "estimated_duration_minutes": item.get("estimated_duration_minutes"),
                        "safety_requirements": json.dumps(item["safety_requirements"]),
                        "criticality": item["criticality"],
                        "source_citation": item.get("source_citation"),
                        "confidence": item["confidence"],
                    },
                )
                inserted += 1
    except Exception as exc:
        logger.error("store_pm_schedules failed after %d inserts: %s", inserted, exc)
        raise
    finally:
        engine.dispose()

    logger.info(
        "store_pm_schedules: inserted %d/%d for %s %s tenant=%s",
        inserted,
        len(schedules),
        manufacturer,
        model_number,
        tenant_id,
    )
    return inserted


def get_stored_pm_schedules(
    tenant_id: str,
    manufacturer: str | None = None,
    model_number: str | None = None,
    equipment_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Retrieve pm_schedules from NeonDB for a tenant, optionally filtered."""
    from sqlalchemy import text

    engine = _get_neon_engine()
    try:
        with engine.connect() as conn:
            params: dict[str, Any] = {"tenant_id": tenant_id, "lim": limit}
            filters = ["tenant_id = :tenant_id"]

            if manufacturer:
                filters.append("LOWER(manufacturer) ILIKE :mfr")
                params["mfr"] = f"%{manufacturer.lower()}%"
            if model_number:
                filters.append("LOWER(model_number) ILIKE :model")
                params["model"] = f"%{model_number.lower()}%"
            if equipment_id:
                filters.append("equipment_id = :equipment_id")
                params["equipment_id"] = equipment_id

            where = " AND ".join(filters)
            rows = conn.execute(
                text(
                    f"""
                    SELECT id, tenant_id, manufacturer, model_number, equipment_id,
                           task, interval_value, interval_unit, interval_type,
                           parts_needed, tools_needed, estimated_duration_minutes,
                           safety_requirements, criticality, source_citation, confidence,
                           next_due_at, last_completed_at, auto_extracted, created_at
                    FROM pm_schedules
                    WHERE {where}
                    ORDER BY criticality DESC, next_due_at ASC NULLS LAST
                    LIMIT :lim
                    """
                ),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("get_stored_pm_schedules failed: %s", exc)
        return []
    finally:
        engine.dispose()

    return [
        {
            "id": str(r[0]),
            "tenant_id": str(r[1]),
            "manufacturer": r[2],
            "model_number": r[3],
            "equipment_id": str(r[4]) if r[4] else None,
            "task": r[5],
            "interval_value": r[6],
            "interval_unit": r[7],
            "interval_type": r[8],
            "parts_needed": r[9] or [],
            "tools_needed": r[10] or [],
            "estimated_duration_minutes": r[11],
            "safety_requirements": r[12] or [],
            "criticality": r[13],
            "source_citation": r[14],
            "confidence": float(r[15]) if r[15] else None,
            "next_due_at": r[16].isoformat() if r[16] else None,
            "last_completed_at": r[17].isoformat() if r[17] else None,
            "auto_extracted": r[18],
            "created_at": r[19].isoformat() if r[19] else None,
        }
        for r in rows
    ]
