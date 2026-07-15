"""Repeated-run model×effort variance study — the §9 gate for changing the prod default.

Implements the 2026-07-14 case-study decision (docs/eval/
2026-07-14-printsense-sheet20-case-study.md §9/§12): the production default
(opus-4-8 · xhigh) may change only after ≥5 independent runs per configuration
pass an explicit decision rule. The 2026-07-14 cost benchmark (n=1/config)
made `high` the leading candidate — this harness produces the evidence.

Design:

* **Shipped prompt path** — requests reuse ``interpret._SYSTEM`` /
  ``_user_prompt`` / ``preprocess.prepare_print_image`` byte-identically;
  only ``model`` / ``output_config.effort`` / ``thinking`` vary per config.
* **Batches API** — all runs go in one ``messages.batches`` job (−50% on all
  tokens; case-study "adopt immediately" lever). Consequence: **wall-clock
  latency is NOT measured here** — batch scheduling hides it. Latency evidence
  stays with the interactive cost benchmark (149 s xhigh vs 73 s high).
* **Prompt caching** — the static system block (~6.3k tokens > the 4,096-token
  Opus minimum) carries a ``cache_control`` breakpoint.
* **Deterministic grading** — every run is graded by :func:`grade_case`
  (two-axis envelope); the decision rule consumes grades, never prose.
* **Hermetic core** — the ``anthropic`` SDK is imported lazily; request
  building, aggregation, the decision rule, and reporting are pure functions
  (CI-tested with a fake client; no network, no spend).

Run (paid, stg Doppler):

    doppler run -p factorylm -c stg -- py -3 -m printsense.benchmarks.variance_study \
        --image printsense/benchmarks/_eval_inputs/01_sheet20_upright.jpg \
        --rubric printsense/benchmarks/scu2_sheet20/rubric.json --runs 5
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from ..grade_case import grade_case

# $/MTok (input, output) — verified 2026-07-14 via the claude-api skill.
# Sonnet 5 shown at the intro rate (through 2026-08-31; list is 3.00/15.00).
PRICE = {
    "claude-opus-4-8": (5.00, 25.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-haiku-4-5": (1.00, 5.00),
}

# How much mean-F1 drop counts as a "material" regression in the decision rule.
MATERIAL_F1_EPSILON = 0.05


@dataclass(frozen=True)
class Config:
    label: str
    model: str
    effort: str | None
    thinking: bool


# §9 minimum comparison set: the three opus efforts. Sonnet/haiku are opt-in
# flags — the cost benchmark already showed both dominated for the primary read.
DEFAULT_CONFIGS = (
    Config("opus-xhigh", "claude-opus-4-8", "xhigh", True),
    Config("opus-high", "claude-opus-4-8", "high", True),
    Config("opus-medium", "claude-opus-4-8", "medium", True),
)
EXTRA_CONFIGS = (
    Config("sonnet5-xhigh", "claude-sonnet-5", "xhigh", True),
    Config("haiku45", "claude-haiku-4-5", None, False),
)

_CID_SEP = "|"


def make_custom_id(case: str, config_label: str, run: int) -> str:
    return f"{case}{_CID_SEP}{config_label}{_CID_SEP}{run}"


def parse_custom_id(cid: str) -> tuple[str, str, int]:
    case, label, run = cid.split(_CID_SEP)
    return case, label, int(run)


def load_case_pages(image_path: str | Path) -> list[tuple[bytes, str]]:
    """File IO + shipped preprocessing (resize budget / upright). Not used in CI."""
    from .. import preprocess as pp

    data = Path(image_path).read_bytes()
    mime = "image/png" if str(image_path).lower().endswith(".png") else "image/jpeg"
    return [pp.prepare_print_image(data, mime)]


def build_requests(
    case_name: str,
    pages: list[tuple[bytes, str]],
    configs: tuple[Config, ...] | list[Config],
    runs: int,
    max_tokens: int | None = None,
) -> list[dict]:
    """One batch request per (config, run) — identical bytes except model/effort/thinking."""
    from .. import interpret

    content: list[dict] = [interpret._source_block(data, mt) for data, mt in pages]
    content.append({"type": "text", "text": interpret._user_prompt(None, None)})
    system = [
        {
            "type": "text",
            "text": interpret._SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }
    ]
    mt = max_tokens or interpret.MAX_TOKENS

    reqs: list[dict] = []
    for cfg in configs:
        for run in range(runs):
            params: dict = {
                "model": cfg.model,
                "max_tokens": mt,
                "system": system,
                "messages": [{"role": "user", "content": content}],
            }
            if cfg.thinking:
                params["thinking"] = {"type": "adaptive"}
            if cfg.effort:
                params["output_config"] = {"effort": cfg.effort}
            reqs.append(
                {"custom_id": make_custom_id(case_name, cfg.label, run), "params": params}
            )
    return reqs


def _cost(model: str, in_tok: int, out_tok: int) -> float:
    pin, pout = PRICE[model]
    return round((in_tok * pin + out_tok * pout) / 1e6, 4)


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise ValueError("batch result message has no text block")


def run_study(
    client,
    case_name: str,
    pages: list[tuple[bytes, str]],
    rubric_path: str | Path,
    configs: tuple[Config, ...] | list[Config],
    runs: int,
    out_dir: str | Path,
    poll_s: float = 30.0,
) -> list[dict]:
    """Submit one batch, poll to completion, grade every run deterministically."""
    from .. import interpret

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    model_by_label = {c.label: c.model for c in configs}

    reqs = build_requests(case_name, pages, configs, runs)
    batch = client.messages.batches.create(requests=reqs)
    print(f"[batch] submitted {len(reqs)} requests as {batch.id}", flush=True)

    while True:
        status = client.messages.batches.retrieve(batch.id).processing_status
        if status == "ended":
            break
        print(f"[batch] {batch.id} {status} …", flush=True)
        time.sleep(poll_s)

    rows: list[dict] = []
    for res in client.messages.batches.results(batch.id):
        case, label, run = parse_custom_id(res.custom_id)
        if res.result.type != "succeeded":
            rows.append(
                {"case": case, "config": label, "run": run,
                 "error": getattr(res.result, "type", "unknown")}
            )
            continue
        msg = res.result.message
        raw = _first_text(msg)
        graph = interpret._apply_confidence_gate(
            interpret.PrintSynthGraph.model_validate(
                json.loads(interpret._strip_fences(raw))
            )
        )
        gpath = out / f"{case}.{label}.{run}.graph.json"
        gpath.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
        env = grade_case(gpath, rubric_path)
        m = env["metric_results"]
        rows.append(
            {
                "case": case,
                "config": label,
                "run": run,
                "score": env["score"],
                "letter": env["letter"],
                "is_A": m.get("is_A", False),
                "import_verdict": env["import_verdict"],
                "misreads": len(env["confident_misreads"]),
                "device_f1": m.get("device_f1"),
                "type_text_f1": m.get("type_text_f1"),
                "wire_f1": m.get("wire_f1"),
                "xref_f1": m.get("xref_f1"),
                "in_tok": msg.usage.input_tokens,
                "out_tok": msg.usage.output_tokens,
                "cost_usd": _cost(model_by_label[label], msg.usage.input_tokens,
                                  msg.usage.output_tokens),
            }
        )
    rows.sort(key=lambda r: (r["config"], r.get("run", 0)))
    return rows


def _mean(vals: list[float]) -> float:
    return round(statistics.fmean(vals), 4) if vals else 0.0


def summarize(rows: list[dict]) -> dict[str, dict]:
    """Per-config aggregate stats. Error rows count against hard-failure rate."""
    out: dict[str, dict] = {}
    labels = sorted({r["config"] for r in rows})
    for label in labels:
        ok = [r for r in rows if r["config"] == label and "error" not in r]
        errs = [r for r in rows if r["config"] == label and "error" in r]
        scores = [r["score"] for r in ok]
        out[label] = {
            "n": len(ok),
            "errors": len(errs),
            "score_mean": round(statistics.fmean(scores), 2) if scores else 0.0,
            "score_stdev": round(statistics.stdev(scores), 2) if len(scores) > 1 else 0.0,
            "score_min": min(scores) if scores else 0.0,
            "all_A": bool(ok) and all(r["is_A"] for r in ok),
            "letters": "".join(r["letter"] for r in ok),
            "misreads_total": sum(r["misreads"] for r in ok),
            "import_fail_rate": round(
                (len([r for r in ok if r["import_verdict"] != "PASS"]) + len(errs))
                / max(1, len(ok) + len(errs)),
                3,
            ),
            "device_f1_mean": _mean([r["device_f1"] for r in ok if r["device_f1"] is not None]),
            "wire_f1_mean": _mean([r["wire_f1"] for r in ok if r["wire_f1"] is not None]),
            "xref_f1_mean": _mean([r["xref_f1"] for r in ok if r["xref_f1"] is not None]),
            "cost_mean": _mean([r["cost_usd"] for r in ok]),
            "cost_total": round(sum(r["cost_usd"] for r in ok), 4),
        }
    return out


def decision(summary: dict[str, dict], incumbent: str, candidate: str) -> dict:
    """The §9 decision rule, mechanically. Switch only if EVERY check passes.

    Topology / signal-direction stability (§9) has no deterministic metric yet —
    it arrives with the §8A/§8B port-aware graph work; until then those axes are
    reported as not-measured and the xref/device F1 stability checks stand in.
    Latency is not measurable in batch mode (interactive benchmark owns it).
    """
    inc, cand = summary[incumbent], summary[candidate]
    checks = {
        "candidate_all_A": cand["all_A"],
        "hard_failures_not_increased": cand["import_fail_rate"] <= inc["import_fail_rate"],
        "misreads_not_increased": cand["misreads_total"] <= inc["misreads_total"],
        "device_not_materially_regressed": cand["device_f1_mean"]
        >= inc["device_f1_mean"] - MATERIAL_F1_EPSILON,
        "xref_not_materially_regressed": cand["xref_f1_mean"]
        >= inc["xref_f1_mean"] - MATERIAL_F1_EPSILON,
        "cost_lower": cand["cost_mean"] < inc["cost_mean"],
    }
    return {
        "incumbent": incumbent,
        "candidate": candidate,
        "checks": checks,
        "not_measured": ["topology_stability (needs §8A)", "signal_direction (needs §8B)",
                         "latency (batch mode — see interactive cost benchmark)"],
        "switch_recommended": all(checks.values()),
    }


def render_report(summary: dict[str, dict], verdict: dict) -> str:
    lines = [
        "# PrintSense variance study — repeated-run model×effort benchmark",
        "",
        "| config | n | score mean+-sd | min | letters | all-A | misreads | import-fail | dF1 | wF1 | xF1 | $/run mean | $ total |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for label, s in summary.items():
        lines.append(
            f"| {label} | {s['n']} | {s['score_mean']}+-{s['score_stdev']} | {s['score_min']} "
            f"| {s['letters']} | {'yes' if s['all_A'] else 'NO'} | {s['misreads_total']} "
            f"| {s['import_fail_rate']} | {s['device_f1_mean']} | {s['wire_f1_mean']} "
            f"| {s['xref_f1_mean']} | ${s['cost_mean']} | ${s['cost_total']} |"
        )
    lines += [
        "",
        f"## Decision rule (§9): {verdict['candidate']} vs {verdict['incumbent']}",
        "",
    ]
    for check, ok in verdict["checks"].items():
        lines.append(f"- [{'ok' if ok else 'FAIL'}] {check}")
    lines += [
        "",
        f"Not measured here: {'; '.join(verdict['not_measured'])}.",
        "Latency evidence lives in the interactive cost benchmark "
        "(docs/eval/2026-07-14-printsense-cost-benchmark.md).",
        "",
        (
            f"**VERDICT: SWITCH RECOMMENDED — {verdict['candidate']} passes every check "
            "(final call + rollout are the operator's)."
            if verdict["switch_recommended"]
            else f"**VERDICT: KEEP {verdict['incumbent']} — at least one check failed.**"
        ),
    ]
    return "\n".join(lines)


def manifest_line(case: str, n_requests: int, n_configs: int, runs: int) -> str:
    """Operator-facing spend preview, printed BEFORE any batch is submitted.

    Ceiling = the 2026-07-14 interactive bench worst case (~$0.43/opus-xhigh run)
    halved by the Batches discount. ASCII-only: this goes to a cp1252 Windows console.
    """
    ceiling = round(n_requests * 0.43 * 0.5, 2)
    return (
        f"[manifest] {n_requests} requests ({n_configs} configs x {runs} runs) "
        f"on case '{case}' -- cost ceiling ~= ${ceiling} (Batches -50% applied)"
    )


def _make_client():
    """Real client — the ONLY place the anthropic SDK is touched (lazy, like interpret)."""
    from .. import interpret

    return interpret._client()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--image", required=True, help="print image (goes through shipped preprocess)")
    ap.add_argument("--rubric", required=True, help="frozen rubric JSON for the case")
    ap.add_argument("--case", default=None, help="case name (default: image stem)")
    ap.add_argument("--runs", type=int, default=5, help="runs per config (§9 minimum: 5)")
    ap.add_argument("--include-sonnet", action="store_true")
    ap.add_argument("--include-haiku", action="store_true")
    ap.add_argument("--incumbent", default="opus-xhigh")
    ap.add_argument("--candidate", default="opus-high")
    ap.add_argument("--out", default="variance_out", help="output dir (graphs + report)")
    ap.add_argument("--poll-seconds", type=float, default=30.0)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the request manifest + cost ceiling; no network, no spend")
    args = ap.parse_args(argv)

    configs = list(DEFAULT_CONFIGS)
    if args.include_sonnet:
        configs.append(EXTRA_CONFIGS[0])
    if args.include_haiku:
        configs.append(EXTRA_CONFIGS[1])
    case = args.case or Path(args.image).stem

    pages = load_case_pages(args.image)
    reqs = build_requests(case, pages, configs, args.runs)
    print(manifest_line(case, len(reqs), len(configs), args.runs), flush=True)
    if args.dry_run:
        for r in reqs:
            print(f"  {r['custom_id']}  model={r['params']['model']} "
                  f"effort={r['params'].get('output_config', {}).get('effort', '-')}")
        return 0

    out = Path(args.out)
    rows = run_study(_make_client(), case, pages, args.rubric, configs, args.runs,
                     out, poll_s=args.poll_seconds)
    (out / "rows.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    summary = summarize(rows)
    verdict = decision(summary, args.incumbent, args.candidate)
    report = render_report(summary, verdict)
    (out / "variance_report.md").write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
