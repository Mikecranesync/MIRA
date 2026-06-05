"""Tests for the create-path proposer (issue #1662, ADR-0017).

Invariant under test: an ingest-derived edge lands as a *proposal*
(`relationship_proposals` + `ai_suggestions(kg_edge)`), never as a
verified `kg_relationships` row. Verification happens only on admin
approval in the Hub.

These are pure-Python unit tests — no DB. A `FakeConn` records the SQL
each call would execute and returns programmable `.first()` results, so we
can assert *which tables get written* without a live NeonDB.
"""

from __future__ import annotations

import json

from ingest.proposal_writer import (
    canonical_relation_type,
    propose_relationship,
    propose_relationship_cursor,
)

PROPOSAL_ID = "11111111-1111-1111-1111-111111111111"


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeConn:
    """Records executed SQL + params; answers the queries propose_relationship
    issues. Configure `existing_proposal_id` / `already_verified` to exercise
    the idempotency branches."""

    def __init__(self, existing_proposal_id=None, already_verified=False):
        self.existing_proposal_id = existing_proposal_id
        self.already_verified = already_verified
        self.executed: list[tuple[str, dict]] = []

    def execute(self, clause, params=None):
        sql = str(clause)
        self.executed.append((sql, params or {}))
        if "FROM kg_entities" in sql:
            return _FakeResult(("equipment",))
        if "FROM relationship_proposals" in sql and "SELECT id" in sql:
            return _FakeResult(
                (self.existing_proposal_id,) if self.existing_proposal_id else None
            )
        if "FROM kg_relationships" in sql:
            return _FakeResult((1,) if self.already_verified else None)
        if "INSERT INTO relationship_proposals" in sql:
            return _FakeResult((PROPOSAL_ID,))
        return _FakeResult(None)

    # convenience accessors -------------------------------------------------
    def sql_blob(self) -> str:
        return "\n".join(sql for sql, _ in self.executed)

    def params_for(self, needle: str) -> dict:
        for sql, params in self.executed:
            if needle in sql:
                return params
        raise AssertionError(f"no executed statement matched {needle!r}")


TENANT = "22222222-2222-2222-2222-222222222222"
SRC = "33333333-3333-3333-3333-333333333333"
TGT = "44444444-4444-4444-4444-444444444444"
CHUNK = "55555555-5555-5555-5555-555555555555"


class TestCanonicalMapping:
    def test_known_types_map_to_canonical(self):
        assert canonical_relation_type("has_manual") == "HAS_DOCUMENT"
        assert canonical_relation_type("documented_in") == "HAS_DOCUMENT"
        assert canonical_relation_type("has_fault") == "HAS_FAILURE_MODE"
        assert canonical_relation_type("has_fault_code") == "HAS_FAILURE_MODE"

    def test_case_insensitive(self):
        assert canonical_relation_type("HAS_MANUAL") == "HAS_DOCUMENT"

    def test_unknown_type_returns_none(self):
        assert canonical_relation_type("frobnicate") is None
        assert canonical_relation_type("") is None


