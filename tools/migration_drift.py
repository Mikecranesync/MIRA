"""Detect migration drift — repo migration files not recorded in a DB's ledger.

Root-cause guard for the drift that left mig 013 (`conversation_eval.meta`)
unapplied on **staging** for weeks: `apply-ingest-migrations.yml` was prod-only
and ledger-less, so nothing tracked (or could detect) that staging was behind.

This scans **both** migration dirs — `mira-hub/db/migrations` and
`mira-core/mira-ingest/db/migrations` — and compares each file's basename against
the `schema_migrations` ledger of a target database. Anything present in the repo
but missing from the ledger is *drift*: a migration the environment silently
never got.

Both migration sets target the same Neon database and the ledger keys on the full
basename (e.g. `013_conversation_eval_meta.sql`), so the two sets coexist without
prefix collisions.

    # fail (exit 1) if the target DB is missing any repo migration:
    NEON_DATABASE_URL=…staging python tools/migration_drift.py
    # report only, never fail (for a soft/advisory gate):
    NEON_DATABASE_URL=… python tools/migration_drift.py --warn-only

Pure core (`repo_migrations`, `find_drift`) is unit-tested; `main()` is the thin
psycopg2 read. Read-only — it never writes the ledger or applies anything.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# The two migration sets that land in the shared Neon DB + get a schema_migrations row.
MIGRATION_DIRS = (
    "mira-hub/db/migrations",
    "mira-core/mira-ingest/db/migrations",
)


def repo_migrations(
    dirs: tuple[str, ...] = MIGRATION_DIRS, *, root: Path | None = None
) -> list[str]:
    """Basenames of every ``*.sql`` under the given migration dirs, sorted, de-duped."""
    base = root or Path(__file__).resolve().parent.parent  # repo root
    names: set[str] = set()
    for d in dirs:
        for f in sorted((base / d).glob("*.sql")):
            names.add(f.name)
    return sorted(names)


def find_drift(repo: list[str], applied: set[str]) -> list[str]:
    """Repo migrations absent from the ledger, sorted. Pure — no I/O.

    Only reports repo→ledger drift (a file that never got applied). A ledger row
    with no repo file (a deleted migration) is intentionally NOT drift here.
    """
    return sorted(name for name in repo if name not in applied)


def render(repo: list[str], applied: set[str], drift: list[str]) -> str:
    lines = [
        "# Migration drift check",
        "",
        f"- repo migrations: {len(repo)}",
        f"- recorded in schema_migrations: {len(applied & set(repo))}/{len(repo)}",
        f"- DRIFT (in repo, not applied): {len(drift)}",
    ]
    if drift:
        lines.append("")
        lines.append("Missing migrations (apply these to the target env):")
        lines += [f"  - {name}" for name in drift]
    else:
        lines.append("")
        lines.append("No drift — every repo migration is recorded in the ledger.")
    return "\n".join(lines) + "\n"


_LEDGER_SQL = "SELECT migration_name FROM schema_migrations"
_LEDGER_EXISTS_SQL = (
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'"
)


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(description="Detect migration drift vs a DB's ledger.")
    parser.add_argument(
        "--warn-only", action="store_true", help="report drift but always exit 0 (advisory)"
    )
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(_LEDGER_EXISTS_SQL)
            if cur.fetchone() is None:
                # No ledger at all = maximal drift (nothing has been recorded).
                applied: set[str] = set()
            else:
                cur.execute(_LEDGER_SQL)
                applied = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()

    repo = repo_migrations()
    drift = find_drift(repo, applied)
    print(render(repo, applied, drift), end="")

    if drift and not args.warn_only:
        print(
            f"\nDRIFT DETECTED: {len(drift)} migration(s) not applied to this DB.", file=sys.stderr
        )
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
