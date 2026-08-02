"""Tests for the factorylm.machine-snapshot.v1 → ingest_batch transport (PRD #3048, PR 3).

Acceptance tests from the PRD, in order:

  - Authorized FactoryLM publisher succeeds — asserted as
    ``accepted == len(tags)`` AND ``rejected == []``, never "the POST returned
    200". The allowlist is fail-closed with no permissive mode, so an unseeded
    tenant returns HTTP 200 with ``accepted=0`` and nothing stored: a test that
    only checks the status code passes vacuously against an empty overlay.
  - **The un-seeded case is pinned explicitly** (``test_unseeded_allowlist_...``)
    so a future seed regression fails loudly here instead of silently emptying
    the live overlay downstream.
  - Wrong-tenant / wrong-source publisher is denied.
  - Malformed payload rejected without affecting live diagnosis.
  - Duplicate snapshot behavior is deterministic.
  - No secrets logged, no plant writes, no fieldbus client imported.

Runs against the shared cross-repo fixtures in ``contracts/machine_snapshot/``
— the same payloads PR 1's overlay adapter tests use, so the transport and the
context contract agree on what "valid" means.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest
from test_tag_ingest import InMemoryTagStore

from auth import verify_hmac
from factorylm_snapshot import (
    FACTORYLM_SOURCE_SYSTEM,
    FactoryLMSnapshotPublisher,
    SnapshotContractError,
    snapshot_to_ingest_batch,
)
from tag_ingest import ingest_batch, normalize_tag_path

_FIXTURE_DIR = Path(__file__).resolve().parents[2] / "contracts" / "machine_snapshot"
_MODULE_SRC = Path(__file__).resolve().parents[1] / "factorylm_snapshot.py"

_TENANT = "3f4d5e6a-7b8c-4d9e-8f01-2a3b4c5d6e7f"
_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"

# The seven canonical tags from the PRD's tag vocabulary — mirrors
# tools/seeds/approved_tags_factorylm_conv_simple.sql.
_CANONICAL_TAGS = (
    "conv_simple.motor_run",
    "conv_simple.vfd_speed_hz",
    "conv_simple.vfd_current_amps",
    "conv_simple.fault_code",
    "conv_simple.comm_ok",
    "conv_simple.height_sensor_mm",
    "conv_simple.sort_divert_active",
)


def _load(name: str) -> dict:
    return json.loads((_FIXTURE_DIR / f"{name}.json").read_text())


def _seeded_store(source_system: str = FACTORYLM_SOURCE_SYSTEM) -> InMemoryTagStore:
    """A store whose allowlist matches what the seed SQL installs."""
    return InMemoryTagStore({source_system: {normalize_tag_path(t): _UNS for t in _CANONICAL_TAGS}})


# ── the seed exists for a reason: seeded vs un-seeded, side by side ─────────


def test_valid_snapshot_all_tags_accepted():
    snapshot = _load("snapshot_v1_valid")
    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)
    assert batch["source_system"] == FACTORYLM_SOURCE_SYSTEM

    store = _seeded_store()
    res = ingest_batch(batch, _TENANT, store)

    assert res.accepted == len(snapshot["tags"])
    assert res.rejected == []
    assert res.events_written == len(snapshot["tags"])
    assert res.state_upserts == len(snapshot["tags"])


def test_unseeded_allowlist_rejects_every_tag():
    """THE failure mode this PR exists to avoid — pinned, not assumed.

    Without the approved_tags seed the pipeline still "succeeds": no exception,
    no error status, ``accepted=0``, nothing stored. Downstream every overlay is
    empty and every test that only checks for a 200 still passes. If this test
    ever starts failing, the seed contract changed.
    """
    snapshot = _load("snapshot_v1_valid")
    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)
    unseeded = InMemoryTagStore({FACTORYLM_SOURCE_SYSTEM: {}})

    res = ingest_batch(batch, _TENANT, unseeded)

    assert res.accepted == 0
    assert len(res.rejected) == len(snapshot["tags"])
    assert {r.reason for r in res.rejected} == {"not_allowlisted"}
    assert unseeded.events == []
    assert unseeded.state == {}


def test_seed_covers_every_canonical_tag_in_the_fixture():
    """The seed file and the shared fixture must not drift apart."""
    seed_sql = (
        Path(__file__).resolve().parents[2]
        / "tools"
        / "seeds"
        / "approved_tags_factorylm_conv_simple.sql"
    ).read_text()
    for tag in _CANONICAL_TAGS:
        assert f"'{tag}'" in seed_sql, f"{tag} missing from the seed"
        assert f"'{normalize_tag_path(tag)}'" in seed_sql, f"{tag} normalized form missing"
    assert f"'{FACTORYLM_SOURCE_SYSTEM}'" in seed_sql
    for tag in _load("snapshot_v1_valid")["tags"]:
        assert tag["tag_path"] in _CANONICAL_TAGS


# ── envelope → canonical batch mapping ──────────────────────────────────────


def test_snapshot_scoped_fields_ride_per_tag_metadata():
    """machine_state / active_conditions are REQUIRED to build a LiveStateOverlay.

    They have no column of their own, so losing them silently would give PR 4 a
    permanently "unknown state" overlay while every tag looked healthy.
    """
    snapshot = _load("snapshot_v1_valid")
    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)

    for entry in batch["tags"]:
        meta = entry["metadata"]["factorylm_snapshot"]
        assert meta["machine_state"] == snapshot["machine_state"]
        assert meta["active_conditions"] == snapshot["active_conditions"]
        assert meta["snapshot_id"] == snapshot["snapshot_id"]
        assert meta["captured_at"] == snapshot["captured_at"]
        assert meta["schema_version"] == snapshot["schema_version"]
        assert meta["provenance"] == snapshot["provenance"]
        assert meta["proposed_uns_path"] == snapshot["asset"]["proposed_uns_path"]


def test_uns_identity_comes_from_the_allowlist_not_the_envelope():
    """proposed_uns_path is provenance only — the seeded uns_path is the truth."""
    snapshot = _load("snapshot_v1_valid")
    store = _seeded_store()
    ingest_batch(snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, store)

    assert store.events
    for row in store.events:
        assert row.uns_path == _UNS
        assert row.uns_path != snapshot["asset"]["proposed_uns_path"]


def test_value_type_is_derived_per_tag():
    """Unrecognized value_type is REJECTED by ingest_batch, not coerced — so the
    producer must derive it. bool before int: isinstance(True, int) is True."""
    snapshot = _load("snapshot_v1_valid")
    by_path = {e["tag_path"]: e for e in snapshot_to_ingest_batch(snapshot)["tags"]}

    assert by_path["conv_simple.motor_run"]["value_type"] == "bool"
    assert by_path["conv_simple.comm_ok"]["value_type"] == "bool"
    assert by_path["conv_simple.fault_code"]["value_type"] == "int"
    assert by_path["conv_simple.vfd_speed_hz"]["value_type"] == "float"


def test_observed_at_becomes_ts_and_quality_passes_through():
    snapshot = _load("snapshot_v1_valid")
    by_path = {e["tag_path"]: e for e in snapshot_to_ingest_batch(snapshot)["tags"]}

    stale = by_path["conv_simple.height_sensor_mm"]
    assert stale["quality"] == "stale"
    assert stale["ts"] == "2026-08-01T11:59:30Z"


def test_falsy_values_survive_the_round_trip():
    """0 and false are valid readings — they must not be dropped as null_value."""
    snapshot = _load("snapshot_v1_valid")
    store = _seeded_store()
    res = ingest_batch(snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, store)

    assert res.rejected == []
    assert store.state["conv_simple.fault_code"].value == "0"


def test_plc_bridge_batch_is_real_telemetry_never_simulated():
    """simulated is derived from source_system once per batch — a plc_bridge
    snapshot is real, so it can never be clobbered by a simulated cache row."""
    snapshot = _load("snapshot_v1_valid")
    store = _seeded_store()
    res = ingest_batch(snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, store)

    assert res.simulated is False
    assert all(row.simulated is False for row in store.events)


# ── tenant: never sourced from the envelope body ────────────────────────────


def test_hmac_path_omits_the_body_tenant():
    """X-MIRA-Tenant is authoritative; the signed body stays minimal."""
    assert "tenant_id" not in snapshot_to_ingest_batch(_load("snapshot_v1_valid"))


def test_envelope_tenant_is_never_read():
    """A caller-supplied envelope tenant must not become the ingest tenant."""
    snapshot = _load("snapshot_v1_valid")
    snapshot["tenant_id"] = "attacker-controlled-tenant"

    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)

    assert batch.get("tenant_id") == _TENANT
    assert "attacker-controlled-tenant" not in json.dumps(batch)


# ── wrong tenant / wrong source denied (fail-closed) ────────────────────────


def test_wrong_tenant_is_denied():
    snapshot = _load("snapshot_v1_valid")
    batch = snapshot_to_ingest_batch(snapshot, tenant_id="other-tenant")
    # A different tenant's allowlist is empty for these tags.
    res = ingest_batch(batch, "other-tenant", InMemoryTagStore({FACTORYLM_SOURCE_SYSTEM: {}}))

    assert res.accepted == 0
    assert {r.reason for r in res.rejected} == {"not_allowlisted"}


def test_wrong_source_system_is_denied():
    """The allowlist is keyed on (tenant, source_system) — a snapshot claiming a
    different source finds nothing, even for the same tag paths."""
    snapshot = dict(_load("snapshot_v1_valid"))
    snapshot["source_system"] = "simulator"
    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)

    res = ingest_batch(batch, _TENANT, _seeded_store(FACTORYLM_SOURCE_SYSTEM))

    assert res.accepted == 0
    assert {r.reason for r in res.rejected} == {"not_allowlisted"}


# ── malformed payload rejected, diagnosis unaffected ────────────────────────


@pytest.mark.parametrize(
    "fixture,reason",
    [
        ("snapshot_v1_invalid_schema_version", "schema_version"),
        ("snapshot_v1_invalid_missing_timestamp", "captured_at:missing"),
    ],
)
def test_malformed_envelope_raises_before_the_pipeline(fixture, reason):
    with pytest.raises(SnapshotContractError) as exc:
        snapshot_to_ingest_batch(_load(fixture), tenant_id=_TENANT)
    assert reason in str(exc.value)


def test_missing_body_tenant_is_not_a_transport_error():
    """tenant_id is an auth-layer concern here, not an envelope field this layer
    requires — the missing-tenant fixture is invalid for PR 1's overlay adapter
    (which audits the producer's claim), not for the transport."""
    snapshot = _load("snapshot_v1_invalid_missing_tenant")
    batch = snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT)
    assert len(batch["tags"]) == len(snapshot["tags"])


