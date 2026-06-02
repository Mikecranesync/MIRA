"""Tests for Phase-6 bench-topic → ISA-95 UNS reconciliation.

The contract: every flat bench/MQTT topic resolves to the SAME path the
uns.py builders would produce — proving the resolver routes through the one
builder rather than inventing path strings (uns-compliance.md rule #1).

We assert resolver output == builder output (computed live in the test), so the
test can never drift from the builders, and we load the real shipped seed
config to prove the garage bench is fully mapped.
"""

from __future__ import annotations

from pathlib import Path

from ingest import uns
from ingest.uns_topic_map import (
    TopicMap,
    load_topic_map,
    resolve_topic_to_uns,
)

SEED = Path(__file__).parent.parent / "ingest" / "config" / "bench_uns_map.json"


def _expected(equipment, subnode, *, line="line_1", work_cell="conveyor_cell"):
    eq = uns.assigned_equipment_path(
        "home_garage", "lake_wales", "conveyor_lab", equipment, line=line, work_cell=work_cell
    )
    return uns.equipment_subnode_path(eq, *subnode) if subnode else eq


# ── seed loads + every path is valid + enterprise-rooted ─────────────────────


def test_seed_map_loads():
    tm = load_topic_map(SEED)
    assert tm.rules_exact  # exact rules present
    assert tm.rules_prefix  # prefix rules present


def test_all_seed_exact_topics_resolve_to_valid_enterprise_paths():
    tm = load_topic_map(SEED)
    assert tm.rules_exact, "expected exact rules in seed"
    for topic in tm.rules_exact:
        path = resolve_topic_to_uns(topic, tm)
        assert path is not None, f"{topic} did not resolve"
        assert path.startswith("enterprise."), path
        assert uns.is_valid_path(path), path


# ── exact topics match builder output byte-for-byte ──────────────────────────


def test_gs10_motor_current_matches_builder():
    tm = load_topic_map(SEED)
    got = resolve_topic_to_uns("Mira_Monitored/conveyor_demo/Motor_Current_A", tm)
    assert got == _expected("gs10_vfd", ["datapoint", "motor_current"])


def test_micro820_fault_alarm_matches_builder():
    tm = load_topic_map(SEED)
    got = resolve_topic_to_uns("Mira_Monitored/conveyor_demo/Fault_Alarm", tm)
    assert got == _expected("micro820_plc", ["datapoint", "fault_alarm"])


def test_sensor_topic_matches_builder():
    tm = load_topic_map(SEED)
    got = resolve_topic_to_uns("sensors/pe101/debounced", tm)
    assert got == _expected("conveyor_1", ["datapoint", "pe_101"])


# ── prefix rule: trailing topic segments become the datapoint tail ───────────


def test_prefix_rule_derives_datapoint_from_remainder():
    tm = load_topic_map(SEED)
    got = resolve_topic_to_uns("demo/cell1/conveyor/cv101/motor_current", tm)
    assert got == _expected("conveyor_1", ["datapoint", "motor_current"])


def test_prefix_rule_multi_segment_remainder():
    tm = load_topic_map(SEED)
    got = resolve_topic_to_uns("demo/cell1/conveyor/cv101/drive/temp", tm)
    assert got == _expected("conveyor_1", ["datapoint", "drive", "temp"])


def test_prefix_rule_segment_boundary_no_overswallow():
    # cv1010 must NOT match the cv101 prefix rule.
    tm = load_topic_map(SEED)
    assert resolve_topic_to_uns("demo/cell1/conveyor/cv1010/x", tm) is None


# ── unmapped topic returns None (caller must not invent a path) ──────────────


def test_unmapped_topic_returns_none():
    tm = load_topic_map(SEED)
    assert resolve_topic_to_uns("totally/unknown/tag", tm) is None
    assert resolve_topic_to_uns("", tm) is None


# ── equipment can attach without a work_cell / line ──────────────────────────


def test_equipment_on_area_only():
    tm = TopicMap.from_dict(
        {
            "defaults": {"company": "acme", "site": "main", "area": "packaging"},
            "topics": [
                {"match": "X/temp", "equipment": "pump_7", "subnode": ["datapoint", "temp"]}
            ],
        }
    )
    got = resolve_topic_to_uns("X/temp", tm)
    expected = uns.equipment_subnode_path(
        uns.assigned_equipment_path("acme", "main", "packaging", "pump_7"),
        "datapoint",
        "temp",
    )
    assert got == expected
    # area-only placement has no .line / .work_cell markers
    assert ".line." not in got and ".work_cell." not in got


# ── rule with neither match nor match_prefix is rejected ─────────────────────


def test_invalid_rule_rejected():
    try:
        TopicMap.from_dict(
            {"defaults": {"company": "a", "site": "b", "area": "c"},
             "topics": [{"equipment": "e"}]}
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "match" in str(exc)
