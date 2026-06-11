"""Tests for clock_resolver — real-time event-timestamp selection.

Proves the Walker live-state precedence: a valid PLC/SCADA clock tag is
preferred over server time; gateway-stamped `ts` is the next fallback; server
time is last; and a bad/stale/unparseable clock is rejected and the reading is
marked degraded. All tests inject an explicit `server_now`, so behaviour is
deterministic (no wall-clock dependence).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from clock_resolver import (
    GATEWAY_CLOCK,
    PLC_CLOCK,
    SCADA_CLOCK,
    SERVER_CLOCK,
    UNKNOWN,
    clock_source_for_tag,
    find_batch_clock,
    parse_clock_value,
    resolve_event_timestamp,
)

NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)


def _tag(tag_path, value):
    return {"tag_path": tag_path, "value": value}


# ── clock-tag detection ──────────────────────────────────────────────────────


def test_clock_source_for_tag_matches_known_names():
    assert clock_source_for_tag("Line5/Filler01/controller_time") == PLC_CLOCK
    assert clock_source_for_tag("enterprise.x.filler01.status.plc_time") == PLC_CLOCK
    assert clock_source_for_tag("PLC_DateTime") == PLC_CLOCK
    assert clock_source_for_tag("gw/scada_time") == SCADA_CLOCK
    assert clock_source_for_tag("system_time") == GATEWAY_CLOCK
    assert clock_source_for_tag("gateway_time") == GATEWAY_CLOCK
    # Not a clock tag.
    assert clock_source_for_tag("filler01/process/fill_level_oz") is None
    assert clock_source_for_tag("") is None


# ── value parsing → UTC ──────────────────────────────────────────────────────


def test_parse_iso_with_offset_normalizes_to_utc():
    dt = parse_clock_value("2026-06-11T07:00:00-05:00")
    assert dt == datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)


def test_parse_iso_naive_assumed_utc_and_z_suffix():
    assert parse_clock_value("2026-06-11T12:00:00") == NOW
    assert parse_clock_value("2026-06-11T12:00:00Z") == NOW


def test_parse_epoch_seconds_and_millis():
    secs = NOW.timestamp()
    assert parse_clock_value(secs) == NOW
    assert parse_clock_value(int(secs * 1000)) == NOW  # ms auto-detected
    assert parse_clock_value(str(int(secs))) == NOW  # numeric string


def test_parse_rejects_garbage():
    assert parse_clock_value("not-a-time") is None
    assert parse_clock_value("") is None
    assert parse_clock_value(None) is None
    assert parse_clock_value(True) is None  # bool is not a timestamp


# ── batch clock discovery ────────────────────────────────────────────────────


def test_find_batch_clock_prefers_plc_over_scada():
    tags = [
        _tag("gw/scada_time", "2026-06-11T11:59:00Z"),
        _tag("plc/controller_time", "2026-06-11T12:00:00Z"),
        _tag("filler01/process/fill", 8.3),
    ]
    clock, degraded = find_batch_clock(tags, NOW)
    assert clock is not None
    assert clock.source == PLC_CLOCK
    assert degraded is False


def test_find_batch_clock_none_when_no_clock_tag():
    clock, degraded = find_batch_clock([_tag("a/process/x", 1)], NOW)
    assert clock is None
    assert degraded is False  # no clock tag present → not degraded, just absent


def test_find_batch_clock_stale_is_degraded():
    stale = (NOW - timedelta(hours=2)).isoformat()
    clock, degraded = find_batch_clock([_tag("plc/plc_time", stale)], NOW)
    assert clock is None
    assert degraded is True  # clock present but rejected → degraded


def test_find_batch_clock_unparseable_is_degraded():
    clock, degraded = find_batch_clock([_tag("plc/plc_time", "garbage")], NOW)
    assert clock is None
    assert degraded is True


# ── per-reading resolution / precedence ──────────────────────────────────────


def test_plc_clock_preferred_over_server_and_reading_ts():
    clock, _ = find_batch_clock([_tag("plc/controller_time", "2026-06-11T12:00:00Z")], NOW)
    rt = resolve_event_timestamp("2026-06-11T11:00:00Z", clock, NOW)
    assert rt.timestamp_source == PLC_CLOCK
    assert rt.timestamp == NOW.isoformat()
    assert rt.sample_age_seconds == 0.0
    assert rt.degraded is False


def test_reading_ts_used_as_gateway_when_no_clock_tag():
    rt = resolve_event_timestamp("2026-06-11T11:59:00Z", None, NOW)
    assert rt.timestamp_source == GATEWAY_CLOCK
    assert rt.sample_age_seconds == 60.0
    assert rt.source_timestamp_local == "2026-06-11T11:59:00Z"


def test_server_time_when_no_clock_and_no_reading_ts():
    rt = resolve_event_timestamp(None, None, NOW)
    assert rt.timestamp_source == SERVER_CLOCK
    assert rt.timestamp == NOW.isoformat()
    assert rt.degraded is False


def test_degraded_clock_falls_back_to_unknown_when_no_gateway_ts():
    # A PLC clock was present but stale → degraded; reading carries no ts of its
    # own → we cannot trust the time at all → unknown + degraded.
    rt = resolve_event_timestamp(None, None, NOW, clock_degraded=True)
    assert rt.timestamp_source == UNKNOWN
    assert rt.degraded is True
    assert rt.timestamp == NOW.isoformat()  # still stored, just untrusted


def test_degraded_clock_keeps_gateway_ts_but_flags_degraded():
    rt = resolve_event_timestamp("2026-06-11T11:59:00Z", None, NOW, clock_degraded=True)
    assert rt.timestamp_source == GATEWAY_CLOCK
    assert rt.degraded is True


def test_scada_clock_source_propagates():
    clock, _ = find_batch_clock([_tag("gw/scada_time", "2026-06-11T12:00:00Z")], NOW)
    rt = resolve_event_timestamp(None, clock, NOW)
    assert rt.timestamp_source == SCADA_CLOCK
