"""One manually-triggered Benchmark Factory cycle over captured data (spec §16 Phase 7).

    python -m answer_radar.factory cycle --discovery FIXTURES.json --pages PAGES.json \
        --out OUT_DIR --private PRIVATE_DIR --seed 2026-W44 [--live-fraction 0.3]

Replays captured records (no live collection), freezes, generates variants, assigns the
hidden Live subset, resolves candidate evidence, routes labels, and writes:
  OUT/review-data.json      #4801 expert-queue input (developer-visible cases only)
  OUT/live-manifest.json    hashes of the sealed Live holdout (text is in PRIVATE_DIR)
  OUT/cases.json            developer view of every non-holdout case
  OUT/cycle-report.json     counts by pool/source/family/lineage, contamination check
Not scheduled: a recurring job is only added after one complete cycle is proven.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from answer_radar.factory.case import validate_set
from answer_radar.factory.discovery import (
    FieldFailureAdapter,
    ForumAdapter,
    IncidentAdapter,
    MachineStateAdapter,
    StackExchangeAdapter,
)
from answer_radar.factory.evidence import ManualPage, resolve
from answer_radar.factory.holdout import (
    HoldoutLeak,
    _inside_git,
    assign_live,
    developer_export,
    seal_live,
)
from answer_radar.factory.labeling import export_review_data, route
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.scoring import build_report
from answer_radar.factory.variants import make_variants

ADAPTERS = {
    "stackexchange": StackExchangeAdapter,
    "control_com": ForumAdapter,
    "mrplc": ForumAdapter,
    "osha_fatalities": IncidentAdapter,
    "niosh_face": IncidentAdapter,
    "csb": IncidentAdapter,
    "uci_ai4i": MachineStateAdapter,
    "uci_metropt3": MachineStateAdapter,
    "field": FieldFailureAdapter,
}


def cycle(
    discovery: dict,
    pages: list[ManualPage],
    out: Path,
    private: Path,
    seed: str,
    live_fraction: float,
) -> dict:
    reg = SourceRegistry.load()
    cases = []
    for sid, recs in sorted(discovery.items()):
        if sid.startswith("_"):
            continue
        cases += ADAPTERS[sid](sid, reg).replay(recs)
    cases = assign_live(cases, fraction=live_fraction, seed=seed)
    cases += [
        v
        for c in list(cases)
        if c.provenance.source_id in ("stackexchange", "control_com", "mrplc")
        for v in make_variants(c)
    ]
    errors = validate_set(cases, reg)
    if errors:
        raise SystemExit("invalid case set:\n" + "\n".join(errors))
    candidates = {c.case_id: resolve(c, pages) for c in cases}
    queue = route(cases, seed=seed)
    # review-data.json carries question text for the expert. Text a source does not allow to be
    # committed may not land in a git work tree (the repository is public).
    if _inside_git(out.resolve()) and not all(
        reg.may_commit_text(c.provenance.source_id) for c in cases
    ):
        raise HoldoutLeak(
            f"{out} is inside a git work tree and the cases include uncommittable source text"
        )
    out.mkdir(parents=True, exist_ok=True)
    visible = [c for c in cases if not c.holdout]
    review = export_review_data([c for c in visible if c.case_id in queue], candidates)
    manifest = seal_live(cases, private)
    report = build_report(cases, registry=reg)
    report["expert_queue"] = {
        cid: why for cid, why in sorted(queue.items()) if cid in {c.case_id for c in visible}
    }
    report["live_holdout_size"] = len(manifest)
    for name, data in {
        "review-data.json": review,
        "live-manifest.json": manifest,
        "cases.json": developer_export(cases, reg),
        "cycle-report.json": report,
    }.items():
        (out / name).write_text(
            json.dumps(data, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8"
        )
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m answer_radar.factory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cycle")
    c.add_argument("--discovery", type=Path, required=True)
    c.add_argument("--pages", type=Path, required=True)
    c.add_argument("--out", type=Path, required=True)
    c.add_argument("--private", type=Path, required=True)
    c.add_argument("--seed", required=True)
    c.add_argument("--live-fraction", type=float, default=0.3)
    a = ap.parse_args(argv)
    pages = [ManualPage(**p) for p in json.loads(a.pages.read_text())]
    rep = cycle(
        json.loads(a.discovery.read_text()), pages, a.out, a.private, a.seed, a.live_fraction
    )
    print(json.dumps(rep["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
