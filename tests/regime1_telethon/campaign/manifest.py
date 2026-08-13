"""Checksum manifest for campaign evidence — what a report was generated FROM.

The ledgers and frozen transcripts are gitignored: they are bulky, they contain
raw bot output, and they live wherever the campaign was driven from. That is a
defensible storage choice and an indefensible *provenance* one — a report that
says "regenerate it" while its inputs exist on exactly one laptop is not
reproducible, it just looks it.

This manifest is the committed half. It records, for every ledger and frozen
transcript, a SHA-256 and a size, so anyone holding an evidence bundle can prove
it is the same evidence the published report was built from — and anyone who
does NOT hold it can see precisely what they are missing instead of discovering
it as a silent difference.

It is deliberately not the evidence itself. Committing raw transcripts would put
unreviewed bot output (and, once field capture exists, customer text) into the
repository.

  py -3 -m tests.regime1_telethon.campaign.manifest          # write
  py -3 -m tests.regime1_telethon.campaign.manifest --verify # check local evidence
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import ledger as ledger_mod  # noqa: E402

MANIFEST_PATH = Path(__file__).parent / "evidence-manifest.json"
SCHEMA_VERSION = 1


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def collect() -> dict:
    """Hash every ledger and frozen transcript currently on disk."""
    ledgers: dict[str, dict] = {}
    for p in (
        sorted(ledger_mod.LEDGER_DIR.glob("*.jsonl")) if ledger_mod.LEDGER_DIR.exists() else []
    ):
        ledgers[p.name] = {"sha256": sha256(p), "bytes": p.stat().st_size}

    frozen: dict[str, dict] = {}
    for p in sorted(ledger_mod.FROZEN_DIR.glob("*.json")) if ledger_mod.FROZEN_DIR.exists() else []:
        frozen[p.name] = {"sha256": sha256(p), "bytes": p.stat().st_size}

    return {
        "schema_version": SCHEMA_VERSION,
        "ledgers": ledgers,
        "frozen": frozen,
        "note": (
            "Ledgers and frozen transcripts are gitignored. A report generated without "
            "the matching evidence bundle is NOT reproducible — verify against these "
            "checksums before trusting a regenerated report."
        ),
    }


def write(path: Path | None = None) -> Path:
    p = path or MANIFEST_PATH
    p.write_text(json.dumps(collect(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return p


def verify(path: Path | None = None) -> tuple[list[str], list[str], list[str]]:
    """Compare local evidence against the manifest.

    Returns (missing, changed, extra). Missing and changed are the ones that
    matter: they mean a regenerated report would differ from the published one.
    """
    p = path or MANIFEST_PATH
    if not p.exists():
        raise SystemExit(f"no manifest at {p} — run without --verify to create one")
    recorded = json.loads(p.read_text(encoding="utf-8"))
    current = collect()

    missing: list[str] = []
    changed: list[str] = []
    extra: list[str] = []
    for section in ("ledgers", "frozen"):
        rec = recorded.get(section, {})
        cur = current.get(section, {})
        for name, meta in rec.items():
            if name not in cur:
                missing.append(f"{section}/{name}")
            elif cur[name]["sha256"] != meta["sha256"]:
                changed.append(f"{section}/{name}")
        for name in cur:
            if name not in rec:
                extra.append(f"{section}/{name}")
    return missing, changed, extra


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    if not args.verify:
        p = write()
        d = collect()
        print(f"wrote {p} — {len(d['ledgers'])} ledger(s), {len(d['frozen'])} frozen transcript(s)")
        return 0

    missing, changed, extra = verify()
    for name in missing:
        print(f"MISSING  {name}")
    for name in changed:
        print(f"CHANGED  {name}")
    for name in extra:
        print(f"EXTRA    {name}")
    if missing or changed:
        print(
            f"\n{len(missing)} missing, {len(changed)} changed — a report regenerated here "
            "would NOT match the published one."
        )
        return 1
    print(f"evidence matches the manifest ({len(extra)} untracked extra file(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
