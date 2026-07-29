"""Deterministic wiring-trust scorecard for one `MachineWiringProfile`.

Mirrors the gate-dict + trust-ladder pattern of
`tools/drive-pack-extract/scorecard.py`, scoped to one asset's wiring
instead of a drive pack. No LLM judgment — every gate is a reproducible
boolean over the profile's own rows.

Doctrine enforced here:
- Only `profile.approved` (== `profile.trusted()`) counts toward "trusted".
  A machine with wiring but zero approved rows scores `proposed_only`, never
  `trusted` — this is BY DESIGN (CV-101 is currently all-proposed and MUST
  score `proposed_only` = fail; see the module docstring in
  `tools/wiring_map_import.py`).
- This module does NOT wire itself into a repo-wide CI gate over live data.
  It is a library + CLI; callers (eval tests, ad-hoc `--ci` runs) decide
  when a `trusted=False` result should fail a build.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Optional

from .reader import profile_from_rows
from .schema import MachineWiringProfile


@dataclass(frozen=True)
class WiringTrustScore:
    """The result of scoring one asset's wiring profile."""

    asset: str
    gates: dict[str, bool]
    trusted: bool
    trust_level: str  # "no_wiring" | "proposed_only" | "partial" | "trusted"
    reasons: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


_GATE_REASONS = {
    "has_wiring": "no wiring_connections rows exist for this asset",
    "has_approved": "wiring exists but none of it is approved (proposed-only)",
    "approved_all_sourced": "an approved connection is missing a drawing reference/evidence (unsourced)",
    "approved_human_readable": "an approved connection lacks a human-readable endpoint label",
    "approved_field_confirmed": "an approved connection is still flagged field_verify (unconfirmed in the field)",
}


def score_profile(profile: MachineWiringProfile) -> WiringTrustScore:
    """Score `profile` against the five trust gates. Deterministic, pure."""
    approved = profile.approved
    gates = {
        "has_wiring": bool(profile.connections),
        "has_approved": bool(approved),
        "approved_all_sourced": bool(approved) and all(c.is_sourced() for c in approved),
        "approved_human_readable": bool(approved)
        and all(c.has_readable_endpoints() for c in approved),
        "approved_field_confirmed": bool(approved)
        and not any(c.is_field_verify_unconfirmed() for c in approved),
    }
    trusted = all(gates.values())

    if not profile.connections:
        trust_level = "no_wiring"
    elif not approved:
        trust_level = "proposed_only"
    elif trusted:
        trust_level = "trusted"
    else:
        trust_level = "partial"

    reasons = [_GATE_REASONS[k] for k, v in gates.items() if not v]

    counts = {
        "total": len(profile.connections),
        "approved": len(approved),
        "proposed": len(profile.proposed),
        "needs_review": len(profile.needs_review),
        "rejected": len(profile.rejected),
    }

    return WiringTrustScore(
        asset=profile.asset,
        gates=gates,
        trusted=trusted,
        trust_level=trust_level,
        reasons=reasons,
        counts=counts,
    )


def _render_human(score: WiringTrustScore) -> str:
    lines = [
        f"asset:       {score.asset}",
        f"trust_level: {score.trust_level}",
        f"trusted:     {score.trusted}",
        "gates:       "
        + ", ".join(f"{k} {'PASS' if v else 'FAIL'}" for k, v in score.gates.items()),
        "counts:      " + ", ".join(f"{k}={v}" for k, v in score.counts.items()),
    ]
    if score.reasons:
        lines.append("reasons:")
        lines.extend(f"  - {r}" for r in score.reasons)
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Score a MachineWiringProfile's wiring trust (offline JSON rows or DB)."
    )
    parser.add_argument(
        "--rows-file", default=None, help="JSON file of wiring_connections-shaped row dicts"
    )
    parser.add_argument("--asset", default=None, help="asset label / evidence_summary asset scope")
    parser.add_argument(
        "--tenant-id", default=os.getenv("MIRA_TENANT_ID"), help="DB path: owning tenant UUID"
    )
    parser.add_argument("--database-url", default=None, help="DB path: override NEON_DATABASE_URL")
    parser.add_argument("--json", action="store_true", help="emit the score as JSON")
    parser.add_argument(
        "--ci", action="store_true", help="exit nonzero when the profile is not trusted"
    )
    args = parser.parse_args(argv)

    if args.rows_file:
        with open(args.rows_file, encoding="utf-8") as fh:
            rows = json.load(fh)
        profile = profile_from_rows(rows, asset=args.asset or "")
    elif args.tenant_id:  # pragma: no cover - DB glue
        db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
        if not db_url:
            print(
                "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)",
                file=sys.stderr,
            )
            return 2

        import psycopg2  # local import: only the DB path needs the driver

        from .reader import load_profile

        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                profile = load_profile(cur, args.tenant_id, asset=args.asset)
        finally:
            conn.close()
    else:
        print("ERROR: pass --rows-file (offline) or --tenant-id (DB)", file=sys.stderr)
        return 2

    score = score_profile(profile)
    if args.json:
        print(json.dumps(score.to_dict(), indent=2))
    else:
        print(_render_human(score))

    if args.ci and not score.trusted:
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
