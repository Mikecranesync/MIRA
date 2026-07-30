"""WS1 context-contract — DB-backed integration tests (ADR-0033, PRD G1 + G6).

The hermetic half lives in `mira-bots/tests/test_technician_context.py` and
`mira-bots/tests/test_ws1_engine_wiring.py`. This file exercises the parts that
only a real Postgres can prove:

1. **The reader works against the real table.**
   `shared.prior_decisions.fetch_prior_decisions` is the first-ever reader of
   `decision_traces` — the Phase-1 inventory found the table had two writers and
   zero readers. A test that only asserts SQL *text* is a lint, not a regression
   test (the mistake this program already shipped once, in v3.234.2 — corrected
   by #3028). So this executes the query.
2. **Slug tenants work end to end.** `decision_traces.tenant_id` is TEXT since
   migration 070 precisely because bot surfaces write slugs. A `::uuid` cast
   anywhere on this path resurrects #3003, which failed *silently* because the
   write is fire-and-forget.
3. **Tenant isolation is real**, both by the reader's explicit predicate and by
   RLS under `factorylm_app`.
4. **Migration 071 round-trips** the context manifest, and the sha256 stored
   next to it still matches a recomputation from the stored payload — which is
   what makes a prompt/trace divergence detectable (G6).

Skips when NEON_DATABASE_URL is unset, so offline dev and offline CI stay green.
Runs against the staging Neon branch in `migration-verify.yml`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import uuid
from pathlib import Path

import pytest

psycopg2 = pytest.importorskip(
    "psycopg2",
    reason="psycopg2-binary required for the WS1 context-contract integration tests",
)

NEON_URL = os.environ.get("NEON_DATABASE_URL", "")
if not NEON_URL:
    pytest.skip(
        "NEON_DATABASE_URL not set — WS1 integration tests require a real Neon branch",
        allow_module_level=True,
    )

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "mira-bots"))
sys.path.insert(0, str(_ROOT))

from shared.decision_trace import build_trace_row  # noqa: E402
from shared.prior_decisions import (  # noqa: E402
    UNKNOWN_UNAVAILABLE,
    fetch_prior_decisions,
)
from shared.technician_context import build_turn_context, manifest_of, prompt_block  # noqa: E402

from materialized_evidence.context_contract import EvidenceKind  # noqa: E402


def _schema_ready() -> bool:
    """True when migration 071 has landed on this branch."""
    try:
        c = psycopg2.connect(NEON_URL)
        try:
            with c.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'decision_traces' "
                    "AND column_name = 'context_manifest'"
                )
                return cur.fetchone() is not None
        finally:
            c.close()
    except Exception:
        return False


if not _schema_ready():
    pytest.skip(
        "decision_traces.context_manifest absent — migration 071 must be applied first",
        allow_module_level=True,
    )


UNS_PATH = "enterprise.garage.demo_cell.cv_101"


@pytest.fixture(scope="module")
def conn():
    c = psycopg2.connect(NEON_URL)
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def slug_tenants():
    """Two distinct SLUG tenants — the shape bot surfaces actually write."""
    suffix = uuid.uuid4().hex[:8]
    return f"ws1-a-{suffix}", f"ws1-b-{suffix}"


def _insert_trace(conn, tenant_id: str, recommendation: str, **extra) -> str:
    trace_id = str(uuid.uuid4())
    cols = {
        "trace_id": trace_id,
        "tenant_id": tenant_id,
        "user_question": "why did the conveyor stop?",
        "recommendation": recommendation,
        "outcome": "resolved",
        **extra,
    }
    names = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO decision_traces ({names}) VALUES ({placeholders})",  # noqa: S608
                cols,
            )
    return trace_id


def _cleanup(conn, *tenant_ids: str) -> None:
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM decision_traces WHERE tenant_id = ANY(%s)", (list(tenant_ids),)
            )


# ---------------------------------------------------------------------------
# 1. The reader executes — against the real table, with a slug tenant
# ---------------------------------------------------------------------------


def test_reader_returns_this_tenants_prior_decisions(conn, slug_tenants):
    tenant_a, tenant_b = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "Reseated the motor leads on CV-101.")
        _insert_trace(conn, tenant_a, "Replaced the F2 control fuse.")
        _insert_trace(conn, tenant_b, "SHOULD_NEVER_APPEAR_FOR_TENANT_A")

        rows, error = asyncio.run(fetch_prior_decisions(tenant_a, limit=5))

        assert error is None, "a healthy lookup must not report an unknown"
        assert len(rows) == 2
        texts = {r["recommendation"] for r in rows}
        assert texts == {
            "Reseated the motor leads on CV-101.",
            "Replaced the F2 control fuse.",
        }
        assert "SHOULD_NEVER_APPEAR_FOR_TENANT_A" not in texts, (
            "cross-tenant leak: the reader's predicate did not scope to the caller"
        )
    finally:
        _cleanup(conn, tenant_a, tenant_b)


def test_reader_never_casts_a_slug_tenant_to_uuid(conn, slug_tenants):
    """#3003 regression. A slug tenant is the NORMAL case here, not an edge case.

    If a `::uuid` cast ever returns to this path, psycopg2 raises
    InvalidTextRepresentation and — because the reader is fail-open — the turn
    would quietly proceed with no priors. So assert on `error` too, not just on
    the row count: a silent [] is exactly the failure mode.
    """
    tenant_a, _ = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "Slug-tenant write must be readable back.")
        rows, error = asyncio.run(fetch_prior_decisions(tenant_a))
        assert error is None
        assert len(rows) == 1
    finally:
        _cleanup(conn, tenant_a)


def test_reader_narrows_to_the_confirmed_uns_subtree(conn, slug_tenants):
    tenant_a, _ = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "On CV-101.", uns_path=UNS_PATH)
        _insert_trace(conn, tenant_a, "On a different machine.", uns_path="enterprise.garage.mx_7")

        rows, error = asyncio.run(fetch_prior_decisions(tenant_a, uns_path=UNS_PATH))

        assert error is None
        assert [r["recommendation"] for r in rows] == ["On CV-101."]
    finally:
        _cleanup(conn, tenant_a)


def test_reader_drops_rows_with_no_decision_content(conn, slug_tenants):
    """Fail-closed: a trace with no recommendation carries nothing citable."""
    tenant_a, _ = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "")
        rows, error = asyncio.run(fetch_prior_decisions(tenant_a))
        assert error is None
        assert rows == []
    finally:
        _cleanup(conn, tenant_a)


def test_reader_orders_newest_first_and_honors_the_limit(conn, slug_tenants):
    tenant_a, _ = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "oldest", ts="2026-07-01T00:00:00+00:00")
        _insert_trace(conn, tenant_a, "middle", ts="2026-07-15T00:00:00+00:00")
        _insert_trace(conn, tenant_a, "newest", ts="2026-07-29T00:00:00+00:00")

        rows, _ = asyncio.run(fetch_prior_decisions(tenant_a, limit=2))
        assert [r["recommendation"] for r in rows] == ["newest", "middle"]
    finally:
        _cleanup(conn, tenant_a)


def test_reader_reports_an_unknown_when_the_lookup_fails(monkeypatch):
    """Requirement 6: an attempted-and-failed lookup is never silent."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://nonexistent-host-ws1/db")
    rows, error = asyncio.run(fetch_prior_decisions("some-tenant", timeout_s=3))
    assert rows == []
    assert error == UNKNOWN_UNAVAILABLE


