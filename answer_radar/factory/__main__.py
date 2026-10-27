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
import hashlib
import json
from dataclasses import replace
from pathlib import Path

from answer_radar.factory.case import Answerability, Label, validate_set
from answer_radar.factory.discovery import (
    FieldFailureAdapter,
    ForumAdapter,
    IncidentAdapter,
    MachineStateAdapter,
    StackExchangeAdapter,
)
from answer_radar.factory.evidence import ManualPage, PageIndex, resolve
from answer_radar.factory.holdout import (
    HoldoutLeak,
    _inside_git,
    assign_live,
    developer_export,
    group_key,
    seal_live,
)
from answer_radar.factory.labeling import export_review_data, import_expert, route
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.scoring import build_report
from answer_radar.factory.variants import make_variants, sync_variant_evidence
from answer_radar.schema import IndependenceClass

ADAPTERS = {
    "stackexchange": StackExchangeAdapter,
    "control_com": ForumAdapter,
    "mrplc": ForumAdapter,
    "plctalk": ForumAdapter,
    "osha_fatalities": IncidentAdapter,
    "niosh_face": IncidentAdapter,
    "csb": IncidentAdapter,
    "uci_ai4i": MachineStateAdapter,
    "uci_metropt3": MachineStateAdapter,
    "field": FieldFailureAdapter,
}


def build(discovery: dict, pages: list[ManualPage], private: Path, seed: str, live_fraction: float):
    """Replay -> freeze -> variants -> Live assignment -> validate -> evidence candidates.

    Pure with respect to the filesystem except for READING the exposure ledger, so `prelabel`
    sees exactly the cases and candidates `cycle` will route.
    """
    reg = SourceRegistry.load()
    cases = []
    for sid, recs in sorted(discovery.items()):
        if sid.startswith("_"):
            continue
        cases += ADAPTERS[sid](sid, reg).replay(recs)
    ledger_path = private / "exposure-ledger.json"
    ledger = set(json.loads(ledger_path.read_text())) if ledger_path.is_file() else set()
    # Variants first, THEN Live assignment: a variant's text can equal another source's
    # question, so the fingerprint reconciliation in assign_live must see the expanded set.
    cases += [
        v
        for c in list(cases)
        if c.provenance.source_id in ("stackexchange", "control_com", "mrplc", "plctalk")
        for v in make_variants(c)
    ]
    cases = assign_live(cases, fraction=live_fraction, seed=seed, exposed_keys=frozenset(ledger))
    live_tasks = {c.freeze_hash for c in cases if c.holdout} | {
        c.question.dedupe_hash for c in cases if c.holdout
    }
    leaked = [
        c.case_id
        for c in cases
        if not c.holdout and ({c.freeze_hash, c.question.dedupe_hash} & live_tasks)
    ]
    if leaked:
        raise HoldoutLeak(f"developer-visible cases duplicate a Live question: {leaked[:3]}")
    errors = validate_set(cases, reg)
    if errors:
        raise SystemExit("invalid case set:\n" + "\n".join(errors))
    # Only authoritative sources may become gold, so only they are offered to experts.
    pages = [p for p in pages if p.source_id in reg and reg.may_back_gold(p.source_id)]
    index = PageIndex(pages)
    candidates = {c.case_id: resolve(c, pages, index=index) for c in cases}
    return reg, cases, candidates, ledger, ledger_path


