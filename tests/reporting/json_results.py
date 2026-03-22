"""JSON results writer for MIRA evaluation runs."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

from tests.scoring.composite import CaseResult, RunResult


def write_run_json(run: RunResult, output_dir: str | Path) -> Path:
    """Write a RunResult to a timestamped JSON file.

    Returns the path to the written file.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = f"run_{run.regime}_{run.timestamp.replace(':', '-')}.json"
    path = output_dir / filename

    payload = {
        "run_id": run.run_id,
        "timestamp": run.timestamp,
        "regime": run.regime,
        "total_cases": run.total_cases,
        "passed_cases": run.passed_cases,
        "pass_rate": run.pass_rate,
        "avg_latency_ms": run.avg_latency_ms,
        "duration_seconds": run.duration_seconds,
        "cases": [asdict(r) for r in run.results],
    }

    with open(path, "w") as f:
        json.dump(payload, f, indent=2, default=str)

    return path


def write_aggregate_json(runs: list[RunResult], output_dir: str | Path) -> Path:
    """Write aggregate results for multiple regime runs."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ts = runs[0].timestamp if runs else "unknown"
    path = output_dir / f"aggregate_{ts.replace(':', '-')}.json"

    payload = {
        "timestamp": ts,
        "regimes": {},
        "overall": {},
    }

    total_cases = 0
    total_passed = 0

    for run in runs:
        payload["regimes"][run.regime] = {
            "total": run.total_cases,
            "passed": run.passed_cases,
            "pass_rate": run.pass_rate,
            "avg_latency_ms": run.avg_latency_ms,
            "duration_seconds": run.duration_seconds,
        }
        total_cases += run.total_cases
        total_passed += run.passed_cases

    payload["overall"] = {
        "total": total_cases,
        "passed": total_passed,
        "pass_rate": round(total_passed / total_cases, 4) if total_cases > 0 else 0.0,
    }

    with open(path, "w") as f:
        json.dump(payload, f, indent=2)

    return path
