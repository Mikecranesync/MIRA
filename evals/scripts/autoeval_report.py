"""Deterministic report, alerts and Mission Control block for autoeval. No LLM.

Everything here is a pure function of the run dict built by autoeval.py. The gate
text comes from report.render(), which appends a wall-clock "(generated ...)" line;
gate_text() strips that line so the report body is byte-stable for unchanged inputs.
Run ids and timestamps are kept out of render_report() and live in the CLI header.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
REPORT_PATH = REPO_ROOT / "evals" / "scripts" / "report.py"
UNSCORED_LIMIT = 4
FORBIDDEN = "[DELIVERY-UPDATE:"
HEARTBEAT = "<!-- autoeval-heartbeat -->"


def gate_text(set_dir: Path, summary: dict, report_path: Path = REPORT_PATH) -> str:
    """The existing release-gate text (no LLM), minus its wall-clock footer line."""
    spec = importlib.util.spec_from_file_location("autoeval_report_gate", report_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    text = mod.render(Path(set_dir), summary, None, None, None)
    return "\n".join(ln for ln in text.splitlines() if not ln.startswith("(generated ")).strip()


def _usd(v: float | None) -> str:
    return "n/a" if v is None else f"${v:.4f}"


def _lane_line(lane: dict) -> str:
    counts = []
    for step in lane.get("steps", []):
        c = step.get("counts", {})
        counts.append(
            f"{step['runner']}@{step['cwd']}: "
            + (", ".join(f"{k}={c[k]}" for k in sorted(c)) or "no count")
        )
    return f"| {lane['name']} | {lane['status']} | {lane['reason']} | {'; '.join(counts) or '-'} |"


def _judge_rows(run: dict) -> list[str]:
    rows = []
    for s in run["sets"]:
        for model, m in s["models"].items():
            c = m["counts"]
            calls = (
                f"api {c.get('api', 0)} / recall {c.get('recall_hit', 0) + c.get('seed_hit', 0)}"
            )
            calls += f" / paid_required {c.get('paid_required', 0)}"
            rows.append(
                f"| {s['set']} | {model} | {m['summary'].get('technician_score')} | "
                f"{m['summary'].get('technician_gate')} | "
                f"{', '.join(m['dangerous']) or 'none'} | {len(m['unscored'])} | {calls} |"
            )
    return rows


def _blockers(run: dict) -> list[str]:
    out = []
    if run.get("runner_error"):
        out.append(f"runner error: {run['runner_error']}")
    for ln in run["lanes"]["results"]:
        if ln["status"] != "pass":
            out.append(f"lane {ln['name']}: {ln['status']}")
    for s in run["sets"]:
        for model, m in s["models"].items():
            if len(m["unscored"]) > UNSCORED_LIMIT:
                out.append(f"{s['set']} {model}: {len(m['unscored'])} unscored")
            if m["counts"].get("paid_required"):
                out.append(
                    f"{s['set']} {model}: {m['counts']['paid_required']} case(s) need a paid judge call"
                )
    if run["lanes"].get("skipped"):
        out.append("lanes skipped (--skip-lanes)")
    return out


def render_report(run: dict) -> str:
    sp = run["spend"]
    lines = [
        "# Autoeval report",
        "",
        f"Tested revision: {run['tested_sha']}",
        f"Mode: {run['mode'].upper()} ({'no paid call can be made' if run['mode'] == 'dry' else 'paid calls allowed'})",
        f"Models: {', '.join(run['models'])}",
        "",
        "## Lanes",
    ]
    if run["lanes"].get("skipped"):
        lines.append("Skipped (--skip-lanes).")
    else:
        lines += ["| Lane | Status | Reason | Counts |", "|---|---|---|---|"]
        lines += [_lane_line(ln) for ln in run["lanes"]["results"]]
    lines += [
        "",
        "## Judge (technician score, gate, dangerous cases)",
        "| Set | Model | Technician score | Gate | Dangerous | Unscored | Calls |",
        "|---|---|---|---|---|---|---|",
    ]
    lines += _judge_rows(run)
    for s in run["sets"]:
        for model, m in s["models"].items():
            lines += ["", f"### Gate text: {s['set']} / {model}", "```text", m["gate"], "```"]
    lines += [
        "",
        "## Spend",
        f"- Today: {_usd(sp['today_usd'])} of daily cap {_usd(sp['daily_cap_usd'])}",
        f"- Total: {_usd(sp['total_usd'])} of total cap {_usd(sp['total_cap_usd'])}",
        f"- Remaining: {_usd(sp['remaining_usd'])}",
        f"- Worst-case reserved for paid-required cases (not spent): {_usd(sp['paid_required_worst_usd'])}",
        f"- Average per paid call: {_usd(sp['avg_usd_per_paid_call'])} over {sp['paid_calls']} call(s)",
        f"- Monthly estimate: {_usd(sp['monthly_estimate_usd'])} (average x this run's paid calls x 30; "
        "assumes this run repeats daily)",
        "",
        "## Blockers",
    ]
    lines += [f"- {b}" for b in _blockers(run)] or ["- none"]
    text = "\n".join(lines) + "\n"
    if FORBIDDEN in text:
        raise ValueError("generated report contains a forbidden delivery marker")
    return text


def _stop_reason(err: str) -> str:
    """'STOP: total cap. spent=...' -> 'total cap': one alert key per stop reason."""
    return err[5:].split(".")[0].split(" present")[0].strip()


def alerts(run: dict, state: dict) -> tuple[list[dict], dict]:
    """Fire on a transition only: a key is announced when it becomes active, not while it stays active."""
    current: dict[str, dict] = {}

    def add(key: str, kind: str, message: str) -> None:
        current[key] = {"key": key, "kind": kind, "message": message, "run_id": run["run_id"]}

    for ln in run["lanes"]["results"]:
        if ln["name"] == "safety" and ln["status"] == "fail":
            add("safety_regression:lane:safety", "safety_regression", "safety lane failed")
        elif ln["status"] == "infra_error":
            add(
                f"execution_failure:lane:{ln['name']}",
                "execution_failure",
                f"lane {ln['name']} produced no test count",
            )
    err = run.get("runner_error")
    if err:  # a budget, kill-switch or billing stop is a hard stop, not a broken runner
        kind = "hard_stop" if err.startswith("STOP:") else "execution_failure"
        why = _stop_reason(err) if kind == "hard_stop" else "runner"
        add(f"{kind}:{why}", kind, f"runner: {err}")
    for s in run["sets"]:
        for model, m in s["models"].items():
            for case in m["dangerous"]:
                add(
                    f"safety_regression:case:{s['set']}:{model}:{case}",
                    "safety_regression",
                    f"{case} judged actively dangerous ({model})",
                )
            awaiting = m["counts"].get("paid_required", 0)
            if awaiting:  # a dry cache miss is a pending approval, not a broken run
                add(
                    f"paid_required:{s['set']}:{model}",
                    "paid_required",
                    f"{awaiting} case(s) in {s['set']} await a paid judge call ({model})",
                )
            if len(m["unscored"]) - awaiting > UNSCORED_LIMIT:
                add(
                    f"execution_failure:unscored:{s['set']}:{model}",
                    "execution_failure",
                    f"{len(m['unscored']) - awaiting} unscored in {s['set']} ({model})",
                )
    for c in run.get("crossings", []):
        add(
            f"budget_threshold:{c['bucket']}:{c['pct']}",
            "budget_threshold",
            f"{c['bucket']} spend crossed {c['pct']}%",
        )
    prev = set(state.get("active", []))
    fired = [current[k] for k in sorted(current) if k not in prev]
    # A stopped run judged only part of its inputs: what it did not reach stays active.
    active = set(current) | (prev if err else set())
    return fired, {"active": sorted(active)}


def mission_control_block(run: dict) -> str:
    st = run["spend"]
    blockers = _blockers(run)
    hard = (
        run.get("runner_error")
        or any(ln["status"] in ("fail", "infra_error") for ln in run["lanes"]["results"])
        or any(a["kind"] == "safety_regression" for a in alerts_now(run))
    )
    state = "BLOCKED" if hard else ("PARTIAL" if blockers else "GREEN")
    lanes = run["lanes"]
    lane_bits = (
        "skipped"
        if lanes.get("skipped")
        else ", ".join(f"{ln['name']}={ln['status']}" for ln in lanes["results"])
    )
    body = [
        "AUTOEVAL RELAY",
        "Goal/slice: autoeval v1 - unattended release-gate judge over recorded MIRA answers",
        f"SHA: tested {run['tested_sha']} (runner {run['runner_sha']})",
        f"State: {state} ({run['mode']} mode)",
        f"Evidence: lanes [{lane_bits}]; calls api={run['calls'].get('api', 0)} "
        f"recall={run['calls'].get('recall', 0)} paid_required={run['calls'].get('paid_required', 0)}; "
        f"spent today {_usd(st['today_usd'])}, total {_usd(st['total_usd'])}",
        "Next: "
        + (
            "review the blockers, then run `autoeval run` again"
            if blockers
            else "none - nothing blocks the lane owner"
        ),
        "Blocked by: " + ("; ".join(blockers) if blockers else "none"),
        "",
        heartbeat_body(run),
    ]
    text = "\n".join(body) + "\n"
    if FORBIDDEN in text:
        raise ValueError("mission control block contains a forbidden delivery marker")
    return text


def alerts_now(run: dict) -> list[dict]:
    """Current alert records without touching any state file."""
    return alerts(run, {"active": []})[0]


def heartbeat_body(run: dict) -> str:
    return "\n".join(
        [
            HEARTBEAT,
            f"run {run['run_id']} mode {run['mode']} tested {run['tested_sha']}",
            f"runner {run['runner_sha']} at {run['created_at']}",
        ]
    )
