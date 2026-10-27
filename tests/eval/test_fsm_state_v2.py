"""Eval FSM readers must use conversation_state_v2 under the unscoped tenant."""

from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_BOTS = _REPO / "mira-bots"
if str(_BOTS) not in sys.path:
    sys.path.insert(0, str(_BOTS))

from shared.session_manager import (  # noqa: E402
    UNSCOPED_CONVERSATION_TENANT,
    ensure_table,
    save_state,
)


def test_run_eval_and_local_pipeline_read_v2_unscoped(tmp_path, monkeypatch):
    db_path = str(tmp_path / "mira.db")
    ensure_table(db_path)
    chat = "eval-fsm-1"
    save_state(
        db_path,
        chat,
        {"state": "Q2", "exchange_count": 1, "context": {}},
        tenant_id=UNSCOPED_CONVERSATION_TENANT,
    )

    import tests.eval.local_pipeline as local_pipeline
    import tests.eval.run_eval as run_eval

    monkeypatch.setattr(run_eval, "MIRA_DB_PATH", db_path)
    assert run_eval._read_fsm_state(chat) == "Q2"

    pipe = local_pipeline.LocalPipeline.__new__(local_pipeline.LocalPipeline)
    pipe.db_path = db_path
    assert pipe.fsm_state(chat) == "Q2"
