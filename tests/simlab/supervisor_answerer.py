"""Staging-only ``AnswerFn`` adapter — route SimLab scoring through the real Supervisor.

This proves the P1 ``ScenarioScore`` interface (``simlab.evaluation``) works
unchanged for the *real* MIRA engine, not just the deterministic oracle. It is
the bridge between the offline scoring service and the live diagnostic path.

**It is staging-only and is NEVER added to the CI gate.** It needs Doppler
secrets + a reachable Open WebUI / cascade. When creds are absent it raises
``SupervisorUnavailable`` (or, under pytest, ``pytest.skip``s) so the offline
suite stays green. ``simlab/evaluation.py`` does not import this module — the
real-Supervisor path lives here in ``tests/`` per the plan's package boundary.

Design
------
- Import-light: ``shared.engine`` is imported lazily inside ``make_supervisor_answerer``
  so merely importing this module never drags the engine into a pure-offline
  collection.
- Reuses ``tests/simlab/juice_runner_adapter.simlab_scenario_to_state`` for the
  direct-connection state shape (``source="direct_connection"`` preserved — the
  SimLab connection certifies the UNS path; the chat-gate is skipped not
  downgraded, per ``.claude/rules/direct-connection-uns-certified.md``).
- The returned ``AnswerFn`` resolves the active scenario from the evidence's
  ``asset_id`` (unique per scenario A–F), pre-seeds the Supervisor state, and
  runs one ``process_full`` turn synchronously, returning ``result["reply"]``.

Usage (staging, with Doppler)::

    doppler run --project factorylm --config stg -- \\
        python -c "from tests.simlab.supervisor_answerer import make_supervisor_answerer; \\
                   from simlab.evaluation import run_all, to_markdown; \\
                   print(to_markdown(run_all(make_supervisor_answerer())))"
"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import TYPE_CHECKING

from simlab.evaluation import AnswerFn
from simlab.scenarios import SCENARIOS

if TYPE_CHECKING:
    from simlab.diagnostic import EvidencePacket


class SupervisorUnavailable(RuntimeError):
    """Raised when the real Supervisor cannot be constructed (no creds / engine)."""


def _creds_present() -> bool:
    """True only when the secrets needed for a real Supervisor turn are set.

    Conservative: require both an Open WebUI key and at least one cascade
    provider key (Groq / Cerebras / Gemini). Absent → caller skips.
    """
    has_owui = bool(os.getenv("OPENWEBUI_API_KEY"))
    has_cascade = any(
        os.getenv(k)
        for k in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY")
    )
    return has_owui and has_cascade


def make_supervisor_answerer(*, db_path: str | None = None) -> AnswerFn:
    """Build a real-Supervisor-backed ``AnswerFn`` (staging only).

    Raises ``SupervisorUnavailable`` if creds are missing or ``shared.engine``
    can't be imported — callers in tests should convert that into a skip.
    """
    if not _creds_present():
        raise SupervisorUnavailable(
            "Supervisor answerer needs OPENWEBUI_API_KEY + a cascade provider key "
            "(GROQ/CEREBRAS/GEMINI). Run under Doppler (factorylm/stg)."
        )

    try:
        # Lazy import: keep this module import-light for offline collection.
        from shared.engine import Supervisor  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover — staging-only path
        raise SupervisorUnavailable(f"shared.engine import failed: {exc}") from exc

    from simlab import SIMLAB_TENANT_ID
    from tests.simlab.juice_runner_adapter import simlab_scenario_to_state

    supervisor = Supervisor(
        db_path=db_path or os.getenv("SIMLAB_DB_PATH", "/tmp/mira_simlab_eval.db"),
        openwebui_url=os.getenv("OPENWEBUI_URL", "http://localhost:3000"),
        api_key=os.getenv("OPENWEBUI_API_KEY", ""),
        collection_id=os.getenv("OPENWEBUI_COLLECTION_ID", ""),
        tenant_id=SIMLAB_TENANT_ID,
    )

    def answer(question: str, evidence: "EvidencePacket") -> str:
        # Resolve the scenario from the evidence's asset_id (unique per A–F).
        scenario = next(
            (s for s in SCENARIOS.values() if s.asset_id == evidence.asset_id),
            None,
        )
        if scenario is None:  # pragma: no cover — defensive
            raise SupervisorUnavailable(
                f"no scenario for evidence asset_id {evidence.asset_id!r}"
            )

        chat_id = f"simlab_eval_{scenario.id}_{uuid.uuid4().hex[:8]}"
        # Direct-connection certified state (source="direct_connection" preserved).
        state = simlab_scenario_to_state(
            scenario.id, ticks=evidence_ticks(scenario.id)
        )
        supervisor.reset(chat_id)
        supervisor._save_state(chat_id, _to_supervisor_state(state))  # noqa: SLF001

        result = asyncio.run(
            supervisor.process_full(chat_id, question, photo_b64=None)
        )
        return result.get("reply", "")

    return answer


def evidence_ticks(scenario_id: str) -> int:
    """The manifest ticks used to seed the Supervisor state (matches the scorer)."""
    from simlab.evaluation import DEFAULT_MANIFEST_TICKS

    return DEFAULT_MANIFEST_TICKS[scenario_id]


def _to_supervisor_state(adapter_state: dict) -> dict:
    """Lift the juice_runner_adapter state into the Supervisor state shape.

    Mirrors ``tests/simlab/runner.py::_build_initial_state`` minimally: keep the
    ``direct_connection`` ``uns_context`` and stash the evidence/tag_state under
    ``context.session_context`` so the gate is skipped and grounding is present.
    """
    return {
        "state": "Q1",
        "asset_identified": adapter_state["asset_id"],
        "uns_context": adapter_state["uns_context"],
        "context": {
            "session_context": {
                "tag_state": adapter_state.get("tag_state", {}),
                "evidence": adapter_state["session_context"]["evidence"],
                "simlab_scenario_id": adapter_state["uns_context"].get("scenario_id"),
            }
        },
        "exchange_count": 0,
        "fault_category": None,
        "final_state": None,
    }
