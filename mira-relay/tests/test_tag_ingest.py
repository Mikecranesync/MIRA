"""Tests for the Phase-2 tag ingestion pipeline (POST /api/v1/tags/ingest).

The pipeline (tag_ingest.ingest_batch) is store-agnostic, so these tests
inject an in-memory store and verify the allowlist / normalization /
provenance logic without a live NeonDB. An endpoint-level test exercises the
Starlette route with a monkeypatched store factory.

Required behaviours (gap-closure plan §3 G6/G7):
  - approved tag accepted
  - unapproved rejected (fail-closed)
  - current_tag_state updates (cache reflects latest value)
  - tag_events append-only (every reading is its own row)
  - simulated flag preserved (derived from source_system, never mixed)
  - UNS path attached (resolved from the allowlist row)
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import relay_server
from tag_ingest import (
    IngestError,
    TagEventRow,
    ingest_batch,
    normalize_tag_path,
)

# ── In-memory store ─────────────────────────────────────────────────────────


class InMemoryTagStore:
    """Test double for TagStore. allowlist is keyed by source_system →
    {normalized_tag_path: uns_path|None}."""

    def __init__(self, allowlist: dict[str, dict[str, str | None]] | None = None) -> None:
        self._allow = allowlist or {}
        self.events: list[TagEventRow] = []
        self.state: dict[str, TagEventRow] = {}  # plc_tag → latest row

    def load_allowlist(self, tenant_id: str, source_system: str) -> dict[str, str | None]:
        return dict(self._allow.get(source_system, {}))

    def current_state_simulated(self, tenant_id: str, tag_paths: list[str]) -> dict[str, bool]:
        return {t: self.state[t].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        # One "transaction" — mirrors NeonTagStore: events + cache together.
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = r
        return (len(event_rows), len(state_rows))


TAG = "Mira_Monitored/Conveyor/Motor_Current"
UNS = "enterprise.lake_wales.bench.conveyor.motor_current"


def _store_with_tag(source_system: str = "ignition", uns: str | None = UNS) -> InMemoryTagStore:
    return InMemoryTagStore({source_system: {normalize_tag_path(TAG): uns}})


def _batch(source_system: str = "ignition", value: object = 8.3, value_type="float", tag_path=TAG):
    return {
        "source_system": source_system,
        "source_connection_id": "conn-1",
        "tenant_id": "t-1",
        "tags": [{"tag_path": tag_path, "value": value, "value_type": value_type, "quality": "good"}],
    }


# ── normalize ───────────────────────────────────────────────────────────────


def test_normalize_collapses_separators():
    assert normalize_tag_path("Mira_Monitored/Conveyor.Motor:Current") == "mira_monitored_conveyor_motor_current"
    assert normalize_tag_path("  A//B  ") == "a_b"
    assert normalize_tag_path("") == ""


# ── behaviour 1: approved tag accepted ───────────────────────────────────────


def test_approved_tag_accepted():
    store = _store_with_tag()
    res = ingest_batch(_batch(), "t-1", store)
    assert res.accepted == 1
    assert res.rejected == []
    assert res.events_written == 1
    assert res.state_upserts == 1
    assert len(store.events) == 1
    assert TAG in store.state


# ── behaviour 2: unapproved rejected (fail-closed) ───────────────────────────


def test_unapproved_tag_rejected():
    store = InMemoryTagStore({"ignition": {}})  # empty allowlist → fail closed
    res = ingest_batch(_batch(), "t-1", store)
    assert res.accepted == 0
    assert res.events_written == 0
    assert len(res.rejected) == 1
    assert res.rejected[0].reason == "not_allowlisted"
    assert store.events == []
    assert store.state == {}


def test_empty_allowlist_for_source_fails_closed():
    # Tag allowlisted for ignition, but batch claims source plc_bridge → no match.
    store = _store_with_tag(source_system="ignition")
    res = ingest_batch(_batch(source_system="plc_bridge"), "t-1", store)
    assert res.accepted == 0
    assert res.rejected[0].reason == "not_allowlisted"


# ── behaviour 3: current_tag_state updates ───────────────────────────────────


def test_current_state_reflects_latest_value():
    store = _store_with_tag()
    ingest_batch(_batch(value=8.3), "t-1", store)
    ingest_batch(_batch(value=12.7), "t-1", store)
    assert store.state[TAG].value == "12.7"


# ── behaviour 4: tag_events append-only ──────────────────────────────────────


def test_tag_events_append_only():
    store = _store_with_tag()
    ingest_batch(_batch(value=8.3), "t-1", store)
    ingest_batch(_batch(value=8.3), "t-1", store)  # same value
    # Both readings are recorded — the stream is append-only, not deduped.
    assert len(store.events) == 2
    # ...while the cache holds exactly one row per tag.
    assert len(store.state) == 1


# ── behaviour 5: simulated flag preserved / never mixed ──────────────────────


def test_simulated_flag_derived_from_source():
    sim_store = _store_with_tag(source_system="simulator")
    res = ingest_batch(_batch(source_system="simulator"), "t-1", sim_store)
    assert res.simulated is True
    assert sim_store.events[0].simulated is True

    real_store = _store_with_tag(source_system="ignition")
    res = ingest_batch(_batch(source_system="ignition"), "t-1", real_store)
    assert res.simulated is False
    assert real_store.events[0].simulated is False


def test_simulated_never_overwrites_real_in_cache():
    # Real value cached first.
    store = InMemoryTagStore(
        {
            "ignition": {normalize_tag_path(TAG): UNS},
            "simulator": {normalize_tag_path(TAG): UNS},
        }
    )
    ingest_batch(_batch(source_system="ignition", value=8.3), "t-1", store)
    assert store.state[TAG].simulated is False

    # A simulated reading arrives for the same tag.
    res = ingest_batch(_batch(source_system="simulator", value=999.0), "t-1", store)
    # Event is still recorded (append-only truth)...
    assert res.events_written == 1
    assert any(e.simulated for e in store.events)
    # ...but the cache was NOT clobbered with simulated data.
    assert res.cache_skipped == 1
    assert res.state_upserts == 0
    assert store.state[TAG].simulated is False
    assert store.state[TAG].value == "8.3"


def test_real_overwrites_sim_in_cache():
    store = InMemoryTagStore(
        {
            "simulator": {normalize_tag_path(TAG): UNS},
            "ignition": {normalize_tag_path(TAG): UNS},
        }
    )
    ingest_batch(_batch(source_system="simulator", value=1.0), "t-1", store)
    assert store.state[TAG].simulated is True
    ingest_batch(_batch(source_system="ignition", value=8.3), "t-1", store)
    # Real data is allowed to replace simulated.
    assert store.state[TAG].simulated is False
    assert store.state[TAG].value == "8.3"


# ── behaviour 6: UNS path attached ───────────────────────────────────────────


def test_uns_path_attached_from_allowlist():
    store = _store_with_tag(uns=UNS)
    ingest_batch(_batch(), "t-1", store)
    assert store.events[0].uns_path == UNS
    assert store.state[TAG].uns_path == UNS


def test_uns_path_null_when_allowlist_has_none():
    store = _store_with_tag(uns=None)  # approved but no UNS mapping yet
    res = ingest_batch(_batch(), "t-1", store)
    assert res.accepted == 1  # still accepted — UNS resolved "where possible"
    assert store.events[0].uns_path is None


# ── batch-level validation ───────────────────────────────────────────────────


def test_invalid_source_system_rejected():
    with pytest.raises(IngestError, match="invalid_source_system"):
        ingest_batch({"source_system": "rogue", "tags": []}, "t-1", _store_with_tag())


def test_missing_tenant_rejected():
    with pytest.raises(IngestError, match="tenant_required"):
        ingest_batch(_batch(), "", _store_with_tag())


def test_bad_value_type_rejected():
    store = _store_with_tag()
    res = ingest_batch(_batch(value_type="blob"), "t-1", store)
    assert res.accepted == 0
    assert res.rejected[0].reason == "bad_value_type"


def test_null_value_rejected_not_stored():
    # A Bad-quality read with no value must be rejected — never stored. Otherwise
    # live_signal_cache's value-present CHECK would 500, and (separate-txn) the
    # event would commit while the cache failed → duplicate events on retry.
    store = _store_with_tag()
    res = ingest_batch(_batch(value=None), "t-1", store)
    assert res.accepted == 0
    assert res.events_written == 0
    assert res.state_upserts == 0
    assert res.rejected[0].reason == "null_value"
    assert store.events == []


def test_zero_and_false_are_valid_values():
    # 0 and False are real values (not null) — must be accepted and stored.
    store = _store_with_tag()
    r0 = ingest_batch(_batch(value=0, value_type="int"), "t-1", store)
    assert r0.accepted == 1
    assert store.state[TAG].value == "0"

    store2 = _store_with_tag()
    rf = ingest_batch(_batch(value=False, value_type="bool"), "t-1", store2)
    assert rf.accepted == 1
    assert store2.state[TAG].value == "false"


# ── endpoint level ───────────────────────────────────────────────────────────


@pytest.fixture
def client_with_store(monkeypatch):
    store = _store_with_tag()
    monkeypatch.setattr(relay_server, "_get_tag_store", lambda: store)
    return TestClient(relay_server.app), store


def test_endpoint_accepts_approved_tag(client_with_store):
    client, store = client_with_store
    resp = client.post("/api/v1/tags/ingest", json=_batch())
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["accepted"] == 1
    assert body["simulated"] is False
    assert len(store.events) == 1


def test_endpoint_requires_tenant(monkeypatch):
    monkeypatch.setattr(relay_server, "_get_tag_store", lambda: _store_with_tag())
    client = TestClient(relay_server.app)
    payload = _batch()
    payload.pop("tenant_id")  # no HMAC tenant (legacy/open in tests) and no body tenant
    resp = client.post("/api/v1/tags/ingest", json=payload)
    assert resp.status_code == 400
    assert resp.json()["error"] == "tenant_required"


def test_endpoint_invalid_json():
    client = TestClient(relay_server.app)
    resp = client.post(
        "/api/v1/tags/ingest", content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 400
