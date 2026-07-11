"""Unit tests for mira_bots.shared.proposal_writer (PR #2605)."""

import json
from unittest.mock import MagicMock

import pytest

from mira_bots.shared.proposal_writer import (
    map_function_class_to_risk_level,
    propose_wiring_connection,
)


class TestMapFunctionClassToRiskLevel:
    """Tests for function_class → risk_level mapping."""

    def test_safety_maps_to_safety_critical(self):
        assert map_function_class_to_risk_level("safety") == "safety_critical"
        assert map_function_class_to_risk_level("SAFETY") == "safety_critical"

    def test_power_maps_to_high(self):
        assert map_function_class_to_risk_level("power") == "high"
        assert map_function_class_to_risk_level("POWER") == "high"

    def test_comm_and_ground_map_to_medium(self):
        assert map_function_class_to_risk_level("comm") == "medium"
        assert map_function_class_to_risk_level("ground") == "medium"

    def test_signal_and_unknown_map_to_low(self):
        assert map_function_class_to_risk_level("signal") == "low"
        assert map_function_class_to_risk_level("unknown") == "low"
        assert map_function_class_to_risk_level(None) == "low"
        assert map_function_class_to_risk_level("") == "low"
        assert map_function_class_to_risk_level("invalid") == "low"


class TestProposeWiringConnection:
    """Tests for proposing a wiring_connection as an ai_suggestions row."""

    def test_propose_inserts_ai_suggestions_row(self):
        """Should INSERT into ai_suggestions with wiring-specific extracted_data."""
        # Mock cursor
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            "suggestion-uuid-here",
        )  # Return the inserted id

        # Call the writer
        result = propose_wiring_connection(
            mock_cursor,
            tenant_id="tenant-uuid",
            wiring_connection_id="wiring-uuid",
            source_terminal="X1:3",
            dest_terminal="TB2-14",
            function_class="power",
            drawing_reference="Sheet 12, Line 24",
            proposed_by="llm:schematic_intelligence",
            confidence=0.75,
        )

        # Verify the result
        assert result == "suggestion-uuid-here"

        # Verify the INSERT was called
        mock_cursor.execute.assert_called_once()
        call_args = mock_cursor.execute.call_args
        sql = call_args[0][0]
        params = call_args[0][1]

        # Check SQL contains expected clauses
        assert "INSERT INTO ai_suggestions" in sql
        assert "suggestion_type, extracted_data" in sql
        assert "'pending'" in sql

        # Check parameters: tenant_id, extracted_data, title, body, confidence, risk_level, proposed_by
        assert params[0] == "tenant-uuid"  # tenant_id
        extracted_data = json.loads(params[1])
        assert extracted_data["wiring_connection_id"] == "wiring-uuid"
        assert extracted_data["source_terminal"] == "X1:3"
        assert extracted_data["dest_terminal"] == "TB2-14"
        assert params[2] == "Wiring: X1:3 → TB2-14 [power]"  # title
        assert "Sheet 12, Line 24" in params[3]  # body
        assert params[4] == 0.85  # confidence bumped for power
        assert params[5] == "high"  # risk_level for power
        assert params[6] == "llm:schematic_intelligence"  # proposed_by

    def test_confidence_adjustment_for_safety(self):
        """Safety proposals should have confidence bumped by 0.2."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("suggestion-id",)

        propose_wiring_connection(
            mock_cursor,
            tenant_id="tenant-id",
            wiring_connection_id="wiring-id",
            source_terminal="E1",
            dest_terminal="E2",
            function_class="safety",
            drawing_reference="E-stop circuit",
            proposed_by="llm:test",
            confidence=0.8,  # Start at 0.8
        )

        call_args = mock_cursor.execute.call_args[0][1]
        confidence = call_args[4]
        assert confidence == 1.0  # 0.8 + 0.2, capped at 1.0

    def test_confidence_adjustment_for_unknown(self):
        """Unknown function_class should reduce confidence by 0.1."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("suggestion-id",)

        propose_wiring_connection(
            mock_cursor,
            tenant_id="tenant-id",
            wiring_connection_id="wiring-id",
            source_terminal="?",
            dest_terminal="?",
            function_class="unknown",
            drawing_reference="unknown",
            proposed_by="llm:test",
            confidence=0.7,  # Start at 0.7
        )

        call_args = mock_cursor.execute.call_args[0][1]
        confidence = call_args[4]
        assert confidence == 0.6  # 0.7 - 0.1

    def test_returns_suggestion_id(self):
        """Should return the inserted ai_suggestions.id."""
        mock_cursor = MagicMock()
        expected_id = "expected-suggestion-uuid"
        mock_cursor.fetchone.return_value = (expected_id,)

        result = propose_wiring_connection(
            mock_cursor,
            tenant_id="tenant-id",
            wiring_connection_id="wiring-id",
            source_terminal="S",
            dest_terminal="D",
            function_class="signal",
            drawing_reference="ref",
            proposed_by="llm:test",
        )

        assert result == expected_id

    def test_raises_on_no_result(self):
        """Should raise ValueError if INSERT returns no row."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None  # No result

        with pytest.raises(ValueError, match="Failed to insert ai_suggestions"):
            propose_wiring_connection(
                mock_cursor,
                tenant_id="tenant-id",
                wiring_connection_id="wiring-id",
                source_terminal="S",
                dest_terminal="D",
                function_class="signal",
                drawing_reference="ref",
                proposed_by="llm:test",
            )