def test_malformed_tags_are_rejected_observably_not_dropped():
    snapshot = _load("snapshot_v1_invalid_malformed_tags")
    res = ingest_batch(
        snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, _seeded_store()
    )

    assert res.accepted == 0
    reasons = {r.reason for r in res.rejected}
    assert "malformed_entry" in reasons  # the bare "not-an-object" string
    assert "missing_tag_path" in reasons  # the dict carrying no tag_path
    assert len(res.rejected) == len(snapshot["tags"])  # nothing silently vanished


def test_non_dict_snapshot_raises():
    with pytest.raises(SnapshotContractError):
        snapshot_to_ingest_batch("not-a-dict")  # type: ignore[arg-type]


# ── duplicate snapshot behavior is deterministic ────────────────────────────


def test_duplicate_snapshot_is_deterministic():
    """tag_events is append-only (both deliveries land); live_signal_cache is
    latest-value (one row per tag either way)."""
    snapshot = _load("snapshot_v1_valid")
    n = len(snapshot["tags"])
    store = _seeded_store()

    first = ingest_batch(snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, store)
    second = ingest_batch(snapshot_to_ingest_batch(snapshot, tenant_id=_TENANT), _TENANT, store)

    assert first.accepted == second.accepted == n
    assert first.rejected == second.rejected == []
    assert len(store.events) == 2 * n
    assert len(store.state) == n


