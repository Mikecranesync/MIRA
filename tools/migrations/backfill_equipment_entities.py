"""Backfill `kg_entities` and `knowledge_entries.equipment_entity_id`
from the existing 74K+ chunks.

Spec: docs/specs/uns-kg-unification-spec.md §4.2, Phase 1.

What it does
------------
1. Walks every distinct (manufacturer, model_number) pair in
   `knowledge_entries` where both are non-NULL and non-empty.
2. For each pair, upserts an `equipment` entity at
   `enterprise.unassigned.{mfr}.{model}`.
3. Walks every distinct source_url with a known equipment, upserts a
   `manual` entity, and creates a HAS_MANUAL edge.
4. UPDATEs `knowledge_entries.equipment_entity_id` for every chunk row
   that matches one of those (mfr, model) pairs.

Idempotent. Safe to re-run. Re-running is a no-op for rows already
linked.

Usage
-----
Dry-run (default — no writes):
    doppler run -p factorylm -c prd -- \\
        python tools/migrations/backfill_equipment_entities.py

Commit:
    doppler run -p factorylm -c prd -- \\
        python tools/migrations/backfill_equipment_entities.py --commit

Tenant scoping (default = all tenants):
    ... -- python tools/migrations/backfill_equipment_entities.py --tenant mike

Batch sizing for the chunk UPDATE pass:
    ... -- python tools/migrations/backfill_equipment_entities.py \\
        --commit --batch-size 1000
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass

# Make the `mira-crawler/ingest` package importable. The crawler ships its
# code as `ingest.*` inside the celery container (`PYTHONPATH=/app/mira_crawler`)
# but on a dev workstation the module path uses a hyphen (`mira-crawler/`).
# Add the `mira-crawler` directory so `import ingest.kg_writer` resolves the
# same code in both environments.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(_REPO_ROOT, "mira-crawler"))
sys.path.insert(0, _REPO_ROOT)

from ingest import kg_writer  # noqa: E402  — see sys.path patch above
from ingest.uns import equipment_unassigned_path, manual_path  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("backfill")


@dataclass
class Stats:
    pairs_seen: int = 0
    equipment_upserted: int = 0
    manuals_upserted: int = 0
    edges_upserted: int = 0
    chunks_linked: int = 0
    skipped_no_extraction: int = 0


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _distinct_pairs(engine, tenant: str | None) -> list[tuple[str, str, str]]:
    """Return distinct (tenant_id, manufacturer, model_number) triples
    where both manufacturer and model_number are populated."""
    from sqlalchemy import text

    sql = """
        SELECT DISTINCT tenant_id,
                        TRIM(manufacturer) AS manufacturer,
                        TRIM(model_number) AS model_number
          FROM knowledge_entries
         WHERE manufacturer IS NOT NULL
           AND model_number IS NOT NULL
           AND TRIM(manufacturer) <> ''
           AND TRIM(model_number) <> ''
    """
    params: dict[str, str] = {}
    if tenant:
        sql += " AND tenant_id = :tenant"
        params["tenant"] = tenant
    sql += " ORDER BY tenant_id, manufacturer, model_number"

    with engine.connect() as c:
        rows = c.execute(text(sql), params).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def _distinct_manuals(
    engine, tenant: str, manufacturer: str, model: str
) -> list[tuple[str | None, str | None]]:
    """Distinct (source_url, title) pairs for chunks belonging to a
    given (tenant, manufacturer, model)."""
    from sqlalchemy import text

    with engine.connect() as c:
        rows = c.execute(
            text("""
                SELECT DISTINCT source_url, metadata->>'title' AS title
                  FROM knowledge_entries
                 WHERE tenant_id = :tenant
                   AND TRIM(manufacturer) = :mfr
                   AND TRIM(model_number) = :model
                   AND source_url IS NOT NULL
                   AND source_url <> ''
            """),
            {"tenant": tenant, "mfr": manufacturer, "model": model},
        ).fetchall()
    return [(r[0], r[1]) for r in rows]


def _link_chunks(
    engine,
    tenant: str,
    manufacturer: str,
    model: str,
    equipment_id: str,
    batch_size: int,
    commit: bool,
) -> int:
    """UPDATE knowledge_entries SET equipment_entity_id = $eq WHERE
    matches and is currently NULL. Returns rowcount."""
    from sqlalchemy import text

    if not commit:
        with engine.connect() as c:
            count = (
                c.execute(
                    text("""
                        SELECT COUNT(*) FROM knowledge_entries
                         WHERE tenant_id = :tenant
                           AND TRIM(manufacturer) = :mfr
                           AND TRIM(model_number) = :model
                           AND equipment_entity_id IS NULL
                    """),
                    {"tenant": tenant, "mfr": manufacturer, "model": model},
                ).scalar()
                or 0
            )
        return int(count)

    total_updated = 0
    while True:
        with engine.connect() as c:
            try:
                rc = c.execute(
                    text("""
                        WITH batch AS (
                            SELECT id FROM knowledge_entries
                             WHERE tenant_id = :tenant
                               AND TRIM(manufacturer) = :mfr
                               AND TRIM(model_number) = :model
                               AND equipment_entity_id IS NULL
                             LIMIT :bs
                        )
                        UPDATE knowledge_entries ke
                           SET equipment_entity_id = cast(:eid AS uuid)
                          FROM batch
                         WHERE ke.id = batch.id
                    """),
                    {
                        "tenant": tenant,
                        "mfr": manufacturer,
                        "model": model,
                        "bs": batch_size,
                        "eid": equipment_id,
                    },
                ).rowcount
                c.commit()
            except Exception as e:
                c.rollback()
                log.error(
                    "_link_chunks batch failed (%s/%s): %s", manufacturer, model, e
                )
                break
        if not rc:
            break
        total_updated += rc
        # Be friendly to Neon — small breather between batches.
        time.sleep(0.05)
    return total_updated


def run(tenant: str | None, batch_size: int, commit: bool) -> Stats:
    engine = _engine()
    stats = Stats()
    pairs = _distinct_pairs(engine, tenant)
    stats.pairs_seen = len(pairs)
    log.info("Found %d distinct (tenant, manufacturer, model) triples", len(pairs))

    for tenant_id, manufacturer, model in pairs:
        eq_path = equipment_unassigned_path(manufacturer, model)
        man_root_path = manual_path(manufacturer, model)
        log.info(
            "tenant=%s mfr=%r model=%r → eq_path=%s manual_root=%s",
            tenant_id,
            manufacturer,
            model,
            eq_path,
            man_root_path,
        )

        if not commit:
            # Dry-run: still inspect manual + chunk counts so the operator
            # can see what would change.
            manuals = _distinct_manuals(engine, tenant_id, manufacturer, model)
            chunk_count = _link_chunks(
                engine,
                tenant_id,
                manufacturer,
                model,
                equipment_id="00000000-0000-0000-0000-000000000000",
                batch_size=batch_size,
                commit=False,
            )
            stats.equipment_upserted += 1
            stats.manuals_upserted += len(manuals)
            stats.chunks_linked += chunk_count
            log.info(
                "  [DRY] would upsert 1 equipment, %d manuals, link %d chunks",
                len(manuals),
                chunk_count,
            )
            continue

        eq_id = kg_writer.upsert_entity(
            tenant_id=tenant_id,
            entity_type="equipment",
            name=model,
            uns_path=eq_path,
            properties={"manufacturer": manufacturer},
        )
        if not eq_id:
            log.warning(
                "Skipping pair %s/%s — equipment upsert returned no id",
                manufacturer,
                model,
            )
            stats.skipped_no_extraction += 1
            continue
        stats.equipment_upserted += 1

        for source_url, title in _distinct_manuals(engine, tenant_id, manufacturer, model):
            man_id = kg_writer.upsert_entity(
                tenant_id=tenant_id,
                entity_type="manual",
                name=title or f"{manufacturer} {model} Manual",
                uns_path=man_root_path,
                properties={
                    "manufacturer": manufacturer,
                    "model": model,
                    "source_url": source_url,
                },
            )
            if not man_id:
                continue
            stats.manuals_upserted += 1
            edge_id = kg_writer.upsert_relationship(
                tenant_id=tenant_id,
                source_entity=eq_id,
                target_entity=man_id,
                relation_type="has_manual",
                confidence=0.95,
            )
            if edge_id:
                stats.edges_upserted += 1

        linked = _link_chunks(
            engine,
            tenant_id,
            manufacturer,
            model,
            equipment_id=eq_id,
            batch_size=batch_size,
            commit=True,
        )
        stats.chunks_linked += linked
        log.info("  linked %d chunks → equipment %s", linked, eq_id)

    return stats


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tenant", help="Restrict backfill to one tenant_id")
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument(
        "--commit", action="store_true", help="Apply writes (default = dry-run)"
    )
    args = p.parse_args()

    if not args.commit:
        log.warning("DRY-RUN — no writes will be performed. Pass --commit to apply.")

    stats = run(args.tenant, args.batch_size, args.commit)

    log.info("=== BACKFILL %s ===", "COMMIT" if args.commit else "DRY-RUN")
    log.info("  distinct pairs scanned:  %d", stats.pairs_seen)
    log.info("  equipment upserted:      %d", stats.equipment_upserted)
    log.info("  manuals upserted:        %d", stats.manuals_upserted)
    log.info("  has_manual edges:        %d", stats.edges_upserted)
    log.info("  chunks linked:           %d", stats.chunks_linked)
    log.info("  skipped (no extraction): %d", stats.skipped_no_extraction)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
