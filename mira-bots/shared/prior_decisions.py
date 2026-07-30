"""Prior-decision recall — the READ half of `decision_traces` (WS1 / PRD G6).

`decision_trace.py` has written this table since Phase 9 and, per the Phase-1
unification inventory, **nothing has ever read it back**. This module is that
reader: the last N grounded turns for a tenant (optionally narrowed to one UNS
subtree), shaped as plain dicts for
`materialized_evidence.context_contract.evidence_from_prior_decisions()`.

Design constraints — deliberately NOT a copy of the writer's posture:

- **Fail-open, like the writer.** A recall failure must never fail the turn.
- **…but never silent.** The writer is fire-and-forget, so silence is
  acceptable there. This read happens *before* the answer, so a failure changes
  what MIRA knows. Callers get an explicit ``error`` code and are expected to
  surface it as a `TechnicianContext.unknowns` entry — "no priors" and "could
  not look" must not be indistinguishable (ADR-0033 requirement 6).
- **Bounded.** This is on the critical path inside the engine's
  `MIRA_PROCESS_TIMEOUT` budget, unlike the fire-and-forget write. Hard timeout,
  small LIMIT, no retry.
- **Tenant-bound EXACTLY the way the writer binds** — `SET LOCAL` on
  `app.current_tenant_id` and **nothing else**. Migration 070's policy reads
  both spellings, so this one is sufficient, and setting `app.tenant_id` as well
  is actively harmful: `NEON_DATABASE_URL` is a **PgBouncer pooler** endpoint,
  and a GUC set on a pooled backend outlives the transaction as the empty
  string. `app.tenant_id` is the setting the **UUID-family** policies cast
  (`current_setting('app.tenant_id', true)::UUID`), so a leaked `''` turns every
  later query on `tag_events` / `approved_tags` / `flaky_input_signals` /
  `live_signal_cache` into `22P02 invalid input syntax for type uuid: ""` — for
  an unrelated session that never touched this module. Staging caught exactly
  that: five pre-existing RLS tests went red the moment this reader set it.
  `decision_traces.tenant_id` is **TEXT** since 070, so no `::uuid` cast belongs
  anywhere near it either (#3003 killed every staging trace that way).
- **Lazy imports.** sqlalchemy is imported inside the worker thread so bot
  containers without it still boot (mirrors `decision_trace.py`).

A prior decision is a HYPOTHESIS, never truth: the contract adapter hard-codes
``trust="candidate"`` and this module does not override it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger("mira-gsd.prior_decisions")

# Bounded by design (see module docstring). Sized against a COLD connect, not a
# warm one: `NullPool` + a fresh `create_engine` per call means every lookup pays
# a full TCP + TLS handshake to Neon (the writer accepts the same cost, but it is
# fire-and-forget so nobody waits on it). A 1.5 s budget timed out on the very
# first staging call and passed on every subsequent one — the classic cold-start
# shape, and it degrades to "unavailable" rather than to a wrong answer, so it
# fails safe but makes the unknown noise rather than signal.
#
# Latency is therefore a REAL cost of switching MIRA_CONTEXT_CONTRACT on, not a
# rounding error: measure it before the flag is promoted to on-by-default.
DEFAULT_TIMEOUT_S = 3.0
DEFAULT_LIMIT = 3

# The unknown a caller records when the lookup was ATTEMPTED and failed.
UNKNOWN_UNAVAILABLE = "prior_decisions_unavailable"

_BASE_SQL = """
SELECT trace_id,
       ts,
       recommendation,
       outcome,
       uns_path::text AS uns_path
FROM decision_traces
WHERE tenant_id = :tenant_id
  AND recommendation IS NOT NULL
  AND recommendation <> ''
"""

_UNS_PREDICATE = "  AND uns_path = CAST(:uns_path AS LTREE)\n"

_ORDER_SQL = "ORDER BY ts DESC\nLIMIT :limit\n"


def _rows_to_dicts(rows: Any) -> list[dict[str, Any]]:
    """SQLAlchemy Rows → plain dicts the contract adapter accepts."""
    out: list[dict[str, Any]] = []
    for r in rows:
        m = r._mapping if hasattr(r, "_mapping") else r
        out.append(
            {
                "id": str(m["trace_id"]),
                "recommendation": m["recommendation"],
                "outcome": m["outcome"],
                "ts": m["ts"].isoformat() if hasattr(m["ts"], "isoformat") else str(m["ts"]),
                "uns_path": m["uns_path"],
            }
        )
    return out


async def fetch_prior_decisions(
    tenant_id: str | None,
    *,
    uns_path: str | None = None,
    limit: int = DEFAULT_LIMIT,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[list[dict[str, Any]], str | None]:
    """Return ``(rows, error)`` — the most recent grounded turns for a tenant.

    ``error`` is None when the lookup ran (an empty list then genuinely means
    "this tenant has no prior decisions"), and ``UNKNOWN_UNAVAILABLE`` when the
    lookup was attempted and failed (DB down, driver missing, timeout, schema
    drift).

    Storage being **unconfigured** (``NEON_DATABASE_URL`` unset — offline dev,
    hermetic tests) is deliberately NOT an error: nothing was attempted, so
    there is nothing to report as unknown. It returns ``([], None)`` exactly
    like the writer no-ops. A missing tenant is likewise not an error; there is
    simply no tenant to scope the read to.
    """
    if not tenant_id:
        return [], None
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return [], None

    sql = _BASE_SQL + (_UNS_PREDICATE if uns_path else "") + _ORDER_SQL
    params: dict[str, Any] = {"tenant_id": tenant_id, "limit": max(1, int(limit))}
    if uns_path:
        params["uns_path"] = uns_path

    def _run() -> list[dict[str, Any]]:
        from sqlalchemy import create_engine
        from sqlalchemy import text as sql_text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.begin() as conn:
            # RLS binding. `begin()`, not `connect()`: SQLAlchemy 2.0 does not
            # open a transaction until the first execute, and a SET LOCAL with
            # no surrounding transaction is a no-op that Postgres only WARNs
            # about — the binding would silently not apply.
            #
            # ONE setting, matching decision_trace.py. Do NOT also set
            # `app.tenant_id`: see the module docstring — through the pooler it
            # leaks as '' and breaks the UUID-family policies that cast it.
            conn.execute(sql_text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            result = conn.execute(sql_text(sql), params)
            return _rows_to_dicts(result.fetchall())

    try:
        loop = asyncio.get_running_loop()
        rows = await asyncio.wait_for(loop.run_in_executor(None, _run), timeout=timeout_s)
        return rows, None
    except Exception as exc:  # noqa: BLE001 — recall must never fail the turn
        # Log the exception CLASS, not just str(exc): asyncio.TimeoutError
        # stringifies to the empty string, which turns the most likely failure
        # here into a log line that says nothing at all.
        logger.warning(
            "PRIOR_DECISIONS_UNAVAILABLE tenant=%s error=%s: %s",
            tenant_id,
            type(exc).__name__,
            exc,
        )
        return [], UNKNOWN_UNAVAILABLE
