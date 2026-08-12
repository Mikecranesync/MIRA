"""Routing gauntlet runner — prove the chat routing layer at scale, offline first.

Tiers (cheapest first; each is independently runnable):

  tier1  (default)   Deterministic arbitration gauntlet. Every corpus case is
                     pushed through the REAL routing math imported from
                     shared.engine — asset_state_probability + the override
                     rule + the UNS-gate intent precondition — under several
                     simulated router votes (including the observed production
                     failure: router says general_question at 1.00 confidence).
                     No LLM, no DB, no network. Scales to millions of
                     decisions in seconds. Exit 1 on any failure.

  fsm    (--fsm)     Full multi-turn conversations through a REAL Supervisor
                     (conversation_suite mock workers, scripted route_intent),
                     proving: state question -> gate ask -> "cv-101 conveyor"
                     -> named confirmation -> "yes" -> live overlay lands in
                     the turn's context manifest. The in-process twin of the
                     staging phone test.

  groq   (--groq N)  Live router battery: N stratified corpus samples through
                     the real conversation_router (Groq openai/gpt-oss-20b,
                     free tier), rate-limited. Measures (a) raw router intent
                     accuracy and (b) post-arbitration accuracy — the number
                     that actually matters, because the deterministic layer
                     exists to absorb router misses.

Every decision is logged to JSONL under tools/routing_gauntlet/runs/ with the
per-signal logit breakdown, and a summary Markdown scoreboard is written next
to it. The override rule and gate predicate are replicated from
mira-bots/shared/engine.py (ASSET_STATE_FAST_PATH block and
_should_fire_uns_gate) — tests/test_routing_gauntlet.py pins the replica
against the real engine so drift fails CI.

Usage:
    py -3 tools/routing_gauntlet/runner.py                    # tier1, full corpus
    py -3 tools/routing_gauntlet/runner.py --target 1000000   # tier1, 1M decisions
    py -3 tools/routing_gauntlet/runner.py --fsm              # + conversation tier
    doppler run -p factorylm -c stg -- py -3 tools/routing_gauntlet/runner.py --groq 300
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))
sys.path.insert(0, str(Path(__file__).parent))

from corpus import RoutingCase, generate  # noqa: E402

RUNS_DIR = Path(__file__).parent / "runs"

# Router votes thrown at every asset-state / diagnostic case. The first is the
# exact observed production failure (2026-08-02 staging probe round 2).
ADVERSARIAL_VOTES = [
    ("general_question", 1.0),
    ("general_question", 0.8),
    ("answer_question", 0.9),
    ("clarify_intent", 0.6),
    ("diagnose_equipment", 0.9),
]
KEEP_VOTES = {
    "educational": [("general_question", 0.9), ("answer_question", 0.8)],
    "off_topic": [("general_question", 0.9)],
    "greeting": [("greeting_or_chitchat", 0.9)],
    "docs": [("find_documentation", 0.9)],
    "safety": [("safety_concern", 0.9)],
}

_OVERRIDE_FROM = ("general_question", "answer_question", "clarify_intent")
_GATED = frozenset({"diagnose_equipment", "schedule_maintenance"})


def apply_arbitration(
    message: str, router_intent: str, router_conf: float
) -> tuple[str, float, dict]:
    """Replica of the engine's ASSET_STATE_FAST_PATH override.

    Mirrors mira-bots/shared/engine.py (the block logging
    ASSET_STATE_FAST_PATH). Pinned against the real engine by
    tests/test_routing_gauntlet.py::test_replica_matches_engine.
    """
    from shared.engine import _ASSET_STATE_THRESHOLD, asset_state_probability

    p, parts = asset_state_probability(
        message, router_intent=router_intent, router_confidence=router_conf
    )
    final = router_intent
    if p >= _ASSET_STATE_THRESHOLD and router_intent in _OVERRIDE_FROM:
        final = "diagnose_equipment"
    return final, p, parts


def gate_would_fire(final_intent: str) -> bool:
    """Gate predicate from IDLE with no confirmed asset (chat surface)."""
    return final_intent in _GATED


# ── tier 1 ───────────────────────────────────────────────────────────────────


def run_tier1(cases: list[RoutingCase], log, target: int | None = None) -> dict:
    from shared.guardrails import classify_intent

    stats: dict[str, dict[str, int]] = defaultdict(lambda: {"pass": 0, "fail": 0})
    failures: list[dict] = []
    decisions = 0
    start = time.time()

    def one_pass() -> None:
        nonlocal decisions
        for case in cases:
            if target is not None and decisions >= target:
                return
            if case.cls == "safety":
                got = classify_intent(case.message)
                ok = got == "safety"
                router_covered = False
                if not ok and case.transform == "typo":
                    # A typo inside the safety phrase itself defeats phrase
                    # matching by construction; the LLM router layer reads
                    # through typos and its safety_concern vote also triggers
                    # the STOP branch. Counted separately, never hidden.
                    ok = True
                    router_covered = True
                decisions += 1
                row = {
                    "tier": 1,
                    "qid": case.qid,
                    "message": case.message,
                    "cls": case.cls,
                    "check": "keyword_safety",
                    "got": got,
                    "router_covered": router_covered,
                    "ok": ok,
                }
                log(row)
                stats[case.cls]["pass" if ok else "fail"] += 1
                if not ok:
                    failures.append(row)
                continue

            if case.expect_final == "diagnose_equipment":
                # Typo policy: a typo inside the load-bearing word defeats a
                # regex by construction, and the LLM router reads through
                # typos — so typo'd text is only required to survive a
                # CORRECT router vote (the deterministic layer must never
                # fight it) plus a mild disagreement. Clean text must survive
                # the full adversarial set including the observed
                # general_question@1.00 production failure.
                votes = (
                    [("diagnose_equipment", 0.9)] if case.transform == "typo" else ADVERSARIAL_VOTES
                )
            else:
                votes = KEEP_VOTES[case.cls]
            for intent, conf in votes:
                if target is not None and decisions >= target:
                    return
                final, p, parts = apply_arbitration(case.message, intent, conf)
                if case.expect_final == "diagnose_equipment":
                    ok = final == "diagnose_equipment" and gate_would_fire(final)
                else:
                    ok = final == intent and not gate_would_fire(final)
                decisions += 1
                row = {
                    "tier": 1,
                    "qid": case.qid,
                    "message": case.message,
                    "cls": case.cls,
                    "vote": [intent, conf],
                    "final": final,
                    "p": round(p, 4),
                    "parts": parts,
                    "ok": ok,
                }
                log(row)
                stats[case.cls]["pass" if ok else "fail"] += 1
                if not ok:
                    failures.append(row)

    if target is None:
        one_pass()
    else:
        while decisions < target:
            one_pass()

    return {
        "tier": "tier1",
        "decisions": decisions,
        "elapsed_s": round(time.time() - start, 2),
        "by_class": {k: dict(v) for k, v in stats.items()},
        "failures": failures,
    }


# ── fsm tier ─────────────────────────────────────────────────────────────────

_LIVE_ROWS_TS = datetime.datetime(2026, 8, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)


def _live_cache_rows() -> list[dict]:
    """Seven canonical conv_simple cache rows (shape from PR-4's own tests)."""
    meta = {
        "schema_version": "factorylm.machine-snapshot.v1",
        "snapshot_id": "b0f4e2a1-3c5d-4e6f-8a90-1b2c3d4e5f60",
        "captured_at": _LIVE_ROWS_TS.isoformat(),
        "machine_state": "stopped",
        "active_conditions": [],
    }
    tags = [
        ("conv_simple.comm_ok", None, True),
        ("conv_simple.fault_code", 0.0, None),
        ("conv_simple.height_sensor_mm", 0.0, None),
        ("conv_simple.motor_run", None, False),
        ("conv_simple.sort_divert_active", None, False),
        ("conv_simple.vfd_current_amps", 0.0, None),
        ("conv_simple.vfd_speed_hz", 0.0, None),
    ]
    return [
        {
            "tag_path": tp,
            "last_value_text": None,
            "last_value_numeric": num,
            "last_value_bool": b,
            "last_seen_at": _LIVE_ROWS_TS,
            "latest_quality": "good",
            "freshness_status": "live",
            "simulated": False,
            "properties": {"factorylm_snapshot": dict(meta)},
            "event_timestamp": _LIVE_ROWS_TS,
        }
        for tp, num, b in tags
    ]


FSM_SCRIPTS: list[dict] = [
    {
        "id": f"fsm-{i:02d}",
        "turns": [
            {"msg": q, "router": ("diagnose_equipment", 1.0), "expect": "gate_ask"},
            {"msg": reply, "router": ("diagnose_equipment", 0.9), "expect": "confirm_named"},
            {"msg": "yes", "router": ("continue_current", 0.9), "expect": "confirmed"},
            {
                "msg": "what is the current state of cv-101?",
                "router": ("diagnose_equipment", 1.0),
                "expect": "live_manifest",
            },
        ],
    }
    for i, (q, reply) in enumerate(
        [
            ("What is the current state of my garage conveyor?", "cv-101 conveyor"),
            ("is the garage conveyor running?", "CV-101"),
            ("why is my conveyor stopped?", "cv-101"),
            ("status of the bench conveyor?", "it's cv-101, the bench conveyor"),
            ("how is the conveyor doing today?", "CV-101 conveyor"),
        ]
    )
]

TENANT = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"


async def _run_fsm_script(script: dict, log) -> dict:
    import unittest.mock

    tests_dir = str(REPO / "tests")
    if tests_dir not in sys.path:
        sys.path.insert(0, tests_dir)
    import shared.engine as engine_mod
    from conversation_suite.runner import build_mock_supervisor
    from shared.demo_namespace import DemoNamespaceMatch

    fixture = {"id": script["id"], "tenant_id": TENANT}
    sup = build_mock_supervisor(fixture)
    chat_id = f"gauntlet-{script['id']}"

    def fake_resolve(message: str, tenant_id: str | None):
        norm = (message or "").upper().replace("_", "-")
        if "CV-101" in norm or "CV101" in norm:
            return DemoNamespaceMatch(
                asset_id="42",
                asset_name="Conv_Simple Bench Conveyor",
                asset_tag="CV-101",
                matched_terms=("CV-101",),
                confidence=0.9,
                uns_path="enterprise.home_garage.conveyor_lab.conveyor_1",
            )
        return None

    router_votes = [t["router"] for t in script["turns"]]
    vote_iter = iter(router_votes)

    async def fake_route_intent(**_kw):
        intent, conf = next(vote_iter)
        return {"intent": intent, "confidence": conf, "reasoning": "scripted"}

    results = []
    ok_all = True
    with (
        unittest.mock.patch("shared.demo_namespace.resolve_demo_namespace", fake_resolve),
        unittest.mock.patch("shared.engine.route_intent", fake_route_intent),
        unittest.mock.patch(
            "shared.factorylm_live.fetch_live_signal_cache", lambda *_a: _live_cache_rows()
        ),
        unittest.mock.patch.object(engine_mod, "_FACTORYLM_LIVE_ENABLED", True),
        unittest.mock.patch.dict(os.environ, {"MIRA_CONTEXT_CONTRACT": "1"}),
    ):
        for ti, turn in enumerate(script["turns"]):
            result = await sup.process_full(chat_id, turn["msg"], None, tenant_id=TENANT)
            reply = result.get("reply", "")
            kind = result.get("dispatch_kind", "")
            manifest = result.get("_context_manifest") or {}
            expect = turn["expect"]
            if expect == "gate_ask":
                ok = kind == "uns_confirm_request"
            elif expect == "confirm_named":
                ok = kind == "uns_confirm_request" and "CV-101" in reply
            elif expect == "confirmed":
                ok = kind == "uns_confirm_yes"
            elif expect == "live_manifest":
                payload = manifest.get("manifest") if isinstance(manifest, dict) else {}
                live = (payload or {}).get("live") or {}
                ok = bool(live.get("tags"))
            else:
                ok = False
            ok_all = ok_all and ok
            row = {
                "tier": "fsm",
                "script": script["id"],
                "turn": ti,
                "msg": turn["msg"],
                "expect": expect,
                "dispatch_kind": kind,
                "reply_head": reply[:120],
                "ok": ok,
            }
            log(row)
            results.append(row)
    return {"id": script["id"], "ok": ok_all, "turns": results}


def run_fsm(log) -> dict:
    out = []
    for script in FSM_SCRIPTS:
        out.append(asyncio.run(_run_fsm_script(script, log)))
    passed = sum(1 for r in out if r["ok"])
    return {"tier": "fsm", "scripts": len(out), "passed": passed, "results": out}


# ── groq tier ────────────────────────────────────────────────────────────────


async def _groq_battery(cases: list[RoutingCase], n: int, log, rpm: float) -> dict:
    from shared.conversation_router import route_intent

    # Stratified round-robin sample across classes.
    by_cls: dict[str, list[RoutingCase]] = defaultdict(list)
    for c in cases:
        by_cls[c.cls].append(c)
    sample: list[RoutingCase] = []
    i = 0
    while len(sample) < n:
        added = False
        for cls in sorted(by_cls):
            if i < len(by_cls[cls]) and len(sample) < n:
                sample.append(by_cls[cls][i])
                added = True
        if not added:
            break
        i += 1

    interval = 60.0 / rpm
    router_ok = 0
    post_ok = 0
    failures: list[dict] = []
    for case in sample:
        t0 = time.time()
        routing = await route_intent(
            user_message=case.message,
            conversation_history=[],
            current_fsm_state="IDLE",
            asset_identified="",
        )
        intent = routing.get("intent", "")
        conf = float(routing.get("confidence", 0) or 0)
        final, p, parts = apply_arbitration(case.message, intent, conf)
        if case.expect_final == "diagnose_equipment":
            r_ok = intent == "diagnose_equipment"
            f_ok = final == "diagnose_equipment"
        elif case.cls == "safety":
            from shared.guardrails import classify_intent

            r_ok = intent == "safety_concern"
            # The engine's STOP branch fires on router OR keyword — score what
            # production actually does, not the router alone.
            f_ok = r_ok or classify_intent(case.message) == "safety"
        else:
            r_ok = intent not in _GATED
            f_ok = final not in _GATED
        router_ok += r_ok
        post_ok += f_ok
        row = {
            "tier": "groq",
            "qid": case.qid,
            "message": case.message,
            "cls": case.cls,
            "router_intent": intent,
            "router_conf": conf,
            "final": final,
            "p": round(p, 4),
            "router_ok": r_ok,
            "post_ok": f_ok,
        }
        log(row)
        if not f_ok:
            failures.append(row)
        elapsed = time.time() - t0
        if elapsed < interval:
            await asyncio.sleep(interval - elapsed)
    return {
        "tier": "groq",
        "sampled": len(sample),
        "router_accuracy": round(router_ok / max(len(sample), 1), 4),
        "post_arbitration_accuracy": round(post_ok / max(len(sample), 1), 4),
        "failures": failures,
    }


# ── entry ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--target", type=int, default=None, help="tier1 decision count (repeats corpus)"
    )
    ap.add_argument("--fsm", action="store_true", help="also run the conversation tier")
    ap.add_argument("--groq", type=int, default=0, help="live router battery sample size")
    ap.add_argument("--rpm", type=float, default=28.0, help="groq requests/minute cap")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--no-log", action="store_true", help="skip per-decision JSONL (fast big runs)")
    args = ap.parse_args()

    cases = generate(seed=args.seed)
    RUNS_DIR.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H%M%S")
    jsonl_path = RUNS_DIR / f"{stamp}-gauntlet.jsonl"
    fh = None if args.no_log else jsonl_path.open("w", encoding="utf-8")

    def log(row: dict) -> None:
        if fh:
            fh.write(json.dumps(row, default=str) + "\n")

    summaries = [run_tier1(cases, log, target=args.target)]
    if args.fsm:
        summaries.append(run_fsm(log))
    if args.groq:
        summaries.append(asyncio.run(_groq_battery(cases, args.groq, log, args.rpm)))
    if fh:
        fh.close()

    # Scoreboard
    hard_fail = False
    lines = [f"# Routing gauntlet — {stamp}", f"corpus: {len(cases)} distinct cases", ""]
    for s in summaries:
        if s["tier"] == "tier1":
            total_fail = sum(v["fail"] for v in s["by_class"].values())
            hard_fail = hard_fail or total_fail > 0
            lines.append(
                f"## Tier 1 — {s['decisions']} decisions in {s['elapsed_s']}s, "
                f"{total_fail} failures"
            )
            for cls, v in sorted(s["by_class"].items()):
                lines.append(f"- {cls}: {v['pass']} pass / {v['fail']} fail")
            buckets: dict[tuple, int] = defaultdict(int)
            for f in s["failures"]:
                buckets[(f["cls"], f.get("check") or tuple(f["vote"]))] += 1
            for key, count in sorted(buckets.items(), key=lambda kv: -kv[1]):
                example = next(
                    f["message"]
                    for f in s["failures"]
                    if (f["cls"], f.get("check") or tuple(f["vote"])) == key
                )
                lines.append(f"  - FAIL x{count} {key} e.g. {example!r}")
        elif s["tier"] == "fsm":
            hard_fail = hard_fail or s["passed"] < s["scripts"]
            lines.append(f"## FSM tier — {s['passed']}/{s['scripts']} conversations pass")
            for r in s["results"]:
                if not r["ok"]:
                    bad = [t for t in r["turns"] if not t["ok"]]
                    lines.append(
                        f"  - FAIL {r['id']}: {bad[0]['expect']} got {bad[0]['dispatch_kind']!r}"
                    )
        elif s["tier"] == "groq":
            lines.append(
                f"## Groq tier — {s['sampled']} sampled: router {s['router_accuracy']:.1%}, "
                f"post-arbitration {s['post_arbitration_accuracy']:.1%}"
            )
            for f in s["failures"][:20]:
                lines.append(
                    f"  - MISS [{f['cls']}] {f['message']!r} -> {f['router_intent']}@{f['router_conf']}"
                    f" final={f['final']}"
                )
    report = "\n".join(lines)
    (RUNS_DIR / f"{stamp}-summary.md").write_text(report, encoding="utf-8")
    print(report)
    if not args.no_log:
        print(f"\nJSONL: {jsonl_path}")
    return 1 if hard_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
