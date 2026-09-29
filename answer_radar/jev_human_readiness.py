"""Compare Jev's shadow signals with blinded human labels, without fitting a gate.

Inputs are the signed attempts from human_readiness.py. This report is diagnostic:
it never changes a human-readiness GO/HOLD decision or sets a production threshold.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

SIGNALS = ("over_specificity", "wrong_family_grounding",
           "contradicts_observations", "unsupported_numerics")


def _auc(pairs: list[tuple[float, bool]]) -> float | None:
    positives = [p for p, truth in pairs if truth]
    negatives = [p for p, truth in pairs if not truth]
    if not positives or not negatives:
        return None
    wins = sum(1 if p > n else 0.5 if p == n else 0
               for p in positives for n in negatives)
    return round(wins / (len(positives) * len(negatives)), 4)


def compare(run: dict) -> dict:
    attempts = run.get("attempts")
    if not isinstance(attempts, list):
        raise ValueError("attempts must be a list")
    report = {"total_attempts": len(attempts), "unlabeled": [], "jev_skipped": [],
              "signals": {}}
    pairs: dict[str, list[tuple[float, bool]]] = {s: [] for s in SIGNALS}
    latencies: list[int] = []
    tokens: list[int] = []
    for a in attempts:
        key = f"{a.get('case_id')}/{a.get('surface')}/{a.get('rep')}"
        review = a.get("human_review") or {}
        labels = review.get("blind_jev_labels")
        if not review.get("labels_locked_before_jev") or not isinstance(labels, dict):
            report["unlabeled"].append(key)
            continue
        if any(type(labels.get(s)) is not bool for s in SIGNALS):
            report["unlabeled"].append(key)
            continue
        jev = a.get("jev") or {}
        if jev.get("skipped_reason"):
            report["jev_skipped"].append({"attempt": key, "reason": jev["skipped_reason"]})
            continue
        values = jev.get("signals") or {}
        if any(type(values.get(s)) not in (float, int)
               or not 0 <= values[s] <= 1 for s in SIGNALS):
            report["jev_skipped"].append({"attempt": key, "reason": "missing_or_invalid_signal"})
            continue
        for s in SIGNALS:
            pairs[s].append((values[s], labels[s]))
        if type(jev.get("latency_ms")) is int and jev["latency_ms"] >= 0:
            latencies.append(jev["latency_ms"])
        if type(jev.get("input_tokens")) is int and jev["input_tokens"] >= 0:
            tokens.append(jev["input_tokens"])
    for signal, rows in pairs.items():
        report["signals"][signal] = {
            "n": len(rows), "positive": sum(t for _, t in rows),
            "auc": _auc(rows),
            "brier": round(sum((p - int(t)) ** 2 for p, t in rows) / len(rows), 4)
            if rows else None,
        }
    report["jev_latency_ms"] = {"n": len(latencies), "values": latencies}
    report["jev_input_tokens"] = {"n": len(tokens), "total": sum(tokens)}
    report["interpretation"] = "Shadow correlation only; no threshold or latency improvement inferred"
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    print(json.dumps(compare(json.loads(args.run.read_text())), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
