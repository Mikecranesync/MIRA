"""Celery task — technician-journey validation swarm on the synthetic queue.

PRD §8.2: "The executor extends the existing Celery synthetic-dogfood worker
and uses the existing dedicated synthetic queue."

This module is the Celery *entry point*; all behavior lives in
``tools/journey_swarm/executor.py`` so the CLI and the worker run byte-identical
logic. It follows the same optional-app registration idiom as
``tasks/eval_scorer.py``: the task binds to whatever Celery app is importable
and degrades to a plain callable when Celery is absent, so importing this
module never crash-loops a worker.

Fail-closed by construction:
  * ``JOURNEY_SWARM_ENABLED`` must be ``1`` — default off, like the synthetic
    dogfood task it sits beside.
  * The executor re-validates the environment↔target binding, the ledger
    environment allowlist, and the fixture preconditions on every run. A
    scheduled run cannot reach production: the ledger refuses any
    ``production_canary`` target without a certificate, and the executor
    refuses any host that is not on the environment's allowlist.

DEPLOYMENT GAP (tracked, not hidden): the crawler worker image
(``mira-crawler/Dockerfile.celery``) currently ships neither ``tools/`` nor
``mira-bots/``, so this task cannot import the executor in-container yet. It
runs today via the CLI and via any worker whose image includes both trees.
``_load_executor`` reports that precisely instead of failing obscurely.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]

try:  # pragma: no cover - depends on deployment layout
    from mira_crawler.celery_app import app  # type: ignore[import]
except Exception:  # noqa: BLE001
    try:
        from celery_app import app  # type: ignore[import]
    except Exception:  # noqa: BLE001
        app = None  # Celery not available — module still imports cleanly.


def _load_executor():
    """Import the journey-swarm executor, or explain why it is unavailable."""
    swarm_dir = _REPO_ROOT / "tools" / "journey_swarm"
    if not swarm_dir.is_dir():
        raise RuntimeError(
            f"journey-swarm executor not present at {swarm_dir} — this worker "
            "image does not ship tools/journey_swarm (see module docstring)"
        )
    for path in (str(swarm_dir), str(_REPO_ROOT / "mira-bots"), str(_REPO_ROOT)):
        if path not in sys.path:
            sys.path.insert(0, path)
    import executor  # type: ignore[import]

    return executor


def run_journey_swarm(
    scenario: str = "tech-journey-core",
    environment: str = "staging",
    base_url: str | None = None,
    baseline_only: bool = False,
) -> dict[str, Any]:
    """Run one journey-swarm scenario. Returns a JSON-safe summary dict.

    Never raises: every failure is reported as a structured result so a
    scheduled run degrades to an observable INFRA record rather than a
    worker traceback.
    """
    if os.getenv("JOURNEY_SWARM_ENABLED", "0") != "1":
        return {"enabled": False, "reason": "JOURNEY_SWARM_ENABLED is not 1"}

    target = base_url or os.getenv("SWARM_PIPELINE_URL", "")
    if not target:
        return {"ok": False, "verdict": "INFRA", "reason": "SWARM_PIPELINE_URL not set"}

    try:
        executor = _load_executor()
    except Exception as exc:  # noqa: BLE001 — a missing tree is INFRA, not a crash
        logger.warning("JOURNEY_SWARM unavailable: %s", exc)
        return {"ok": False, "verdict": "INFRA", "reason": str(exc)}

    try:
        # Refuse before any turn runs if the label and the target disagree.
        executor.assert_target_matches_environment(environment, target)
    except Exception as exc:  # noqa: BLE001
        logger.error("JOURNEY_SWARM refused: %s", exc)
        return {"ok": False, "verdict": "REFUSED", "reason": str(exc)}

    argv = [
        "--scenario",
        scenario,
        "--environment",
        environment,
        "--base-url",
        target,
    ]
    if baseline_only:
        argv.append("--baseline-only")
    old_argv = sys.argv
    try:
        sys.argv = ["journey-swarm", *argv]
        code = executor.main()
    except Exception as exc:  # noqa: BLE001
        logger.exception("JOURNEY_SWARM run failed")
        return {"ok": False, "verdict": "INFRA", "reason": str(exc)}
    finally:
        sys.argv = old_argv

    return {
        "ok": code == 0,
        "exit_code": code,
        "verdict": "GREEN" if code == 0 else "NOT_GREEN",
        "scenario": scenario,
        "environment": environment,
    }


if app is not None:  # pragma: no cover - registration depends on the worker

    @app.task(name="tasks.journey_swarm.run_journey_swarm")
    def run_journey_swarm_task(
        scenario: str = "tech-journey-core",
        environment: str = "staging",
        base_url: str | None = None,
        baseline_only: bool = False,
    ) -> dict[str, Any]:
        return run_journey_swarm(
            scenario=scenario,
            environment=environment,
            base_url=base_url,
            baseline_only=baseline_only,
        )