# ── publisher: HMAC round-trip against the REAL verifier ────────────────────


class _FakeResponse:
    """A relay response stub.

    Carries an `accepted`/`rejected` body because the publisher now VALIDATES
    the ingest result rather than trusting the status code (#3063) — a bare 200
    is no longer evidence the tags landed. `accepted` defaults to the full
    canonical batch so the happy-path tests describe a correctly seeded relay.
    """

    def __init__(self, status_code: int = 200, accepted: int = 7, rejected=None) -> None:
        self.status_code = status_code
        self._accepted = accepted
        self._rejected = rejected or []

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return {"accepted": self._accepted, "rejected": self._rejected}


class _FakeHttpx:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.status_code = 200

    def post(self, url, *, content=None, headers=None, timeout=None, **kwargs):
        self.calls.append(
            {"url": url, "content": content, "headers": dict(headers or {}), "timeout": timeout}
        )
        return _FakeResponse(self.status_code)


@pytest.fixture
def fake_httpx(monkeypatch):
    fake = _FakeHttpx()
    mod = types.ModuleType("httpx")
    mod.post = fake.post  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "httpx", mod)
    return fake


def test_publisher_requires_a_tenant():
    with pytest.raises(ValueError):
        FactoryLMSnapshotPublisher("http://relay.example", tenant_id="")


