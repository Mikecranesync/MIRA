"""Train-before-deploy approval store for SimLab asset agents.

Self-contained local store backed by SQLite WAL.  No Neon DB migration required.

Wiring to production Hub
------------------------
This module mirrors the schema shape of two Hub migrations:
- ``migration 046`` — ``asset_agent_status`` table (lifecycle states)
- ``migration 047`` — ``asset_validation_qa`` table (validation Q&A + verdicts)

The lifecycle graph and state-machine enforcement are imported from
``mira-bots/shared/asset_agent_transition.py`` (the same module that
``mira-pipeline/ignition_chat.py`` and the Hub ``AssetValidateTab.tsx`` use).

For production Hub wiring, replace this SQLite store with NeonDB calls to
the ``asset_validation_qa`` and ``asset_agent_status`` tables.  The method
signatures (record_answer, set_verdict, agent_state, transition, gate) are
intentionally identical to what the Hub routes expect.

sys.path note
-------------
``mira-bots`` is not a Python package (no ``mira_bots/__init__.py``).
We insert ``<repo_root>/mira-bots`` onto sys.path so that
``from shared.asset_agent_transition import …`` resolves correctly.
This mirrors the pattern in ``tests/simlab/runner.py``.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger("simlab.approval")

# -- Import asset_agent_transition via sys.path (not as a package) ----------
_REPO_ROOT = Path(__file__).parent.parent
_MIRA_BOTS = str(_REPO_ROOT / "mira-bots")
if _MIRA_BOTS not in sys.path:
    sys.path.insert(0, _MIRA_BOTS)

from shared.asset_agent_transition import (  # noqa: E402
    GATE_REFUSAL_MESSAGE,
    GateDecision,
    gate_decision,
    validate_transition,
)

# Valid verdict values (mirror asset_validation_qa.reviewer_verdict CHECK constraint)
VALID_VERDICTS = frozenset({"good", "bad", "needs_review"})

_DDL = """
CREATE TABLE IF NOT EXISTS asset_agent_status (
    asset_uns_path TEXT PRIMARY KEY,
    state          TEXT NOT NULL DEFAULT 'draft',
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_validation_qa (
    qa_id           TEXT PRIMARY KEY,
    scenario_id     TEXT NOT NULL,
    asset_uns_path  TEXT NOT NULL,
    question        TEXT NOT NULL,
    mira_answer     TEXT NOT NULL,
    citations       TEXT NOT NULL DEFAULT '[]',
    evidence_tags   TEXT NOT NULL DEFAULT '[]',
    groundedness    INTEGER,
    reviewer_verdict TEXT,
    reviewed_by     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at     TEXT
);
"""


class ApprovalStore:
    """Local SQLite-backed approval store.

    Parameters
    ----------
    db_path:
        Path to the SQLite database file.  Defaults to ``/tmp/mira_simlab_approvals.db``.
        Pass ``:memory:`` for tests.
    """

    def __init__(self, db_path: str = "/tmp/mira_simlab_approvals.db") -> None:
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_DDL)
        self._conn.commit()

    # ------------------------------------------------------------------
    # Validation Q&A
    # ------------------------------------------------------------------

    def record_answer(
        self,
        *,
        scenario_id: str,
        asset_uns_path: str,
        question: str,
        mira_answer: str,
        citations: list,
        evidence_tags: list,
        groundedness: Optional[int] = None,
    ) -> str:
        """Record a MIRA answer for a scenario question.

        Returns the generated ``qa_id`` (UUID string).
        """
        qa_id = str(uuid.uuid4())
        self._conn.execute(
            """
            INSERT INTO asset_validation_qa
              (qa_id, scenario_id, asset_uns_path, question, mira_answer,
               citations, evidence_tags, groundedness)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                qa_id,
                scenario_id,
                asset_uns_path,
                question,
                mira_answer,
                json.dumps(citations),
                json.dumps(evidence_tags),
                groundedness,
            ),
        )
        self._conn.commit()
        return qa_id

    def set_verdict(self, qa_id: str, verdict: str, reviewed_by: str) -> None:
        """Set the reviewer verdict on a Q&A row.

        Parameters
        ----------
        qa_id:
            UUID returned by ``record_answer``.
        verdict:
            One of ``'good'``, ``'bad'``, ``'needs_review'``.
        reviewed_by:
            Human reviewer identifier (required for ``good`` verdicts).
        """
        if verdict not in VALID_VERDICTS:
            raise ValueError(
                f"verdict must be one of {sorted(VALID_VERDICTS)}, got {verdict!r}"
            )
        rows = self._conn.execute(
            "UPDATE asset_validation_qa "
            "SET reviewer_verdict=?, reviewed_by=?, reviewed_at=datetime('now') "
            "WHERE qa_id=?",
            (verdict, reviewed_by, qa_id),
        ).rowcount
        if rows == 0:
            raise KeyError(f"No Q&A row with qa_id={qa_id!r}")
        self._conn.commit()

    def get_answer(self, qa_id: str) -> dict:
        """Return the Q&A row as a dict, raising ``KeyError`` if not found."""
        row = self._conn.execute(
            "SELECT * FROM asset_validation_qa WHERE qa_id=?", (qa_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"No Q&A row with qa_id={qa_id!r}")
        return self._row_to_dict_qa(row)

    def list_answers(self, asset_uns_path: str) -> list[dict]:
        """Return all Q&A rows for the given asset UNS path."""
        rows = self._conn.execute(
            "SELECT * FROM asset_validation_qa WHERE asset_uns_path=? ORDER BY created_at",
            (asset_uns_path,),
        ).fetchall()
        return [self._row_to_dict_qa(r) for r in rows]

    # ------------------------------------------------------------------
    # Asset-agent lifecycle
    # ------------------------------------------------------------------

    def agent_state(self, asset_uns_path: str) -> str:
        """Return the current lifecycle state.  Default is ``'draft'`` if unset."""
        row = self._conn.execute(
            "SELECT state FROM asset_agent_status WHERE asset_uns_path=?",
            (asset_uns_path,),
        ).fetchone()
        return row[0] if row else "draft"

    def transition(self, asset_uns_path: str, target: str, actor: str = "") -> None:
        """Attempt a lifecycle state transition.

        Delegates to ``validate_transition()`` from
        ``shared.asset_agent_transition``; raises ``IllegalTransition`` on
        illegal moves.
        """
        current = self.agent_state(asset_uns_path)
        validate_transition(current, target, actor=actor)  # raises on illegal
        self._conn.execute(
            """
            INSERT INTO asset_agent_status (asset_uns_path, state)
            VALUES (?, ?)
            ON CONFLICT(asset_uns_path) DO UPDATE SET state=excluded.state,
              updated_at=datetime('now')
            """,
            (asset_uns_path, target),
        )
        self._conn.commit()
        logger.info("asset_agent %s: %s → %s (actor=%r)", asset_uns_path, current, target, actor)

    def gate(self, asset_uns_path: str) -> dict:
        """Evaluate the deployment gate for this asset.

        Uses ``gate_decision(state, enforce=True, auto_deploy=False)`` from
        ``shared.asset_agent_transition``.

        Returns a dict with ``allow: bool``, ``reason: str``, and (if refused)
        ``message: str`` (the technician-facing refusal text).
        """
        state = self.agent_state(asset_uns_path)
        decision: GateDecision = gate_decision(state, enforce=True, auto_deploy=False)
        result: dict = {"allow": decision.allow, "reason": decision.reason}
        if not decision.allow:
            result["message"] = GATE_REFUSAL_MESSAGE
        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _row_to_dict_qa(self, row: tuple) -> dict:
        cols = [
            "qa_id",
            "scenario_id",
            "asset_uns_path",
            "question",
            "mira_answer",
            "citations",
            "evidence_tags",
            "groundedness",
            "reviewer_verdict",
            "reviewed_by",
            "created_at",
            "reviewed_at",
        ]
        d = dict(zip(cols, row))
        d["citations"] = json.loads(d["citations"]) if d["citations"] else []
        d["evidence_tags"] = json.loads(d["evidence_tags"]) if d["evidence_tags"] else []
        return d

    def close(self) -> None:
        """Close the SQLite connection."""
        self._conn.close()