class TestProposeRelationship:
    def test_writes_proposal_and_suggestion_not_kg_relationships(self):
        """The core acceptance: fresh ingest edge → relationship_proposals,
        NOT kg_relationships."""
        c = _FakeConn()
        rid = propose_relationship(
            c,
            tenant_id=TENANT,
            source_entity=SRC,
            target_entity=TGT,
            relation_type="has_manual",
            confidence=0.95,
            source_chunk_id=CHUNK,
        )
        assert rid == PROPOSAL_ID
        blob = c.sql_blob()
        assert "INSERT INTO relationship_proposals" in blob
        assert "INSERT INTO ai_suggestions" in blob
        assert "INSERT INTO relationship_evidence" in blob
        # The invariant: nothing is written to kg_relationships here.
        assert "INSERT INTO kg_relationships" not in blob

    def test_sets_rls_tenant_context(self):
        """RLS-enforced tables (relationship_proposals / ai_suggestions) need
        app.current_tenant_id set on the transaction, or inserts get filtered
        under the factorylm_app role."""
        c = _FakeConn()
        propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95, source_chunk_id=CHUNK,
        )
        sc_params = c.params_for("set_config('app.current_tenant_id'")
        assert sc_params["tid"] == TENANT

    def test_proposal_uses_canonical_type(self):
        c = _FakeConn()
        propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_fault", confidence=0.85, source_chunk_id=CHUNK,
        )
        prop_params = c.params_for("INSERT INTO relationship_proposals")
        assert prop_params["rel"] == "HAS_FAILURE_MODE"

    def test_ai_suggestion_bridges_proposal_id(self):
        c = _FakeConn()
        propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95, source_chunk_id=CHUNK,
        )
        sug_params = c.params_for("INSERT INTO ai_suggestions")
        extracted = json.loads(sug_params["extracted"])
        assert extracted["relationship_proposal_id"] == PROPOSAL_ID
        assert extracted["relationship_type"] == "HAS_DOCUMENT"
        assert extracted["original_relation_type"] == "has_manual"

    def test_unmapped_type_is_not_proposed(self):
        c = _FakeConn()
        rid = propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="frobnicate",
        )
        assert rid is None
        assert "INSERT INTO relationship_proposals" not in c.sql_blob()

    def test_self_edge_skipped(self):
        c = _FakeConn()
        rid = propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=SRC,
            relation_type="has_manual",
        )
        assert rid is None
        assert c.executed == []

    def test_idempotent_when_open_proposal_exists(self):
        c = _FakeConn(existing_proposal_id=PROPOSAL_ID)
        rid = propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95, source_chunk_id=CHUNK,
        )
        assert rid == PROPOSAL_ID
        assert "INSERT INTO relationship_proposals" not in c.sql_blob()

    def test_skips_when_edge_already_verified(self):
        c = _FakeConn(already_verified=True)
        rid = propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95, source_chunk_id=CHUNK,
        )
        assert rid is None
        assert "INSERT INTO relationship_proposals" not in c.sql_blob()

    def test_evidence_skipped_without_source_chunk(self):
        c = _FakeConn()
        propose_relationship(
            c, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95,
        )
        assert "INSERT INTO relationship_evidence" not in c.sql_blob()
        # proposal + suggestion still written
        assert "INSERT INTO relationship_proposals" in c.sql_blob()


class TestAutoVerifyFlag:
    """The MIRA_KG_INGEST_AUTOVERIFY flag (issue #1662): proposals by default,
    legacy auto-verify only on deliberate opt-in."""

    def test_flag_defaults_off(self, monkeypatch):
        from ingest import kg_writer

        monkeypatch.delenv("MIRA_KG_INGEST_AUTOVERIFY", raising=False)
        assert kg_writer._autoverify_enabled() is False

    def test_flag_truthy_values_enable(self, monkeypatch):
        from ingest import kg_writer

        for val in ("1", "true", "YES", "On"):
            monkeypatch.setenv("MIRA_KG_INGEST_AUTOVERIFY", val)
            assert kg_writer._autoverify_enabled() is True

    def test_flag_falsey_values_stay_off(self, monkeypatch):
        from ingest import kg_writer

        for val in ("", "0", "false", "no"):
            monkeypatch.setenv("MIRA_KG_INGEST_AUTOVERIFY", val)
            assert kg_writer._autoverify_enabled() is False

    def test_default_path_proposes_not_verifies(self, monkeypatch):
        """With the flag unset, upsert_relationship routes to the proposer and
        never inserts kg_relationships."""
        from ingest import kg_writer

        monkeypatch.delenv("MIRA_KG_INGEST_AUTOVERIFY", raising=False)
        c = _FakeConn()
        monkeypatch.setattr(kg_writer, "_get_conn", _passthrough_conn(c))
        kg_writer.upsert_relationship(
            tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=0.95, source_chunk_id=CHUNK,
        )
        assert "INSERT INTO relationship_proposals" in c.sql_blob()
        assert "INSERT INTO kg_relationships" not in c.sql_blob()

    def test_optin_path_auto_verifies(self, monkeypatch):
        """With the flag set, the legacy path writes kg_relationships directly."""
        from ingest import kg_writer

        monkeypatch.setenv("MIRA_KG_INGEST_AUTOVERIFY", "1")
        c = _FakeConn()
        monkeypatch.setattr(kg_writer, "_get_conn", _passthrough_conn(c))
        kg_writer.upsert_relationship(
            tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_manual", confidence=1.0, source_chunk_id=CHUNK,
        )
        assert "INSERT INTO kg_relationships" in c.sql_blob()
        assert "INSERT INTO relationship_proposals" not in c.sql_blob()


