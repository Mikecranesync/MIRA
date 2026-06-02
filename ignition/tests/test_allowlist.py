#!/usr/bin/env python
"""
Unit tests for the MIRA tag allowlist pure functions.

Runnable without a Jython/Ignition runtime:
  python ignition/tests/test_allowlist.py

Also pytest-compatible (no pytest dependency required for plain run).

Imports allowlist.py from the sibling webdev directory — no system.* calls needed.
"""
import os
import sys

# Make allowlist.py importable from the webdev tags directory
_here = os.path.dirname(os.path.abspath(__file__))
_allowlist_dir = os.path.join(
    _here, "..", "webdev", "FactoryLM", "api", "tags"
)
sys.path.insert(0, os.path.normpath(_allowlist_dir))

# Also locate approved_tags.json (relative to this test file)
_project_dir = os.path.join(_here, "..", "project")
APPROVED_TAGS_JSON = os.path.normpath(os.path.join(_project_dir, "approved_tags.json"))

import allowlist  # noqa: E402 — must be after sys.path insert


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_set():
    return allowlist.load_approved_set(APPROVED_TAGS_JSON)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_approved_tags_json_loads():
    """approved_tags.json must be parseable and non-empty."""
    approved = load_set()
    assert len(approved) > 0, "approved_tags.json produced an empty allowlist"
    print("PASS test_approved_tags_json_loads — %d tags loaded" % len(approved))


def test_allowlisted_tag_passes():
    """A known bench tag must be in the approved set."""
    approved = load_set()
    known_good = "[default]Mira_Monitored/Conveyor/MotorRunning"
    assert allowlist.is_allowlisted(known_good, approved), (
        "Expected '%s' to be allowlisted" % known_good
    )
    print("PASS test_allowlisted_tag_passes — '%s' correctly approved" % known_good)


def test_non_allowlisted_tag_blocked():
    """Tags in _non_allowlisted_examples must NOT be in the approved set."""
    approved = load_set()
    # These are listed in _non_allowlisted_examples in the JSON (writable control tags)
    blocked_examples = [
        "[default]Mira_Monitored/Conveyor/ConveyorSpeedCmd",
        "[default]Mira_Monitored/Conveyor/VfdCmdWord",
        "[default]Mira_Monitored/Conveyor/VfdFreqSetpoint",
    ]
    for path in blocked_examples:
        assert not allowlist.is_allowlisted(path, approved), (
            "Expected '%s' to be blocked but it is in the allowlist" % path
        )
    print(
        "PASS test_non_allowlisted_tag_blocked — %d control/write tags correctly absent"
        % len(blocked_examples)
    )


def test_arbitrary_path_blocked():
    """A completely unknown path must be blocked."""
    approved = load_set()
    unknown = "[default]Mira_Monitored/SomethingElse/UnknownTag"
    assert not allowlist.is_allowlisted(unknown, approved), (
        "Expected '%s' to be blocked" % unknown
    )
    print("PASS test_arbitrary_path_blocked — unknown path correctly absent")


def test_filter_to_allowlist_keeps_approved():
    """filter_to_allowlist keeps only approved leaf tags."""
    approved = load_set()
    tag_list = [
        {"path": "[default]Mira_Monitored/Conveyor/MotorRunning", "is_folder": False},
        {"path": "[default]Mira_Monitored/Conveyor/FaultAlarm",   "is_folder": False},
        {"path": "[default]Mira_Monitored/Conveyor/VfdCmdWord",   "is_folder": False},  # blocked
        {"path": "[default]Mira_Monitored/Conveyor/UnknownTag",   "is_folder": False},  # blocked
    ]
    result = allowlist.filter_to_allowlist(tag_list, approved)
    result_paths = [t["path"] for t in result]
    assert "[default]Mira_Monitored/Conveyor/MotorRunning" in result_paths
    assert "[default]Mira_Monitored/Conveyor/FaultAlarm" in result_paths
    assert "[default]Mira_Monitored/Conveyor/VfdCmdWord" not in result_paths
    assert "[default]Mira_Monitored/Conveyor/UnknownTag" not in result_paths
    assert len(result) == 2
    print(
        "PASS test_filter_to_allowlist_keeps_approved — "
        "2 approved kept, 2 non-approved dropped"
    )


