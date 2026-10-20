"""Score every validator on the frozen corpus. Thresholds are chosen on DEV only, then applied to HELD-OUT.

  python analyze.py <data_dir> <out.json>

Inputs in <data_dir>: corpus.jsonl, labels.jsonl, v1.jsonl, scores-*.jsonl (NLI / embedding sentence scores).
Verdict per answer: supported | unsupported | no_opinion.
  V0  shipped gate: an answer it served as `answered` counts as `supported` (that is what the user is told),
      anything it withheld is `no_opinion`.
  V1  typed claim verifier (run_v1.ts).
  V2/V3 probabilistic: min over the answer's factual sentences of the support score (cosine / entailment);
      `unsupported` below τ, else `supported`; no factual sentence ⇒ `no_opinion`.
  Combinations: V1→X (V1 decides when it has an opinion, else X) and V1∨X (unsupported if either flags).
Metrics: catch = unsupported ÷ bad (wrong_fact + wrong_page + answered_not_in_manual);
         false_flag = unsupported ÷ correct_supported; coverage = opinion ÷ all.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

BAD = {"wrong_fact", "wrong_fact_unlisted", "wrong_page", "answered_not_in_manual"}
GOOD = {"correct_supported"}
MAX_DEV_FALSE_FLAG = 0.10


def load(p: Path) -> dict[str, dict]:
    return {r["item_id"]: r for r in (json.loads(x) for x in p.open())}


def prob_verdict(rec: dict, key: str, tau: float) -> str:
    s = rec.get("sentences") or []
    if not s:
        return "no_opinion"
    return "unsupported" if min(x[key] for x in s) < tau else "supported"


def metrics(ids: list[str], verdict: dict[str, str], labels: dict[str, str]) -> dict:
    bad = [i for i in ids if labels[i] in BAD]
    good = [i for i in ids if labels[i] in GOOD]
    caught = sum(verdict[i] == "unsupported" for i in bad)
    ff = sum(verdict[i] == "unsupported" for i in good)
    passed_bad = sum(verdict[i] == "supported" for i in bad)
    opinion = sum(verdict[i] != "no_opinion" for i in ids)
    by_label: dict[str, Counter] = defaultdict(Counter)
    for i in ids:
        by_label[labels[i]][verdict[i]] += 1
    return {
        "n": len(ids),
        "bad": len(bad),
        "good": len(good),
        "caught": caught,
        "catch_rate": round(caught / len(bad), 3) if bad else None,
        "bad_marked_supported": passed_bad,
        "false_flags": ff,
        "false_flag_rate": round(ff / len(good), 3) if good else None,
        "coverage": round(opinion / len(ids), 3) if ids else None,
        "confusion": {k: dict(v) for k, v in sorted(by_label.items())},
    }


def tune(dev: list[str], recs: dict[str, dict], key: str, labels: dict[str, str]) -> float:
    """Largest-catch τ whose DEV false-flag rate stays ≤ MAX_DEV_FALSE_FLAG (ties → the smaller τ)."""
    best_tau, best_catch = 0.0, -1
    for t in [x / 100 for x in range(1, 100)]:
        v = {i: prob_verdict(recs[i], key, t) for i in dev}
        m = metrics(dev, v, labels)
        if m["good"] and m["false_flag_rate"] > MAX_DEV_FALSE_FLAG:
            continue
        if m["caught"] > best_catch:
            best_tau, best_catch = t, m["caught"]
    return best_tau


def main() -> int:
    d = Path(sys.argv[1])
    out = Path(sys.argv[2])
    corpus = load(d / "corpus.jsonl")
    labels = {k: v["label"] for k, v in load(d / "labels.jsonl").items()}
    adv = load(d / "corpus_adv.jsonl") if (d / "corpus_adv.jsonl").exists() else {}
    corpus |= adv
    labels |= {i: ("wrong_fact" if i.startswith("adv:") else "wrong_page") for i in adv}
    ids = [i for i in corpus if labels.get(i) not in (None, "no_gold", "gold_doubt")]
    dev = [i for i in ids if corpus[i]["split"] == "dev"]
    held = [i for i in ids if corpus[i]["split"] not in ("dev", "adv_heldout")]
    adv_held = [i for i in ids if corpus[i]["split"] == "adv_heldout"]

    verdicts: dict[str, dict[str, str]] = {}
    verdicts["V0 shipped gate"] = {
        i: "supported" if corpus[i]["status"] == "answered" else "no_opinion" for i in ids
    }
    v1 = load(d / "v1.jsonl") | (load(d / "v1_adv.jsonl") if (d / "v1_adv.jsonl").exists() else {})
    verdicts["V1 typed"] = {i: v1[i]["verdict"] for i in ids}
    if (d / "v1b.jsonl").exists():
        v1b = load(d / "v1b.jsonl") | (
            load(d / "v1b_adv.jsonl") if (d / "v1b_adv.jsonl").exists() else {}
        )
        verdicts["V1b typed+join (post-hoc)"] = {i: v1b[i]["verdict"] for i in ids}
    curves = {}

    taus = {}
    for f in sorted(d.glob("scores-*.jsonl")):
        recs = load(f)
        name = f.stem.removeprefix("scores-")
        fa = d / f"adv-{f.name}"
        recs |= load(fa) if fa.exists() else {}
        if any(i not in recs for i in ids):
            print(f"skip {name}: {sum(i not in recs for i in ids)} items unscored")
            continue
        key = "cos" if name == "emb" else "ent"
        tau = tune(dev, recs, key, labels)
        taus[name] = tau
        label = "V2 embedding" if name == "emb" else f"V3 {name.split('_', 1)[-1]}"
        verdicts[label] = {i: prob_verdict(recs[i], key, tau) for i in ids}
        # Descriptive only (NOT used for selection): what any τ could achieve on held-out + adversarial.
        hv = [i for i in ids if corpus[i]["split"] != "dev"]
        curves[label] = [
            {
                "tau": t / 20,
                **{
                    x: metrics(hv, {i: prob_verdict(recs[i], key, t / 20) for i in hv}, labels)[x]
                    for x in ("caught", "bad", "false_flags", "good")
                },
            }
            for t in range(1, 20)
        ]

    base_v1 = "V1b typed+join (post-hoc)" if "V1b typed+join (post-hoc)" in verdicts else "V1 typed"
    for name in [k for k in verdicts if k.startswith(("V2", "V3"))]:
        x = verdicts[name]
        v1v = verdicts[base_v1]
        verdicts[f"V1→{name}"] = {i: v1v[i] if v1v[i] != "no_opinion" else x[i] for i in ids}
        verdicts[f"V1∨{name}"] = {
            i: "unsupported"
            if "unsupported" in (v1v[i], x[i])
            else ("supported" if "supported" in (v1v[i], x[i]) else "no_opinion")
            for i in ids
        }

    report = {
        "split_sizes": {"dev": len(dev), "heldout": len(held), "adv_heldout": len(adv_held)},
        "label_counts": {
            "dev": dict(Counter(labels[i] for i in dev)),
            "heldout": dict(Counter(labels[i] for i in held)),
        },
        "taus_dev_tuned": taus,
        "max_dev_false_flag": MAX_DEV_FALSE_FLAG,
        "validators": {
            name: {
                "dev": metrics(dev, v, labels),
                "heldout": metrics(held, v, labels),
                "adv_heldout": metrics(adv_held, v, labels),
                "heldout_all": metrics(held + adv_held, v, labels),
            }
            for name, v in verdicts.items()
        },
        "curves_heldout_descriptive": curves,
        "combo_base": base_v1,
        "tq06": {
            i: {
                "label": labels[i],
                "answer": corpus[i]["answer"][:120],
                **{n: v[i] for n, v in verdicts.items()},
            }
            for i in ids
            if corpus[i]["question_id"] == "tq-28" and not i.startswith("advpage")
        },
    }
    # Generation variance: same question, same config, five walks.
    trials = defaultdict(list)
    for i in ids:
        c = corpus[i]
        if c["source"] == "public-walk" and c["walk"] in ("w1", "w2", "w3", "w4", "w5"):
            trials[c["question_id"]].append(labels[i])
    unstable = {q: Counter(v) for q, v in trials.items() if len(set(v)) > 1}
    report["generation_variance_w1_w5"] = {
        "questions": len(trials),
        "label_changes_across_5_trials": len(unstable),
        "examples": {q: dict(c) for q, c in list(unstable.items())[:15]},
    }
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(
        f"{'validator':34s} heldout+adv: catch  false-flag  bad→supported | adv catch | dev catch / false-flag"
    )
    for name, m in report["validators"].items():
        h, a, dv = m["heldout_all"], m["adv_heldout"], m["dev"]
        print(
            f"{name:34s} {h['caught']:>12}/{h['bad']:<4} {h['false_flags']:>5}/{h['good']:<5} {h['bad_marked_supported']:>8}"
            f"      | {a['caught']:>3}/{a['bad']:<4} | {dv['caught']}/{dv['bad']} / {dv['false_flags']}/{dv['good']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
