"""kg_entities UNS-path backfill orchestrator.

Spec: docs/specs/uns-kg-unification-spec.md §3.1 (knowledge-base branch).
Companion: mira-crawler/ingest/uns.py (path grammar).

Two backfill paths exist in the repo today; this script is the
single entry point that runs them in the right order and reports
the counts the spec's acceptance criteria call for:

1. SQL pass — mira-hub/db/migrations/014_uns_path_backfill.sql
   Fills uns_path on any pre-existing kg_entities row that has
   manufacturer info in its properties jsonb but no path yet.

2. Entity creation pass — tools/migrations/backfill_equipment_entities.py
   Walks knowledge_entries to discover (manufacturer, model) pairs,
   upserts equipment + manual entities at the right kb path, and
   links chunks via knowledge_entries.equipment_entity_id.

Output format:
    entities_created   — new kg_entities rows written
    entries_linked     — knowledge_entries rows that got equipment_entity_id
    entries_orphaned   — knowledge_entries rows with no manufacturer/model
    entities_unpathed  — kg_entities still missing uns_path after both passes

Idempotent: re-running is safe. The SQL pass touches only rows where
uns_path IS NULL; the entity-creation pass already uses ON CONFLICT
DO NOTHING upserts.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

# Reuse the existing entity-creation pass — don't reimplement.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from tools.migrations import backfill_equipment_entities  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("uns-backfill")


@dataclass
class Counts:
    entities_created: int = 0
    entries_linked: int = 0
    entries_orphaned: int = 0
    entities_unpathed: int = 0


def _engine():
    url = os.getenv("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _count_orphans(engine, tenant: str | None) -> int:
    sql = """
        SELECT count(*) FROM knowledge_entries
         WHERE equipment_entity_id IS NULL
           AND (manufacturer IS NULL OR manufacturer = ''
                OR model_number IS NULL OR model_number = '')
    """
    params: dict = {}
    if tenant:
        sql += " AND tenant_id = :tenant"
        params["tenant"] = tenant
    with engine.connect() as c:
        return int(c.execute(text(sql), params).scalar() or 0)


def _count_unpathed(engine, tenant: str | None) -> int:
    sql = "SELECT count(*) FROM kg_entities WHERE uns_path IS NULL"
    params: dict = {}
    if tenant:
        sql += " AND tenant_id = :tenant"
        params["tenant"] = tenant
    with engine.connect() as c:
        return int(c.execute(text(sql), params).scalar() or 0)


def _apply_sql_pass(engine) -> None:
    """Run migration 014 against the active database.

    This is intentionally separate from the canonical migration runner
    so the orchestrator can be invoked ad-hoc without touching the
    full migration pipeline. Idempotent.
    """
    migration = REPO_ROOT / "mira-hub" / "db" / "migrations" / "014_uns_path_backfill.sql"
    if not migration.exists():
        raise RuntimeError(f"migration not found: {migration}")
    sql = migration.read_text()
    with engine.begin() as c:
        # The file already wraps itself in BEGIN/COMMIT — strip them so
        # SQLAlchemy's transaction is the only one in play.
        cleaned = sql.replace("BEGIN;", "").replace("COMMIT;", "")
        for stmt in _split_statements(cleaned):
            # Skip pure-whitespace/comment chunks — psycopg rejects empty queries.
            # The migration trails with rollback notes that are all '--' comments.
            if any(
                s and not s.startswith('--')
                for s in (line.strip() for line in stmt.splitlines())
            ):
                c.execute(text(stmt))
    log.info("SQL pass complete (migration 014)")


def _split_statements(sql: str) -> list[str]:
    """Split on `;` outside dollar-quoted blocks. PL/pgSQL bodies between
    matching `$$ ... $$` are kept intact. Good enough for our migration
    files — they don't nest dollar-tags."""
    parts: list[str] = []
    buf: list[str] = []
    in_dollar = False
    for line in sql.splitlines():
        stripped = line.strip()
        if "$$" in stripped:
            # Toggle for each occurrence on the line.
            occ = stripped.count("$$")
            for _ in range(occ):
                in_dollar = not in_dollar
            buf.append(line)
            continue
        if not in_dollar and stripped.endswith(";"):
            buf.append(line)
            parts.append("\n".join(buf))
            buf = []
        else:
            buf.append(line)
    if buf:
        parts.append("\n".join(buf))
    return parts


def run(tenant: str | None, batch_size: int, commit: bool) -> Counts:
    engine = _engine()
    counts = Counts()

    if commit:
        log.info("Applying SQL backfill (migration 014)…")
        _apply_sql_pass(engine)
    else:
        log.warning("DRY-RUN — skipping SQL pass. Pass --commit to apply.")

    log.info("Running entity-creation pass (backfill_equipment_entities)…")
    stats = backfill_equipment_entities.run(tenant, batch_size, commit)
    counts.entities_created = stats.equipment_upserted + stats.manuals_upserted
    counts.entries_linked = stats.chunks_linked

    counts.entries_orphaned = _count_orphans(engine, tenant)
    counts.entities_unpathed = _count_unpathed(engine, tenant)
    return counts


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tenant", help="Restrict backfill to one tenant_id")
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument(
        "--commit",
        action="store_true",
        help="Apply writes (default = dry-run)",
    )
    args = p.parse_args()

    counts = run(args.tenant, args.batch_size, args.commit)

    log.info("=== UNS BACKFILL %s ===", "COMMIT" if args.commit else "DRY-RUN")
    log.info("  entities created:    %d", counts.entities_created)
    log.info("  entries linked:      %d", counts.entries_linked)
    log.info("  entries orphaned:    %d", counts.entries_orphaned)
    log.info("  entities unpathed:   %d", counts.entities_unpathed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
