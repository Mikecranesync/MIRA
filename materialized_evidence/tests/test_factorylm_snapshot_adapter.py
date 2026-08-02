"""`factorylm.machine-snapshot.v1` → LiveStateOverlay adapter (PRD #3048, PR 1).

Tests the pure `overlay_from_factorylm_snapshot` against the SHARED cross-repo
fixtures in `contracts/machine_snapshot/` — the same payloads FactoryLM tests
against, so the two projects stay wire-compatible.
"""

from __future__ import annotations

import json
import pathlib

from materialized_evidence.context_contract import (
    FACTORYLM_SNAPSHOT_SCHEMA,
    Freshness,
    LiveStateOverlay,
    overlay_from_factorylm_snapshot,
)

_FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "machine_snapshot"


def _fixture(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text())


def test_valid_snapshot_maps_tags_state_and_provenance():
    overlay, violations = overlay_from_factorylm_snapshot(_fixture("snapshot_v1_valid.json"))
    assert violations == []
    assert isinstance(overlay, LiveStateOverlay)
    assert overlay.machine_state == "running"
    assert overlay.active_conditions == []
    # all seven-ish canonical tags carried, in order, values preserved
    paths = [t.tag_path for t in overlay.tags]
    assert "conv_simple.vfd_speed_hz" in paths
    speed = next(t for t in overlay.tags if t.tag_path == "conv_simple.vfd_speed_hz")
    assert speed.value == 32.5
    assert speed.observed_at == "2026-08-01T12:00:00Z"  # source timestamp preserved, not invented


def test_good_quality_maps_to_live_and_stale_stays_stale():
    overlay, _ = overlay_from_factorylm_snapshot(_fixture("snapshot_v1_valid.json"))
    by_path = {t.tag_path: t for t in overlay.tags}
    assert by_path["conv_simple.motor_run"].freshness is Freshness.LIVE
    assert by_path["conv_simple.height_sensor_mm"].freshness is Freshness.STALE  # was quality=stale
    # freshness summary counts both bands (six live incl. sort_divert_active,
    # one stale — the fixture carries all seven conv_simple.* canonical tags
    # per factorylm #199)
    assert overlay.freshness_summary.get("live", 0) == 6
    assert overlay.freshness_summary.get("stale", 0) == 1


def test_unknown_quality_never_becomes_good():
    snap = _fixture("snapshot_v1_valid.json")
    snap["tags"][0]["quality"] = "banana"  # not in the ingest vocab
    overlay, violations = overlay_from_factorylm_snapshot(snap)
    assert violations == []
    tag = overlay.tags[0]
    # downgraded toward LESS confidence — never live/good
    assert tag.quality == "uncertain"
    assert tag.freshness is Freshness.UNKNOWN
    assert tag.freshness is not Freshness.LIVE


def test_simulator_source_marks_freshness_simulated_not_real():
    snap = _fixture("snapshot_v1_valid.json")
    snap["source_system"] = "simulator"
    overlay, _ = overlay_from_factorylm_snapshot(snap)
    live_or_sim = {t.freshness for t in overlay.tags}
    assert Freshness.SIMULATED in live_or_sim
    assert Freshness.LIVE not in live_or_sim  # a simulated row is never presented as real telemetry


def test_invalid_fixtures_yield_no_overlay_and_a_nonfatal_violation():
    for name, expect in [
        ("snapshot_v1_invalid_missing_tenant.json", "tenant_id:missing"),
        ("snapshot_v1_invalid_missing_timestamp.json", "captured_at:missing"),
        ("snapshot_v1_invalid_malformed_tags.json", "malformed_tag"),
    ]:
        overlay, violations = overlay_from_factorylm_snapshot(_fixture(name))
        assert overlay is None, name
        assert expect in violations, (name, violations)


def test_wrong_schema_version_is_rejected():
    overlay, violations = overlay_from_factorylm_snapshot(
        _fixture("snapshot_v1_invalid_schema_version.json")
    )
    assert overlay is None
    assert any(v.startswith("schema_version:") for v in violations)


def test_non_dict_input_is_safe():
    for bad in (None, "x", 5, ["a"]):
        overlay, violations = overlay_from_factorylm_snapshot(bad)
        assert overlay is None
        assert violations  # non-fatal, never raises


def test_valid_fixture_declares_the_contract_version():
    assert _fixture("snapshot_v1_valid.json")["schema_version"] == FACTORYLM_SNAPSHOT_SCHEMA


def test_adapter_reuses_the_shared_overlay_type_no_writes():
    # read-only + reuse: the function imports nothing network/fieldbus and returns
    # the shared LiveStateOverlay (not a bespoke type).
    import inspect

    import materialized_evidence.context_contract as cc

    src = inspect.getsource(cc.overlay_from_factorylm_snapshot)
    for forbidden in ("pymodbus", "pycomm3", "requests", "httpx", "socket", "write_register"):
        assert forbidden not in src
    assert "live_overlay_from_machine_packet(packet)" in src  # delegates, not re-implements


# ── Empty-tags parity with the FactoryLM producer (review 2026-08-02) ─────────


def test_empty_tag_list_is_rejected_not_an_evidence_free_overlay():
    """An overlay with zero tags would still assert ``machine_state``.

    The FactoryLM producer's ``validate_envelope`` already rejects this
    ("tags must be a non-empty list"). The consumer accepted it, so a snapshot
    carrying no evidence at all could still render a live block telling a
    technician the machine is "running" with nothing behind it — a fabricated
    plant claim, which is exactly what the grounding rules forbid. The consumer
    is the side facing untrusted input, so it must be at least as strict as the
    producer.
    """
    snap = _fixture("snapshot_v1_valid.json")
    snap["tags"] = []
    overlay, violations = overlay_from_factorylm_snapshot(snap)
    assert overlay is None
    assert "tags:empty" in violations


def test_missing_tags_key_is_still_not_a_list():
    snap = _fixture("snapshot_v1_valid.json")
    del snap["tags"]
    overlay, violations = overlay_from_factorylm_snapshot(snap)
    assert overlay is None
    assert "tags:not_a_list" in violations


def test_a_populated_snapshot_is_unaffected_by_the_empty_guard():
    """Counterfactual: the guard must not reject the real fixture."""
    overlay, violations = overlay_from_factorylm_snapshot(_fixture("snapshot_v1_valid.json"))
    assert violations == []
    assert overlay is not None and len(overlay.tags) == 7
