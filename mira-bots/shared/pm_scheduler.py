"""PM Work Order Scheduler — Auto-PM Pipeline step 5.

Checks pm_schedules for due PMs and creates work orders in NeonDB.
Optionally mirrors to Atlas CMMS via mira-mcp REST API.

Called by:
  - mira-pipeline midnight cron loop (asyncio background task)
  - POST /api/pm/generate-work-orders (manual trigger)

Flow:
  1. Query pm_schedules WHERE next_due_at <= NOW() (or NULL = never run)
  2. Insert WO row into work_orders NeonDB table
  3. Advance next_due_at by the PM interval
  4. Fire-and-forget to Atlas CMMS (non-blocking, failures logged not raised)
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("mira-pm-scheduler")

# Criticality → work_order priority mapping
_PRIORITY_MAP = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
}

# Interval unit → days multiplier (for advancing next_due_at)
_UNIT_DAYS: dict[str, float] = {
    "hours": 1 / 24,
    "days": 1.0,
    "weeks": 7.0,
    "months": 30.44,
    "years": 365.25,
    "cycles": 0,  # cannot advance cycle-based PMs by time
}


_EQUIPMENT_NAMESPACE = uuid.UUID("7f3d1a2b-4c5e-6f7a-8b9c-0d1e2f3a4b5c")


def _resolve_equipment_id(
    manufacturer: str, model_number: str, hint: str | None, tenant_id: str
) -> str:
    """Return a UUID for the equipment, creating a cmms_equipment row if needed.

    Priority: (1) hint from pm_schedules, (2) existing cmms_equipment lookup,
    (3) new cmms_equipment row inserted with deterministic UUID.
    """
    if hint:
        return hint
    from sqlalchemy import text

    new_id = str(
        uuid.uuid5(
            _EQUIPMENT_NAMESPACE, f"{tenant_id}:{manufacturer.lower()}:{model_number.lower()}"
        )
    )
    engine = _get_neon_engine()
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT id FROM cmms_equipment
                    WHERE tenant_id = :tid
                      AND LOWER(manufacturer) = LOWER(:mfr)
                      AND LOWER(model_number) = LOWER(:model)
                    LIMIT 1
                    """
                ),
                {"tid": tenant_id, "mfr": manufacturer, "model": model_number},
            ).fetchone()
            if row:
                return str(row[0])
            eq_number = f"{manufacturer[:4].upper()}-{model_number[:8].upper()}"
            conn.execute(
                text(
                    """
                    INSERT INTO cmms_equipment
                        (id, equipment_number, manufacturer, model_number,
                         tenant_id, created_at, updated_at)
                    VALUES
                        (:id, :eq_number, :manufacturer, :model_number,
                         :tenant_id, NOW(), NOW())
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": new_id,
                    "eq_number": eq_number,
                    "manufacturer": manufacturer,
                    "model_number": model_number,
                    "tenant_id": tenant_id,
                },
            )
            logger.info(
                "_resolve_equipment_id: created cmms_equipment id=%s %s %s",
                new_id,
                manufacturer,
                model_number,
            )
        return new_id
    except Exception as exc:
        logger.error("_resolve_equipment_id failed: %s", exc)
        return new_id
    finally:
        engine.dispose()


def _get_neon_engine():
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


def _wo_number() -> str:
    return f"PM-{uuid.uuid4().hex[:8].upper()}"


def _build_description(pm: dict[str, Any]) -> str:
    lines = [
        "Auto-generated PM work order from manual extraction.",
        "",
        f"Equipment: {pm['manufacturer']} {pm['model_number']}",
        f"Interval: Every {pm['interval_value']} {pm['interval_unit']}",
    ]
    if pm.get("source_citation"):
        lines.append(f"Manual reference: {pm['source_citation']}")
    if pm.get("parts_needed"):
        lines.append("\nParts needed:")
        for p in pm["parts_needed"]:
            lines.append(f"  • {p}")
    if pm.get("tools_needed"):
        lines.append("\nTools needed:")
        for t in pm["tools_needed"]:
            lines.append(f"  • {t}")
    if pm.get("safety_requirements"):
        lines.append("\nSafety requirements:")
        for s in pm["safety_requirements"]:
            lines.append(f"  ⚠ {s}")
    confidence = pm.get("confidence")
    if confidence:
        lines.append(f"\nExtraction confidence: {int(confidence * 100)}%")
    return "\n".join(lines)


def _build_suggested_actions(pm: dict[str, Any]) -> list[str]:
    actions = [pm["task"]]
    if pm.get("parts_needed"):
        actions.append(f"Parts: {', '.join(pm['parts_needed'])}")
    if pm.get("tools_needed"):
        actions.append(f"Tools: {', '.join(pm['tools_needed'])}")
    return actions


def get_due_pms(tenant_id: Optional[str] = None) -> list[dict[str, Any]]:
    """Return all pm_schedules that are due.

    Checks BOTH trigger conditions (#898):
      - calendar / calendar_or_meter: next_due_at <= NOW() or IS NULL
      - meter / calendar_or_meter:    meter_current >= meter_threshold
    """
    from sqlalchemy import text

    engine = _get_neon_engine()
    try:
        with engine.connect() as conn:
            params: dict[str, Any] = {}
            tenant_filter = ""
            if tenant_id:
                tenant_filter = "AND (tenant_id = :tenant_id OR tenant_id IS NULL)"
                params["tenant_id"] = tenant_id

            rows = conn.execute(
                text(
                    f"""
                    SELECT id, tenant_id, manufacturer, model_number, equipment_id,
                           task, interval_value, interval_unit, interval_type,
                           parts_needed, tools_needed, estimated_duration_minutes,
                           safety_requirements, criticality, source_citation, confidence,
                           next_due_at,
                           COALESCE(trigger_type, 'calendar') AS trigger_type,
                           meter_threshold,
                           COALESCE(meter_current, 0)          AS meter_current
                    FROM pm_schedules
                    WHERE (
                        -- Calendar trigger
                        (COALESCE(trigger_type, 'calendar') IN ('calendar', 'calendar_or_meter')
                         AND (next_due_at IS NULL OR next_due_at <= NOW()))
                        OR
                        -- Meter trigger
                        (COALESCE(trigger_type, 'calendar') IN ('meter', 'calendar_or_meter')
                         AND meter_threshold IS NOT NULL
                         AND COALESCE(meter_current, 0) >= meter_threshold)
                    )
                    {tenant_filter}
                    ORDER BY criticality DESC, next_due_at ASC NULLS FIRST
                    LIMIT 500
                    """
                ),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("get_due_pms failed: %s", exc)
        return []
    finally:
        engine.dispose()

    return [
        {
            "id": str(r[0]),
            "tenant_id": str(r[1]) if r[1] else "mike",
            "manufacturer": r[2] or "",
            "model_number": r[3] or "",
            "equipment_id": str(r[4]) if r[4] else None,
            "task": r[5],
            "interval_value": r[6],
            "interval_unit": r[7],
            "interval_type": r[8],
            "parts_needed": r[9] or [],
            "tools_needed": r[10] or [],
            "estimated_duration_minutes": r[11],
            "safety_requirements": r[12] or [],
            "criticality": r[13] or "medium",
            "source_citation": r[14],
            "confidence": float(r[15]) if r[15] else None,
            "next_due_at": r[16].isoformat() if r[16] else None,
            "trigger_type": str(r[17]),
            "meter_threshold": float(r[18]) if r[18] is not None else None,
            "meter_current": float(r[19]),
        }
        for r in rows
    ]


def _advance_next_due(
    pm_id: str,
    interval_value: int,
    interval_unit: str,
    trigger_type: str = "calendar",
) -> None:
    """Advance next_due_at by the PM interval from NOW().

    For meter / calendar_or_meter PMs also resets meter_current to 0 and
    stamps meter_last_reset_at so the next reading cycle starts clean (#898).
    """
    days = _UNIT_DAYS.get(interval_unit, 0)
    if days <= 0:
        logger.info("_advance_next_due: skipping cycle-based PM %s", pm_id)
        return

    total_days = interval_value * days
    meter_reset_clause = (
        ", meter_current = 0, meter_last_reset_at = NOW()"
        if trigger_type in ("meter", "calendar_or_meter")
        else ""
    )
    from sqlalchemy import text

    engine = _get_neon_engine()
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    UPDATE pm_schedules
                    SET next_due_at = NOW() + INTERVAL '{total_days} days',
                        last_completed_at = NOW()
                        {meter_reset_clause}
                    WHERE id = :pm_id
                    """
                ),
                {"pm_id": pm_id},
            )
        logger.debug(
            "_advance_next_due: pm_id=%s advanced by %g days trigger_type=%s",
            pm_id,
            total_days,
            trigger_type,
        )
    except Exception as exc:
        logger.error("_advance_next_due failed for pm_id=%s: %s", pm_id, exc)
    finally:
        engine.dispose()


def _insert_work_order(pm: dict[str, Any]) -> str | None:
    """Insert a PM work order into the work_orders NeonDB table. Returns WO id."""
    from sqlalchemy import text

    wo_id = str(uuid.uuid4())
    wo_number = _wo_number()
    description = _build_description(pm)
    suggested_actions = _build_suggested_actions(pm)
    safety_warnings = pm.get("safety_requirements") or []
    priority = _PRIORITY_MAP.get(pm["criticality"], "medium")
    title = f"PM: {pm['task']} — {pm['manufacturer']} {pm['model_number']}"
    equipment_id = _resolve_equipment_id(
        pm["manufacturer"], pm["model_number"], pm.get("equipment_id"), pm["tenant_id"]
    )

    engine = _get_neon_engine()
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO work_orders (
                        id, work_order_number, source, created_by_agent,
                        manufacturer, model_number, equipment_id,
                        title, description,
                        suggested_actions, safety_warnings,
                        status, priority, route_taken,
                        tenant_id, user_id, created_at, updated_at
                    ) VALUES (
                        :id, :wo_number, 'auto_pm', 'pm_scheduler',
                        :manufacturer, :model_number, :equipment_id,
                        :title, :description,
                        :suggested_actions, :safety_warnings,
                        'open', :priority, 'PM',
                        :tenant_id, 'pm_scheduler', NOW(), NOW()
                    )
                    """
                ),
                {
                    "id": wo_id,
                    "wo_number": wo_number,
                    "manufacturer": pm["manufacturer"],
                    "model_number": pm["model_number"],
                    "equipment_id": equipment_id,
                    "title": title,
                    "description": description,
                    "suggested_actions": suggested_actions,
                    "safety_warnings": safety_warnings,
                    "priority": priority,
                    "tenant_id": pm["tenant_id"],
                },
            )
        logger.info(
            "WO created: %s (%s) for %s %s",
            wo_number,
            wo_id,
            pm["manufacturer"],
            pm["model_number"],
        )
        return wo_id
    except Exception as exc:
        logger.error("_insert_work_order failed for pm_id=%s: %s", pm["id"], exc)
        return None
    finally:
        engine.dispose()


async def _mirror_to_atlas(pm: dict[str, Any], wo_id: str) -> None:
    """Optionally create WO in Atlas CMMS via mira-mcp REST API. Non-blocking."""
    mcp_url = os.getenv("MCP_REST_URL", "http://mira-mcp:8001")
    mcp_key = os.getenv("MCP_REST_API_KEY", "")
    if not mcp_key:
        return  # Atlas not configured — skip silently

    title = f"PM: {pm['task']} — {pm['manufacturer']} {pm['model_number']}"
    description = _build_description(pm)
    priority_map = {"critical": "EMERGENCY", "high": "HIGH", "medium": "MEDIUM", "low": "LOW"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{mcp_url}/api/cmms/work-orders",
                headers={"Authorization": f"Bearer {mcp_key}"},
                json={
                    "title": title,
                    "description": description,
                    "priority": priority_map.get(pm["criticality"], "MEDIUM"),
                    "category": "PREVENTIVE",
                    "asset_id": pm.get("equipment_id"),
                    "external_ref": wo_id,
                },
            )
        if resp.is_success:
            logger.info("Atlas WO created for pm_id=%s wo_id=%s", pm["id"], wo_id)
        else:
            logger.warning(
                "Atlas WO creation non-success pm_id=%s status=%d body=%s",
                pm["id"],
                resp.status_code,
                resp.text[:200],
            )
    except Exception as exc:
        logger.warning("Atlas mirror failed for pm_id=%s (non-fatal): %s", pm["id"], exc)


async def generate_due_work_orders(tenant_id: str | None = None) -> dict[str, Any]:
    """Main entry point: check all due PMs and create WOs.

    Returns summary dict with counts and created WO IDs.
    """
    due_pms = get_due_pms(tenant_id=tenant_id)
    logger.info("generate_due_work_orders: %d due PMs found (tenant=%s)", len(due_pms), tenant_id)

    created_wos: list[dict[str, str]] = []
    skipped = 0

    for pm in due_pms:
        wo_id = _insert_work_order(pm)
        if wo_id is None:
            skipped += 1
            continue

        _advance_next_due(
            pm["id"], pm["interval_value"], pm["interval_unit"], pm.get("trigger_type", "calendar")
        )

        # Fire-and-forget to Atlas — import asyncio here to avoid issues at module load
        import asyncio

        asyncio.create_task(_mirror_to_atlas(pm, wo_id))

        created_wos.append(
            {
                "wo_id": wo_id,
                "pm_id": pm["id"],
                "task": pm["task"],
                "manufacturer": pm["manufacturer"],
                "model_number": pm["model_number"],
                "priority": _PRIORITY_MAP.get(pm["criticality"], "medium"),
            }
        )

    logger.info(
        "generate_due_work_orders: created=%d skipped=%d",
        len(created_wos),
        skipped,
    )
    return {
        "due_pms_found": len(due_pms),
        "work_orders_created": len(created_wos),
        "skipped": skipped,
        "created": created_wos,
        "run_at": datetime.now(timezone.utc).isoformat(),
    }


async def run_midnight_scheduler() -> None:
    """Asyncio background task — runs daily at UTC midnight.

    Started by mira-pipeline lifespan. Loops forever, sleeping until next midnight.
    """
    import asyncio

    logger.info("PM midnight scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        # Seconds until next UTC midnight
        next_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        from datetime import timedelta

        next_midnight = next_midnight + timedelta(days=1)
        sleep_seconds = (next_midnight - now).total_seconds()

        logger.info(
            "PM scheduler sleeping %.0f seconds until next run (%s UTC)",
            sleep_seconds,
            next_midnight.strftime("%Y-%m-%d %H:%M:%S"),
        )
        await asyncio.sleep(sleep_seconds)

        try:
            result = await generate_due_work_orders()
            logger.info(
                "PM_SCHEDULER_RUN created=%d due=%d",
                result["work_orders_created"],
                result["due_pms_found"],
            )
        except Exception as exc:
            logger.error("PM scheduler run failed: %s", exc)
