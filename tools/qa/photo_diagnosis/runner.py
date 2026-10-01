#!/usr/bin/env python3
"""Photo Diagnosis Benchmark — runner CLI.

Loads+validates case fixtures (`schema.py`), plays diagnosis cases through
the fixed-fact simulator (`simulator.py`) and qa cases through their
question lists, grades every turn and the final outcome (`grading.py`),
meters every provider call through a budget ledger (`budget.py`), and
writes `--out/<ts>/results.jsonl` + a rendered report (`report.py`).

`--dry-run` loads and validates every case and prints counts. It makes NO
network call and constructs no Hub, no provider, no ledger — see
`dry_run_summary()` / `_print_dry_run()`.

Reuses `tools/qa/retrieval_acceptance.py` verbatim (`Hub`, `Row`,
`common_checks`, `SECRET_MARKERS`) — never copied. It refuses production;
this runner keeps that guard (`_refuses_prod`).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

# --- make this script runnable both as `python runner.py` (script mode,
# sys.path[0] == this file's own directory) and as `python -m
# photo_diagnosis.runner` — either way `photo_diagnosis` must be importable.
_PKG_DIR = Path(__file__).resolve().parent  # tools/qa/photo_diagnosis
_TOOLS_QA_DIR = _PKG_DIR.parent  # tools/qa
_REPO_ROOT = _TOOLS_QA_DIR.parent.parent  # repo root
if str(_TOOLS_QA_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_QA_DIR))

from photo_diagnosis import budget as budget_mod  # noqa: E402
from photo_diagnosis import grading, schema  # noqa: E402
from photo_diagnosis import providers as providers_mod  # noqa: E402
from photo_diagnosis import report as report_mod  # noqa: E402
from photo_diagnosis import simulator as simulator_mod  # noqa: E402


def load_retrieval_acceptance() -> Any:
    """Import `tools/qa/retrieval_acceptance.py` under its own stable
    module name (never bare `import retrieval_acceptance` — that name can
    collide the way a top-level `runner` module once did; see
    `project_runner_module_collision` in session memory)."""
    mod_name = "retrieval_acceptance"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(
        mod_name, _TOOLS_QA_DIR / "retrieval_acceptance.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


def _refuses_prod(base: str) -> bool:
    """Mirror retrieval_acceptance.py's own guard exactly — no network
    client to import it from, so the check is re-stated here."""
    return "app.factorylm.com" in base.replace("app-staging", "")


# ---------------------------------------------------------------------------
# Dry run — no network, no Hub, no provider


def dry_run_summary(cases_dir: Path) -> dict[str, Any]:
    valid, errors = schema.load_cases(cases_dir)
    by_kind: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_privacy: dict[str, int] = {}
    for c in valid:
        by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        by_privacy[c["privacy"]] = by_privacy.get(c["privacy"], 0) + 1
    scorable_cases = [c for c in valid if schema.scorable(c)]
    not_scorable_cases = [c for c in valid if not schema.scorable(c)]
    total_questions = sum(len(c.get("questions") or []) for c in valid if c["kind"] == "qa")
    total_turn_caps = sum(c.get("max_turns", 0) for c in valid if c["kind"] == "diagnosis")
    return {
        "total_cases": len(valid),
        "by_kind": by_kind,
        "by_type": by_type,
        "by_privacy": by_privacy,
        "scorable": len(scorable_cases),
        "not_scorable": len(not_scorable_cases),
        "not_scorable_ids": [c["id"] for c in not_scorable_cases],
        "total_questions": total_questions,
        "total_turn_caps": total_turn_caps,
        "errors": [{"path": str(e.path), "case_id": e.case_id, "errors": e.errors} for e in errors],
    }


def _print_dry_run(summary: dict[str, Any]) -> None:
    print(f"photo_diagnosis dry-run: {summary['total_cases']} case(s) loaded")
    print(f"  by kind:    {summary['by_kind']}")
    print(f"  by type:    {summary['by_type']}")
    print(f"  by privacy: {summary['by_privacy']}")
    print(f"  scorable (validated_by set): {summary['scorable']}")
    print(f"  NOT scorable (awaiting validation): {summary['not_scorable']}")
    for cid in summary["not_scorable_ids"]:
        print(f"    - {cid}: NOT scorable")
    print(f"  total qa questions:   {summary['total_questions']}")
    print(f"  total turn-cap sum:   {summary['total_turn_caps']}")
    if summary["errors"]:
        print(f"  INVALID: {len(summary['errors'])} case(s) failed validation")
        for e in summary["errors"]:
            print(f"    - {e['path']} ({e['case_id']}): {'; '.join(e['errors'])}")


# ---------------------------------------------------------------------------
# Writing results — never leak a secret into results.jsonl


def _has_secret_marker(obj: Any) -> bool:
    ra = load_retrieval_acceptance()
    serialized = json.dumps(obj, default=str).lower()
    return any(marker in serialized for marker in ra.SECRET_MARKERS)


def _safe_record(record: dict[str, Any]) -> dict[str, Any]:
    if _has_secret_marker(record):
        return {
            "case_id": record.get("case_id"),
            "repeat": record.get("repeat"),
            "status": "redacted_secret_detected",
            "reason": "a field matched SECRET_MARKERS; full record withheld",
        }
    return record


def write_results(out_dir: Path, records: list[dict[str, Any]]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "results.jsonl"
    with path.open("w") as f:
        for r in records:
            f.write(json.dumps(_safe_record(r), default=str) + "\n")
    return path


# ---------------------------------------------------------------------------
# Live turn helper — reuses Hub.chat / Hub.diagnostics / common_checks


def mira_turn(
    hub: Any,
    ra: Any,
    notebook_id: str,
    scenario_label: str,
    message: str,
    *,
    thread_id: str | None = None,
    visual_evidence: dict | None = None,
    history: list[dict] | None = None,
    source_doc_ids: list[str] | None = None,
) -> tuple[Any, dict, dict]:
    row = ra.Row(scenario_label)
    body: dict[str, Any] = {"message": message, "mode": "general"}
    if thread_id:
        body["threadId"] = thread_id
    if visual_evidence:
        body["visualEvidence"] = visual_evidence
    if history:
        body["history"] = history
    if source_doc_ids:
        body["sourceDocIds"] = source_doc_ids
    row.trace_id, w = hub.chat(notebook_id, body)
    d = hub.diagnostics(notebook_id, w["client_request_id"])
    row.turn_id = d.get("turnId")
    p = d["packet"]
    ra.common_checks(row, d, w)
    row.packet, row.wire = p, {k: v for k, v in w.items() if k != "content"}
    return row, p, w


def _contract_record(row: Any, w: dict) -> dict:
    """Keep what `common_checks` found — a contract failure must reach the report.

    Citation SUPPORT cannot be graded from this transport: the SSE `sources`
    frame the Hub client summarizes carries a citation count, not the cited
    chunk text. Record that honestly instead of guessing (spec: never infer).
    """
    return {
        "passed": row.passed,
        "failed": [name for name, ok, _ in row.checks if not ok],
        "trace_id": row.trace_id,
        "basis": w.get("basis"),
        "citations": w.get("citations", 0),
        "citation_support": (
            "citation_text_unavailable" if w.get("citations", 0) else "no_citations"
        ),
    }


def _resolve_source(raw: str, case_file: Path) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else (case_file.parent / p)


# ---------------------------------------------------------------------------
# Diagnosis-case loop


def run_diagnosis_case(
    hub: Any,
    ra: Any,
    case: dict,
    ledger: budget_mod.Ledger,
    judge: Any,
    classifier: simulator_mod.Classifier,
    repeat: int,
) -> dict:
    sim = simulator_mod.TechSimulator(case, classifier)
    nb = hub.create_notebook(f"PB-{case['id']}-{repeat}-{uuid.uuid4().hex[:6]}")
    source_doc_ids = [
        hub.attach_manual(nb, _resolve_source(s, case["_source_file"]))
        for s in (case.get("sources") or [])
    ]
    thread_id = "thrd_" + uuid.uuid4().hex

    opening = sim.opening()
    _, look = hub.look(nb["id"], case["_photo_path"])
    visual_evidence = {"fileId": look["fileId"], "capturedAt": look["observation"]["capturedAt"]}

    history: list[dict] = []
    revealed_texts: list[str] = []
    turn_grades: list[dict] = []
    message = opening
    mira_reply = ""
    turn_index = 0
    status = "completed"
    reason = ""

    while turn_index < case.get("max_turns", schema.DEFAULT_MAX_TURNS):
        turn_index += 1
        try:
            row, p, w = mira_turn(
                hub,
                ra,
                nb["id"],
                f"{case['id']} turn{turn_index}",
                message,
                thread_id=thread_id,
                visual_evidence=visual_evidence if turn_index == 1 else None,
                history=history if turn_index > 1 else None,
                source_doc_ids=source_doc_ids if turn_index == 1 else None,
            )
        except Exception as e:  # noqa: BLE001 — recorded as a failed run, not silently dropped
            status, reason = "error", f"mira turn failed: {e}"
            break
        ledger.record_manual_search_from_packet(p)
        contract = _contract_record(row, w)
        mira_reply = w["content"]
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": mira_reply})

        try:
            tg = grading.turn_grade(
                judge, list(history[:-1]), list(revealed_texts), case.get("visible_facts") or []
            )
            tg["turn"] = turn_index
            tg["contract"] = contract
            turn_grades.append(tg)
        except grading.GraderError as e:
            turn_grades.append(
                {"turn": turn_index, "status": "ungraded", "reason": str(e), "contract": contract}
            )

        if sim.stopped:
            break
        sim_turn = sim.respond(mira_reply)
        revealed_texts.extend(
            f["text"]
            for f in case.get("hidden_facts") or []
            if f["id"] in sim_turn.revealed_fact_ids
        )
        if sim_turn.kind == "stop":
            break
        message = sim_turn.text or "(no reply)"

    try:
        outcome = grading.outcome_grade(judge, history, case)
    except grading.GraderError as e:
        outcome, status = "ungraded", "ungraded"
        reason = reason or str(e)

    return {
        "case_id": case["id"],
        "kind": "diagnosis",
        "type": case["type"],
        "repeat": repeat,
        "arm": "mira",
        "status": status,
        "reason": reason,
        "outcome": outcome,
        "turns": turn_index,
        "turn_grades": turn_grades,
        "X": any(tg.get("X") for tg in turn_grades),
    }


def run_qa_case(
    hub: Any,
    ra: Any,
    case: dict,
    ledger: budget_mod.Ledger,
    judge: Any,
    repeat: int,
) -> dict:
    nb = hub.create_notebook(f"PB-{case['id']}-{repeat}-{uuid.uuid4().hex[:6]}")
    source_doc_ids = [
        hub.attach_manual(nb, _resolve_source(s, case["_source_file"]))
        for s in (case.get("sources") or [])
    ]
    _, look = hub.look(nb["id"], case["_photo_path"])
    visual_evidence = {"fileId": look["fileId"], "capturedAt": look["observation"]["capturedAt"]}

    answers: list[dict] = []
    for i, q in enumerate(case.get("questions") or []):
        try:
            row, p, w = mira_turn(
                hub,
                ra,
                nb["id"],
                f"{case['id']} q{i}",
                q["q"],
                visual_evidence=visual_evidence if i == 0 else None,
                source_doc_ids=source_doc_ids if i == 0 else None,
            )
        except Exception as e:  # noqa: BLE001
            answers.append({"q": q["q"], "status": "error", "reason": str(e)})
            continue
        ledger.record_manual_search_from_packet(p)
        graded = grading.qa_grade(w["content"], q)
        graded["contract"] = _contract_record(row, w)
        if q.get("requires_citation") and w.get("citations", 0) == 0:
            graded["citation_missing"] = True
        answers.append({"q": q["q"], **graded})

    return {
        "case_id": case["id"],
        "kind": "qa",
        "type": case["type"],
        "repeat": repeat,
        "arm": "mira",
        "status": "completed",
        "answers": answers,
    }


def run_baseline_case(
    case: dict,
    ledger: budget_mod.Ledger,
    baseline: Any,
    classifier: simulator_mod.Classifier,
    repeat: int,
) -> dict:
    """Equal-evidence comparator: same simulator + photo, baseline's OWN
    history, a plain "maintenance technician assistant" system prompt — no
    retrieval."""
    if case["kind"] != "diagnosis":
        return {
            "case_id": case["id"],
            "kind": case["kind"],
            "repeat": repeat,
            "arm": "baseline",
            "status": "skipped",
        }
    sim = simulator_mod.TechSimulator(case, classifier)
    history = [{"role": "system", "content": "You are a maintenance technician assistant."}]
    message = sim.opening()
    turn_index = 0
    status = "completed"
    reason = ""
    while turn_index < case.get("max_turns", schema.DEFAULT_MAX_TURNS):
        turn_index += 1
        history.append({"role": "user", "content": message})
        try:
            text, _usage = ledger.call(baseline, history, max_tokens=500)
        except budget_mod.BudgetExhausted:
            raise
        except Exception as e:  # noqa: BLE001
            status, reason = "error", f"baseline call failed: {e}"
            break
        history.append({"role": "assistant", "content": text})
        if sim.stopped:
            break
        sim_turn = sim.respond(text)
        if sim_turn.kind == "stop":
            break
        message = sim_turn.text or "(no reply)"
    return {
        "case_id": case["id"],
        "kind": "diagnosis",
        "type": case["type"],
        "repeat": repeat,
        "arm": "baseline",
        "status": status,
        "reason": reason,
        "turns": turn_index,
    }


# ---------------------------------------------------------------------------
# CLI


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--cases", required=True, help="directory of case YAML files")
    ap.add_argument(
        "--base", default=os.environ.get("ACCEPT_BASE", "https://app-staging.factorylm.com")
    )
    ap.add_argument(
        "--cookie", default=os.environ.get("ACCEPT_COOKIE") or os.environ.get("BETA_GATE_COOKIE")
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default=None, help="run only this case id")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--budget-usd", type=float, default=25.0)
    ap.add_argument("--no-baseline", action="store_true")
    ap.add_argument("--out", default=str(_REPO_ROOT / "tests" / "golden_photo" / "runs"))
    ap.add_argument("--judge-model", default=os.environ.get("PHOTO_BENCH_JUDGE_MODEL", "gpt-4o"))
    ap.add_argument(
        "--baseline-model", default=os.environ.get("PHOTO_BENCH_BASELINE_MODEL", "gpt-4o")
    )
    for arm in ("judge", "baseline"):
        for side in ("in", "out"):
            env = os.environ.get(f"PHOTO_BENCH_{arm.upper()}_PRICE_{side.upper()}")
            ap.add_argument(
                f"--{arm}-price-{side}",
                type=float,
                default=float(env) if env else None,
                help=f"current {arm} {side}put price, $ per million tokens (required for a live run)",
            )
    ap.add_argument("--manual-search-cap", type=int, default=budget_mod.DEFAULT_MANUAL_SEARCH_CAP)
    ap.add_argument("--verbose", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    cases_dir = Path(args.cases)

    if args.dry_run:
        summary = dry_run_summary(cases_dir)
        _print_dry_run(summary)
        return 0 if not summary["errors"] else 1

    if _refuses_prod(args.base):
        print("refusing to run photo-diagnosis traffic against production", file=sys.stderr)
        return 2
    if not args.cookie:
        print("ACCEPT_COOKIE / BETA_GATE_COOKIE is required for a live run", file=sys.stderr)
        return 2

    ra = load_retrieval_acceptance()
    hub = ra.Hub(args.base, args.cookie)
    ledger = budget_mod.Ledger(args.budget_usd, manual_search_cap=args.manual_search_cap)
    judge = providers_mod.OpenAIProvider(
        args.judge_model,
        price_in_per_mtok=args.judge_price_in,
        price_out_per_mtok=args.judge_price_out,
    )
    metered_judge = budget_mod.MeteredProvider(judge, ledger)
    classifier = simulator_mod.make_llm_classifier(metered_judge)
    baseline = None
    if not args.no_baseline:
        baseline_provider = providers_mod.OpenAIProvider(
            args.baseline_model,
            price_in_per_mtok=args.baseline_price_in,
            price_out_per_mtok=args.baseline_price_out,
        )
        baseline = budget_mod.MeteredProvider(baseline_provider, ledger)

    valid, errors = schema.load_cases(cases_dir)
    if errors:
        for e in errors:
            print(f"INVALID case {e.path} ({e.case_id}): {'; '.join(e.errors)}", file=sys.stderr)
    cases = [c for c in valid if schema.scorable(c)]
    if args.only:
        cases = [c for c in cases if c["id"] == args.only]

    records: list[dict[str, Any]] = []
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.out) / stamp
    budget_exhausted = False

    for case in cases:
        for repeat in range(1, args.repeats + 1):
            if budget_exhausted:
                records.append(
                    {
                        "case_id": case["id"],
                        "repeat": repeat,
                        "status": "not_run_budget",
                        "reason": "budget cap reached",
                    }
                )
                continue
            try:
                if case["kind"] == "diagnosis":
                    records.append(
                        run_diagnosis_case(hub, ra, case, ledger, metered_judge, classifier, repeat)
                    )
                    if baseline is not None:
                        records.append(
                            run_baseline_case(case, ledger, baseline, classifier, repeat)
                        )
                else:
                    records.append(run_qa_case(hub, ra, case, ledger, metered_judge, repeat))
            except budget_mod.BudgetExhausted as e:
                budget_exhausted = True
                records.append(
                    {
                        "case_id": case["id"],
                        "repeat": repeat,
                        "status": "not_run_budget",
                        "reason": str(e),
                    }
                )
            except Exception as e:  # noqa: BLE001 — a failed run is a recorded row, not a crash
                records.append(
                    {"case_id": case["id"], "repeat": repeat, "status": "error", "reason": str(e)}
                )

    results_path = write_results(out_dir, records)
    gitsha = "unknown"
    try:
        st, _hd, j = hub.json("GET", "/api/health")
        if st == 200 and isinstance(j, dict):
            gitsha = j.get("gitSha") or j.get("sha") or "unknown"
    except Exception:  # noqa: BLE001 — report header falls back to "unknown"
        pass

    header = {
        "base": args.base,
        "staging_git_sha": gitsha,
        "judge_provider": judge.name,
        "judge_model": judge.model,
        "baseline_model": args.baseline_model if baseline is not None else "none",
    }
    report_text = report_mod.render_report(records, ledger.summary(), header)
    (out_dir / "report.md").write_text(report_text)
    print(f"wrote {results_path}")
    print(f"wrote {out_dir / 'report.md'}")
    print(json.dumps(ledger.summary(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
