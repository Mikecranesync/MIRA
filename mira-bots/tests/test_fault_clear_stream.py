"""RET-001 — the fault-clear procedure stream.

Why this exists (measured, not assumed — see
`docs/testing/campaign-reports/2026-08-09-reset-sense-option-b-falsified.md`):

"reset" is polysemous in a drive manual. For
`"Rockwell Automation PowerFlex 525 F004 How do I reset it?"` every existing
stream returns the WRONG sense (position reset, F111 safety-hardware reset,
factory defaults) and the actual fault-clear procedure — which IS in the corpus,
public and embedded — never enters the top 10. Measured on staging:

  * vector  — the target rows sit at cosine rank ~119-2200 within PowerFlex 525
              and score BELOW the 0.70 floor. A query that verbatim-quotes the
              chunk only reaches rank 5, so no query rewrite can close the gap.
  * bm25    — OR-fanout `ts_rank_cd` rewards token repetition, so fault-history
              tables outrank the procedure. Scoping to the model does not help.
  * phrase  — the ONLY mechanism that reaches them.

So this is a deterministic, phrase-anchored, model-scoped lookup injected the way
the existing `structured_fault` stream already is. It is ADDITIVE: it adds at most
`_FAULT_CLEAR_LIMIT` rows and never suppresses or reorders anything else.

The load-bearing tests here are the NEGATIVE controls (`TestIntentNegativeControls`).
Every gate in this arc false-positived on first contact with real data; a stream that
fires on "reset to factory defaults" would poison an unrelated answer.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402


def _mock_engine_with_conn(conn: MagicMock) -> MagicMock:
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    return engine


def _patch_create_engine(engine):
    import sqlalchemy

    return patch.object(sqlalchemy, "create_engine", return_value=engine)


def _fc_row(page: int = 164) -> dict:
    """A real PowerFlex 525 fault-clear row, copied from staging."""
    return {
        "content": (
            "Clear fault. • Press Stop if P045 [Stop Mode] is set to a value "
            'between "0" and "3". • Cycle drive power.'
        ),
        "manufacturer": "Rockwell Automation",
        "model_number": "PowerFlex 525",
        "equipment_type": "VFD",
        "source_type": "manual",
        "source_url": None,
        "source_page": page,
        "metadata": {},
        "verified": True,
        "similarity": 0.9,
    }


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------


class TestIntentPositive:
    """Queries that MUST arm the stream."""

    @pytest.mark.parametrize(
        "query",
        [
            # The exact production query from campaign c7 / #3165.
            "Rockwell Automation PowerFlex 525 F004 How do I reset it?",
            "AutomationDirect, GS10 How do I reset it? CE10",
            "how do I clear the fault on the powerflex 525",
            "the drive is faulted, how do I reset it",
            "PowerFlex 525 F004 undervoltage - how do i clear this fault",
            "how do you reset a drive after a trip",
        ],
    )
    def test_arms(self, query):
        assert neon_recall._wants_fault_clear(query) is True


class TestIntentNegativeControls:
    """Queries that MUST NOT arm the stream.

    These are the controls. A fault-clear procedure injected into an answer about
    factory defaults or a position counter is a fabricated-context bug, which is
    exactly the failure class this whole arc is about.
    """

    @pytest.mark.parametrize(
        "query",
        [
            # a DIFFERENT reset object, even with a fault code in context
            "PowerFlex 525 F004 how do I reset it to factory defaults",
            "PowerFlex 525 F004 how do I reset the position counter",
            "how do I reset the rotor position on the PowerFlex 525",
            "PowerFlex 525 how do I reset the elapsed run time meter",
            "how do I reset the password on the keypad",
            "reset the encoder after replacing it, F004 was showing",
            # no reset/clear verb at all
            "what does F004 mean on my PowerFlex 525",
            "PowerFlex 525 F004 undervoltage what causes it",
            # reset verb but no fault context whatsoever
            "how do I reset the drive to start a new batch",
            # empty / junk
            "",
            "thanks",
        ],
    )
    def test_does_not_arm(self, query):
        assert neon_recall._wants_fault_clear(query) is False


# ---------------------------------------------------------------------------
# The stream itself
# ---------------------------------------------------------------------------


class TestFaultClearSearch:
    def test_returns_rows_tagged_with_its_own_stream(self):
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = [_fc_row()]
        rows = neon_recall._fault_clear_search(conn, MagicMock(), None, ["PowerFlex 525"], limit=2)
        assert len(rows) == 1
        assert rows[0]["retrieval_streams"] == ["fault_clear"]
        assert "Cycle drive power" in rows[0]["content"]

    def test_scopes_to_the_resolved_model(self):
        """The model scope is what keeps a PowerFlex 40 chunk out of a 525 answer.

        Asserts the predicate is in the SQL, not merely that the value is in the
        params dict — params are built regardless, so the params-only version of
        this test survived deleting the scope from the query (mutation-checked).
        """
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        neon_recall._fault_clear_search(conn, lambda s: s, None, ["PowerFlex 525"], limit=2)
        sql = conn.execute.call_args[0][0]
        params = conn.execute.call_args[0][1]
        assert "model_number ILIKE :fm0" in sql, f"model scope missing from SQL:\n{sql}"
        assert params["fm0"] == "%PowerFlex 525%"

    def test_orders_by_phrase_specificity_not_alphabetically(self):
        """Rank by how procedural the matched phrase is, not by content text.

        Found live: with an alphabetical ORDER BY, the 2-row budget was spent on
        two near-copies of "1. Press Esc to acknowledge the fault" (it sorts
        first) and the far more useful "Clear fault. • Press Stop if P045 …
        • Cycle drive power" never came back at all.
        """
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        neon_recall._fault_clear_search(conn, lambda s: s, None, ["PowerFlex 525"], limit=3)
        sql = conn.execute.call_args[0][0]
        assert "prio" in sql, "no specificity ranking in the query"
        # the ranking must drive the final ordering, not the content string
        final_order = sql.rsplit("ORDER BY", 1)[1]
        assert "prio" in final_order, f"final ORDER BY is not by specificity: {final_order!r}"

    def test_no_model_means_no_query(self):
        """Unscoped, the phrases match 100+ rows across every vendor. Never run it."""
        conn = MagicMock()
        assert neon_recall._fault_clear_search(conn, MagicMock(), None, [], limit=2) == []
        conn.execute.assert_not_called()

    def test_anonymous_caller_never_sees_private_rows(self):
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        # identity text_fn so the real SQL string reaches conn.execute
        neon_recall._fault_clear_search(conn, lambda s: s, None, ["PowerFlex 525"], limit=2)
        sql = conn.execute.call_args[0][0]
        assert "is_private = false" in sql
        assert "tenant_id = :tid" not in sql

    def test_tenant_caller_gets_hybrid_read(self):
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        neon_recall._fault_clear_search(
            conn, lambda s: s, "11111111-1111-1111-1111-111111111111", ["PowerFlex 525"], limit=2
        )
        sql = conn.execute.call_args[0][0]
        assert "is_private = false OR tenant_id = :tid" in sql


# ---------------------------------------------------------------------------
# Wiring into recall_knowledge
# ---------------------------------------------------------------------------


class TestRecallIntegration:
    def _run(self, query, product_hint=None, fc_rows=None, **env):
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search", return_value=[]),
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
            patch.object(
                neon_recall, "_fault_clear_search", return_value=list(fc_rows or [])
            ) as spy,
            patch.dict(os.environ, env),
        ):
            out = recall_knowledge(
                [0.1] * 4, None, limit=5, query_text=query, product_hint=product_hint
            )
        return out, spy

    def test_procedure_is_injected_at_the_top(self):
        """The whole point: the procedure must reach the prompt, not rank 500."""
        out, spy = self._run(
            "Rockwell Automation PowerFlex 525 F004 How do I reset it?",
            fc_rows=[dict(_fc_row(), retrieval_streams=["fault_clear"])],
        )
        assert spy.called
        assert out, "fault-clear row did not reach the result set"
        assert out[0]["retrieval_streams"] == ["fault_clear"]

    def test_not_called_without_fault_clear_intent(self):
        _, spy = self._run("what does F004 mean on my PowerFlex 525")
        spy.assert_not_called()

    def test_not_called_without_a_resolved_model(self):
        """No model => no scope => the stream must stay off (see test_no_model_means_no_query)."""
        _, spy = self._run("how do I clear the fault")
        spy.assert_not_called()

    def test_product_hint_supplies_the_scope(self):
        """Stranger uploads (#2211) resolve a model via the hint, not the regex."""
        _, spy = self._run("F004 how do I clear the fault", product_hint="IMPULSE G+", fc_rows=[])
        assert spy.called
        assert "IMPULSE G+" in spy.call_args[0][3]

    def test_kill_switch_disables_the_stream(self):
        _, spy = self._run(
            "Rockwell Automation PowerFlex 525 F004 How do I reset it?",
            MIRA_FAULT_CLEAR_STREAM="0",
        )
        spy.assert_not_called()

    def test_stream_failure_degrades_to_todays_behaviour(self):
        """Fail-safe: a broken fault-clear stream must not take the OTHER streams down.

        Asserting `out == []` would be vacuous — recall_knowledge's outer handler
        returns [] on any exception, so that passes with or without the guard.
        The real contract is that the bm25 row still comes back.
        """
        bm25_row = dict(_fc_row(page=999), retrieval_streams=["bm25"], similarity=0.4)
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []
        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search", return_value=[]),
            patch.object(neon_recall, "_recall_bm25", return_value=[bm25_row]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
            patch.object(neon_recall, "_fault_clear_search", side_effect=RuntimeError("boom")),
        ):
            out = recall_knowledge(
                [0.1] * 4,
                None,
                limit=5,
                query_text="Rockwell Automation PowerFlex 525 F004 How do I reset it?",
            )
        assert len(out) == 1, "a broken fault-clear stream swallowed the bm25 results"
        assert out[0]["source_page"] == 999
