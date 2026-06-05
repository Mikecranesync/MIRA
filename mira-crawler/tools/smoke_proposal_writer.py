#!/usr/bin/env python3.12
"""Real-DB smoke for the proposal reroute (issue #1662 / PR #1716).

Drives the live ingest edge path (`kg_writer.register_equipment_and_manual`)
against whatever NEON_DATABASE_URL is in the environment, under a throwaway
synthetic tenant, then proves the doctrine end-to-end and cleans up after
itself.

Asserts:
  1. relationship_proposals row exists (canonical type HAS_DOCUMENT)
  2. relationship_evidence row exists
  3. ai_suggestions(kg_edge) bridge row exists, payload -> the proposal
  4. ZERO rows inserted into kg_relationships on the live path
  5. re-running the same ingest is idempotent (proposal count stays 1)

Run against STAGING (never prod):
    doppler run --project factorylm --config stg -- \
        python3.12 mira-crawler/tools/smoke_proposal_writer.py

Exit code 0 = PASS, 1 = FAIL. Safe to re-run; uses a fixed synthetic
tenant and deletes its rows at the end.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

# Make `ingest.*` importable when run from the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingest import kg_writer  # noqa: E402
from ingest.store import _engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

# Fixed synthetic tenant so re-runs are clean and nothing real is touched.
SMOKE_TENANT = "00000000-0000-4000-a000-0000000016ec"  # "...16ec" ~ #1662
SMOKE_CHUNK = str(uuid.uuid4())


def _count(c, table: str) -> int:
    row = c.execute(
        text(f"SELECT count(*) FROM {table} WHERE tenant_id = cast(:t AS uuid)"),
        {"t": SMOKE_TENANT},
    ).first()
    return int(row[0]) if row else 0


def _cleanup(c) -> None:
    # evidence -> suggestions -> proposals -> kg edges -> entities
    c.execute(
        text(
            "DELETE FROM relationship_evidence WHERE proposal_id IN "
            "(SELECT id FROM relationship_proposals WHERE tenant_id = cast(:t AS uuid))"
        ),
        {"t": SMOKE_TENANT},
    )
    for tbl in (
        "ai_suggestions",
        "relationship_proposals",
        "kg_relationships",
        "kg_entities",
    ):
        c.execute(
            text(f"DELETE FROM {tbl} WHERE tenant_id = cast(:t AS uuid)"),
            {"t": SMOKE_TENANT},
        )


def main() -> int:
    eng = _engine()
    failures: list[str] = []

    # Pre-clean any leftovers from a prior run.
    with eng.connect() as c:
        c.execute(
            text("SELECT set_config('app.current_tenant_id', :t, false)"),
            {"t": SMOKE_TENANT},
        )
        _cleanup(c)
        c.commit()

    # --- Run the live ingest edge path twice (idempotency) ---------------
    for _ in range(2):
        kg_writer.register_equipment_and_manual(
            tenant_id=SMOKE_TENANT,
            manufacturer="SmokeTest Mfr",
            model="ZZ999",
            manual_title="Smoke Manual ZZ999",
            manual_url="https://smoke.test/zz999.pdf",
            source_chunk_id=SMOKE_CHUNK,
        )

    # --- Assert ----------------------------------------------------------
    with eng.connect() as c:
        c.execute(
            text("SELECT set_config('app.current_tenant_id', :t, false)"),
            {"t": SMOKE_TENANT},
        )
        n_prop = _count(c, "relationship_proposals")
        n_evid_row = c.execute(
            text(
                "SELECT count(*) FROM relationship_evidence e "
                "JOIN relationship_proposals p ON p.id = e.proposal_id "
                "WHERE p.tenant_id = cast(:t AS uuid)"
            ),
            {"t": SMOKE_TENANT},
        ).first()
        n_evid = int(n_evid_row[0]) if n_evid_row else 0
        n_sugg = c.execute(
            text(
                "SELECT count(*) FROM ai_suggestions "
                "WHERE tenant_id = cast(:t AS uuid) AND suggestion_type = 'kg_edge'"
            ),
            {"t": SMOKE_TENANT},
        ).first()
        n_sugg = int(n_sugg[0]) if n_sugg else 0
        n_edge = _count(c, "kg_relationships")
        rel_type = c.execute(
            text(
                "SELECT relationship_type FROM relationship_proposals "
                "WHERE tenant_id = cast(:t AS uuid) LIMIT 1"
            ),
            {"t": SMOKE_TENANT},
        ).first()
        rel_type = rel_type[0] if rel_type else None

        if n_prop != 1:
            failures.append(f"relationship_proposals = {n_prop}, expected 1 (idempotent)")
        if rel_type != "HAS_DOCUMENT":
            failures.append(f"relationship_type = {rel_type!r}, expected 'HAS_DOCUMENT'")
        if n_evid < 1:
            failures.append(f"relationship_evidence = {n_evid}, expected >= 1")
        if n_sugg != 1:
            failures.append(f"ai_suggestions(kg_edge) = {n_sugg}, expected 1")
        if n_edge != 0:
            failures.append(f"kg_relationships = {n_edge}, expected 0 (no auto-verify)")

        print(
            f"proposals={n_prop} evidence={n_evid} suggestions={n_sugg} "
            f"kg_relationships={n_edge} rel_type={rel_type!r}"
        )

        _cleanup(c)
        c.commit()

    if failures:
        print("SMOKE FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SMOKE PASS — ingest edge proposed, not auto-verified; idempotent; cleaned up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
