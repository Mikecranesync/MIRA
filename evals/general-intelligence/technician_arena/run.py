"""Run the Technician Arena: three automated arms over the frozen case set.

  raw-frontier    pinned frontier model (default gpt-5.5) through its API, neutral
                  instruction, no MIRA tools. Reference only: a different model
                  from MIRA's, so MIRA-vs-this is labelled confounded.
  raw-same-model  gpt-oss-120b on Groq with the same neutral instruction — the
                  model MIRA actually runs. The only valid wrapper-regression pair.
  mira            the deployed staging Hub notebook chat (mira_staging.py).

The ChatGPT product arm is a human protocol (README); its captures are graded
alongside these records, never generated here.

A scored (non-dry) run refuses unless every selected case's expert key is signed
and unaltered, and refuses without --budget-usd. Every (case, arm) pair produces
a record — ran or not_run with a reason — and RUN-MANIFEST.json pins the build,
models, parameters, non-secret flags, seed, case keys and spend.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "runners"))

import arena  # noqa: E402
from technician_arena import cases as ta_cases  # noqa: E402
from technician_arena import keys  # noqa: E402

ARMS = ("raw-frontier", "raw-same-model", "mira")
# Non-secret switches that decide what the MIRA arm does; recorded by value.
FLAG_NAMES = (
    "MIRA_CANONICAL_SEAM",
    "INFERENCE_BACKEND",
    "NOTEBOOK_ANSWER_GATE",
    "NOTEBOOK_SEMANTIC_CHECK",
    "MIRA_JEV_SHADOW",
    "MIRA_JEV_DECISION",
    "GROQ_MODEL",
    "CEREBRAS_MODEL",
    "TOGETHERAI_MODEL",
)


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _raw_arm(name: str, env: dict[str, str]) -> arena.RawFrontier:
    if name == "raw-frontier":
        return arena.RawFrontier(
            env.get("ARENA_FRONTIER_BASE_URL", "https://api.openai.com/v1"),
            env.get("OPENAI_API_KEY", ""),
            env.get("ARENA_FRONTIER_MODEL", "gpt-5.5"),
            reasoning_effort=env.get("ARENA_FRONTIER_EFFORT", "medium"),
        )
    return arena.RawFrontier(
        "https://api.groq.com/openai/v1", env.get("GROQ_API_KEY", ""), "openai/gpt-oss-120b"
    )


def _excerpt_text(case: dict[str, Any], root: Path) -> str | None:
    """Equal-context text for the raw arms, or None if a source has no text file."""
    parts = []
    for e in (case.get("equal_context") or {}).get("excerpts", []):
        ref = e.get("local_text")
        p = root / ref.removeprefix("fixtures/") if ref else None
        if not p or not p.exists():
            return None
        parts.append(
            f"[Source: {e.get('doc')} — {e.get('pages')}]\n{p.read_text(encoding='utf-8')}"
        )
    return "\n\n".join(parts)


def _run_raw(arm_obj, arm, case, workflow, root, budget, dry) -> list[dict[str, Any]]:
    context = ""
    if workflow == "equal_context" and case.get("equal_context", {}).get("excerpts"):
        text = _excerpt_text(case, root)
        if text is None:
            return [
                {
                    "case_id": case["id"],
                    "arm": arm,
                    "status": "not_run:equal_context_source_missing",
                }
            ]
        context = "Reference material:\n" + text + "\n\n"
    out, history = [], []
    for i, turn in enumerate(case["turns"]):
        if turn.get("role") != "user":
            continue
        t = dict(turn, text=(context if i == 0 else "") + turn["text"])
        images = [root / p.removeprefix("fixtures/") for p in turn.get("images") or []]
        t0, err, meta = time.monotonic(), None, {}
        if dry:
            answer, model, cost = arena._canned(case, "raw", i), f"dry-run:{arm}", 0.0
        else:
            model = arm_obj.model
            try:
                answer, meta = arm_obj.ask(case, history, t, images)
            except Exception as exc:  # noqa: BLE001 — recorded, never crashes the run
                # Codex #3487 r2 F2: a failed call is an error attempt, and the rest
                # of the conversation is not sent on a broken history.
                out.append(
                    {
                        "case_id": case["id"],
                        "arm": arm,
                        "workflow": workflow,
                        "turn_index": i,
                        "status": "error:provider",
                        "answer": "",
                        "model": model,
                        "error": f"{type(exc).__name__}: {str(exc)[:200]}",
                        "cost_usd": 0.0,
                        "latency_ms": int((time.monotonic() - t0) * 1000),
                    }
                )
                return out
            cost = arena.estimate_cost_usd(
                model, int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)
            )
        out.append(
            {
                "case_id": case["id"],
                "arm": arm,
                "workflow": workflow,
                "turn_index": i,
                "status": "ran",
                "answer": answer,
                "model": model,
                "input_tokens": meta.get("input_tokens"),
                "output_tokens": meta.get("output_tokens"),
                "cost_usd": cost,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "error": err,
            }
        )
        # Codex #3487 F7: the paid attempt is recorded BEFORE it is charged, so a
        # budget stop keeps every call that was made, and its cost.
        try:
            budget.charge(cost)
            if not dry and (meta.get("input_tokens") is None or meta.get("output_tokens") is None):
                # Codex #3487 r3 F2: a paid call that reports no usage cannot be
                # priced, so it cannot be held to the budget — stop here.
                out[-1]["cost_usd"] = None
                out[-1]["usage_missing"] = True
                out[-1]["status"] = "error:usage_missing"  # r4 F3: never gradable
                raise arena.BudgetExceeded("provider returned no token usage; spend unknown")
        except arena.BudgetExceeded as exc:
            exc.partial = out
            raise
        history += [
            {"role": "user", "content": t["text"]},
            {"role": "assistant", "content": answer},
        ]
    return out


def main(argv: list[str] | None = None, env: dict[str, str] | None = None) -> int:
    import os

    env = dict(os.environ) if env is None else env
    ap = argparse.ArgumentParser(description="Technician Arena runner")
    ap.add_argument("--arms", default=",".join(ARMS))
    ap.add_argument("--workflow", choices=("native", "equal_context"), default="native")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--budget-usd", type=float, default=None)
    ap.add_argument("--case", action="append", default=[])
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument(
        "--include-diagnostic",
        action="store_true",
        help="also run cases keyed after outputs were seen; tagged diagnostic, never scored",
    )
    ap.add_argument("--apk", default=None, help="Android APK under test (hashed into the manifest)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    if unknown := [a for a in arms if a not in ARMS]:
        print(f"unknown arm(s): {unknown}", file=sys.stderr)
        return 2
    cases = ta_cases.load()
    if errors := ta_cases.validate(cases):
        print("\n".join(f"INVALID: {e}" for e in errors), file=sys.stderr)
        return 2
    if args.case:
        cases = [c for c in cases if c["id"] in set(args.case)]
    if args.budget_usd is not None and not (
        math.isfinite(args.budget_usd) and args.budget_usd >= 0
    ):
        print(
            f"REFUSED: --budget-usd must be a finite, non-negative number (got {args.budget_usd})",
            file=sys.stderr,
        )
        return 2
    if not args.dry_run:
        if args.budget_usd is None:
            print("REFUSED: a scored run needs --budget-usd", file=sys.stderr)
            return 2
        if bad := keys.unscorable(cases):
            print(f"REFUSED: expert keys not signed/intact: {bad}", file=sys.stderr)
            return 2

    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(1 << 30)
    rng = random.Random(seed)
    order = list(cases)
    rng.shuffle(order)
    out = Path(args.out) if args.out else HERE / "runs" / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    budget = arena.Budget(args.budget_usd)
    root = ta_cases.FIXTURES_ROOT
    records: list[dict[str, Any]] = []
    mira = None
    if "mira" in arms and not args.dry_run:
        from technician_arena import mira_staging

        hub = mira_staging.connect(
            env.get("ARENA_HUB_BASE", "https://app-staging.factorylm.com"),
            env.get("ARENA_HUB_COOKIE", ""),
        )
        mira = mira_staging.MiraStaging(hub, workflow=args.workflow, fixtures_root=root)
    # Codex #3487 r2 F6: build each raw arm once; the manifest records the shape
    # these exact objects send.
    raw_arms = {a: _raw_arm(a, env) for a in arms if a != "mira"}
    pairs = []
    for case in order:
        case_arms = list(arms)
        rng.shuffle(case_arms)
        pairs += [(case, arm) for arm in case_arms]
    done = 0
    try:
        for case, arm in pairs:
            diagnostic = bool(case.get("key_written_after_outputs_seen"))
            st = ta_cases.run_status(case, arm, fixtures_root=root)
            if diagnostic and not args.dry_run and not args.include_diagnostic:
                # Codex #3487 F5: keyed after outputs were seen — not in a scored run.
                st = "not_run:diagnostic_only"
            if st != "runnable":
                recs = [{"case_id": case["id"], "arm": arm, "status": st}]
            elif arm == "mira" and args.dry_run:
                recs = [
                    {
                        "case_id": case["id"],
                        "arm": arm,
                        "status": "ran",
                        "answer": arena._canned(case, "mira", 0),
                        "model": "dry-run:mira",
                    }
                ]
            elif arm == "mira":
                recs = mira.run_case(case)
            else:
                recs = _run_raw(
                    None if args.dry_run else raw_arms[arm],
                    arm,
                    case,
                    args.workflow,
                    root,
                    budget,
                    args.dry_run,
                )
            for r in recs:
                if diagnostic:
                    r["diagnostic"] = True
            records.extend(recs)
            done += 1
    except arena.BudgetExceeded as exc:
        case, arm = pairs[done]
        partial = getattr(exc, "partial", [])
        user_turns = sum(1 for t in case["turns"] if t.get("role") == "user")
        for r in partial:
            if case.get("key_written_after_outputs_seen"):
                r["diagnostic"] = True
            if len(partial) < user_turns:
                # Codex #3487 r2 F5: a conversation cut short is not gradable; the
                # paid attempt stays recorded with its cost.
                r["status"] = "error:incomplete"
        records.extend(partial)
        for case, arm in pairs[done + 1 :]:
            records.append(
                {"case_id": case["id"], "arm": arm, "status": "not_run:budget_exhausted"}
            )
        print(f"STOPPED: {exc}", file=sys.stderr)
    deployed = mira.pinned_sha if mira is not None else None

    with (out / "attempts.jsonl").open("w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")
    apk = None
    if args.apk:
        p = Path(args.apk)
        apk = {"file": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    manifest = {
        "prd": "MIRA vs ChatGPT Technician Arena (2026-09-28)",
        "git_sha": _git_sha(),
        "dry_run": args.dry_run,
        "workflow": args.workflow,
        "seed": seed,
        "case_order": [c["id"] for c in order],
        "arms": [{"name": a, "model": (None if a == "mira" else raw_arms[a].model)} for a in arms],
        "raw_request_shape": {a: arm_obj.request_body([]) for a, arm_obj in raw_arms.items()},
        "staging": {
            "base": env.get("ARENA_HUB_BASE", "https://app-staging.factorylm.com"),
            "deployed_sha": deployed,
        },
        "flags": {k: env[k] for k in FLAG_NAMES if k in env},
        "cases": [
            {
                "id": c["id"],
                "family": c["family"],
                "key_status": keys.key_status(c),
                "key_sha256": (c.get("expert_key") or {}).get("key_sha256"),
                "key_written_after_outputs_seen": c["key_written_after_outputs_seen"],
                "public_export_allowed": c["rights"]["public_export_allowed"],
            }
            for c in cases
        ],
        "apk": apk,
        "budget_usd": args.budget_usd,
        "spent_usd": budget.spent_usd,
        "spend_unknown": any(r.get("usage_missing") for r in records),
    }
    (out / "RUN-MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {out} ({len(records)} records, spent ${budget.spent_usd:.4f})")
    return 0
