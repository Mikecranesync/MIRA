"""Canonical resource keys and overlap (docs/peer-network/schemas/claim.schema.json)."""

from __future__ import annotations

import json
import re
from pathlib import Path

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "docs" / "peer-network" / "schemas" / "claim.schema.json"
)
_PATTERN = re.compile(
    json.loads(_SCHEMA.read_text())["properties"]["resource_keys"]["items"]["pattern"]
)
_PATH_PREFIXES = ("docs/", "deployment/", "tests/", ".github/workflows/")


class InvalidResourceKey(ValueError):
    """A key that does not name a canonical resource (free text, traversal, unknown family)."""


def canonicalize(key: str) -> str:
    """Trim, collapse duplicate slashes, drop a trailing slash, then require the schema pattern.

    Rejects '.' / '..' segments before matching so `docs/../packages/x` can never normalise into
    something the pattern accepts."""
    raw = key.strip()
    if not raw:
        raise InvalidResourceKey("empty key")
    collapsed = re.sub(r"/{2,}", "/", raw).rstrip("/")
    if any(seg in (".", "..") for seg in collapsed.split("/")):
        raise InvalidResourceKey(f"traversal segment in {key!r}")
    if not _PATTERN.fullmatch(collapsed):
        raise InvalidResourceKey(f"not a canonical resource key: {key!r}")
    return collapsed


def _segments(key: str) -> list[str]:
    return key.split("/")


def overlaps(a: str, b: str) -> bool:
    """Two keys overlap when equal, or when one is an ancestor path of the other.

    Path-shaped families (docs/, deployment/, tests/, .github/workflows/) nest by segment:
    `docs/peer-network` overlaps `docs/peer-network/schemas/x.json`, and vice versa.
    Non-path keys (`mira-mobile`, `migration:next`, `root:CLAUDE.md`) overlap only when equal."""
    ca, cb = canonicalize(a), canonicalize(b)
    if ca == cb:
        return True
    if not (ca.startswith(_PATH_PREFIXES) and cb.startswith(_PATH_PREFIXES)):
        return False
    sa, sb = _segments(ca), _segments(cb)
    shorter, longer = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
    return longer[: len(shorter)] == shorter


def covers(held: str, wanted: str) -> bool:
    """`held` covers `wanted` when they are equal, or when `wanted` DESCENDS from `held` in a
    path family. Asymmetric on purpose: a claim on `docs/peer-network/schemas` does not cover
    `docs/peer-network` (a child never covers its parent), while `docs/peer-network` covers
    `docs/peer-network/schemas/x.json`. Overlap (symmetric) decides the race; coverage
    (asymmetric) decides whether a key needs a new claim."""
    ch, cw = canonicalize(held), canonicalize(wanted)
    if ch == cw:
        return True
    if not (ch.startswith(_PATH_PREFIXES) and cw.startswith(_PATH_PREFIXES)):
        return False
    sh, sw = _segments(ch), _segments(cw)
    return len(sw) > len(sh) and sw[: len(sh)] == sh


def keys_conflict(mine: list[str], theirs: list[str]) -> list[tuple[str, str]]:
    """Every (mine, theirs) pair that overlaps — empty means the two claims may run at once."""
    return [(m, t) for m in mine for t in theirs if overlaps(m, t)]
