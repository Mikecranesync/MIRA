#!/usr/bin/env python3
"""
Detect enum drift between Postgres migrations and application code.

Spec: docs/specs/enforcement-layer-spec.md §4.3

Algorithm:
  1. Walk migrations under mira-hub/db/migrations/ and any other *.sql files
     in the repo. Extract:
        CREATE TYPE <name> AS ENUM ('a', 'b', 'c')
        ALTER TYPE  <name> ADD VALUE [IF NOT EXISTS] 'd'
     Build canonical map { enum_name: set(values) }.

  2. Walk application code. For each enum we know about, find:
        '<value>'::<enum_name>      ← canonical Postgres cast
        "<value>"::<enum_name>
     in TS and Python files, plus string literals in arrays of well-known
     status types (bounded heuristic — see WELL_KNOWN_ARRAYS).

  3. Report:
        code-not-in-migrations  → values cast in code but missing in SQL
        migrations-not-in-code  → values declared in SQL but never cast in code
                                  (informational; never fails)

Exit code 0 = clean (or only informational findings).
Exit code 1 = code-not-in-migrations findings (CI fails).

Allowlist: drop one `enum:value` pair per line in `.enum-drift-allowlist.txt`
to skip a known-safe drift (e.g. backfill in flight).
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST_PATH = ROOT / ".enum-drift-allowlist.txt"

SCAN_SQL_GLOBS = [
    "mira-hub/db/migrations/*.sql",
    "**/migrations/*.sql",
]

SCAN_CODE_GLOBS = [
    "mira-hub/src/**/*.ts",
    "mira-hub/src/**/*.tsx",
    "mira-bots/shared/**/*.py",
    "mira-bots/**/*.py",
    "mira-pipeline/**/*.py",
]

SKIP_PATH_PARTS = {"node_modules", ".next", "venv", ".git", "__pycache__", "dist", ".turbo"}

# Code-side detection is intentionally narrow: only `'value'::enum_name` casts.
# Anything else (heuristic array detection, status-string matching) produced
# unacceptable false-positive rates in production code, so we rely on the one
# unambiguous form. To check a value that doesn't go through a Postgres cast,
# add it to .enum-drift-allowlist.txt or write a targeted assertion.

CREATE_ENUM_RE = re.compile(
    r"CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM\s*\(\s*([^)]+)\)",
    re.IGNORECASE | re.DOTALL,
)
ALTER_ADD_VALUE_RE = re.compile(
    r"ALTER\s+TYPE\s+(\w+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'",
    re.IGNORECASE,
)
LITERAL_VALUE_RE = re.compile(r"'([^']+)'")
CAST_RE = re.compile(r"['\"]([\w_-]+)['\"]\s*::\s*(\w+)")


@dataclass
class EnumDef:
    name: str
    values: set[str] = field(default_factory=set)
    declared_in: list[str] = field(default_factory=list)


@dataclass
class CodeUsage:
    enum: str
    value: str
    file: str
    line: int


def load_allowlist() -> set[str]:
    if not ALLOWLIST_PATH.exists():
        return set()
    out: set[str] = set()
    for raw in ALLOWLIST_PATH.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        out.add(line.lower())
    return out


def iter_paths(globs: list[str]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for g in globs:
        for p in ROOT.glob(g):
            if not p.is_file():
                continue
            if any(part in SKIP_PATH_PARTS for part in p.parts):
                continue
            if p in seen:
                continue
            seen.add(p)
            out.append(p)
    return out


def parse_sql_enums(paths: list[Path]) -> dict[str, EnumDef]:
    enums: dict[str, EnumDef] = {}
    for p in paths:
        text = p.read_text(errors="ignore")
        rel = str(p.relative_to(ROOT))

        for m in CREATE_ENUM_RE.finditer(text):
            name = m.group(1).lower()
            body = m.group(2)
            values = {v for v in LITERAL_VALUE_RE.findall(body)}
            e = enums.setdefault(name, EnumDef(name=name))
            e.values.update(values)
            e.declared_in.append(rel)

        for m in ALTER_ADD_VALUE_RE.finditer(text):
            name = m.group(1).lower()
            value = m.group(2)
            e = enums.setdefault(name, EnumDef(name=name))
            e.values.add(value)
            if rel not in e.declared_in:
                e.declared_in.append(rel)

    return enums


def parse_code_usage(paths: list[Path], known_enums: set[str]) -> list[CodeUsage]:
    usages: list[CodeUsage] = []
    for p in paths:
        text = p.read_text(errors="ignore")
        rel = str(p.relative_to(ROOT))

        for i, line in enumerate(text.splitlines(), start=1):
            for m in CAST_RE.finditer(line):
                value, enum = m.group(1), m.group(2).lower()
                if enum in known_enums:
                    usages.append(CodeUsage(enum=enum, value=value, file=rel, line=i))

    # Dedup
    keyset: set[tuple[str, str]] = set()
    deduped: list[CodeUsage] = []
    for u in usages:
        k = (u.enum, u.value)
        if k in keyset:
            continue
        keyset.add(k)
        deduped.append(u)
    return deduped


def compare(
    enums: dict[str, EnumDef], usages: list[CodeUsage], allowlist: set[str]
) -> tuple[list[CodeUsage], list[tuple[str, str]]]:
    code_not_in_sql: list[CodeUsage] = []
    declared_values = {(e.name, v) for e in enums.values() for v in e.values}
    used_values = {(u.enum, u.value) for u in usages}

    for u in usages:
        if (u.enum, u.value) in declared_values:
            continue
        if f"{u.enum}:{u.value}".lower() in allowlist:
            continue
        code_not_in_sql.append(u)

    sql_not_in_code: list[tuple[str, str]] = []
    for e in enums.values():
        for v in sorted(e.values):
            if (e.name, v) in used_values:
                continue
            if f"{e.name}:{v}".lower() in allowlist:
                continue
            sql_not_in_code.append((e.name, v))

    return code_not_in_sql, sql_not_in_code


def main() -> int:
    sql_paths = iter_paths(SCAN_SQL_GLOBS)
    code_paths = iter_paths(SCAN_CODE_GLOBS)

    enums = parse_sql_enums(sql_paths)

    if not enums:
        print("⚠️  No enums discovered — nothing to check. (Check SCAN_SQL_GLOBS.)")
        return 0

    print(f"Discovered {len(enums)} enum types from {len(sql_paths)} SQL files:")
    for e in sorted(enums.values(), key=lambda x: x.name):
        print(f"  {e.name:<28} {sorted(e.values)}")

    usages = parse_code_usage(code_paths, set(enums.keys()))
    allowlist = load_allowlist()
    code_not_in_sql, sql_not_in_code = compare(enums, usages, allowlist)

    print(f"\nScanned {len(code_paths)} code files; found {len(usages)} enum cast/literal usages.")

    if sql_not_in_code:
        print("\n[informational] Declared in migrations but never used in code:")
        for enum_name, value in sql_not_in_code:
            print(f"  {enum_name}:{value}")

    if code_not_in_sql:
        print("\n❌ DRIFT: values cast in code but missing from migrations:")
        for u in code_not_in_sql:
            print(f"  {u.file}:{u.line}  {u.enum}:{u.value}")
        print(
            "\nFix: add a migration like:\n"
            "  ALTER TYPE <enum_name> ADD VALUE IF NOT EXISTS '<value>';\n"
            "Or if the cast is bogus, remove it / add to .enum-drift-allowlist.txt."
        )
        return 1

    print("\n✅ No drift detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
