"""Compatibility shim — the detectors now live in `mira-bots/shared/answer_qc.py`.

They moved so PRODUCTION can import them. While they lived here they ran only
inside the swarm: they judged fixtures and never saw a real technician's reply,
which is how defect D3 shipped past a green battery. `tools/` is not in the bot
image; `shared/` is.

Import from `shared.answer_qc` in new code. This module exists so the swarm
entry points (`probe_battery`, `probe_fuzz`, `probe_multiturn`) and their tests
keep working against ONE definition rather than a copy that drifts.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mira-bots"))

from shared.answer_qc import (  # noqa: E402,F401 — re-export surface
    DETECTORS,
    QCReport,
    claimed_action,
    contradictory_footer,
    invented_history,
    invented_topic,
    malformed_citation,
    presupposed_action,
    qc_mode,
    run_output_qc,
    scan,
    self_contradiction,
    uncited_spec,
    unrelated_vendor,
)
