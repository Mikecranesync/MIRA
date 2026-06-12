"""#1835 follow-up — the SimLab scenario runner must bind the Supervisor to
``SIMLAB_TENANT_ID`` so KB recall surfaces the ingested juice-bottling docs.

``run_scenario`` calls ``process_full`` directly (it pre-seeds the
``direct_connection`` UNS context), so the per-call tenant is never set by
``process()``; recall falls back to ``self.rag.tenant_id``, which the Supervisor
constructor arg populates. Without it, scenarios recall under the empty tenant
and can never cite the SimLab corpus seeded by
``tools/seeds/seed-simlab-docs.py``.

This asserts the WIRING (the constructor ``tenant_id``). The end-to-end
"scenarios cite the docs" payoff additionally needs a live dev Neon with the seed
applied (``seed-simlab-docs.py --commit``) and is verified there — not offline.

Run from the repo/worktree ROOT (cwd=mira-bots shadows stdlib ``email``):
    python3.12 -m pytest tests/simlab/test_runner_tenant.py -q
"""

from __future__ import annotations

import shared.engine

from simlab import SIMLAB_TENANT_ID


def test_build_supervisor_binds_simlab_tenant(monkeypatch):
    captured: dict = {}

    class _FakeSupervisor:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    # _build_supervisor does `from shared.engine import Supervisor` at call time,
    # so patching the module attribute is enough.
    monkeypatch.setattr(shared.engine, "Supervisor", _FakeSupervisor)

    from tests.simlab import runner

    runner._build_supervisor()

    assert captured.get("tenant_id") == SIMLAB_TENANT_ID, (
        "SimLab runner must construct the Supervisor with tenant_id="
        "SIMLAB_TENANT_ID so recall surfaces the seeded juice-bottling docs"
    )
