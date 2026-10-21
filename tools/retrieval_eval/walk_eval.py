"""Paired, uncertainty-aware comparison of two Stranger Walk arms (#4576).

Reads the harness's existing outputs (``scored.json`` + ``observations.json``)
and never re-runs a walk, calls a model or touches staging.

    python3 tools/retrieval_eval/walk_eval.py \
        --arm off=RUN_DIR --arm on=RUN_DIR1,RUN_DIR2 \
        --corpus mira-hub/tests/stranger-walk/corpus.json [--lanes off=F.jsonl ...] [--json OUT]

Several directories for one arm are merged by question id, later directories
winning (a resumed walk). ``--sealed --key KEY.json`` scores an unseen set
(KEY maps question id -> accepted pages, [] = unanswerable). Sealed mode prints
aggregates only and refuses every per-question or per-manual output, because
reading a sealed set's individual results turns it into development data.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

if __package__ in (None, ""):  # run as a script: make the sibling package importable
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from retrieval_eval import stats  # noqa: E402
from retrieval_eval.refusal import is_refusal  # noqa: E402

ANSWERED_CLASSES = ("CORRECT", "WRONG_PAGE")


def load_key(path: str) -> dict[str, list[int]]:
    """Question id -> accepted pages. Accepts the id map, or the sealed set's gold.jsonl itself
    (only ``qid`` and ``accepted_pages`` are read)."""
    if path.endswith(".jsonl"):
        rows = [json.loads(x) for x in Path(path).read_text().splitlines() if x.strip()]
        return {r["qid"]: r["accepted_pages"] or [] for r in rows}
    return json.loads(Path(path).read_text())


def load_arm(dirs: list[str]) -> tuple[dict[str, dict], dict]:
    rows: dict[str, dict] = {}
    booked = 0.0
    shas = set()
    for d in dirs:
        scored = json.loads(Path(d, "scored.json").read_text())
        obs = {o["id"]: o for o in json.loads(Path(d, "observations.json").read_text())}
        booked += float(scored.get("bookedUsd") or 0)
        shas.add((scored.get("meta") or {}).get("gitSha", "?"))
        for r in scored["rows"]:
            if r["id"] in obs or r["id"] not in rows:
                rows[r["id"]] = {**r, "_obs": obs.get(r["id"], {})}
    return rows, {"bookedUsd": round(booked, 4), "gitShas": sorted(shas), "dirs": dirs}


def answer_text(obs: dict) -> str:
    raw = obs.get("rendered")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return raw
    return (raw or {}).get("answer") or ""


def refusal_class(row: dict) -> str:
    """refused_clean | refused_cited | answered | broken (answer text + citation)."""
    if row["classification"] == "BROKEN":
        return "broken"
    if not is_refusal(answer_text(row["_obs"])):
        return "answered"
    return "refused_cited" if row.get("citedPage") is not None else "refused_clean"


def right_page(row: dict, accepted: list[int] | None, tol: int) -> bool:
    if accepted is None:  # development corpus: the harness classification is authoritative
        return row["classification"] == "CORRECT"
    if row["classification"] not in ANSWERED_CLASSES or str(row.get("reason", "")).startswith(
        "wrong_doc"
    ):
        return False
    p = row.get("citedPage")
    return p is not None and any(abs(p - q) <= tol for q in accepted)


def outcome(row: dict, accepted: list[int] | None, tol: int) -> int:
    """1 = what a technician should get: the right page, or an honest refusal when unanswerable.

    A refusal is judged by its answer text with production's own classifier, so a refusal that
    also shows a citation still counts here; ``refused_cited`` is reported and gated separately.
    """
    if accepted == []:
        return int(refusal_class(row) in ("refused_clean", "refused_cited"))
    return int(right_page(row, accepted, tol))


def arm_summary(rows: dict[str, dict], key: dict | None, tol: int) -> dict:
    ans = [r for i, r in rows.items() if key is None or key[i] != []]
    una = [r for i, r in rows.items() if key is not None and key[i] == []]
    k = sum(right_page(r, None if key is None else key[r["id"]], tol) for r in ans)
    lat = [r["_obs"]["elapsedMs"] / 1000 for r in rows.values() if r["_obs"].get("elapsedMs")]
    safety = [r for r in rows.values() if r.get("safetyRelevant")]
    out = {
        "questions": len(rows),
        "answerable": {"n": len(ans), "right_page": k, "wilson95": stats.wilson(k, len(ans))},
        "classes": dict(Counter(r["classification"] for r in rows.values())),
        "safety": {
            "relevant": len(safety),
            "red_lines": sum(1 for r in safety if r.get("safetyRedLine")),
        },
        "latency_s": {
            "p50": stats.percentile(lat, 50),
            "p95": stats.percentile(lat, 95),
            "n": len(lat),
        },
        "stream_status": dict(Counter(r["_obs"].get("streamStatus") for r in rows.values())),
    }
    if una:
        rc = Counter(refusal_class(r) for r in una)
        refused = rc["refused_clean"] + rc["refused_cited"]
        out["unanswerable"] = {
            "n": len(una),
            **rc,
            "refused": refused,
            "wilson95_refused": stats.wilson(refused, len(una)),
        }
    return out


def lane_summary(rows: list[dict], asked: set[str]) -> dict:
    """Vector-lane outcome and retrieval-span latency for one arm (validity check V4, gate P1).

    The denominator is every question the arm scored: a question with no lane record, or no
    trace, counts as ``missing``, never as evidence either way. A later resume file wins.
    """
    by_id: dict[str, dict] = {}
    for r in rows:
        if r["id"] in asked and r.get("lane") != "no_trace":
            by_id[r["id"]] = r
    lanes = Counter(r["lane"] for r in by_id.values())
    missing = len(asked - set(by_id))
    if missing:
        lanes["missing"] = missing
    lat = [
        r["retrieval_latency_s"] for r in by_id.values() if r.get("retrieval_latency_s") is not None
    ]
    return {
        "lanes": dict(lanes),
        "vector_ran_fraction": round(lanes["ran"] / len(asked), 3) if asked else None,
        "retrieval_latency_s": {
            "p50": stats.percentile(lat, 50),
            "p95": stats.percentile(lat, 95),
            "n": len(lat),
        },
    }


def validity(a: dict, b: dict, expected: set[str]) -> dict:
    """Validity check V6: every expected question asked, unbroken, in both arms."""
    broken = {i for rows in (a, b) for i, r in rows.items() if r["classification"] == "BROKEN"}
    missing = expected - (set(a) & set(b))
    return {
        "expected": len(expected),
        "missing_from_an_arm": len(missing),
        "broken": len(broken & expected),
        "v6_pass": not missing and not (broken & expected),
        "_ids": sorted(missing | (broken & expected)),
    }


def paired(
    a: dict, b: dict, key: dict | None, tol: int, cluster_of: dict[str, str]
) -> tuple[dict, list[tuple[str, int, int]]]:
    ids = sorted(
        i for i in a if i in b and "BROKEN" not in (a[i]["classification"], b[i]["classification"])
    )
    acc = {i: (None if key is None else key[i]) for i in ids}
    xs = [(i, outcome(a[i], acc[i], tol), outcome(b[i], acc[i], tol)) for i in ids]
    t = Counter((x1, x2) for _, x1, x2 in xs)
    both, a_only, b_only, neither = t[(1, 1)], t[(1, 0)], t[(0, 1)], t[(0, 0)]
    res = {
        "n": len(ids),
        "a_only": a_only,
        "b_only": b_only,
        "mcnemar_p": round(stats.mcnemar_exact(a_only, b_only), 4),
        "diff": round((b_only - a_only) / len(ids), 4) if ids else None,
        "newcombe95": stats.newcombe_paired(both, a_only, b_only, neither),
    }
    if cluster_of:
        res["cluster_bootstrap95"] = stats.cluster_bootstrap_diff(
            [(cluster_of[i], x1, x2) for i, x1, x2 in xs]
        )
    return res, xs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--arm",
        action="append",
        required=True,
        help="NAME=DIR[,DIR...]; first --arm is the baseline",
    )
    ap.add_argument("--corpus", help="Stranger Walk corpus.json (manual, oem, family per question)")
    ap.add_argument(
        "--key", help="question id -> accepted pages ([] = unanswerable), or gold.jsonl"
    )
    ap.add_argument("--sealed", action="store_true", help="aggregates only; requires --key")
    ap.add_argument("--tolerance", type=int, default=1)
    ap.add_argument(
        "--lanes",
        action="append",
        default=[],
        help="NAME=lanes.jsonl[,...] from lanes.py; later files win",
    )
    ap.add_argument("--json", help="write the full report here")
    args = ap.parse_args(argv)
    if args.sealed and not args.key:
        ap.error("--sealed needs --key")
    key = load_key(args.key) if args.key else None
    arms = {}
    for spec in args.arm:
        name, _, dirs = spec.partition("=")
        arms[name] = load_arm(dirs.split(","))
    questions = (
        {q["id"]: q for q in json.loads(Path(args.corpus).read_text())["questions"]}
        if args.corpus
        else {}
    )
    manuals = (
        {m["id"]: m for m in json.loads(Path(args.corpus).read_text())["manuals"]}
        if args.corpus
        else {}
    )
    cluster_of = {i: q["manual"] for i, q in questions.items()}
    if key is not None:
        missing = [i for rows, _ in arms.values() for i in rows if i not in key]
        if missing:
            ap.error(f"{len(missing)} question ids are not in --key")

    report = {"sealed": args.sealed, "arms": {}, "paired": {}, "lanes": {}}
    for name, (rows, meta) in arms.items():
        report["arms"][name] = {**meta, **arm_summary(rows, key, args.tolerance)}
    for spec in args.lanes:
        name, _, f = spec.partition("=")
        lines = [x for part in f.split(",") for x in Path(part).read_text().splitlines() if x]
        report["lanes"][name] = lane_summary([json.loads(x) for x in lines], set(arms[name][0]))
    names = list(arms)
    for other in names[1:]:
        a_rows, b_rows = arms[names[0]][0], arms[other][0]
        res, xs = paired(a_rows, b_rows, key, args.tolerance, cluster_of)
        expected = set(questions) if questions and not args.sealed else set(a_rows) | set(b_rows)
        v6 = validity(a_rows, b_rows, expected)
        ids = v6.pop("_ids")
        if not args.sealed:
            v6["invalid_ids"] = ids
        res["validity"] = v6
        la, lb = report["lanes"].get(names[0]), report["lanes"].get(other)
        if la and lb:
            fa, fb = la["vector_ran_fraction"], lb["vector_ran_fraction"]
            res["validity"]["v4_vector_ran"] = {
                names[0]: fa,
                other: fb,
                "within_10_points": abs(fa - fb) <= 0.10,
            }
        if not args.sealed and questions:
            for dim in ("oem", "family"):
                g: dict[str, list[int]] = {}
                for i, x1, x2 in xs:
                    v = manuals[questions[i]["manual"]][dim]
                    g.setdefault(v, [0, 0, 0])
                    g[v][0] += 1
                    g[v][1] += x1
                    g[v][2] += x2
                res[f"by_{dim}"] = {
                    k: {"n": n, names[0]: s1, other: s2} for k, (n, s1, s2) in sorted(g.items())
                }
            res["changed"] = [{"id": i, names[0]: x1, other: x2} for i, x1, x2 in xs if x1 != x2]
        report["paired"][f"{names[0]}->{other}"] = res

    text = json.dumps(report, indent=2, default=lambda t: [round(x, 4) for x in t])
    if args.json:
        Path(args.json).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
