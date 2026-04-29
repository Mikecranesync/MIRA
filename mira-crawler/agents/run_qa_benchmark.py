"""
Sarah (QA/Benchmark) — 04:00 ET daily.
Reads Carlos's KB growth result, runs the intelligence loop benchmark.
Writes: accuracy score, delta vs yesterday, regression count.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import get_agent_result, run_agent  # noqa: E402

BENCHMARK_SCRIPT = _REPO / "mira-bots" / "benchmarks" / "run_benchmark.py"
_BENCH_GLOB = sorted(_REPO.glob("benchmark_v*.json"), reverse=True)


def _last_score() -> float | None:
    if len(_BENCH_GLOB) >= 2:
        try:
            data = json.loads(_BENCH_GLOB[1].read_text())
            return float(data.get("summary", {}).get("technical_accuracy", 0))
        except Exception:
            return None
    return None


def _run() -> dict:
    kb_result = get_agent_result("kb_growth")
    new_content = kb_result.get("manual") if kb_result else None

    # Run benchmark (short mode — just technical accuracy)
    if BENCHMARK_SCRIPT.exists():
        result = subprocess.run(
            [sys.executable, str(BENCHMARK_SCRIPT), "--mode", "quick", "--output", "json"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            try:
                data = json.loads(result.stdout)
                accuracy = float(data.get("summary", {}).get("technical_accuracy", 0))
            except (json.JSONDecodeError, ValueError):
                accuracy = 0.0
        else:
            accuracy = 0.0
    else:
        # No benchmark script — report last known score
        accuracy = 0.0
        if _BENCH_GLOB:
            try:
                data = json.loads(_BENCH_GLOB[0].read_text())
                accuracy = float(data.get("summary", {}).get("technical_accuracy", 0))
            except Exception:
                pass

    prev = _last_score()
    delta = round(accuracy - prev, 2) if prev is not None else 0.0
    regressions = 1 if delta < -2.0 else 0

    return {
        "accuracy": round(accuracy, 1),
        "delta": delta,
        "regressions": regressions,
        "tested_after": new_content or "none",
    }


def _telegram(result: dict) -> str:
    delta_str = f"▲ +{result['delta']}%" if result["delta"] >= 0 else f"▼ {result['delta']}%"
    reg = f" · ⚠️ {result['regressions']} regression(s)" if result["regressions"] else ""
    content = result.get("tested_after", "none")
    return (
        f"Post-ingest quality check\n"
        f"Technical Accuracy: *{result['accuracy']}%* ({delta_str}){reg}\n"
        f"Tested after: {content}"
    )


if __name__ == "__main__":
    run_agent("qa_benchmark", _run, name="Sarah (QA)", emoji="📊",
              telegram_template=_telegram)