def test_publisher_hmac_signature_verifies_against_the_real_verifier(fake_httpx):
    """The signer and verifier share auth._signed_string — proven, not assumed."""
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example/", tenant_id=_TENANT, hmac_key="s3cret-key"
    )
    assert pub.publish(_load("snapshot_v1_valid")) is True

    call = fake_httpx.calls[0]
    assert call["url"] == "http://relay.example/api/v1/tags/ingest"
    # The real server-side verifier accepts the headers the publisher produced.
    assert verify_hmac(call["headers"], call["content"], "s3cret-key") == _TENANT

    body = json.loads(call["content"])
    assert body["source_system"] == FACTORYLM_SOURCE_SYSTEM
    assert "tenant_id" not in body  # header is authoritative on the HMAC path


def test_publisher_signs_the_exact_bytes_it_sends(fake_httpx):
    """Posting via content= (not json=) is what keeps the body hash valid."""
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example", tenant_id=_TENANT, hmac_key="s3cret-key"
    )
    pub.publish(_load("snapshot_v1_valid"))

    call = fake_httpx.calls[0]
    assert isinstance(call["content"], bytes)
    tampered = call["content"] + b" "
    with pytest.raises(ValueError, match="signature_mismatch"):
        verify_hmac(call["headers"], tampered, "s3cret-key")


def test_publisher_bearer_mode_carries_tenant_in_body(fake_httpx):
    pub = FactoryLMSnapshotPublisher("http://relay.example", tenant_id=_TENANT, api_key="benchkey")
    pub.publish(_load("snapshot_v1_valid"))

    call = fake_httpx.calls[0]
    assert call["headers"]["Authorization"] == "Bearer benchkey"
    assert "X-MIRA-Signature" not in call["headers"]
    assert json.loads(call["content"])["tenant_id"] == _TENANT


def test_publisher_never_leaks_the_key_on_the_success_path(fake_httpx, caplog):
    """Verified by mutation: adding `logger.debug("key=%s", self._hmac_key)` to
    publish() turns this test red, so the caplog assertion is load-bearing and
    not passing for an unrelated reason."""
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example", tenant_id=_TENANT, hmac_key="s3cret-key"
    )
    with caplog.at_level("DEBUG"):
        pub.publish(_load("snapshot_v1_valid"))

    assert "s3cret-key" not in caplog.text
    assert "s3cret-key" not in json.dumps(fake_httpx.calls[0]["headers"])
    assert "s3cret-key" not in fake_httpx.calls[0]["content"].decode()


def test_publisher_never_leaks_the_key_on_the_failure_paths(fake_httpx, caplog):
    """The failure paths are where a credential actually leaks in practice.

    Both `except` arms log an exception string (`"...: %s", exc`), and an
    exception raised from inside a signed request is exactly the kind that can
    carry a key or a full signed header set into a log. The success-path test
    above cannot catch that — these arms never run on it.
    """
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example", tenant_id=_TENANT, hmac_key="s3cret-key"
    )

    with caplog.at_level("DEBUG"):
        # Arm 1: SnapshotContractError, before any POST.
        assert pub.publish(_load("snapshot_v1_invalid_schema_version")) is False
        # Arm 2: a transport error raised mid-request, after signing.
        fake_httpx.status_code = 500
        assert pub.publish(_load("snapshot_v1_valid")) is False

    assert "s3cret-key" not in caplog.text


def test_publisher_drops_a_bad_snapshot_without_raising(fake_httpx, caplog):
    """A malformed snapshot must never raise into a diagnosis path."""
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example", tenant_id=_TENANT, hmac_key="s3cret-key"
    )
    with caplog.at_level("WARNING"):
        assert pub.publish(_load("snapshot_v1_invalid_schema_version")) is False

    assert fake_httpx.calls == []  # nothing was sent
    assert "invalid snapshot" in caplog.text


def test_publisher_survives_a_relay_error(fake_httpx):
    fake_httpx.status_code = 500
    pub = FactoryLMSnapshotPublisher(
        "http://relay.example", tenant_id=_TENANT, hmac_key="s3cret-key"
    )
    assert pub.publish(_load("snapshot_v1_valid")) is False


