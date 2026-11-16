"""autoeval: unattended, zero-paid-by-default evaluation runner for MIRA.

  run   [--paid] [--full] [--sets ...] [--models ...] [--state-dir D] [--skip-lanes] [--send-alerts]
  seed  --recorded DIR --inputs DIR --model M [--state-dir D]
  status [--state-dir D]
  import   --records DIR --set S --sha SHA --base-url URL --results-root DIR [--route technician]
  fixture  --set-dir DIR [--model M] [--paid] [--state-dir D]
  draft    --prompt FILE --passages FILE --category C --out FILE [--model M] [--paid] [--state-dir D]
  verify   --candidates FILE --passages FILE --out-dir DIR

Default state dir ~/.factorylm/autoeval holds ledger.jsonl, cas/, state.json, paid.json (paid
mode only), STOP (kill sentinel), runs/<run_id>/ and seed/. Nothing is written inside the checkout.
Dry is the default: a verdict cache miss is recorded as paid_required and no request is made.
import and verify never touch the network or the ledger.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path

import autoeval_budget as ab
import autoeval_draft as dr
import autoeval_fixture_judge as fx
import autoeval_import as ai
import autoeval_judge as jd
import autoeval_report as rp
import autoeval_select as sel
import autoeval_verify_cases as vc
import httpx
from autoeval_run import (
    CALL_REASONS,
    KeyOnce,
    _iso_now,
    _judge_all,
    _lanes,
    _no_key,
    _run_id,
    _send,
    _spend,
    _write,
    dry_config,
    git,
    paid_config,
)

REPO = Path(__file__).resolve().parents[2]
DEFAULT_STATE = Path.home() / ".factorylm" / "autoeval"
MODELS = ("claude-sonnet-4-6", "claude-opus-5-5")
LANE_RUNNER = sel.subprocess_runner  # tests replace this; a real run executes the lanes


def cmd_run(args) -> int:
    state = Path(args.state_dir).expanduser()
    state.mkdir(parents=True, exist_ok=True)
    mode = "paid" if args.paid else "dry"
    cfg, secret = paid_config(state) if args.paid else (dry_config(state), "")
    head = git(["rev-parse", "HEAD"], REPO)
    run_id = _run_id()
    run_dir = state / "runs" / run_id
    ledger = ab.Ledger(state / "ledger.jsonl", cfg)
    before = (ledger.spent_total(), ledger.spent_day(ledger.today()))
    keyf = KeyOnce(secret)
    client = httpx.Client(timeout=120) if args.paid else None
    cache = jd.VerdictCache(jd.load_cas().CAS(state / "cas"))
    lanes = _lanes(args, REPO, state, head, LANE_RUNNER)
    judged = _judge_all(args, state, run_dir, cfg, ledger, cache, keyf, client, head, mode)
    rows = judged["rows"]
    part = judged["partial"]  # counts of a set the run was stopped in
    calls = {
        "api": part.get("api", 0),
        "recall": sum(part.get(k, 0) for k in CALL_REASONS),
        "paid_required": part.get("paid_required", 0),
    }
    paid_req = 0.0
    for s in judged["sets"]:
        for m in s["models"].values():
            c = m["counts"]
            calls["api"] += c.get("api", 0)
            calls["recall"] += sum(c.get(k, 0) for k in CALL_REASONS)
            calls["paid_required"] += c.get("paid_required", 0)
            paid_req += m["paid_required_usd"]
    spend, crossings = _spend(args, ledger, cfg, before, calls["api"], paid_req)
    run = {
        "run_id": run_id,
        "created_at": _iso_now(),
        "mode": mode,
        "tested_sha": head,
        "runner_sha": head,
        "host": platform.node(),
        "python": platform.python_version(),
        "models": list(args.models),
        "lanes": lanes,
        "sets": judged["sets"],
        "spend": spend,
        "calls": calls,
        "crossings": crossings,
        "runner_error": judged["error"],
        "key_fetches": keyf.fetches,
    }
    astate = state / "alert-state.json"
    prev = json.loads(astate.read_text()) if astate.exists() else {}
    fired, new_state = rp.alerts(run, prev)
    # Delivery is tracked apart from activity (Codex r1 F4 on #5569): an alert
    # still active but never delivered (sending off, Telegram down) is retried
    # on the next run that can send, instead of being deduplicated forever.
    current = {a["key"]: a for a in rp.alerts_now(run)}
    delivered = set(prev.get("delivered", [])) & set(current)
    pending = [current[k] for k in sorted(current) if k not in delivered]
    if args.send_alerts and pending:
        run["alerts_sent"] = _send(pending)
        if run["alerts_sent"]:
            delivered |= {a["key"] for a in pending}
    new_state["delivered"] = sorted(delivered)
    header = f"<!-- autoeval run {run_id} created {run['created_at']} -->\n"
    _write(run_dir / "run.json", json.dumps(run, indent=2, sort_keys=True))
    _write(run_dir / "report.md", header + rp.render_report(run))
    _write(run_dir / "mission_control.txt", rp.mission_control_block(run))
    _write(run_dir / "verdicts.jsonl", "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows))
    astate.write_text(json.dumps(new_state, indent=2))
    with open(state / "alerts.jsonl", "a") as f:
        for a in fired:
            f.write(json.dumps(a, sort_keys=True) + "\n")
    _write(run_dir / "alerts.jsonl", "".join(json.dumps(a, sort_keys=True) + "\n" for a in fired))
    print(
        json.dumps(
            {
                "run_id": run_id,
                "run_dir": str(run_dir),
                "mode": mode,
                "calls": calls,
                "alerts": [a["kind"] for a in fired],
                "runner_error": judged["error"],
                "spend_today_usd": spend["today_usd"],
            },
            indent=2,
        )
    )
    blocked = (
        bool(judged["error"])
        or any(r["status"] != "pass" for r in lanes["results"])
        or bool(rp.coverage_problems(run))
    )
    return 3 if judged["error"] else (1 if blocked else 0)


def cmd_status(args) -> int:
    state = Path(args.state_dir).expanduser()
    cfg = dry_config(state)
    led = ab.Ledger(state / "ledger.jsonl", cfg)
    runs = sorted((state / "runs").glob("*")) if (state / "runs").exists() else []
    st = json.loads((state / "state.json").read_text()) if (state / "state.json").exists() else {}
    print(
        json.dumps(
            {
                "spent_total_usd": led.spent_total(),
                "spent_today_usd": led.spent_day(led.today()),
                "last_run": runs[-1].name if runs else None,
                "last_ok_sha": st.get("last_ok_sha"),
                "kill_switch": (state / "STOP").exists(),
            },
            indent=2,
        )
    )
    return 0


def cmd_seed(args) -> int:
    state = Path(args.state_dir).expanduser()
    state.mkdir(parents=True, exist_ok=True)
    cfg = dry_config(state)
    cache = jd.VerdictCache(jd.load_cas().CAS(state / "cas"))
    env = jd.JudgeEnv(
        mode="seed",
        model=args.model,
        cache=cache,
        cfg=cfg,
        ledger=ab.Ledger(state / "ledger.jsonl", cfg),
        key_provider=_no_key,
        runner_sha=git(["rev-parse", "HEAD"], REPO),
    )
    inputs = Path(args.inputs)
    tag = f"{inputs.name}__{args.model}"
    sr = jd.seed_from_recorded(Path(args.recorded), inputs, state / "seed" / tag, env)
    summary_file = state / "seed" / f"{tag}.summary.json"
    _write(summary_file, json.dumps(sr.summary, indent=2, sort_keys=True))
    print(
        json.dumps(
            {
                "set": inputs.name,
                "model": args.model,
                "counts": sr.counts,
                "technician_score": sr.summary.get("technician_score"),
                "dangerous_cases": sr.summary.get("dangerous_cases"),
                "unscored": sr.summary.get("unscored"),
                "summary_file": str(summary_file),
            },
            indent=2,
        )
    )
    return 0


def cmd_import(args) -> int:
    try:
        manifest = ai.import_records(
            Path(args.records),
            Path(args.results_root),
            set_name=args.set,
            route=args.route,
            sha=args.sha,
            base_url=args.base_url,
        )
    except ai.ImportRefused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


def cmd_verify(args) -> int:
    counts = vc.run_verify(Path(args.candidates), Path(args.passages), Path(args.out_dir))
    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0


def cmd_fixture(args) -> int:
    state = Path(args.state_dir).expanduser()
    state.mkdir(parents=True, exist_ok=True)
    cfg, secret = paid_config(state) if args.paid else (dry_config(state), "")
    mode = "paid" if args.paid else "dry"
    run_dir = state / "runs" / _run_id()
    fkey = KeyOnce(secret)  # fetched at the first real paid call only
    client = httpx.Client(timeout=120) if args.paid else None
    env = jd.JudgeEnv(
        mode=mode,
        model=args.model,
        cache=jd.VerdictCache(jd.load_cas().CAS(state / "cas")),
        cfg=cfg,
        ledger=ab.Ledger(state / "ledger.jsonl", cfg),
        key_provider=fkey,
        runner_sha=git(["rev-parse", "HEAD"], REPO),
        client=client,
    )
    set_dir = Path(args.set_dir)
    out = run_dir / "fixture" / f"{set_dir.name}__{args.model}"
    try:
        res = fx.run_fixture(set_dir, out, env)
    except ab.BudgetStop as e:
        print(str(e), file=sys.stderr)
        return 3
    print(
        json.dumps(
            {
                "mode": mode,
                "set": res.set_id,
                "model": args.model,
                "api": res.summary["api"],
                "statuses": res.summary["statuses"],
                "mean_scores": res.summary["mean_scores"],
                "unscored": res.summary["unscored"],
                "out": str(out),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def cmd_draft(args) -> int:
    state = Path(args.state_dir).expanduser()
    state.mkdir(parents=True, exist_ok=True)
    cfg, secret = paid_config(state) if args.paid else (dry_config(state), "")
    env = dr.DraftEnv(
        mode="paid" if args.paid else "dry",
        model=args.model,
        cache=dr.DraftCache(jd.load_cas().CAS(state / "cas")),
        cfg=cfg,
        ledger=ab.Ledger(state / "ledger.jsonl", cfg),
        key_provider=KeyOnce(secret),
        client=httpx.Client(timeout=120) if args.paid else None,
    )
    instructions = Path(args.prompt).read_text()
    passages = json.loads(Path(args.passages).read_text())
    try:
        res = dr.draft(instructions, passages, category=args.category, env=env)
    except dr.DraftRefused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    except ab.BudgetStop as e:
        print(str(e), file=sys.stderr)
        return 3
    if res.candidates:
        dr.write_candidates(Path(args.out), res.candidates)
    print(
        json.dumps(
            {
                "reason": res.reason,
                "api": 1 if res.reason == "api" else 0,
                "candidates": len(res.candidates),
                "paid_required_worst_usd": res.paid_required_usd,
                "out": args.out if res.candidates else None,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="autoeval", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def state_arg(p):
        p.add_argument("--state-dir", default=str(DEFAULT_STATE))

    r = sub.add_parser("run", help="judge recorded answers (dry unless --paid)")
    state_arg(r)
    r.add_argument("--paid", action="store_true")
    r.add_argument("--full", action="store_true")
    r.add_argument("--sets", nargs="*", default=[])
    r.add_argument("--models", nargs="*", default=list(MODELS))
    r.add_argument("--results-root", default=str(REPO / "evals" / "results"))
    r.add_argument("--skip-lanes", action="store_true")
    r.add_argument("--send-alerts", action="store_true")
    r.set_defaults(fn=cmd_run)
    s = sub.add_parser("seed", help="replay recorded Stage 1 verdicts into the cache (free)")
    state_arg(s)
    s.add_argument("--recorded", required=True)
    s.add_argument("--inputs", required=True)
    s.add_argument("--model", required=True)
    s.set_defaults(fn=cmd_seed)
    st = sub.add_parser("status", help="ledger totals and last run (free)")
    state_arg(st)
    st.set_defaults(fn=cmd_status)
    im = sub.add_parser("import", help="validate generated records into a transcript set (free)")
    im.add_argument("--records", required=True)
    im.add_argument("--set", required=True)
    im.add_argument("--sha", required=True)
    im.add_argument("--base-url", required=True)
    im.add_argument("--results-root", required=True)
    im.add_argument("--route", default="technician")
    im.set_defaults(fn=cmd_import)
    fi = sub.add_parser("fixture", help="judge an imported set with tests/eval/judge.py (dry)")
    state_arg(fi)
    fi.add_argument("--set-dir", required=True)
    fi.add_argument("--model", default="claude-sonnet-4-6")
    fi.add_argument("--paid", action="store_true")
    fi.set_defaults(fn=cmd_fixture)
    dd = sub.add_parser("draft", help="metered drafting of candidate cases (dry unless --paid)")
    state_arg(dd)
    dd.add_argument("--prompt", required=True)
    dd.add_argument("--passages", required=True)
    dd.add_argument("--category", required=True)
    dd.add_argument("--out", required=True)
    dd.add_argument("--model", default="claude-sonnet-4-6")
    dd.add_argument("--paid", action="store_true")
    dd.set_defaults(fn=cmd_draft)
    ve = sub.add_parser("verify", help="deterministic quote check of drafted cases (free)")
    ve.add_argument("--candidates", required=True)
    ve.add_argument("--passages", required=True)
    ve.add_argument("--out-dir", required=True)
    ve.set_defaults(fn=cmd_verify)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
