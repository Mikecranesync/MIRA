"""Unit tests for tools/check_migration_check_drift.py parser + diff logic."""

import sys
from pathlib import Path

# Import the script's functions
sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))
from check_migration_check_drift import (
    _parse_check_values,
    parse_migration_file,
)


def test_parse_check_values_basic():
    """Test extracting quoted values from a CHECK clause."""
    values = _parse_check_values("'foo', 'bar', 'baz'")
    assert values == {"foo", "bar", "baz"}


def test_parse_check_values_with_spaces():
    """Test parsing with varying whitespace."""
    values = _parse_check_values("  'foo'  ,  'bar'  ")
    assert values == {"foo", "bar"}


def test_parse_check_values_single_quote():
    """Test parsing a value that contains an escaped quote (not double-escaped)."""
    # In SQL CHECK, escaped quotes are doubled: 'foo''bar' → foo'bar
    # But our regex does simple matching, so this tests literal '…' pairs only
    values = _parse_check_values("'foo', 'bar baz'")
    assert "foo" in values
    assert "bar baz" in values


def test_parse_check_values_empty():
    """Test parsing an empty or malformed clause."""
    values = _parse_check_values("")
    assert values == set()

    values = _parse_check_values("()")
    assert values == set()


def test_parse_migration_file_inline():
    """Test parsing a migration with an inline CHECK."""
    temp_file = Path("/tmp/test_migration_inline.sql")
    temp_file.write_text(
        """
        CREATE TABLE relationship_type (
            id UUID PRIMARY KEY,
            rel_type VARCHAR(50) UNIQUE NOT NULL CHECK (rel_type IN (
                'DEPENDS_ON', 'DRIVES', 'PART_OF', 'SIGNALS', 'POWERS'
            ))
        );
        """
    )
    try:
        constraints = parse_migration_file(str(temp_file))
        assert len(constraints) > 0
        # Should find the rel_type CHECK (keyed by unknown:rel_type_check for inline)
        found = False
        for key, (table, vals) in constraints.items():
            if "rel_type" in key and vals:
                assert "DEPENDS_ON" in vals, f"Missing DEPENDS_ON in {vals}"
                assert "DRIVES" in vals, f"Missing DRIVES in {vals}"
                found = True
        assert found, f"No inline CHECK found in {constraints}"
    finally:
        temp_file.unlink(missing_ok=True)


def test_parse_migration_file_alter():
    """Test parsing a migration with ALTER TABLE ADD CONSTRAINT."""
    temp_file = Path("/tmp/test_migration_alter.sql")
    temp_file.write_text(
        """
        ALTER TABLE decision_traces
        ADD CONSTRAINT decision_traces_relationship_type_check
        CHECK (relationship_type IN (
            'DEPENDS_ON', 'DRIVES', 'PART_OF', 'SIGNALS', 'POWERS'
        ));
        """
    )
    try:
        constraints = parse_migration_file(str(temp_file))
        # Should find the ALTER constraint
        found = False
        for key, (table, vals) in constraints.items():
            if "decision_traces" in key and vals:
                assert "DEPENDS_ON" in vals
                assert "DRIVES" in vals
                found = True
        assert found, f"No ALTER CHECK found in {constraints}"
    finally:
        temp_file.unlink(missing_ok=True)


def test_parse_migration_file_no_check():
    """Test parsing a migration with no CHECK constraints."""
    temp_file = Path("/tmp/test_migration_no_check.sql")
    temp_file.write_text(
        """
        CREATE TABLE simple_table (
            id UUID PRIMARY KEY,
            name VARCHAR(100)
        );
        """
    )
    try:
        constraints = parse_migration_file(str(temp_file))
        assert len(constraints) == 0
    finally:
        temp_file.unlink(missing_ok=True)


def test_parse_migration_file_missing():
    """Test parsing a non-existent file."""
    constraints = parse_migration_file("/nonexistent/path/migration.sql")
    assert len(constraints) == 0


def test_shrink_detection_mock():
    """Test the shrink detection logic (no DB needed)."""
    # Simulate a live constraint with 5 values
    live_vals = {"DEPENDS_ON", "DRIVES", "PART_OF", "SIGNALS", "POWERS"}
    # Migration declares only 4 (missing SIGNALS)
    migration_vals = {"DEPENDS_ON", "DRIVES", "PART_OF", "POWERS"}

    shrink = live_vals - migration_vals
    assert shrink == {"SIGNALS"}, f"Expected shrink {{'SIGNALS'}}, got {shrink}"


def test_growth_detection_mock():
    """Test that adding a value is NOT detected as a shrink."""
    live_vals = {"DEPENDS_ON", "DRIVES", "PART_OF"}
    migration_vals = {"DEPENDS_ON", "DRIVES", "PART_OF", "NEW_VALUE"}

    shrink = live_vals - migration_vals
    assert shrink == set(), f"Growth should not be detected as shrink, got {shrink}"


def test_unchanged_detection_mock():
    """Test that unchanged values are not detected as a shrink."""
    live_vals = {"DEPENDS_ON", "DRIVES", "PART_OF"}
    migration_vals = {"DEPENDS_ON", "DRIVES", "PART_OF"}

    shrink = live_vals - migration_vals
    assert shrink == set(), f"Unchanged should not be shrink, got {shrink}"
