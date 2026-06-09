#!/usr/bin/env python3.12
"""Real-DB smoke for the proposal reroute (issue #1662 / PR #1716).

Proves the "never auto-verify" doctrine end-to-end against a real Neon DB
for BOTH ingest write paths, under throwaway synthetic tenants, cleaning up
after itself:

  Path A (SQLAlchemy) — kg_writer.register_equipment_and_manual, the live
    store.py ingest hot path.
  Path B (psycopg2 cursor) — proposal_writer.propose_relationship_cursor,
    the full_ingest_pipeline.py bulk OEM loader path.

Each asserts: relationship_proposals row (canonical type), relationship_evidence
(Path A), ai_suggestions(kg_edge) bridge, ZERO kg_relationships on the live
path, and idempotent re-run.

Run against STAGING (never prod):
    doppler run --project factorylm --config stg -- \
        python3.12 mira-crawler/tools/smoke_proposal_writer.py

Exit code 0 = PASS, 1 = FAIL. Safe to re-run; uses fixed synthetic tenants
and deletes their rows at the end.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

# Make `ingest.*` importable when run from the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingest import kg_writer  # noqa: E402
from ingest.proposal_writer import propose_relationship_cursor  # noqa: E402
from ingest.store import _engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

# Fixed synthetic tenants so re-runs are clean and nothing real is touched.
SMOKE_TENANT_A = "00000000-0000-4000-a000-0000000016ec"  # "...16ec" ~ #1662
SMOKE_TENANT_B = "00000000-0000-4000-a000-0000000016ed"  # Path B (cursor)
SMOKE_CHUNK = str(uuid.uuid4())


def _count(c, table: str, tenant: str) -> int:
    row = c.execute(
        text(f"SELECT count(*) FROM {table} WHERE tenant_id = cast(:t AS uuid)"),
        {"t": tenant},
    ).first()
    return int(row[0]) if row else 0


def _cleanup(c, tenant: str) -> None:
    c.execute(
        text(
            "DELETE FROM relationship_evidence WHERE proposal_id IN "
            "(SELECT id FROM relationship_proposals WHERE tenant_id = cast(:t AS uuid))"
        ),
        {"t": tenant},
    )
    for tbl in ("ai_suggestions", "relationship_proposals", "kg_relationships", "kg_entities"):
        c.execute(
            text(f"DELETE FROM {tbl} WHERE tenant_id = cast(:t AS uuid)"),
            {"t": tenant},
        )


def _assert_proposed(c, tenant: str, label: str, expect_evidence: bool) -> list[str]:
    """Shared assertions: 1 proposal (HAS_DOCUMENT), 1 kg_edge suggestion,
    0 kg_relationships, optional evidence."""
    out: list[str] = []
    n_prop = _count(c, "relationship_proposals", tenant)
    n_sugg = c.execute(
        text(
            "SELECT count(*) FROM ai_suggestions "
            "WHERE tenant_id = cast(:t AS uuid) AND suggestion_type = 'kg_edge'"
        ),
        {"t": tenant},
    ).first()
    n_sugg = int(n_sugg[0]) if n_sugg else 0
    n_edge = _count(c, "kg_relationships", tenant)
    rel_type = c.execute(
        text(
            "SELECT relationship_type FROM relationship_proposals "
            "WHERE tenant_id = cast(:t AS uuid) LIMIT 1"
        ),
        {"t": tenant},
    ).first()
    rel_type = rel_type[0] if rel_type else None
    n_evid = c.execute(
        text(
            "SELECT count(*) FROM relationship_evidence e "
            "JOIN relationship_proposals p ON p.id = e.proposal_id "
            "WHERE p.tenant_id = cast(:t AS uuid)"
        ),
        {"t": tenant},
    ).first()
    n_evid = int(n_evid[0]) if n_evid else 0

    if n_prop != 1:
        out.append(f"[{label}] relationship_proposals = {n_prop}, expected 1 (idempotent)")
    if rel_type != "HAS_DOCUMENT":
        out.append(f"[{label}] relationship_type = {rel_type!r}, expected 'HAS_DOCUMENT'")
    if n_sugg != 1:
        out.append(f"[{label}] ai_suggestions(kg_edge) = {n_sugg}, expected 1")
    if n_edge != 0:
        out.append(f"[{label}] kg_relationships = {n_edge}, expected 0 (no auto-verify)")
    if expect_evidence and n_evid < 1:
        out.append(f"[{label}] relationship_evidence = {n_evid}, expected >= 1")
    print(
        f"[{label}] proposals={n_prop} evidence={n_evid} suggestions={n_sugg} "
        f"kg_relationships={n_edge} rel_type={rel_type!r}"
    )
    return out


def _smoke_path_a(eng) -> list[str]:
    """SQLAlchemy path via the live register_equipment_and_manual ingest call."""
    with eng.connect() as c:
        c.execute(text("SELECT set_config('app.current_tenant_id', :t, false)"), {"t": SMOKE_TENANT_A})
        _cleanup(c, SMOKE_TENANT_A)
        c.commit()
    for _ in range(2):  # idempotency
        kg_writer.register_equipment_and_manual(
            tenant_id=SMOKE_TENANT_A,
            manufacturer="SmokeTest Mfr",
            model="ZZ999",
            manual_title="Smoke Manual ZZ999",
            manual_url="https://smoke.test/zz999.pdf",
            source_chunk_id=SMOKE_CHUNK,
        )
    with eng.connect() as c:
        c.execute(text("SELECT set_config('app.current_tenant_id', :t, false)"), {"t": SMOKE_TENANT_A})
        fails = _assert_proposed(c, SMOKE_TENANT_A, "Path A", expect_evidence=True)
        _cleanup(c, SMOKE_TENANT_A)
        c.commit()
    return fails


def _smoke_path_b(eng) -> list[str]:
    """psycopg2-cursor path via propose_relationship_cursor (no FK on
    source/target entity ids, so throwaway UUIDs suffice to prove the SQL)."""
    import psycopg2

    src, tgt = str(uuid.uuid4()), str(uuid.uuid4())
    conn = psycopg2.connect(os.environ["NEON_DATABASE_URL"])
    conn.autocommit = False
    try:
        cur = conn.cursor()
        cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", (SMOKE_TENANT_B,))
        for _ in range(2):  # idempotency
            propose_relationship_cursor(
                cur,
                tenant_id=SMOKE_TENANT_B,
                source_entity=src,
                target_entity=tgt,
                relation_type="documented_in",
                confidence=1.0,
                source_chunk_id=SMOKE_CHUNK,
            )
        conn.commit()
    finally:
        conn.close()

    with eng.connect() as c:
        c.execute(text("SELECT set_config('app.current_tenant_id', :t, false)"), {"t": SMOKE_TENANT_B})
        fails = _assert_proposed(c, SMOKE_TENANT_B, "Path B", expect_evidence=True)
        _cleanup(c, SMOKE_TENANT_B)
        c.commit()
    return fails


def main() -> int:
    eng = _engine()
    failures = _smoke_path_a(eng) + _smoke_path_b(eng)
    if failures:
        print("SMOKE FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SMOKE PASS — both ingest paths propose, not auto-verify; idempotent; cleaned up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
