"""Headless UNSEEN generalization-lane runner (UNSEEN-5, scheduled CI).

Runs the frozen novel-content probe through the REAL Telegram single-photo
rung on the FREE cascade only, and prints the classified envelope. Zero paid
inference is STRUCTURAL: the paid provider is disabled via env before any
import, and the PRINT_BENCH_BUDGET_USD hard-stop applies on top.

Usage:  python tools/unseen_lane_runner.py            (report to stdout)
        python tools/unseen_lane_runner.py out.json   (also write JSON)

Exit codes: 0 = lane ran (failures are REPORTED, not fatal — Phase 5 owns
baselines); 2 = the lane itself could not run (import/corpus/digest failure).
"""

from __future__ import annotations

import os
import sys

# Paid provider structurally OFF before anything imports printsense/bot.
os.environ["PRINT_VISION_PROVIDER"] = "none"
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "000000:headless-lane-dummy")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "headless-lane")
os.environ.setdefault("MIRA_DB_PATH", os.path.join(os.getcwd(), "unseen_lane_scratch.db"))

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "mira-bots"))
sys.path.insert(0, os.path.join(_ROOT, "mira-bots", "telegram"))


def main() -> int:
    import asyncio
    import json
    from unittest.mock import AsyncMock, MagicMock

    try:
        import bot  # noqa: PLC0415
        import printsense_testkit as tk  # noqa: PLC0415

        from printsense.benchmarks.unseen_lane import cases as unseen_cases  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001 — lane cannot run
        print(f"UNSEEN_LANE_BOOTSTRAP_FAILED: {type(exc).__name__}: {exc}")
        return 2
    if not unseen_cases.expectations_frozen_ok():
        print("UNSEEN_LANE_DIGEST_MISMATCH: expectations do not match unseen_lane.sha256")
        return 2

    context = MagicMock()
    context.bot.send_document = AsyncMock()
    spy = tk.RouterUsageSpy()
    spy.install(bot.engine.router)
    try:
        env = asyncio.run(
            tk.run_unseen_lane(
                bot._try_print_translator_reply, context, 0, mode="scheduled", usage_spy=spy
            )
        )
    finally:
        spy.restore()

    print(tk.unseen_phone_summary(env))
    report = json.dumps(env, sort_keys=True, indent=1, default=str)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"report written: {sys.argv[1]}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
