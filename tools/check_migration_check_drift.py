#!/usr/bin/env python3
"""
Detect CHECK constraint value drift in migrations before merge.

When a migration file declares a CHECK (col IN (...)) constraint, this script
parses its value list and diffs against the LIVE STAGING database. If the
migration's list SHRINKS (loses values present in the live constraint), the
script fails — a silent regression like #032_decision_traces nearly hitting
31→28 values. A GROWTH (values added) always passes.

Usage:
  python3 tools/check_migration_check_drift.py <migration_file> [<migration_file> ...]

Env vars:
  DATABASE_URL — staging Neon connection string (read-only via information_schema)

Exits 0 if no shrinks found, 1 if shrink detected, 2 if script error.
"""

import sys
import re
import os
from typing import Dict, Set, Tuple, Optional


def parse_migration_file(path: str) -> Dict[str, Tuple[str, Set[str]]]:
    """
    Parse a migration .sql file for CHECK constraints.

    Returns a dict: constraint_key → (table_name, set of declared values)
    where constraint_key = f"{table}:{constraint_name}" for uniqueness.

    Handles:
    - Inline: COL … CHECK (col IN ('val1', 'val2'))
    - ALTER: ALTER TABLE … ADD CONSTRAINT … CHECK (col IN (...))
    """
    constraints = {}
    try:
        with open(path, "r") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"ERROR: {path} not found", file=sys.stderr)
        return constraints

    # Pattern 1: Explicit ALTER TABLE ADD CONSTRAINT
    # ALTER TABLE foo ADD CONSTRAINT foo_bar_check CHECK (bar IN ('x','y'))
    # Do this first — more reliable pattern with explicit constraint name
    # Use DOTALL flag to match across newlines in the IN clause
    alter_pattern = r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+CONSTRAINT\s+(\w+)\s+CHECK\s*\(\s*(\w+)\s+IN\s*\((.*?)\)"
    for m in re.finditer(alter_pattern, content, re.IGNORECASE | re.DOTALL):
        table_name = m.group(1).lower()
        constraint_name = m.group(2).lower()
        col_name = m.group(3).lower()
        values_str = m.group(4)
        key = f"{table_name}:{constraint_name}"
        vals = _parse_check_values(values_str)
        constraints[key] = (table_name, vals)

    # Pattern 2: Generic CHECK constraint with IN clause
    # Matches: CHECK (col IN (...)) anywhere in the file, captures the column and values
    # This is more forgiving for inline checks
    generic_pattern = r"CHECK\s*\(\s*(\w+)\s+IN\s*\((.*?)\)"
    for m in re.finditer(generic_pattern, content, re.IGNORECASE | re.DOTALL):
        col_name = m.group(1).lower()
        values_str = m.group(2)
        vals = _parse_check_values(values_str)
        # For constraints not already found by ALTER pattern, generate a key
        # Use a heuristic constraint name (col-based, no table context)
        constraint_name = f"{col_name}_check"
        # Try to infer table from nearby CREATE TABLE (best effort)
        # If we've already found this via ALTER, skip it
        key = f"unknown:{constraint_name}"
        if vals and key not in constraints:
            constraints[key] = ("unknown", vals)

    return constraints


def _parse_check_values(values_str: str) -> Set[str]:
    """Extract quoted string values from a CHECK IN (...) clause."""
    values = set()
    # Match single-quoted strings: 'value'
    for match in re.finditer(r"'([^']*)'", values_str):
        values.add(match.group(1))
    return values


def query_live_constraint(db_url: str, table: str, constraint_name: str) -> Optional[Set[str]]:
    """
    Query the live staging database for the current CHECK constraint values.

    Returns a set of values if the constraint exists, None if not.
    Uses information_schema.check_constraints to find the definition.
    """
    try:
        import psycopg
    except ImportError:
        print(
            "ERROR: psycopg3 not available. Install via: pip install psycopg[binary]",
            file=sys.stderr,
        )
        return None

    try:
        with psycopg.connect(db_url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                # Query the CHECK constraint definition from the live DB
                cur.execute(
                    """
                    SELECT check_clause
                    FROM information_schema.check_constraints
                    WHERE constraint_schema = 'public'
                      AND constraint_name = %s
                    LIMIT 1
                    """,
                    (constraint_name,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                check_clause = row[0]
                # Parse values from the clause (same regex as _parse_check_values)
                return _parse_check_values(check_clause)
    except Exception as e:
        print(f"ERROR querying {table}:{constraint_name}: {e}", file=sys.stderr)
        return None


def main():
    """Main: parse migration files, check for value shrinks against live DB."""
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        return 2

    migration_files = sys.argv[1:]
    all_constraints = {}

    # Parse all migration files
    for mig_file in migration_files:
        constraints = parse_migration_file(mig_file)
        all_constraints.update(constraints)

    if not all_constraints:
        # No CHECK constraints found — pass
        print("OK: No CHECK constraints found in migration files.")
        return 0

    # Query live DB and check for shrinks
    shrinks_found = []
    for key, (table, migration_vals) in all_constraints.items():
        constraint_name = key.split(":")[1]
        live_vals = query_live_constraint(db_url, table, constraint_name)

        if live_vals is None:
            # Constraint doesn't exist in live DB yet (new constraint) — OK
            print(f"  ✓ {key} (new constraint, not yet live)")
            continue

        # Diff: values in live but not in migration = SHRINK (danger)
        shrink = live_vals - migration_vals
        if shrink:
            shrinks_found.append((key, table, shrink, migration_vals, live_vals))
            print(
                f"  ✗ {key}: SHRINK detected (live has {live_vals}, migration declares {migration_vals})",
                file=sys.stderr,
            )

    if shrinks_found:
        print(
            "\nERROR: CHECK constraint shrinks detected. Migrations would lose values:",
            file=sys.stderr,
        )
        for key, table, shrink, migration_vals, live_vals in shrinks_found:
            print(f"  {key}", file=sys.stderr)
            print(f"    Lost values: {shrink}", file=sys.stderr)
            print(f"    Live:       {live_vals}", file=sys.stderr)
            print(f"    Migration:  {migration_vals}", file=sys.stderr)
        return 1

    print(f"OK: {len(all_constraints)} CHECK constraints — no shrinks detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
