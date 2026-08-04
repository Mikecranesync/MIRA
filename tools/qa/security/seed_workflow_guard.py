#!/usr/bin/env python3
"""Fail-closed guards for production-capable seed workflows."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

_VALID_SEED_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
_DESTRUCTIVE_SQL = re.compile(
    r"\b(?:DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?|DELETE\s+FROM)\b",
    re.IGNORECASE,
)


class SeedGuardError(ValueError):
    """Raised when a workflow-resolvable seed violates the safety contract."""


def validate_seed_name(name: str) -> None:
    """Require a non-empty bare basename without traversal tokens."""
    if not name or ".." in name or _VALID_SEED_NAME.fullmatch(name) is None:
        raise SeedGuardError(
            f"Invalid seed name {name!r}: use a bare basename containing only "
            "letters, digits, dot, underscore, or hyphen; '..' is forbidden."
        )


def resolve_seed(seed_dir: Path, name: str) -> Path:
    """Resolve a seed and prove its real path stays inside ``seed_dir``."""
    validate_seed_name(name)
    try:
        root = seed_dir.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SeedGuardError(f"Seed directory not found: {seed_dir}") from exc

    candidate = seed_dir / f"{name}.sql"
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SeedGuardError(f"Seed file is missing or unresolvable: {candidate}") from exc

    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise SeedGuardError(
            f"Seed resolves outside {root}: {candidate} -> {resolved}"
        ) from exc
    if not resolved.is_file():
        raise SeedGuardError(f"Seed is not a regular file: {resolved}")
    return resolved


def _without_sql_comments(text: str) -> str:
    # SQL comments separate tokens like whitespace. Removing them with an empty
    # string would turn PostgreSQL-valid ``DROP/**/TABLE`` into ``DROPTABLE``
    # and let it evade the destructive-statement check.
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


def destructive_seed_findings(seed_dir: Path) -> list[str]:
    """Return workflow-resolvable seeds containing destructive SQL statements."""
    try:
        root = seed_dir.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SeedGuardError(f"Seed directory not found: {seed_dir}") from exc

    findings: list[str] = []
    for candidate in sorted(seed_dir.glob("*.sql")):
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root)
        except (OSError, RuntimeError, ValueError):
            findings.append(f"{candidate}: resolves outside {root} or is broken")
            continue
        if not resolved.is_file():
            findings.append(f"{candidate}: is not a regular file")
            continue
        match = _DESTRUCTIVE_SQL.search(
            _without_sql_comments(resolved.read_text(encoding="utf-8"))
        )
        if match:
            findings.append(f"{candidate}: contains destructive SQL: {match.group(0)}")
    return findings


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("resolve",), help=argparse.SUPPRESS)
    parser.add_argument("--seed-dir", type=Path, required=True)
    parser.add_argument("--name", required=True)

    args = parser.parse_args(argv)
    try:
        print(_display_path(resolve_seed(args.seed_dir, args.name)))
        return 0
    except SeedGuardError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