# ---------------------------------------------------------------------------
# 2. Tenant isolation also holds under RLS (the app role, not the owner)
# ---------------------------------------------------------------------------


def test_rls_isolates_the_manifest_columns_under_factorylm_app(conn, slug_tenants):
    """The reader's predicate is one layer; the policy is the other.

    Migration 071 adds columns to a table whose policy was rewritten in TEXT
    form by 070 — assert the policy still isolates rows carrying the new
    columns, under the role production actually uses.
    """
    tenant_a, tenant_b = slug_tenants
    trace_id = str(uuid.uuid4())
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE factorylm_app")
                cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_a,))
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question, context_manifest,
                        context_manifest_sha256)
                       VALUES (%s, %s, %s, %s::jsonb, %s)""",
                    (trace_id, tenant_a, "q", json.dumps({"k": "v"}), "d" * 64),
                )

        with conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE factorylm_app")
                cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_b,))
                cur.execute("SELECT COUNT(*) FROM decision_traces WHERE trace_id = %s", (trace_id,))
                assert cur.fetchone()[0] == 0, "RLS leak: tenant B saw tenant A's manifest row"

        with conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE factorylm_app")
                cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_a,))
                cur.execute("SELECT COUNT(*) FROM decision_traces WHERE trace_id = %s", (trace_id,))
                assert cur.fetchone()[0] == 1, "tenant A must see its own row"
    finally:
        _cleanup(conn, tenant_a, tenant_b)


# ---------------------------------------------------------------------------
# 3. G6 — the manifest round-trips, and prompt and audit row agree
# ---------------------------------------------------------------------------


def test_context_manifest_round_trips_through_migration_071(conn, slug_tenants):
    tenant_a, _ = slug_tenants
    try:
        _insert_trace(conn, tenant_a, "Reseated the motor leads on CV-101.", uns_path=UNS_PATH)
        rows, error = asyncio.run(fetch_prior_decisions(tenant_a, uns_path=UNS_PATH))
        assert error is None and rows

        ctx, violations = build_turn_context(
            tenant_id=tenant_a,
            question="why did it stop again?",
            uns_context={"uns_path": UNS_PATH, "manufacturer": "Automation Direct"},
            prior_decisions=rows,
        )
        assert violations == []
        payload, sha = manifest_of(ctx)
        rendered = prompt_block(ctx)
        assert "Reseated the motor leads" in rendered

        row = build_trace_row(
            tenant_id=tenant_a,
            user_question="why did it stop again?",
            recommendation="Check the overload relay. [Source: GS10 manual p.7]",
            context_manifest={"manifest": payload, "sha256": sha},
        )

        trace_id = str(uuid.uuid4())
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question, recommendation,
                        context_manifest, context_manifest_sha256)
                       VALUES (%s, %s, %s, %s, %s::jsonb, %s)""",
                    (
                        trace_id,
                        row["tenant_id"],
                        row["user_question"],
                        row["recommendation"],
                        row["context_manifest"],
                        row["context_manifest_sha256"],
                    ),
                )

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT context_manifest, context_manifest_sha256 "
                    "FROM decision_traces WHERE trace_id = %s",
                    (trace_id,),
                )
                stored_manifest, stored_sha = cur.fetchone()

        assert stored_sha == sha
        # The stored payload must still hash to the stored sha — this is the
        # check that makes a prompt/trace divergence DETECTABLE rather than
        # merely asserted.
        recomputed = hashlib.sha256(
            json.dumps(stored_manifest, sort_keys=True, ensure_ascii=False, default=str).encode()
        ).hexdigest()
        assert recomputed == stored_sha

        # …and it describes the prompt it claims to: every evidence item the
        # audit row carries appears in the block the model was given.
        assert stored_manifest["evidence"], "the manifest must carry the priors"
        for item in stored_manifest["evidence"]:
            assert item["kind"] == EvidenceKind.PRIOR_DECISION.value
            assert item["trust"] == "candidate", "a prior answer cannot promote itself"
            assert item["payload"]["summary"] in rendered
    finally:
        _cleanup(conn, tenant_a)


