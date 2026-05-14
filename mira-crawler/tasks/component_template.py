"""Component template extraction — automated post-ingest pipeline.

After a manual lands in `knowledge_entries`, this task pulls the chunks for
(manufacturer, model), runs the existing Groq → Cerebras cascade in
`tools/build_component_template.py`, and upserts one row into
`component_templates` (+ provenance rows in `component_template_sources`).

Constraints
-----------
- LLM cascade is the Groq → Cerebras path defined in tools/build_component_template.py.
  No Anthropic — CLAUDE.md hard constraint #2.
- Idempotent. `verified` rows are never overwritten by the LLM; `rejected` rows
  are left as-is until a human re-opens them; `proposed` rows are updated in
  place so the latest extraction wins.
- Never blocks ingest — failures are logged with structured fields, not raised.

Issue: #1257.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Path bootstrap — make tools/build_component_template.py importable from
# both Docker (PYTHONPATH includes /app/tools) and local dev (sibling dir).
# ---------------------------------------------------------------------------

_TASK_DIR = Path(__file__).resolve().parent
_CRAWLER_DIR = _TASK_DIR.parent
_REPO_ROOT = _CRAWLER_DIR.parent

for _candidate in (_REPO_ROOT / "tools", Path("/app/tools")):
    if _candidate.exists() and str(_candidate) not in sys.path:
        sys.path.insert(0, str(_candidate))

# ---------------------------------------------------------------------------
# Celery app — supports both mira_crawler.* (Docker) and tasks.* (local) layouts.
# ---------------------------------------------------------------------------

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app  # type: ignore[no-redef]

from build_component_template import (  # type: ignore[import-not-found]  # noqa: E402
    _engine,
    extract_template,
    fetch_chunks,
)

try:
    from mira_crawler.ingest.uns import model_path  # type: ignore[import-not-found]
except ImportError:
    from ingest.uns import model_path  # type: ignore[import-not-found]

logger = logging.getLogger("mira-crawler.tasks.component_template")


# ---------------------------------------------------------------------------
# Idempotent upsert helpers.
# ---------------------------------------------------------------------------


def _existing_template(manufacturer: str, model: str) -> dict[str, Any] | None:
    """Return the latest-version row for (manufacturer, model), or None."""
    from sqlalchemy import text

    sql = text(
        """
        SELECT id, version, verification_status
        FROM component_templates
        WHERE manufacturer ILIKE :mfr AND model ILIKE :model
        ORDER BY version DESC
        LIMIT 1
        """
    )
    with _engine().connect() as conn:
        row = conn.execute(sql, {"mfr": manufacturer, "model": model}).mappings().fetchone()
    return dict(row) if row else None


def _upsert_template(
    extracted: dict[str, Any],
    manufacturer: str,
    model: str,
    category: str,
    component_type: str,
    chunks: list[dict[str, Any]],
    existing: dict[str, Any] | None,
    knowledge_entry_id: str | None,
    source_type: str,
) -> tuple[str, str]:
    """INSERT a new row or UPDATE an existing `proposed` one in place.

    Returns (template_id, action). action ∈
        {"inserted", "updated", "updated_after_race", "skipped_verified"}.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    if existing and existing.get("verification_status") == "verified":
        logger.info(
            "Template %s for %s %s is verified — skipping LLM overwrite",
            existing["id"],
            manufacturer,
            model,
        )
        return str(existing["id"]), "skipped_verified"

    uns_path = model_path(manufacturer, model)

    params: dict[str, Any] = {
        "cat": category,
        "type": component_type,
        "mfr": manufacturer,
        "model": model,
        "description": extracted.get("description"),
        "power": json.dumps(extracted.get("power_specs", {})),
        "io": json.dumps(extracted.get("input_output_specs", {})),
        "signal": json.dumps(extracted.get("signal_behavior", {})),
        "connector": extracted.get("connector_type"),
        "pinout": json.dumps(extracted.get("pinout", {})),
        "env": json.dumps(extracted.get("environmental_limits", {})),
        "mounting": extracted.get("mounting_notes"),
        "indicators": json.dumps(extracted.get("diagnostic_indicators", [])),
        "signals": json.dumps(extracted.get("expected_signals", [])),
        "failures": json.dumps(extracted.get("common_failure_modes", [])),
        "troubleshooting": json.dumps(extracted.get("troubleshooting_steps", [])),
        "pm": json.dumps(extracted.get("pm_checks", [])),
        "safety": json.dumps(extracted.get("safety_notes", [])),
        "uns_rec": extracted.get("recommended_uns_template") or uns_path,
        "uns_path": uns_path,
    }

    update_sql = text(
        """
        UPDATE component_templates SET
            component_category = :cat,
            component_type = :type,
            description = :description,
            power_specs = :power,
            input_output_specs = :io,
            signal_behavior = :signal,
            connector_type = :connector,
            pinout = :pinout,
            environmental_limits = :env,
            mounting_notes = :mounting,
            diagnostic_indicators = :indicators,
            expected_signals = :signals,
            common_failure_modes = :failures,
            troubleshooting_steps = :troubleshooting,
            pm_checks = :pm,
            safety_notes = :safety,
            recommended_uns_template = :uns_rec,
            uns_path = :uns_path::ltree,
            updated_at = now()
        WHERE id = :id AND verification_status <> 'verified'
        """
    )

    with _engine().begin() as conn:
        if existing:
            template_id = str(existing["id"])
            params["id"] = template_id
            conn.execute(update_sql, params)
            conn.execute(
                text(
                    "DELETE FROM component_template_sources "
                    "WHERE template_id = :id AND extracted_by = 'llm'"
                ),
                {"id": template_id},
            )
            action = "updated"
        else:
            template_id = str(uuid.uuid4())
            params["id"] = template_id
            try:
                conn.execute(
                    text(
                        """
                        INSERT INTO component_templates (
                            id, component_category, component_type,
                            manufacturer, model, description,
                            power_specs, input_output_specs, signal_behavior,
                            connector_type, pinout, environmental_limits,
                            mounting_notes, diagnostic_indicators, expected_signals,
                            common_failure_modes, troubleshooting_steps, pm_checks,
                            safety_notes, recommended_uns_template, uns_path,
                            verification_status, version
                        ) VALUES (
                            :id, :cat, :type,
                            :mfr, :model, :description,
                            :power, :io, :signal,
                            :connector, :pinout, :env,
                            :mounting, :indicators, :signals,
                            :failures, :troubleshooting, :pm,
                            :safety, :uns_rec, :uns_path::ltree,
                            'proposed', 1
                        )
                        ON CONFLICT (manufacturer, model, version) DO NOTHING
                        """
                    ),
                    params,
                )
                action = "inserted"
            except IntegrityError:
                # Belt-and-suspenders: ON CONFLICT should swallow dupes, but a
                # parallel worker could have raced on a different constraint.
                action = "updated_after_race"

            winner = _existing_template(manufacturer, model)
            if winner and str(winner["id"]) != template_id:
                template_id = str(winner["id"])
                params["id"] = template_id
                conn.execute(update_sql, params)
                conn.execute(
                    text(
                        "DELETE FROM component_template_sources "
                        "WHERE template_id = :id AND extracted_by = 'llm'"
                    ),
                    {"id": template_id},
                )
                action = "updated_after_race"

        for chunk in chunks[:10]:
            conn.execute(
                text(
                    """
                    INSERT INTO component_template_sources (
                        template_id, source_type, source_document_id, excerpt,
                        extraction_confidence, extracted_by
                    ) VALUES (:tid, :stype, :sdoc, :excerpt, :conf, 'llm')
                    """
                ),
                {
                    "tid": template_id,
                    "stype": _normalize_source_type(chunk.get("source_type") or source_type),
                    "sdoc": chunk.get("id"),
                    "excerpt": (chunk.get("content") or "")[:500],
                    "conf": 0.55,
                },
            )

        if knowledge_entry_id:
            try:
                sdoc_uuid: str | None = str(uuid.UUID(knowledge_entry_id))
            except (ValueError, AttributeError):
                sdoc_uuid = None
            conn.execute(
                text(
                    """
                    INSERT INTO component_template_sources (
                        template_id, source_type, source_document_id, excerpt,
                        extraction_confidence, extracted_by
                    ) VALUES (:tid, :stype, :sdoc, :excerpt, :conf, 'llm')
                    """
                ),
                {
                    "tid": template_id,
                    "stype": _normalize_source_type(source_type),
                    "sdoc": sdoc_uuid,
                    "excerpt": f"trigger:knowledge_entry_id={knowledge_entry_id}",
                    "conf": 0.55,
                },
            )

    return template_id, action


