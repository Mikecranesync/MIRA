"""TRH v2 entry point.

    py -3 -m tests.regime1_telethon.campaign.trh.cli oracles
    py -3 -m tests.regime1_telethon.campaign.trh.cli synth --oracle reset_procedure
    py -3 -m tests.regime1_telethon.campaign.trh.cli mutate
    py -3 -m tests.regime1_telethon.campaign.trh.cli diagnose --fixture <path>
    py -3 -m tests.regime1_telethon.campaign.trh.cli report --campaign c12s42

`diagnose` is the one a human runs after a bad answer. It is offline and free:
no bot, no LLM, and no network once `corpus-cache.json` is warm.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3]))

from tests.regime1_telethon.campaign.trh import (  # noqa: E402
    mutations as mutations_mod,
)
from tests.regime1_telethon.campaign.trh import (  # noqa: E402
    oracles as oracles_mod,
)
from tests.regime1_telethon.campaign.trh import (  # noqa: E402
    pipeline,
    report,
    synthesize,
)

CACHE = HERE / "corpus-cache.json"


PARAM_CACHE = HERE.parent / "param-corpus-cache.json"


def _cached_corpus() -> oracles_mod.HarnessCorpus:
    """Offline corpus from the committed caches — no network, $0.

    Both halves are wired: phrase lookups for INGEST, and the offline lab's
    existing parameter-token cache for GROUNDING. Handing the graders only the
    phrase half made fabrication checks degrade to INCONCLUSIVE without saying so.
    """
    from .. import fabrication

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    tokens = fabrication.CorpusIndex(PARAM_CACHE) if PARAM_CACHE.exists() else None
    return oracles_mod.HarnessCorpus(
        oracles_mod.PhraseCorpus(fetch=None, cache=cache), tokens=tokens
    )


def cmd_oracles(args) -> int:
    reg = oracles_mod.load()
    corpus = _cached_corpus()
    print(f"{len(reg)} oracle(s)\n")
    for oid, o in reg.items():
        present, missing = o.corpus_coverage(corpus)
        status = "INGEST-FAIL" if missing else "ingest-ok"
        print(f"  {oid:26} {status:12} scope={o.scope.get('model', '?')}")
        for e in missing:
            print(f"      MISSING  {e.match!r}")
        if args.verbose:
            for e in present:
                print(f"      present  {e.match!r}")
    return 0


def cmd_synth(args) -> int:
    reg = oracles_mod.load()
    oracles = [reg[args.oracle]] if args.oracle else list(reg.values())
    for o in oracles:
        cases = synthesize.generate(o, seed=args.seed)
        print(f"\n=== {o.id} — {len(cases)} variant(s)")
        for c in cases:
            print(f"  [{c.register}] {c.rationale}")
            for t in c.turns:
                print(f"      > {t['send']}")
    return 0


def cmd_mutate(args) -> int:
    results = mutations_mod.run_all(allow_dirty=args.allow_dirty)
    print(mutations_mod.summarize(results))
    bad = [r for r in results if r.status == mutations_mod.NOT_PROVEN]
    return 1 if bad else 0


def cmd_diagnose(args) -> int:
    conv = pipeline.load_fixture(Path(args.fixture))
    cap = pipeline.capture(conv, source=f"fixture {args.fixture}", corpus=_cached_corpus())
    print(pipeline.defect_report(cap))
    if args.save:
        print(f"\n[saved] {cap.save()}")
    return 0


def cmd_report(args) -> int:
    fixtures = sorted(pipeline.FIXTURE_DIR.glob("*.json"))
    if not fixtures:
        print("no fixtures captured yet — run `diagnose --save` first", file=sys.stderr)
        return 1
    corpus = _cached_corpus()
    all_d, all_c = [], []
    for f in fixtures:
        conv = pipeline.load_fixture(f)
        oracle = oracles_mod.for_case(conv.conv_id)
        d, c = pipeline.diagnose(conv, oracle=oracle, corpus=corpus)
        all_d.extend(d)
        all_c.extend(c)
    mut_summary = ""
    if args.with_mutations:
        mut_summary = mutations_mod.summarize(mutations_mod.run_all())
    body = report.render(
        args.campaign,
        all_d,
        all_c,
        mutation_summary=mut_summary,
        deploy_sha=args.deploy_sha,
        coverage_notes=[f"built from {len(fixtures)} captured fixture(s), not a live run"],
    )
    if args.write:
        print(f"[written] {report.write(args.campaign, body)}")
    else:
        print(body)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="trh", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("oracles", help="list oracles + corpus coverage")
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(fn=cmd_oracles)

    p = sub.add_parser("synth", help="generate synthetic technician variants")
    p.add_argument("--oracle")
    p.add_argument("--seed", type=int, default=0)
    p.set_defaults(fn=cmd_synth)

    p = sub.add_parser("mutate", help="prove the protections have teeth")
    p.add_argument("--allow-dirty", action="store_true")
    p.set_defaults(fn=cmd_mutate)

    p = sub.add_parser("diagnose", help="classify a captured failure")
    p.add_argument("--fixture", required=True)
    p.add_argument("--save", action="store_true")
    p.set_defaults(fn=cmd_diagnose)

    p = sub.add_parser("report", help="campaign report over captured fixtures")
    p.add_argument("--campaign", default="trh")
    p.add_argument("--deploy-sha", default="")
    p.add_argument("--with-mutations", action="store_true")
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_report)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
