#!/usr/bin/env python3
"""DRY-RUN manufacturer catalog reconciliation planner (issue #1596).

Plans — and NEVER applies — the cleanup of the existing polluted catalog by
mapping each distinct ``knowledge_entries.manufacturer`` value to its canonical
form using the SAME normalizer the ingest write boundary uses
(``mira-crawler/ingest/manufacturer_normalize.py``).

This is a planner, not a migration. It has NO write path. Applying the plan is
a separate, gated dev → staging → prod step (see ``docs/environments.md`` and
``tools/uns_backfill.py`` for the apply-side pattern).

Classification per distinct input name:
  - ``alias``     — deterministic OCR-variant map hit (raw → canonical).
  - ``fuzzy``     — a high-threshold fuzzy proposal toward a known canonical
                    name; flagged NEEDS REVIEW, never auto-applied.
  - ``unchanged`` — identity; no alias and no fuzzy candidate.

Input sources (offline-friendly, default is file/stdin — NEVER a database):
  - ``--input <file>`` : one manufacturer per line, OR a JSON array of strings.
  - stdin              : same formats, when no ``--input`` and no ``--from-db``.
  - ``--from-db``      : OPTIONAL read-only mode. Runs only
                         ``SELECT DISTINCT manufacturer FROM knowledge_entries``.
                         Requires an explicitly-supplied ``--db-url`` (it will
                         NOT silently read ``NEON_DATABASE_URL``) that matches a
                         known-safe (non-prod) marker; any unrecognized URL —
                         including prod — is refused. SELECT only — no writes.

Usage:
  python3 tools/reconcile_manufacturers.py --input mfrs.txt
  cat mfrs.txt | python3 tools/reconcile_manufacturers.py
  python3 tools/reconcile_manufacturers.py --input mfrs.txt --json
  python3 tools/reconcile_manufacturers.py --from-db --db-url "$NEON_STG_DATABASE_URL"
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

# Reuse the crawler's normalizer (source of truth) — don't reimplement it.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))
from ingest.manufacturer_normalize import (  # noqa: E402
    OCR_VARIANT_ALIASES,
    normalize_manufacturer,
    propose_fuzzy_canonical,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("reconcile-manufacturers")

# Fail-safe ALLOWLIST of markers that identify a KNOWN-SAFE (non-prod) database.
# --from-db proceeds ONLY when the URL contains one of these; anything else
# (including the prod URL) is refused by default.
#
# Why an allowlist, not a prod blocklist: a real Neon connection string uses the
# *endpoint* hostname (ep-<id>-pooler.<region>.aws.neon.tech), NOT the branch id
# / VPS IP / website domain. We don't have the prod endpoint id, and even if we
# blocked it, any new/renamed prod endpoint would slip through. Default-deny is
# the only design that can't silently connect to prod.
#
# Markers: docs/environments.md (staging endpoint ep-polished-hall-ahcqtcxe,
# staging branch br-small-term-ahtkz61d) + the standard local-DB loopbacks.
SAFE_URL_MARKERS = (
    "ep-polished-hall-ahcqtcxe",  # staging Neon endpoint
    "br-small-term-ahtkz61d",  # staging Neon branch
    "localhost",  # local Postgres
    "127.0.0.1",  # local Postgres
)

# The set of canonical/known names the fuzzy proposer matches against — the
# clean canonical spellings the alias map already collapses toward. We do NOT
# add input names here: that would let one dirty input propose another, creating
# ambiguous merges.
KNOWN_CANONICALS: set[str] = set(OCR_VARIANT_ALIASES.values())

BANNER = (
    "=" * 72 + "\nDRY RUN — no database writes. Apply is a separate, gated "
    "dev→staging→prod step.\n" + "=" * 72
)


@dataclass(frozen=True)
class Plan:
    """A single proposed (never applied) reconciliation for one raw name."""

    raw: str
    canonical: str
    action: str  # "alias" | "fuzzy" | "unchanged"
    needs_review: bool
    score: float | None = None  # fuzzy similarity, when action == "fuzzy"


def classify(raw: str) -> Plan:
    """Classify one raw manufacturer name. Alias precedence first; fuzzy only
    as a fallback on identity results; otherwise unchanged."""
    result = normalize_manufacturer(raw)
    if result.method == "alias":
        return Plan(raw=raw, canonical=result.canonical, action="alias", needs_review=False)

    # Identity result — try a high-threshold fuzzy proposal toward a canonical.
    proposal = propose_fuzzy_canonical(result.canonical, KNOWN_CANONICALS)
    if proposal is not None:
        return Plan(
            raw=raw,
            canonical=proposal.canonical,
            action="fuzzy",
            needs_review=True,
            score=proposal.score,
        )

    return Plan(raw=raw, canonical=result.canonical, action="unchanged", needs_review=False)


def plan_reconciliation(names: list[str]) -> list[Plan]:
    """Plan over the DISTINCT non-blank input names, order preserved."""
    seen: set[str] = set()
    distinct: list[str] = []
    for name in names:
        if name is None:
            continue
        stripped = name.strip()
        if not stripped or stripped in seen:
            continue
        seen.add(stripped)
        distinct.append(stripped)
    return [classify(name) for name in distinct]


def summarize(plans: list[Plan]) -> dict[str, int]:
    counts = {"alias": 0, "fuzzy": 0, "unchanged": 0}
    for p in plans:
        counts[p.action] += 1
    return counts


def is_safe_url(url: str) -> bool:
    """True only if the URL contains a known-safe (non-prod) marker.

    Fail-safe: any URL we don't recognize as safe — including the production
    URL — returns False and is refused. This cannot silently connect to prod.
    """
    lowered = url.lower()
    return any(marker in lowered for marker in SAFE_URL_MARKERS)


# ---------------------------------------------------------------------------
# Input sources
# ---------------------------------------------------------------------------


def _parse_names(text: str) -> list[str]:
    """Parse a JSON array of strings, or fall back to one-name-per-line."""
    text = text.strip()
    if not text:
        return []
    if text.startswith("["):
        data = json.loads(text)
        if not isinstance(data, list):
            raise ValueError("JSON input must be an array of strings")
        return [str(item) for item in data]
    return [line for line in text.splitlines() if line.strip()]


def read_from_file(path: Path) -> list[str]:
    return _parse_names(path.read_text())


def read_from_stdin() -> list[str]:
    return _parse_names(sys.stdin.read())


def read_from_db(db_url: str) -> list[str]:
    """Read DISTINCT manufacturers from NeonDB — read-only, non-prod only.

    sqlalchemy is imported LAZILY here so the default file/stdin path never
    pulls in a DB driver (no DB/network dependency unless --from-db is used).
    Runs exactly one statement: SELECT DISTINCT manufacturer. No writes.
    """
    if not is_safe_url(db_url):
        log.error(
            "REFUSING --from-db: URL does not match a known-safe (non-prod) marker. "
            "Allowed markers: %s. This planner is dry-run and read-only and connects "
            "ONLY to a recognized staging/local DB — never prod, never an unknown host.",
            ", ".join(SAFE_URL_MARKERS),
        )
        raise SystemExit(2)

    from sqlalchemy import create_engine, text  # lazy: only when --from-db
    from sqlalchemy.pool import NullPool

    log.info("Connecting read-only to non-prod DB for SELECT DISTINCT manufacturer…")
    engine = create_engine(
        db_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT DISTINCT manufacturer FROM knowledge_entries")).fetchall()
    return [r[0] for r in rows if r[0]]


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def render_text_report(plans: list[Plan]) -> str:
    counts = summarize(plans)
    lines = [
        BANNER,
        "",
        f"Distinct manufacturer values planned: {len(plans)}",
        f"  alias (deterministic):  {counts['alias']}",
        f"  fuzzy (NEEDS REVIEW):   {counts['fuzzy']}",
        f"  unchanged (identity):   {counts['unchanged']}",
        "",
    ]

    aliases = [p for p in plans if p.action == "alias"]
    fuzzies = [p for p in plans if p.action == "fuzzy"]

    if aliases:
        lines.append("Deterministic alias collapses (safe to apply):")
        for p in sorted(aliases, key=lambda p: p.raw.lower()):
            lines.append(f"  {p.raw!r} -> {p.canonical!r}")
        lines.append("")

    if fuzzies:
        lines.append("Fuzzy proposals (NEEDS REVIEW — do NOT auto-apply):")
        for p in sorted(fuzzies, key=lambda p: p.raw.lower()):
            lines.append(f"  {p.raw!r} ~> {p.canonical!r}  (score={p.score:.3f})")
        lines.append("")

    lines.append(
        "No writes were made. To apply, route the reviewed mappings through the "
        "gated dev→staging→prod migration path (see docs/environments.md)."
    )
    return "\n".join(lines)


def render_json_report(plans: list[Plan]) -> str:
    payload = {
        "dry_run": True,
        "counts": summarize(plans),
        "plans": [asdict(p) for p in plans],
    }
    return json.dumps(payload, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--input", type=Path, help="File of manufacturer names (lines or JSON array)"
    )
    parser.add_argument(
        "--from-db",
        action="store_true",
        help="Read DISTINCT manufacturers from NeonDB (read-only, non-prod only; requires --db-url)",
    )
    parser.add_argument(
        "--db-url",
        help="Explicit non-prod DB URL for --from-db (NOT read from NEON_DATABASE_URL env)",
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit machine-readable JSON instead of text"
    )
    args = parser.parse_args()

    if args.from_db:
        if not args.db_url:
            log.error(
                "--from-db requires an explicit --db-url (a non-prod URL). "
                "It will not silently use NEON_DATABASE_URL."
            )
            return 2
        names = read_from_db(args.db_url)
    elif args.input:
        names = read_from_file(args.input)
    else:
        names = read_from_stdin()

    if not names:
        log.warning("No manufacturer names provided — nothing to plan.")
        return 0

    plans = plan_reconciliation(names)

    if args.json:
        print(render_json_report(plans))
    else:
        print(render_text_report(plans))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
