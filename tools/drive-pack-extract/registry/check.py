"""`check` — read-only: is a local drive manual new / unchanged / changed vs. the registry?

Computes a local PDF's SHA-256 and classifies it against ``sources.json``.
Never downloads, extracts, grades, writes, or promotes anything. Non-gating:
always exits 0 (it reports a state; it does not fail a build).

Usage:
    python check.py --manual path/to/manual.pdf [--id MANUAL_ID] [--json]

- ``--id`` given   -> classify against that specific registered manual.
- ``--id`` omitted -> identify by hash (is this exact PDF already registered?);
  an unknown hash reports ``new_manual``.

A ``changed_by_hash`` result is the trigger to run ``update_candidate.py`` —
which produces a CANDIDATE for human review, never a trusted replacement.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import registry


def _summary(cls: registry.Classification, *, manual: Path, sha256: str) -> dict:
    return {
        "manual_path": str(manual),
        "sha256": sha256,
        "manual_id": cls.manual_id,
        "state": cls.state,
        "needs_candidate": cls.needs_candidate,
        "reasons": cls.reasons,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Classify a local drive manual PDF against the registry."
    )
    parser.add_argument("--manual", required=True, type=Path, help="path to the local manual PDF")
    parser.add_argument(
        "--id", dest="manual_id", default=None, help="registered manual_id (optional)"
    )
    parser.add_argument("--registry", default=None, help="override sources.json path")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)

    manual: Path = args.manual.resolve()
    if not manual.is_file():
        print(f"ERROR: manual not found at {manual}", file=sys.stderr)
        return 2  # a genuinely missing input is an error, not a "state"

    reg = registry.load_registry(args.registry)
    sha256 = registry.sha256_file(manual)

    if args.manual_id:
        entry = registry.find_entry(reg, args.manual_id)
    else:
        # Identify by hash: a known hash means this exact PDF is registered.
        entry = registry.find_by_hash(reg, sha256)

    cls = registry.classify(entry, sha256)
    summary = _summary(cls, manual=manual, sha256=sha256)

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"manual : {manual}")
        print(f"sha256 : {sha256}")
        print(f"id     : {cls.manual_id or '(unregistered)'}")
        print(f"state  : {cls.state}")
        for r in cls.reasons:
            print(f"  - {r}")
        if cls.needs_candidate:
            print("next   : run update_candidate.py to generate a CANDIDATE for human review")

    return 0  # read-only, non-gating


if __name__ == "__main__":
    raise SystemExit(main())