_ALLOWED_SOURCE_TYPES = {
    "manual",
    "datasheet",
    "print",
    "technician_note",
    "oem_kb",
    "other",
}


def _normalize_source_type(raw: str | None) -> str:
    """Map ingest-side source_type values onto the CHECK-constrained enum."""
    if not raw:
        return "manual"
    lower = raw.lower()
    if lower in _ALLOWED_SOURCE_TYPES:
        return lower
    if "manual" in lower:
        return "manual"
    if "datasheet" in lower or "data_sheet" in lower:
        return "datasheet"
    return "other"


def _log_extraction(
    manufacturer: str,
    model: str,
    status: str,
    chunks_used: int,
    template_id: str | None = None,
    error: str | None = None,
) -> None:
    logger.info(
        "component_template_extraction status=%s mfr=%r model=%r chunks=%d template=%s err=%s",
        status,
        manufacturer,
        model,
        chunks_used,
        template_id or "-",
        (error or "")[:200],
    )


# ---------------------------------------------------------------------------
# Celery task.
# ---------------------------------------------------------------------------


@app.task(
    bind=True,
    name="mira_crawler.tasks.component_template.extract_component_template",
    max_retries=2,
    soft_time_limit=300,
    time_limit=420,
    acks_late=True,
    autoretry_for=(),
    default_retry_delay=60,
)
def extract_component_template(
    self,
    manufacturer: str = "",
    model: str = "",
    category: str = "unknown",
    component_type: str = "unknown",
    knowledge_entry_id: str | None = None,
    source_type: str = "manual",
    chunk_limit: int = 40,
) -> dict[str, Any]:
    """Pull chunks for (manufacturer, model), run extraction, upsert template.

    Idempotent — safe to call repeatedly. `verified` rows stay untouched;
    `rejected` rows stay rejected; `proposed` rows are refreshed in place.
    """
    if not manufacturer or not model:
        _log_extraction(manufacturer, model, "skipped_no_identifiers", 0)
        return {"status": "skipped", "reason": "missing_identifiers"}

    try:
        chunks = fetch_chunks(manufacturer, model, limit=chunk_limit)
    except Exception as exc:
        logger.warning("fetch_chunks failed for %s %s: %s", manufacturer, model, exc)
        raise self.retry(exc=exc, countdown=60)

    if not chunks:
        _log_extraction(manufacturer, model, "skipped_no_chunks", 0)
        return {
            "status": "skipped",
            "reason": "no_chunks",
            "manufacturer": manufacturer,
            "model": model,
        }

    existing = _existing_template(manufacturer, model)
    if existing and existing.get("verification_status") == "verified":
        _log_extraction(
            manufacturer,
            model,
            "skipped_verified",
            len(chunks),
            template_id=str(existing["id"]),
        )
        return {
            "status": "skipped",
            "reason": "already_verified",
            "template_id": str(existing["id"]),
            "manufacturer": manufacturer,
            "model": model,
        }
    if existing and existing.get("verification_status") == "rejected":
        _log_extraction(
            manufacturer,
            model,
            "skipped_rejected",
            len(chunks),
            template_id=str(existing["id"]),
        )
        return {
            "status": "skipped",
            "reason": "previous_rejected",
            "template_id": str(existing["id"]),
            "manufacturer": manufacturer,
            "model": model,
        }

    try:
        extracted = asyncio.run(
            extract_template(manufacturer, model, category, component_type, chunks)
        )
    except Exception as exc:
        logger.warning(
            "Cascade extraction failed for %s %s: %s",
            manufacturer,
            model,
            exc,
        )
        try:
            raise self.retry(exc=exc, countdown=120)
        except self.MaxRetriesExceededError:
            _log_extraction(
                manufacturer,
                model,
                "failed_extraction",
                len(chunks),
                error=str(exc),
            )
            return {
                "status": "failed",
                "stage": "extraction",
                "error": str(exc),
                "manufacturer": manufacturer,
                "model": model,
            }

    try:
        template_id, action = _upsert_template(
            extracted,
            manufacturer,
            model,
            category,
            component_type,
            chunks,
            existing,
            knowledge_entry_id,
            source_type,
        )
    except Exception as exc:
        logger.exception("Upsert failed for %s %s", manufacturer, model)
        _log_extraction(
            manufacturer,
            model,
            "failed_db",
            len(chunks),
            error=str(exc),
        )
        return {
            "status": "failed",
            "stage": "db",
            "error": str(exc),
            "manufacturer": manufacturer,
            "model": model,
        }

    _log_extraction(manufacturer, model, action, len(chunks), template_id=template_id)
    return {
        "status": "ok",
        "action": action,
        "template_id": template_id,
        "manufacturer": manufacturer,
        "model": model,
        "chunks_used": len(chunks),
    }