def test_recall_failure_is_recorded_in_the_audit_row_not_just_the_log(conn, slug_tenants):
    """An unknown must survive to the durable record, or the audit cannot tell
    "no history" from "we could not look"."""
    tenant_a, _ = slug_tenants
    try:
        ctx, violations = build_turn_context(
            tenant_id=tenant_a,
            question="q",
            uns_context={"uns_path": UNS_PATH},
            prior_decisions=[],
            recall_error=UNKNOWN_UNAVAILABLE,
        )
        assert violations == []
        payload, sha = manifest_of(ctx)
        row = build_trace_row(
            tenant_id=tenant_a,
            user_question="q",
            recommendation="a",
            context_manifest={"manifest": payload, "sha256": sha},
        )

        trace_id = str(uuid.uuid4())
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question, recommendation,
                        context_manifest, context_manifest_sha256)
                       VALUES (%s, %s, %s, %s, %s::jsonb, %s)""",
                    (
                        trace_id,
                        row["tenant_id"],
                        row["user_question"],
                        row["recommendation"],
                        row["context_manifest"],
                        row["context_manifest_sha256"],
                    ),
                )

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT context_manifest -> 'unknowns' FROM decision_traces "
                    "WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == [UNKNOWN_UNAVAILABLE]
    finally:
        _cleanup(conn, tenant_a)