def test_filter_empty_list():
    """filter_to_allowlist on an empty list returns empty list."""
    approved = load_set()
    result = allowlist.filter_to_allowlist([], approved)
    assert result == []
    print("PASS test_filter_empty_list")


def test_is_allowlisted_case_sensitive():
    """Allowlist matching is case-sensitive (Ignition paths are case-sensitive)."""
    approved = load_set()
    # Lowercase version of a real path must NOT match
    lower_path = "[default]mira_monitored/conveyor/motorrunning"
    assert not allowlist.is_allowlisted(lower_path, approved), (
        "Case-insensitive match would be a security regression"
    )
    print("PASS test_is_allowlisted_case_sensitive")


def test_approved_tags_schema():
    """Every entry in approved_tags.json must have tag_path, uns_path, data_type."""
    import json
    with open(APPROVED_TAGS_JSON, "r") as fh:
        data = json.load(fh)
    for i, entry in enumerate(data.get("tags", [])):
        assert "tag_path" in entry, "Entry %d missing tag_path" % i
        assert "uns_path" in entry, "Entry %d missing uns_path" % i
        assert "data_type" in entry, "Entry %d missing data_type" % i
        assert entry["tag_path"].startswith("[default]"), (
            "Entry %d tag_path should start with [default]: %s" % (i, entry["tag_path"])
        )
        assert entry["uns_path"].startswith("enterprise."), (
            "Entry %d uns_path should start with enterprise.: %s" % (i, entry["uns_path"])
        )
    tag_count = len(data.get("tags", []))
    print(
        "PASS test_approved_tags_schema — %d entries all have required fields" % tag_count
    )


def test_all_bench_conveyor_tags_present():
    """Core diagnostic tags (motor run, fault, VFD dc-bus, error-code) must be present."""
    approved = load_set()
    critical_tags = [
        "[default]Mira_Monitored/Conveyor/MotorRunning",
        "[default]Mira_Monitored/Conveyor/FaultAlarm",
        "[default]Mira_Monitored/Conveyor/VfdDcBus",
        "[default]Mira_Monitored/Conveyor/ErrorCode",
        "[default]Mira_Monitored/Conveyor/EStopActive",
        "[default]Mira_Monitored/Conveyor/VfdCommOk",
        "[default]Mira_Monitored/Conveyor/ConveyorRunning",
        "[default]Mira_Monitored/Conveyor/VfdFrequency",
        "[default]Mira_Monitored/Conveyor/VfdCurrent",
        "[default]Mira_Monitored/Conveyor/ConvState",
    ]
    missing = [t for t in critical_tags if t not in approved]
    assert not missing, "Critical diagnostic tags missing from allowlist: %s" % missing
    print(
        "PASS test_all_bench_conveyor_tags_present — "
        "%d critical diagnostic tags confirmed" % len(critical_tags)
    )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    tests = [
        test_approved_tags_json_loads,
        test_allowlisted_tag_passes,
        test_non_allowlisted_tag_blocked,
        test_arbitrary_path_blocked,
        test_filter_to_allowlist_keeps_approved,
        test_filter_empty_list,
        test_is_allowlisted_case_sensitive,
        test_approved_tags_schema,
        test_all_bench_conveyor_tags_present,
    ]

    passed = 0
    failed = 0
    for test_fn in tests:
        try:
            test_fn()
            passed += 1
        except Exception as exc:
            print("FAIL %s — %s" % (test_fn.__name__, exc))
            failed += 1

    print("\n%d passed, %d failed" % (passed, failed))
    if failed:
        sys.exit(1)