class _FakeCursor:
    """psycopg2-cursor analogue of _FakeConn: records executed SQL + params,
    answers the queries propose_relationship_cursor issues via fetchone()."""

    def __init__(self, existing_proposal_id=None, already_verified=False):
        self.existing_proposal_id = existing_proposal_id
        self.already_verified = already_verified
        self.executed: list[tuple[str, tuple]] = []
        self._pending = None

    def execute(self, sql, params=None):
        self.executed.append((sql, tuple(params or ())))
        if "FROM kg_entities" in sql:
            self._pending = ("equipment",)
        elif "FROM relationship_proposals" in sql and "SELECT id" in sql:
            self._pending = (
                (self.existing_proposal_id,) if self.existing_proposal_id else None
            )
        elif "FROM kg_relationships" in sql:
            self._pending = (1,) if self.already_verified else None
        elif "INSERT INTO relationship_proposals" in sql:
            self._pending = (PROPOSAL_ID,)
        else:
            self._pending = None

    def fetchone(self):
        return self._pending

    def sql_blob(self) -> str:
        return "\n".join(sql for sql, _ in self.executed)

    def params_for(self, needle: str) -> tuple:
        for sql, params in self.executed:
            if needle in sql:
                return params
        raise AssertionError(f"no executed statement matched {needle!r}")


class TestProposeRelationshipCursor:
    """The psycopg2-cursor variant (Path B / full_ingest_pipeline) holds the
    same invariants as the SQLAlchemy variant."""

    def test_proposes_not_verifies(self):
        cur = _FakeCursor()
        rid = propose_relationship_cursor(
            cur, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="documented_in", confidence=1.0, source_chunk_id=CHUNK,
        )
        assert rid == PROPOSAL_ID
        blob = cur.sql_blob()
        assert "INSERT INTO relationship_proposals" in blob
        assert "INSERT INTO ai_suggestions" in blob
        assert "INSERT INTO relationship_evidence" in blob
        assert "INSERT INTO kg_relationships" not in blob

    def test_canonical_type(self):
        cur = _FakeCursor()
        propose_relationship_cursor(
            cur, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="has_fault_code", confidence=1.0, source_chunk_id=CHUNK,
        )
        prop_params = cur.params_for("INSERT INTO relationship_proposals")
        # order: (tenant, source, src_type, target, tgt_type, canonical, ...)
        assert prop_params[5] == "HAS_FAILURE_MODE"

    def test_unmapped_skipped(self):
        cur = _FakeCursor()
        rid = propose_relationship_cursor(
            cur, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="frobnicate",
        )
        assert rid is None
        assert "INSERT INTO relationship_proposals" not in cur.sql_blob()

    def test_idempotent_existing(self):
        cur = _FakeCursor(existing_proposal_id=PROPOSAL_ID)
        rid = propose_relationship_cursor(
            cur, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="documented_in", confidence=1.0,
        )
        assert rid == PROPOSAL_ID
        assert "INSERT INTO relationship_proposals" not in cur.sql_blob()

    def test_skips_already_verified(self):
        cur = _FakeCursor(already_verified=True)
        rid = propose_relationship_cursor(
            cur, tenant_id=TENANT, source_entity=SRC, target_entity=TGT,
            relation_type="documented_in", confidence=1.0,
        )
        assert rid is None
        assert "INSERT INTO relationship_proposals" not in cur.sql_blob()


def _passthrough_conn(fake):
    """Build a contextmanager that yields the given FakeConn, matching
    kg_writer._get_conn's signature (conn=None)."""
    from contextlib import contextmanager

    @contextmanager
    def _cm(*_args, **_kwargs):
        yield fake

    return _cm
