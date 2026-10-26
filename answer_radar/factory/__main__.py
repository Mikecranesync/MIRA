"""One manually-triggered Benchmark Factory cycle over captured data (spec §16 Phase 7).

    python -m answer_radar.factory cycle --discovery FIXTURES.json --pages PAGES.json \
        --out OUT_DIR --private PRIVATE_DIR --seed 2026-W44 [--live-fraction 0.3] \
        [--expert-export EXPORT_DIR]

Replays captured records (no live collection), freezes, generates variants, assigns the
hidden Live subset, resolves candidate evidence, routes labels, and writes:
  OUT/review-data.json      #4801 expert-queue input (developer-visible cases only)
  OUT/live-manifest.json    hashes of the sealed Live holdout (text is in PRIVATE_DIR)
  OUT/cases.json            developer view of every non-holdout case
  OUT/cycle-report.json     counts by pool/source/family/lineage, contamination check
  PRIVATE/review-data-live.json  the Live cases' expert queue, kept outside git with their text
With --expert-export (a #4801 page export plus the review-data.json, and for Live the
review-data-live.json, that the expert answered) expert answers settle gold on every case,
Live included, before sealing. An answer whose manual/pages no longer match what was shown
is ignored.
Not scheduled: a recurring job is only added after one complete cycle is proven.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
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
from answer_radar.factory.labeling import export_review_data, import_expert, route
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
    expert_export: Path | None = None,
) -> dict:
    reg = SourceRegistry.load()
    cases = []
    for sid, recs in sorted(discovery.items()):
        if sid.startswith("_"):
            continue
        cases += ADAPTERS[sid](sid, reg).replay(recs)
    ledger_path = private / "exposure-ledger.json"
    ledger = set(json.loads(ledger_path.read_text())) if ledger_path.is_file() else set()
    cases = assign_live(cases, fraction=live_fraction, seed=seed, exposed_keys=frozenset(ledger))
    cases += [
        v
        for c in list(cases)
        if c.provenance.source_id in ("stackexchange", "control_com", "mrplc")
        for v in make_variants(c)
    ]
    errors = validate_set(cases, reg)
    if errors:
        raise SystemExit("invalid case set:\n" + "\n".join(errors))
    # Only authoritative sources may become gold, so only they are offered to experts.
    pages = [p for p in pages if p.source_id in reg and reg.may_back_gold(p.source_id)]
    candidates = {c.case_id: resolve(c, pages) for c in cases}
    queue = route(cases, seed=seed)
    if expert_export is not None:
        answers = load_expert_export(expert_export)  # validates manifest + review-data first
        shown = json.loads((expert_export / "review-data.json").read_text(encoding="utf-8"))
        live_shown = expert_export / "review-data-live.json"
        if live_shown.is_file():
            extra = json.loads(live_shown.read_text(encoding="utf-8"))
            shown = {k: shown.get(k, []) + extra.get(k, []) for k in ("forum", "safety")}
        cases = import_expert(cases, answers, candidates, shown)
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
    # Everything not held out is about to be shown to developers: record that, permanently.
    cases = [c if c.holdout else replace(c, exposed_to_developers=True) for c in cases]
    errors = validate_set(cases, reg)  # again, now that evidence and expert gold are attached
    if errors:
        raise SystemExit("invalid case set after expert import:\n" + "\n".join(errors))
    manifest = seal_live(cases, private)
    ledger |= {c.question.lineage_key for c in cases if not c.holdout}
    ledger_path.write_text(json.dumps(sorted(ledger), indent=2) + "\n", encoding="utf-8")
    # Live cases need expert gold too. Their review file goes beside the sealed text, outside git,
    # so the expert sees them while developers never do.
    live = [c for c in cases if c.holdout and c.case_id in queue]
    (private / "review-data-live.json").write_text(
        json.dumps(export_review_data(live, candidates), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    report = build_report(cases, registry=reg)
    report["expert_queue"] = {
        cid: why for cid, why in sorted(queue.items()) if cid in {c.case_id for c in visible}
    }
    report["live_holdout_size"] = len(manifest)
    report["live_expert_queue_size"] = len(live)
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


def load_expert_export(d: Path) -> dict[str, dict]:
    """Read a #4801 review-page export: export-manifest.json + answers/<doc>.json.

    Refuses an export without a manifest (the preview page's test answers must never count).
    A record whose key does not match its file refuses the whole export (fail closed, like
    rescore_human), rather than silently scoring a partial answer set.
    """
    if not (d / "export-manifest.json").is_file():
        raise SystemExit(f"{d}: no export-manifest.json; refusing an unidentified export")
    if not (d / "review-data.json").is_file():
        raise SystemExit(
            f"{d}: no review-data.json; the export must carry the file the expert answered"
        )
    out = {}
    for f in sorted((d / "answers").glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        if rec.get("key") != f.stem:
            raise SystemExit(
                f"{f}: record key {rec.get('key')!r} does not match its file; refusing the export"
            )
        out[f.stem] = rec
    return out


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
    c.add_argument("--expert-export", type=Path, default=None)
    a = ap.parse_args(argv)
    pages = [ManualPage(**p) for p in json.loads(a.pages.read_text())]
    rep = cycle(
        json.loads(a.discovery.read_text()),
        pages,
        a.out,
        a.private,
        a.seed,
        a.live_fraction,
        a.expert_export,
    )
    print(json.dumps(rep["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