def load_labels(path: Path) -> dict[str, dict]:
    """{case_id: {"freeze_hash", "input_sha256", "labels": [Label]}} as written by prelabel."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        cid: {
            "freeze_hash": rec["freeze_hash"],
            "input_sha256": rec["input_sha256"],
            "labels": [
                Label(
                    d["labeler_id"],
                    IndependenceClass(d["independence"]),
                    Answerability(d["answerability"]),
                    tuple(d.get("pages", ())),
                    d.get("safety_class"),
                    d.get("confidence"),
                    bool(d.get("unsure")),
                )
                for d in rec["labels"]
            ],
        }
        for cid, rec in raw.items()
    }


def cycle(
    discovery: dict,
    pages: list[ManualPage],
    out: Path,
    private: Path,
    seed: str,
    live_fraction: float,
    expert_export: Path | None = None,
    labels: Path | None = None,
    review_variants: bool = False,
) -> dict:
    reg, cases, candidates, ledger, ledger_path = build(
        discovery, pages, private, seed, live_fraction
    )
    if labels is not None:
        from answer_radar.factory.prelabel import input_digest

        pre, page_text = load_labels(labels), {(p.doc_sha256, p.page): p.text for p in pages}

        def fresh(c) -> bool:
            # Reuse a label only for the exact frozen question AND the exact pages the labeler
            # saw; a changed question or manual corpus leaves the case unlabeled for review.
            rec = pre.get(c.case_id)
            return (
                bool(rec)
                and rec["freeze_hash"] == c.freeze_hash
                and rec["input_sha256"] == input_digest(c, candidates.get(c.case_id, []), page_text)
            )

        cases = [
            replace(c, labels=[*c.labels, *pre[c.case_id]["labels"]]) if fresh(c) else c
            for c in cases
        ]
    queue = route(cases, seed=seed, review_variants=review_variants)
    if expert_export is not None:
        answers = load_expert_export(expert_export)  # validates manifest + review-data first
        shown = json.loads((expert_export / "review-data.json").read_text(encoding="utf-8"))
        live_shown = expert_export / "review-data-live.json"
        if live_shown.is_file():
            extra = json.loads(live_shown.read_text(encoding="utf-8"))
            shown = {k: shown.get(k, []) + extra.get(k, []) for k in ("forum", "safety")}
        cases = import_expert(cases, answers, candidates, shown)
        cases = sync_variant_evidence(cases)  # preserving variants probe the adjudicated pages
        # Partial exports are normal (experts work through the queue over time); unanswered cases
        # stay provisional. Say how partial, so a truncated export is never silent.
        shown_ids = {f"{k}-{r['id']}" for k in ("forum", "safety") for r in shown.get(k, [])}
        expert_status = {"shown": len(shown_ids), "answered": len(shown_ids & set(answers))}
        expert_status["complete"] = expert_status["shown"] == expert_status["answered"]
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
    ledger |= {group_key(c) for c in cases if not c.holdout}
    ledger |= {f"fp:{c.question.dedupe_hash}" for c in cases if not c.holdout}
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
    if expert_export is not None:
        report["expert_export"] = expert_status
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
    # The manifest pins the exact review file(s) the answers were given against, so an old
    # answers/ tree can never be paired with a newer review file (rescore_human's frozen pin).
    manifest = json.loads((d / "export-manifest.json").read_text(encoding="utf-8"))
    for name, field in (
        ("review-data.json", "review_data_sha256"),
        ("review-data-live.json", "review_data_live_sha256"),
    ):
        pinned = manifest.get(field)
        if (d / name).is_file() and pinned != hashlib.sha256((d / name).read_bytes()).hexdigest():
            raise SystemExit(
                f"{d}: export-manifest {field} does not match {name}; refusing the export"
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


def _private(path: Path) -> Path:
    if _inside_git(path.resolve()):
        raise HoldoutLeak(
            f"{path} is inside a git work tree; captured source text would be publishable"
        )
    return path


def capture(
    source: str,
    site: str,
    tags: list[str],
    pages: int,
    private: Path,
    per_label: int = 10,
    seed: str = "s",
) -> int:
    """Fetch an approved source into PRIVATE (outside git): captured text is never committed."""
    _private(private)
    reg = SourceRegistry.load()
    adapter = ADAPTERS[source](source, reg)
    if source == "uci_ai4i":
        records, site = adapter.fetch_ai4i(per_label=per_label, seed=seed), "ai4i"
    else:
        records = adapter.fetch(site=site, tags=tags, pages=pages)
    private.mkdir(parents=True, exist_ok=True)
    path = private / f"{source}-{site}.json"
    existing = (
        json.loads(path.read_text(encoding="utf-8")).get(source, []) if path.is_file() else []
    )
    merged = {r["id"]: r for r in [*existing, *records]}  # re-captures keep the first capture
    for r in existing:
        merged[r["id"]] = r
    path.write_text(
        json.dumps({source: [merged[k] for k in sorted(merged)]}, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"file": str(path), "fetched": len(records), "total": len(merged)}))
    return 0


def run_prelabel(a) -> int:
    """Paid lane: two independent providers label visible original cases under a hard cap."""
    import dataclasses
    import os

    import httpx

    from answer_radar.factory.prelabel import Budget, Labeler, input_digest, prelabel

    _private(a.private)
    pages = [ManualPage(**p) for p in json.loads(a.pages.read_text())]
    _, cases, candidates, _, _ = build(
        json.loads(a.discovery.read_text()), pages, a.private, a.seed, a.live_fraction
    )
    labelers = [
        Labeler(
            "openai:gpt-5.4-mini",
            "https://api.openai.com/v1/chat/completions",
            "gpt-5.4-mini",
            os.environ["OPENAI_API_KEY"],
            0.75,
            4.5,
            openai_style_tokens=True,
        ),
        Labeler(
            "openrouter:llama-3.3-70b",
            "https://openrouter.ai/api/v1/chat/completions",
            "meta-llama/llama-3.3-70b-instruct",
            os.environ["OPENROUTER_API_KEY"],
            0.5,
            1.0,
        ),
    ]

    def post(url, body, headers):
        r = httpx.post(url, json=body, headers=headers, timeout=60)
        r.raise_for_status()
        return r.json()

    budget = Budget(cap_usd=a.budget_usd)  # validates: finite, non-negative
    page_text = {(p.doc_sha256, p.page): p.text for p in pages}
    by_id = {c.case_id: c for c in cases}
    # Recall before recompute: reuse every saved label whose frozen question and rendered input
    # are unchanged; only missing or invalidated cases are sent (and paid for) again.
    saved_path = a.private / "labels.json"
    saved = load_labels(saved_path) if saved_path.is_file() else {}
    reuse = {
        k: rec["labels"]
        for k, rec in saved.items()
        if k in by_id
        and rec["freeze_hash"] == by_id[k].freeze_hash
        and rec["input_sha256"] == input_digest(by_id[k], candidates.get(k, []), page_text)
    }
    labels = prelabel(cases, candidates, page_text, labelers, budget, post, reuse=reuse)
    a.private.mkdir(parents=True, exist_ok=True)
    (a.private / "labels.json").write_text(
        json.dumps(
            {
                k: {
                    "freeze_hash": by_id[k].freeze_hash,
                    "input_sha256": input_digest(by_id[k], candidates.get(k, []), page_text),
                    "labels": [dataclasses.asdict(lb) for lb in v],
                }
                for k, v in labels.items()
            },
            default=str,
            indent=1,
        ),
        encoding="utf-8",
    )
    with (a.private / "prelabel-costs.jsonl").open("a", encoding="utf-8") as fh:  # history kept
        fh.write("".join(json.dumps(c) + "\n" for c in budget.calls))
    print(
        json.dumps(
            {
                "labeled": len(labels),
                "reused": len(reuse),
                "calls": len(budget.calls),
                "spent_usd": round(budget.spent_usd, 4),
                "cap_usd": a.budget_usd,
            }
        )
    )
    return 0


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
    c.add_argument("--labels", type=Path, default=None)
    c.add_argument("--review-variants", action="store_true")
    pl = sub.add_parser("prelabel")
    pl.add_argument("--discovery", type=Path, required=True)
    pl.add_argument("--pages", type=Path, required=True)
    pl.add_argument("--private", type=Path, required=True)
    pl.add_argument("--seed", required=True)
    pl.add_argument("--live-fraction", type=float, default=0.3)
    pl.add_argument("--budget-usd", type=float, required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("--source", choices=["stackexchange", "uci_ai4i"], required=True)
    cap.add_argument("--site", default="")
    cap.add_argument("--tag", action="append", default=[])
    cap.add_argument("--pages", type=int, default=1)
    cap.add_argument("--per-label", type=int, default=10)
    cap.add_argument("--seed", default="s")
    cap.add_argument("--private", type=Path, required=True)
    pg = sub.add_parser("pages")
    pg.add_argument("--manuals", type=Path, required=True)
    pg.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    if a.cmd == "capture":
        return capture(a.source, a.site, a.tag, a.pages, a.private, a.per_label, a.seed)
    if a.cmd == "prelabel":
        return run_prelabel(a)
    if a.cmd == "pages":
        from answer_radar.factory.pages import build_pages

        _private(a.out.parent)
        corpus = build_pages(a.manuals)
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(corpus) + "\n", encoding="utf-8")
        print(json.dumps({"pages": len(corpus), "manuals": len({p["doc_sha256"] for p in corpus})}))
        return 0
    pages = [ManualPage(**p) for p in json.loads(a.pages.read_text())]
    rep = cycle(
        json.loads(a.discovery.read_text()),
        pages,
        a.out,
        a.private,
        a.seed,
        a.live_fraction,
        a.expert_export,
        a.labels,
        a.review_variants,
    )
    print(json.dumps(rep["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
