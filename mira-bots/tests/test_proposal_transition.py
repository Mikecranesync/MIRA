"""Tests for mira_bots.shared.proposal_transition.

All tests use a mock DB (unittest.mock) — no live Postgres needed.

The critical invariant this suite checks:
  - propose_relationship: writes relationship_proposals + relationship_evidence
    + ai_suggestions(kg_edge).  Zero kg_relationships rows.
  - review_proposal (approve): writes kg_relationships with approval_state='verified'
    + sets relationship_proposal_id FK.
  - review_proposal (reject): writes NO kg_relationships row.
  - Illegal pre-state: raises ValueError.
  - Unknown rel_type: propose_relationship returns None without touching DB.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers — fake DB row / cursor
# ---------------------------------------------------------------------------


class FakeResult:
    """Minimal SQLAlchemy Result mock."""

    def __init__(self, row=None):
        self._row = row

    def first(self):
        return self._row


class FakeConn:
    """Records every execute() call and returns pre-programmed results."""

    def __init__(self):
        self.executed: list[dict[str, Any]] = []
        self._results: dict[str, FakeResult] = {}
        self.committed = False
        self.rolled_back = False

    def queue_result(self, sql_fragment: str, result: FakeResult) -> None:
        """Pre-program a result for a SQL call that contains sql_fragment."""
        self._results[sql_fragment] = result

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.executed.append({"sql": sql, "params": params or {}})
        # Match by fragment.
        for fragment, result in self._results.items():
            if fragment in sql:
                return result
        return FakeResult(None)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


@contextmanager
def _fake_conn_ctx(conn):
    """Context manager that just yields the pre-built FakeConn."""
    yield conn


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TENANT = str(uuid.uuid4())
SRC_ID = str(uuid.uuid4())
TGT_ID = str(uuid.uuid4())
PROP_ID = str(uuid.uuid4())


@pytest.fixture
def fresh_conn():
    return FakeConn()


# ---------------------------------------------------------------------------
# propose_relationship tests
# ---------------------------------------------------------------------------


class TestProposeRelationship:
    def _call(self, conn, rel_type="HAS_DOCUMENT", src=SRC_ID, tgt=TGT_ID, tenant=TENANT, **kw):
        from shared.proposal_transition import propose_relationship

        with patch("shared.proposal_transition._get_conn", side_effect=lambda c=None: _fake_conn_ctx(c or conn)):
            return propose_relationship(
                source_id=src,
                target_id=tgt,
                rel_type=rel_type,
                evidence=[],
                tenant_id=tenant,
                conn=conn,
                **kw,
            )

    def test_creates_proposal_and_suggestion_no_kg_relationships(self, fresh_conn):
        """Core invariant: propose writes proposals + suggestions, NOT kg_relationships."""
        # No pre-existing proposal or entity rows.
        result = self._call(fresh_conn)

        assert result is not None
        sqls = [e["sql"] for e in fresh_conn.executed]

        # Must touch relationship_proposals (INSERT)
        assert any("INSERT INTO relationship_proposals" in s for s in sqls), (
            "Expected INSERT INTO relationship_proposals"
        )
        # Must touch ai_suggestions (INSERT)
        assert any("INSERT INTO ai_suggestions" in s for s in sqls), (
            "Expected INSERT INTO ai_suggestions"
        )
        # Must NOT touch kg_relationships
        assert not any("kg_relationships" in s for s in sqls), (
            "upsert_relationship must NOT write to kg_relationships directly"
        )

    def test_dedup_returns_existing_proposal_id(self, fresh_conn):
        """Returns existing proposal_id without creating a duplicate row."""
        existing_id = str(uuid.uuid4())
        # Queue a pre-existing row on the SELECT de-dup query.
        fresh_conn.queue_result("relationship_proposals", FakeResult((existing_id,)))

        result = self._call(fresh_conn)
        assert result == existing_id

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert not any("INSERT INTO relationship_proposals" in s for s in sqls), (
            "Should not INSERT when proposal already exists"
        )

    def test_unknown_rel_type_returns_none_without_db_call(self):
        """An unknown rel_type is rejected in Python before touching DB."""
        conn = FakeConn()
        result = self._call(conn, rel_type="not_in_vocab")

        assert result is None
        assert fresh_conn_executed_nothing(conn)

    def test_self_edge_returns_none(self):
        """Source == target must be silently rejected."""
        conn = FakeConn()
        result = self._call(conn, src=SRC_ID, tgt=SRC_ID)

        assert result is None
        assert fresh_conn_executed_nothing(conn)

    def test_evidence_rows_written(self, fresh_conn):
        """Evidence list is translated to relationship_evidence rows."""
        evidence = [
            {
                "evidence_type": "document_page",
                "source_description": "page 12",
                "page_or_location": "12",
                "excerpt": "The motor is connected to CV-101",
                "confidence_contribution": 0.8,
            }
        ]
        from shared.proposal_transition import propose_relationship

        with patch(
            "shared.proposal_transition._get_conn",
            side_effect=lambda c=None: _fake_conn_ctx(c or fresh_conn),
        ):
            propose_relationship(
                source_id=SRC_ID,
                target_id=TGT_ID,
                rel_type="WIRED_TO",
                evidence=evidence,
                tenant_id=TENANT,
                conn=fresh_conn,
            )

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert any("INSERT INTO relationship_evidence" in s for s in sqls), (
            "Expected INSERT INTO relationship_evidence"
        )

    def test_vocab_guard_covers_all_migration_028_types(self):
        """RELATIONSHIP_TYPE_VOCAB must include DRIVES and IS_DRIVEN_BY (migration 028)."""
        from shared.proposal_transition import RELATIONSHIP_TYPE_VOCAB

        assert "DRIVES" in RELATIONSHIP_TYPE_VOCAB
        assert "IS_DRIVEN_BY" in RELATIONSHIP_TYPE_VOCAB


# ---------------------------------------------------------------------------
# review_proposal tests
# ---------------------------------------------------------------------------


def _make_proposal_row(status="proposed"):
    """Fake relationship_proposals row (tuple matching column order in SELECT)."""
    return (
        PROP_ID,          # id
        TENANT,           # tenant_id
        SRC_ID,           # source_entity_id
        "equipment",      # source_entity_type
        TGT_ID,           # target_entity_id
        "fault_code",     # target_entity_type
        "HAS_FAILURE_MODE",  # relationship_type
        0.75,             # confidence
        status,           # status
        "llm",            # created_by
        "motor fault detected on page 5",  # reasoning
    )


class TestReviewProposal:
    def _call(self, conn, decision="approve", proposal_row=None, existing_kg_row=None, **kw):
        from shared.proposal_transition import review_proposal

        if proposal_row is None:
            proposal_row = _make_proposal_row()

        conn.queue_result(
            "FROM relationship_proposals",
            FakeResult(proposal_row),
        )
        if existing_kg_row is not None:
            conn.queue_result("FROM kg_relationships", FakeResult(existing_kg_row))

        with patch(
            "shared.proposal_transition._get_conn",
            side_effect=lambda c=None: _fake_conn_ctx(c or conn),
        ):
            return review_proposal(
                proposal_id=PROP_ID,
                decision=decision,
                tenant_id=TENANT,
                reviewed_by="human:test_user",
                conn=conn,
                **kw,
            )

    def test_approve_inserts_verified_kg_relationships(self, fresh_conn):
        """Approve creates a verified kg_relationships row."""
        result = self._call(fresh_conn, decision="approve")

        assert result is not None
        assert result["decision"] == "approve"
        assert result["proposal_status"] == "verified"
        assert result["kg_relationship_id"] is not None

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert any("INSERT INTO kg_relationships" in s for s in sqls), (
            "Approve must INSERT INTO kg_relationships"
        )
        # Verify approval_state='verified' is in the INSERT params.
        kg_insert = next(
            e for e in fresh_conn.executed if "INSERT INTO kg_relationships" in e["sql"]
        )
        assert "'verified'" in kg_insert["sql"] or any(
            "verified" in str(v) for v in kg_insert["params"].values()
        )

    def test_approve_sets_relationship_proposal_id_fk(self, fresh_conn):
        """Approve must set relationship_proposal_id on the kg_relationships row."""
        self._call(fresh_conn, decision="approve")

        kg_insert = next(
            (e for e in fresh_conn.executed if "INSERT INTO kg_relationships" in e["sql"]),
            None,
        )
        assert kg_insert is not None
        assert "relationship_proposal_id" in kg_insert["sql"]

    def test_approve_updates_ai_suggestions(self, fresh_conn):
        """Approve syncs the ai_suggestions bridge row to 'accepted'."""
        self._call(fresh_conn, decision="approve")

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert any("UPDATE ai_suggestions" in s for s in sqls), (
            "Approve must update ai_suggestions"
        )
        ai_update = next(e for e in fresh_conn.executed if "UPDATE ai_suggestions" in e["sql"])
        assert "'accepted'" in ai_update["sql"] or any(
            "accepted" in str(v) for v in ai_update["params"].values()
        )

    def test_reject_creates_no_kg_relationships(self, fresh_conn):
        """Reject must NOT write to kg_relationships."""
        result = self._call(fresh_conn, decision="reject")

        assert result is not None
        assert result["decision"] == "reject"
        assert result["proposal_status"] == "rejected"
        assert result["kg_relationship_id"] is None

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert not any("kg_relationships" in s for s in sqls), (
            "Reject must NOT touch kg_relationships"
        )

    def test_reject_updates_ai_suggestions_to_rejected(self, fresh_conn):
        """Reject syncs the ai_suggestions bridge row to 'rejected'."""
        self._call(fresh_conn, decision="reject")

        ai_update = next(
            (e for e in fresh_conn.executed if "UPDATE ai_suggestions" in e["sql"]),
            None,
        )
        assert ai_update is not None
        assert "'rejected'" in ai_update["sql"] or any(
            "rejected" in str(v) for v in ai_update["params"].values()
        )

    def test_illegal_pre_state_raises_value_error(self, fresh_conn):
        """A proposal in 'verified' state cannot be decided again."""
        verified_row = _make_proposal_row(status="verified")
        with pytest.raises(ValueError, match="Illegal transition"):
            self._call(fresh_conn, decision="approve", proposal_row=verified_row)

    def test_illegal_pre_state_deprecated(self, fresh_conn):
        """A 'deprecated' proposal cannot be decided."""
        deprecated_row = _make_proposal_row(status="deprecated")
        with pytest.raises(ValueError, match="Illegal transition"):
            self._call(fresh_conn, decision="approve", proposal_row=deprecated_row)

    def test_unknown_decision_raises_value_error(self, fresh_conn):
        """An unknown decision string raises ValueError before touching DB."""
        with pytest.raises(ValueError, match="decision must be"):
            from shared.proposal_transition import review_proposal

            review_proposal(
                proposal_id=PROP_ID,
                decision="maybe",
                tenant_id=TENANT,
                reviewed_by="human:test",
            )

    def test_approve_updates_existing_kg_relationship(self, fresh_conn):
        """When a kg_relationships row already exists, UPDATE rather than INSERT."""
        existing_kg_id = str(uuid.uuid4())
        existing_row = (existing_kg_id,)
        result = self._call(fresh_conn, decision="approve", existing_kg_row=existing_row)

        assert result["kg_relationship_id"] == existing_kg_id

        sqls = [e["sql"] for e in fresh_conn.executed]
        assert any("UPDATE kg_relationships" in s for s in sqls), (
            "Should UPDATE existing kg_relationships row"
        )
        assert not any("INSERT INTO kg_relationships" in s for s in sqls), (
            "Should NOT INSERT when row already exists"
        )


# ---------------------------------------------------------------------------
# RELATIONSHIP_TYPE_VOCAB consistency test
# ---------------------------------------------------------------------------


class TestVocab:
    def test_vocab_is_frozenset(self):
        from shared.proposal_transition import RELATIONSHIP_TYPE_VOCAB

        assert isinstance(RELATIONSHIP_TYPE_VOCAB, frozenset)

    def test_vocab_matches_migration_018_and_028(self):
        """Spot-check key values from both migrations are present."""
        from shared.proposal_transition import RELATIONSHIP_TYPE_VOCAB

        # From migration 018
        for t in ["HAS_COMPONENT", "HAS_DOCUMENT", "WIRED_TO", "HAS_FAILURE_MODE"]:
            assert t in RELATIONSHIP_TYPE_VOCAB, f"{t} missing from RELATIONSHIP_TYPE_VOCAB"
        # From migration 028 (DRIVES / IS_DRIVEN_BY)
        assert "DRIVES" in RELATIONSHIP_TYPE_VOCAB
        assert "IS_DRIVEN_BY" in RELATIONSHIP_TYPE_VOCAB

    def test_lowercase_not_in_vocab(self):
        """Legacy lowercase values must NOT be in the controlled vocab."""
        from shared.proposal_transition import RELATIONSHIP_TYPE_VOCAB

        assert "has_manual" not in RELATIONSHIP_TYPE_VOCAB
        assert "has_fault" not in RELATIONSHIP_TYPE_VOCAB


# ---------------------------------------------------------------------------
# kg_writer rel_type map tests
#
# We can't import kg_writer directly (it uses relative imports from .uns
# and .store that require the full mira-crawler package).  Instead we read
# the _REL_TYPE_MAP constant directly from the source text — this is a
# pure-contract test: the map value must be present and correct.
# ---------------------------------------------------------------------------


def _read_rel_type_map() -> dict:
    """Parse _REL_TYPE_MAP from kg_writer.py source text without executing it."""
    import ast
    import os

    src_path = os.path.join(
        os.path.dirname(__file__),
        "../../mira-crawler/ingest/kg_writer.py",
    )
    with open(src_path) as f:
        source = f.read()

    tree = ast.parse(source)
    for node in ast.walk(tree):
        # Handle plain assignment:  _REL_TYPE_MAP = {...}
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "_REL_TYPE_MAP":
                    return ast.literal_eval(node.value)
        # Handle annotated assignment:  _REL_TYPE_MAP: dict[str, str] = {...}
        if isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == "_REL_TYPE_MAP":
                if node.value is not None:
                    return ast.literal_eval(node.value)
    raise RuntimeError("_REL_TYPE_MAP not found in kg_writer.py")


class TestKgWriterRelTypeMap:
    def test_has_manual_maps_to_has_document(self):
        m = _read_rel_type_map()
        assert m.get("has_manual") == "HAS_DOCUMENT"

    def test_has_fault_maps_to_has_failure_mode(self):
        m = _read_rel_type_map()
        assert m.get("has_fault") == "HAS_FAILURE_MODE"


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def fresh_conn_executed_nothing(conn: FakeConn) -> bool:
    return len(conn.executed) == 0