# ── read-only by construction ───────────────────────────────────────────────


def test_no_fieldbus_or_control_client_is_imported():
    src = _MODULE_SRC.read_text()
    for forbidden in ("pymodbus", "pycomm3", "snap7", "opcua", "socket."):
        assert forbidden not in src, f"read-only transport must not use {forbidden!r}"


def test_module_defines_no_canonical_primitive():
    """A local guard mirroring tests/test_architecture.py Contract 5 — this
    module must import the contract, never redefine it."""
    src = _MODULE_SRC.read_text()
    for primitive in (
        "def normalize_tag_path",
        "def build_tag_entry",
        "def build_ingest_batch",
        "def ingest_batch",
        "def persist_batch",
        "def load_allowlist",
    ):
        assert primitive not in src, f"one-pipeline law: {primitive!r} belongs to the contract"
    assert "from ingest_contract import" in src


# ── #3063: the publisher must validate the RESULT, not the HTTP status ───────


class _StubIngestResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def _publisher(monkeypatch, response_payload):
    """A publisher whose POST returns `response_payload` with HTTP 200."""
    import httpx

    posted = {}

    def _fake_post(url, **kwargs):
        posted["url"] = url
        return _StubIngestResponse(response_payload)

    monkeypatch.setattr(httpx, "post", _fake_post)
    return FactoryLMSnapshotPublisher("http://relay.test", "staging", api_key="k"), posted


def test_unseeded_allowlist_returns_false_despite_http_200(monkeypatch):
    """THE failure this issue exists for.

    An un-seeded `approved_tags` makes the relay answer **HTTP 200** with
    `accepted=0` and every tag in `rejected`. Checking only `raise_for_status()`
    reported success while storing nothing — the feed looked wired and was
    inert. The seed shipped in #3059 has been applied to no environment, so
    this is the live default, not a corner case.
    """
    snap = _load("snapshot_v1_valid")
    rejected = [{"tag_path": t["tag_path"], "reason": "not_allowlisted"} for t in snap["tags"]]
    pub, _ = _publisher(monkeypatch, {"accepted": 0, "rejected": rejected})
    assert pub.publish(snap) is False


def test_partial_acceptance_returns_false(monkeypatch):
    snap = _load("snapshot_v1_valid")
    pub, _ = _publisher(
        monkeypatch,
        {"accepted": 6, "rejected": [{"tag_path": "conv_simple.comm_ok", "reason": "bad_value_type"}]},
    )
    assert pub.publish(snap) is False


def test_reject_reasons_are_logged_so_an_operator_can_act(monkeypatch, caplog):
    snap = _load("snapshot_v1_valid")
    rejected = [{"tag_path": t["tag_path"], "reason": "not_allowlisted"} for t in snap["tags"]]
    pub, _ = _publisher(monkeypatch, {"accepted": 0, "rejected": rejected})
    with caplog.at_level("WARNING"):
        pub.publish(snap)
    text = caplog.text
    assert "not_allowlisted" in text, "the reason must reach the operator, not just a False"
    assert "0" in text and "7" in text, "accepted-vs-sent counts must be visible"


def test_full_acceptance_returns_true(monkeypatch):
    """Counterfactual — a correctly seeded relay must still succeed."""
    snap = _load("snapshot_v1_valid")
    pub, _ = _publisher(monkeypatch, {"accepted": len(snap["tags"]), "rejected": []})
    assert pub.publish(snap) is True


def test_unparseable_response_body_is_not_treated_as_success(monkeypatch):
    """A 200 whose body we cannot read is not evidence the tags landed."""
    import httpx

    class _BadJson(_StubIngestResponse):
        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "post", lambda url, **kw: _BadJson({}))
    pub = FactoryLMSnapshotPublisher("http://relay.test", "staging", api_key="k")
    assert pub.publish(_load("snapshot_v1_valid")) is False


def test_empty_tag_list_is_refused_at_decode():
    """An envelope with no tags is not a publishable batch (#3063).

    Matches the FactoryLM producer's `validate_envelope` ("tags must be a
    non-empty list") and MIRA's own overlay adapter, which rejects `tags: []`
    rather than building an evidence-free overlay.
    """
    snap = _load("snapshot_v1_valid")
    snap["tags"] = []
    with pytest.raises(SnapshotContractError) as exc:
        snapshot_to_ingest_batch(snap, tenant_id="staging")
    assert "empty" in str(exc.value)
