"""MIRA observability + evaluation layer (Bhaumik five pillars).

A lightweight, JSON-first, read-only layer that makes every MIRA answer
**measurable, traceable, and auditable** — without rebuilding the product,
editing the engine, or adding an external observability vendor.

Five pillars (Sandipan Bhaumik):

1. **Evaluation**    — ``evalset.py`` + ``run_eval.py`` (eval pack → pass/fail report)
2. **Observability** — ``trace.py`` (one JSON ``AnswerTrace`` per answer) + ``viewer.py``
3. **Data foundation** — eval packs + approval registry are boring, human-editable JSON/YAML
4. **Orchestration** — the 7 named trace steps in ``trace.STEP_*``
5. **Governance**    — ``checks.py`` gates + ``approval_registry.py`` (human approval central)

Everything here is **additive and observational**. It never blocks an answer and
never writes to a PLC. Traces land as local JSONL; reports as local JSON. The only
substrate that runs fully offline is SimLab (the deterministic conveyor/bottling
demo), so the harness is built on it — see ``harness.py``.

The dependency-light trace/checks/approval core now lives in
``mira-bots/shared/observe`` (so the engine + adapters can import it without
depending on simlab). This package adds ``mira-bots`` to ``sys.path`` and
re-exports that core, keeping ``simlab.observe`` working as the eval/ask facade.

Entry points::

    python -m simlab.observe.ask "Why did the conveyor stop?"      # single answer + trace
    python -m simlab.observe.run_eval conveyor_demo                # eval pack → report
    python -m simlab.observe.viewer <trace.jsonl>                  # read a trace
"""

import sys as _sys
from pathlib import Path as _Path

# Make ``shared.observe`` importable when run from the repo root (the bot
# containers already have mira-bots on the path; this covers CLI/test use).
_BOTS = str(_Path(__file__).resolve().parents[2] / "mira-bots")
if _BOTS not in _sys.path:
    _sys.path.insert(0, _BOTS)

from shared.observe.trace import (  # noqa: E402, F401
    ALL_STEPS,
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_RECEIVE_QUESTION,
    STEP_RESOLVE_ASSET,
    STEP_RETRIEVE_CONTEXT,
    STEP_RETURN_ANSWER,
    STEP_VALIDATE_ANSWER,
    AnswerTrace,
    Step,
    Warning,
)

__all__ = [
    "AnswerTrace",
    "Step",
    "Warning",
    "ALL_STEPS",
    "STEP_RECEIVE_QUESTION",
    "STEP_RESOLVE_ASSET",
    "STEP_RETRIEVE_CONTEXT",
    "STEP_CHECK_GOVERNANCE",
    "STEP_GENERATE_ANSWER",
    "STEP_VALIDATE_ANSWER",
    "STEP_RETURN_ANSWER",
]
