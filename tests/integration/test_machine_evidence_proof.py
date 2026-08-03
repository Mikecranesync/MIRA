"""PRD #3048 PR 5 — controlled integration proof, in-process half.

This harness is the executable part of the PR 5 verification runbook
(`docs/runbooks/factorylm-machine-evidence-integration-proof.md`). It chains
the REAL merged modules end-to-end — no re-implementations, no mocks of the
code under proof — against the shared cross-repo fixtures:

    fixture envelope (contracts/machine_snapshot/, byte-identical to the
        FactoryLM producer's corpus — factorylm #198 / MIRA #3058)
      → mira-relay/factorylm_snapshot.snapshot_to_ingest_batch   (PR 3, #3059)
      → mira-relay/tag_ingest.ingest_batch, fail-closed allowlist seeded from
        the REAL seed file tools/seeds/approved_tags_factorylm_conv_simple.sql
      → persisted rows → shared.factorylm_live.overlay_from_cache_rows (PR 4)
      → materialized_evidence.context_contract.overlay_from_factorylm_snapshot
        (PR 1, #3052) and shared.technician_context.augment_with_live
      → ONE TechnicianContext manifest (manifest_of)

PRD proof-point coverage (see the runbook for the full matrix):

  1. simulated canonical snapshot          — TestStep1CanonicalSnapshot
  2. existing authorized ingress accepts   — TestStep2IngressAccepts
  3. MIRA builds TechnicianContext.live    — TestStep3OverlayBuilt
  4. prompt projection and manifest agree  — TestStep4OneContextOneManifest
  5. answer uses the live evidence         — TestStep5ServedBackAtTurnTime
     (in-process: ingested rows served back through PR 4's read-back path;
     the LLM-answer half is the supervised live probe in the runbook)
  6. malformed/unauthorized/stale controls fail safely — TestStep6FailSafeControls
  7. no PLC/CMMS/KG/control write occurs   — TestStep7NoWrites

Steps 5's read-back cases importorskip `shared.factorylm_live` (PR 4, #3061):
they activate automatically the moment that PR merges, and skip with an
explicit reason until then. Everything else runs on today's `main`.

Hermetic by design: in-memory TagStore (the same double mira-relay's own
suite uses), no network, no DB, no clocks beyond the fixtures' own
timestamps — safe for any CI sweep.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
_MIRA_RELAY = REPO_ROOT / "mira-relay"
_MIRA_RELAY_TESTS = _MIRA_RELAY / "tests"
_MIRA_BOTS = REPO_ROOT / "mira-bots"
for _p in (str(REPO_ROOT), str(_MIRA_RELAY), str(_MIRA_RELAY_TESTS), str(_MIRA_BOTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from factorylm_snapshot import (  # noqa: E402  (mira-relay, PR 3)
    FACTORYLM_SOURCE_SYSTEM,
    SnapshotContractError,
    snapshot_to_ingest_batch,
)
from tag_ingest import IngestError, ingest_batch  # noqa: E402  (mira-relay)
from test_tag_ingest import InMemoryTagStore  # noqa: E402  (the canonical store double)

from materialized_evidence.context_contract import (  # noqa: E402  (PR 1)
    Freshness,
    overlay_from_factorylm_snapshot,
)
from shared.technician_context import (  # noqa: E402  (PR 1)
    augment_with_live,
    build_turn_context,
    manifest_of,
)

FIXTURES = REPO_ROOT / "contracts" / "machine_snapshot"
SEED_SQL = REPO_ROOT / "tools" / "seeds" / "approved_tags_factorylm_conv_simple.sql"

TENANT = "3f4d5e6a-7b8c-4d9e-8f01-2a3b4c5d6e7f"
OTHER_TENANT = "9e8d7c6b-5a49-4382-b1a0-ffeeddccbbaa"

# The PRD's canonical conv_simple vocabulary — what the FactoryLM producer
# emits and what the seed allowlists.
CANONICAL_TAGS = frozenset(
    {
        "conv_simple.motor_run",
        "conv_simple.vfd_speed_hz",
        "conv_simple.vfd_current_amps",
        "conv_simple.fault_code",
        "conv_simple.comm_ok",
        "conv_simple.height_sensor_mm",
        "conv_simple.sort_divert_active",
    }
)

# Matches each VALUES row of the seed:  'plc_bridge', '<src>', '<norm>', '<uns>'::ltree
_SEED_ROW_RE = re.compile(
    r"'plc_bridge',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'::ltree"
)


def _fixture(name: str) -> dict:
    with open(FIXTURES / name, encoding="utf-8") as fh:
        return json.load(fh)


def _seed_rows() -> list[tuple[str, str, str]]:
    """(source_tag_path, normalized_tag_path, uns_path) rows parsed from the
    REAL seed SQL — so this proof also fails if the seed file drifts from the
    producer vocabulary or from normalize_tag_path semantics."""
    rows = _SEED_ROW_RE.findall(SEED_SQL.read_text(encoding="utf-8"))
    assert rows, "seed file parsed empty — regex or seed drifted"
    return rows


class _TenantScopedStore(InMemoryTagStore):
    """The shared in-memory double, made tenant-aware the way NeonTagStore is:
    an allowlist row only matches the tenant it was seeded for."""

    def __init__(self, tenant_id: str, allowlist: dict) -> None:
        super().__init__(allowlist)
        self._tenant_id = tenant_id

    def load_allowlist(self, tenant_id: str, source_system: str) -> dict:
        if tenant_id != self._tenant_id:
            return {}
        return super().load_allowlist(tenant_id, source_system)


def _seeded_store(tenant_id: str = TENANT) -> _TenantScopedStore:
    allow = {norm: uns for (_src, norm, uns) in _seed_rows()}
    return _TenantScopedStore(tenant_id, {FACTORYLM_SOURCE_SYSTEM: allow})


def _base_ctx():
    ctx, violations = build_turn_context(
        tenant_id=TENANT,
        question="why is the conveyor stopped?",
        uns_context={
            "asset": "conv_simple",
            "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
            "source": "direct_connection",
            "confidence": "certified",
        },
        prior_decisions=[],
    )
    assert ctx is not None, f"base context failed to build: {violations}"
    return ctx


# ── Step 1 — FactoryLM simulated canonical snapshot ─────────────────────────


class TestStep1CanonicalSnapshot:
    def test_fixture_carries_the_full_canonical_vocabulary(self):
        """The shared fixture IS the producer's corpus (byte-identical across
        repos — factorylm #198 / MIRA #3058), so proving it here proves the
        producer side of the boundary."""
        snap = _fixture("snapshot_v1_valid.json")
        assert snap["schema_version"] == "factorylm.machine-snapshot.v1"
        assert snap["source_system"] == FACTORYLM_SOURCE_SYSTEM
        assert {t["tag_path"] for t in snap["tags"]} == CANONICAL_TAGS

    def test_seed_matches_the_producer_vocabulary(self):
        """The allowlist seed and the producer must agree on the seven tags —
        the exact drift class that makes a wired handoff deliver nothing."""
        assert {src for (src, _n, _u) in _seed_rows()} == CANONICAL_TAGS


# ── Step 2 — the existing authorized ingress accepts it ─────────────────────


class TestStep2IngressAccepts:
    def test_authorized_snapshot_fully_accepted(self):
        """accepted == len(tags) AND rejected == [] — never just HTTP 200,
        because the fail-closed allowlist makes an unseeded tenant look like
        success at the status-code level."""
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store()
        result = ingest_batch(
            snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, store
        )
        assert result.accepted == len(snap["tags"]) == 7
        assert result.rejected == []
        assert result.events_written == 7
        assert result.state_upserts == 7
        # snapshot-scoped fields survived into per-tag metadata (PRD mapping)
        for row in store.events:
            meta = row.metadata["factorylm_snapshot"]
            assert meta["machine_state"] == snap["machine_state"]
            assert meta["snapshot_id"] == snap["snapshot_id"]
        # UNS identity came from the SEED (allowlist), not the envelope
        assert all(
            row.uns_path == "enterprise.home_garage.conveyor_lab.conveyor_1"
            for row in store.events
        )

    def test_unseeded_allowlist_is_loud_not_vacuous(self):
        """The PRD's amended warning, pinned: without the seed a valid snapshot
        yields accepted=0 with every tag rejected — the handoff would look
        wired and deliver nothing."""
        snap = _fixture("snapshot_v1_valid.json")
        store = _TenantScopedStore(TENANT, {})
        result = ingest_batch(
            snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, store
        )
        assert result.accepted == 0
        assert len(result.rejected) == 7
        assert {r.reason for r in result.rejected} == {"not_allowlisted"}
        assert store.events == []

    def test_duplicate_snapshot_is_deterministic(self):
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store()
        batch = snapshot_to_ingest_batch(snap, tenant_id=TENANT)
        first = ingest_batch(batch, TENANT, store)
        second = ingest_batch(batch, TENANT, store)
        assert first.as_dict() == second.as_dict()
        assert len(store.events) == 14  # append-only truth stream keeps both
        assert len(store.state) == 7  # latest-value cache stays one row per tag


# ── Step 3 — MIRA builds TechnicianContext.live ─────────────────────────────


class TestStep3OverlayBuilt:
    def test_adapter_builds_the_overlay_from_the_shared_fixture(self):
        overlay, violations = overlay_from_factorylm_snapshot(
            _fixture("snapshot_v1_valid.json")
        )
        assert violations == []
        assert overlay is not None
        assert overlay.machine_state == "running"
        assert len(overlay.tags) == 7
        assert overlay.freshness_summary.get("live", 0) == 6
        assert overlay.freshness_summary.get("stale", 0) == 1


# ── Step 4 — prompt projection and saved manifest agree ─────────────────────


class TestStep4OneContextOneManifest:
    def test_one_context_carries_the_live_overlay_and_hash_is_deterministic(self):
        """ONE context object, re-validated, ONE manifest (ADR-0033). The
        manifest is what the audit row stores and what the prompt is projected
        from — same object, so agreement is structural, not coincidental."""
        snap = _fixture("snapshot_v1_valid.json")
        base = _base_ctx()
        combined, violations = augment_with_live(base, snap)
        assert violations == []
        assert combined is not None
        assert combined.live is not None

        payload, sha = manifest_of(combined)
        payload2, sha2 = manifest_of(combined)
        assert sha == sha2  # deterministic — divergence would be undetectable otherwise
        assert payload == payload2

        # The manifest's live family is exactly the adapter's overlay
        overlay, _ = overlay_from_factorylm_snapshot(snap)
        expected_live = augment_with_live(base, overlay)[0].to_dict()["live"]
        assert payload["live"] == expected_live

    def test_manifest_hash_changes_only_when_context_changes(self):
        base = _base_ctx()
        _, base_sha = manifest_of(base)
        combined, _ = augment_with_live(base, _fixture("snapshot_v1_valid.json"))
        _, live_sha = manifest_of(combined)
        assert base_sha != live_sha  # live evidence IS a context change
        _, base_sha_again = manifest_of(base)
        assert base_sha == base_sha_again  # base ctx untouched by augmentation


# ── Step 5 — the served path: ingested state read back at turn time ─────────


def _cache_rows_from_store(store: InMemoryTagStore) -> list[dict]:
    """Map the store's persisted state rows to the dict shape
    fetch_live_signal_cache returns — the same columns NeonTagStore upserts
    (value → text/numeric/bool exactly as tag_ingest._value_columns does),
    plus the two things the hardened reader requires: ``properties`` carrying
    the persisted ``metadata.factorylm_snapshot`` identity, and the source
    ``event_timestamp`` (never the cache's server-receipt time)."""
    from tag_ingest import _value_columns

    rows = []
    for tag_path, row in store.state.items():
        text, numeric, boolean = _value_columns(row.value_type, row.value)
        rows.append(
            {
                "tag_path": tag_path,
                "uns_path": row.uns_path,
                "last_value_text": text,
                "last_value_numeric": numeric,
                "last_value_bool": boolean,
                "latest_quality": row.quality,
                "freshness_status": "live",
                "simulated": row.simulated,
                "properties": row.metadata,
                "event_timestamp": row.event_timestamp,
            }
        )
    return rows


class TestStep5ServedBackAtTurnTime:
    """PR 4's read-back path (#3061). importorskip until it merges — these
    activate automatically when `shared.factorylm_live` lands on main. The
    LLM-answer half of step 5 is the supervised live probe in the runbook."""

    def test_ingested_snapshot_is_served_back_into_one_context(self):
        fl = pytest.importorskip(
            "shared.factorylm_live",
            reason="PR 4 (#3061) not merged — step 5 activates when it lands",
        )
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store()
        result = ingest_batch(
            snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, store
        )
        assert result.accepted == 7

        overlay = fl.overlay_from_cache_rows(_cache_rows_from_store(store))
        assert overlay is not None
        assert len(overlay.tags) == 7
        assert [t.tag_path for t in overlay.tags] == sorted(
            t.tag_path for t in overlay.tags
        )  # deterministic order → deterministic manifest hash
        # snapshot-level state survived the persistence round-trip: served from
        # the stored metadata.factorylm_snapshot, not invented by the reader
        assert overlay.machine_state == snap["machine_state"]
        # observed_at is each tag's SOURCE observation timestamp (verbatim from
        # the envelope, incl. the stale tag's earlier one), never receipt time
        envelope_observed = {t["tag_path"]: t["observed_at"] for t in snap["tags"]}
        assert {t.tag_path: t.observed_at for t in overlay.tags} == envelope_observed

        combined, violations = augment_with_live(_base_ctx(), overlay)
        assert violations == []
        payload, _ = manifest_of(combined)
        served_paths = {t["tag_path"] for t in payload["live"]["tags"]}
        assert served_paths == CANONICAL_TAGS

    def test_no_rows_means_no_overlay_not_a_failure(self):
        fl = pytest.importorskip(
            "shared.factorylm_live",
            reason="PR 4 (#3061) not merged — step 5 activates when it lands",
        )
        assert fl.overlay_from_cache_rows([]) is None

    def test_generic_cache_rows_are_never_relabeled_as_factorylm_evidence(self):
        """The hardened reader requires the persisted snapshot identity on every
        row — a generic PLC cache row (no metadata.factorylm_snapshot) yields
        no overlay, it does not get dressed up as FactoryLM evidence."""
        fl = pytest.importorskip(
            "shared.factorylm_live",
            reason="PR 4 (#3061) not merged — step 5 activates when it lands",
        )
        overlay = fl.overlay_from_cache_rows(
            [
                {
                    "tag_path": "conv_simple.motor_run",
                    "last_value_bool": True,
                    "latest_quality": "good",
                    "freshness_status": "live",
                    "simulated": False,
                    "event_timestamp": "2026-08-01T12:00:00Z",
                    "properties": {},
                }
            ]
        )
        assert overlay is None


# ── Step 6 — malformed / unauthorized / stale control cases fail safely ─────


class TestStep6FailSafeControls:
    @pytest.mark.parametrize(
        "name",
        [
            "snapshot_v1_invalid_missing_timestamp.json",
            "snapshot_v1_invalid_schema_version.json",
        ],
    )
    def test_malformed_envelope_is_refused_at_the_transport(self, name):
        with pytest.raises(SnapshotContractError):
            snapshot_to_ingest_batch(_fixture(name), tenant_id=TENANT)

    def test_malformed_tag_entries_are_observable_rejections(self):
        snap = _fixture("snapshot_v1_invalid_malformed_tags.json")
        result = ingest_batch(
            snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, _seeded_store()
        )
        assert result.accepted == 0
        assert result.rejected  # rejected with reasons, never silently dropped

    def test_malformed_snapshot_does_not_poison_the_context(self):
        """Fail-open: a bad envelope means no live overlay this turn — the
        base context (and therefore the diagnosis) is unaffected."""
        base = _base_ctx()
        _, sha_before = manifest_of(base)
        combined, violations = augment_with_live(
            base, _fixture("snapshot_v1_invalid_schema_version.json")
        )
        assert combined is None
        assert violations
        _, sha_after = manifest_of(base)
        assert sha_before == sha_after

    def test_wrong_tenant_is_denied_by_the_fail_closed_allowlist(self):
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store(tenant_id=TENANT)
        result = ingest_batch(
            snapshot_to_ingest_batch(snap, tenant_id=OTHER_TENANT), OTHER_TENANT, store
        )
        assert result.accepted == 0
        assert {r.reason for r in result.rejected} == {"not_allowlisted"}

    def test_wrong_source_system_is_rejected_at_the_door(self):
        snap = _fixture("snapshot_v1_valid.json")
        snap["source_system"] = "factorylm-plc-modbus"  # the pre-amendment value
        with pytest.raises(IngestError):
            ingest_batch(
                snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, _seeded_store()
            )

    def test_unauthorized_hmac_fails_closed(self):
        from auth import sign_hmac_headers, verify_hmac

        body = json.dumps({"any": "payload"}).encode()
        headers = sign_hmac_headers(TENANT, body, "right-key")
        assert verify_hmac(headers, body, "right-key") == TENANT
        with pytest.raises(ValueError):
            verify_hmac(headers, body, "wrong-key")

    def test_stale_quality_never_becomes_live(self):
        overlay, _ = overlay_from_factorylm_snapshot(_fixture("snapshot_v1_valid.json"))
        by_path = {t.tag_path: t for t in overlay.tags}
        assert by_path["conv_simple.height_sensor_mm"].freshness is Freshness.STALE

    def test_stale_quality_never_becomes_live_ON_THE_DEPLOYED_PATH(self):
        """The same guarantee as above, but through ingest → cache → read-back.

        REGRESSION. The assertion above runs on PR 1's DIRECT adapter, which maps
        quality→freshness itself. The deployed path does not go through it: the
        snapshot is persisted and re-read, and `_freshness_for` originally
        consulted only `freshness_status` — which `persist_batch` stamps 'live'
        for every non-simulated row, because that column means COLLECTOR
        liveness. So `conv_simple.height_sensor_mm`, which the producer marks
        `quality="stale"`, came back LIVE with a summary of {live: 7}: the
        technician saw a reading the producer had already doubted as current.

        Both suites passed throughout — each side was self-consistent, and no
        test crossed the seam with a degraded tag. That is the whole reason this
        one exists.
        """
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store()
        result = ingest_batch(snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, store)
        assert result.accepted == 7 and result.rejected == []

        fl = pytest.importorskip("shared.factorylm_live")
        overlay = fl.overlay_from_cache_rows(_cache_rows_from_store(store))
        assert overlay is not None

        by_path = {t.tag_path: t for t in overlay.tags}
        assert by_path["conv_simple.height_sensor_mm"].freshness is Freshness.STALE
        # …and it is DOWNGRADED, not dropped: all 7 tags still reach the overlay.
        assert len(overlay.tags) == 7
        # The summary a technician-facing block renders must agree with the
        # producer — and with the direct-adapter path, which yields the same.
        assert overlay.freshness_summary.get("live", 0) == 6
        assert overlay.freshness_summary.get("stale", 0) == 1

    def test_both_overlay_paths_agree_on_freshness(self):
        """One snapshot must not produce two different answers.

        `overlay_from_factorylm_snapshot` (direct) and `overlay_from_cache_rows`
        (deployed) are separate implementations reached by separate callers. If
        they disagree, one of them is lying to a technician — and which one you
        get depends on plumbing they cannot see.
        """
        snap = _fixture("snapshot_v1_valid.json")
        store = _seeded_store()
        ingest_batch(snapshot_to_ingest_batch(snap, tenant_id=TENANT), TENANT, store)

        fl = pytest.importorskip("shared.factorylm_live")
        deployed = fl.overlay_from_cache_rows(_cache_rows_from_store(store))
        direct, _ = overlay_from_factorylm_snapshot(snap)

        assert deployed.freshness_summary == direct.freshness_summary
        assert {t.tag_path: t.freshness for t in deployed.tags} == {
            t.tag_path: t.freshness for t in direct.tags
        }

    def test_stale_cache_row_served_as_stale_not_dropped(self):
        fl = pytest.importorskip(
            "shared.factorylm_live",
            reason="PR 4 (#3061) not merged — stale read-back activates when it lands",
        )
        overlay = fl.overlay_from_cache_rows(
            [
                {
                    "tag_path": "conv_simple.motor_run",
                    "last_value_bool": True,
                    "latest_quality": "good",
                    "freshness_status": "stale",
                    "simulated": False,
                    "event_timestamp": "2026-08-01T00:00:00Z",
                    "properties": {
                        "factorylm_snapshot": {
                            "schema_version": "factorylm.machine-snapshot.v1",
                            "snapshot_id": "snap-stale-0001",
                            "captured_at": "2026-08-01T00:00:00Z",
                            "machine_state": "running",
                            "active_conditions": [],
                        }
                    },
                }
            ]
        )
        assert overlay is not None
        assert overlay.tags[0].freshness is Freshness.STALE


# ── Step 7 — no PLC, CMMS, KG, or control write occurs ──────────────────────


_FORBIDDEN_IN_SOURCE = (
    "pymodbus",
    "pycomm3",
    "snap7",
    "opcua",
    "write_coil",
    "write_register",
    "write_coils",
    "write_registers",
)


class TestStep7NoWrites:
    def test_chain_modules_carry_no_fieldbus_or_write_capability(self):
        sources = [
            _MIRA_RELAY / "factorylm_snapshot.py",
            REPO_ROOT / "materialized_evidence" / "context_contract.py",
            _MIRA_BOTS / "shared" / "technician_context.py",
        ]
        pr4 = _MIRA_BOTS / "shared" / "factorylm_live.py"
        if pr4.exists():  # PR 4 joins the sweep the moment it lands
            sources.append(pr4)
        for path in sources:
            src = path.read_text(encoding="utf-8")
            for token in _FORBIDDEN_IN_SOURCE:
                assert token not in src, f"{token} in {path.name}"

    def test_full_chain_imports_no_fieldbus_client(self):
        """After every proof above has exercised the whole chain in this
        process, no fieldbus client module may be loaded."""
        loaded = [m for m in sys.modules if "pymodbus" in m or "pycomm3" in m]
        assert loaded == []

    def test_envelope_is_observation_only(self):
        snap = _fixture("snapshot_v1_valid.json")

        def walk(obj):
            if isinstance(obj, dict):
                for key, val in obj.items():
                    lowered = str(key).lower()
                    assert not any(
                        tok in lowered
                        for tok in ("command", "write", "actuate", "setpoint", "control")
                    ), key
                    walk(val)
            elif isinstance(obj, list):
                for item in obj:
                    walk(item)

        walk(snap)

    def test_ingress_wrote_only_observation_rows(self):
        store = _seeded_store()
        ingest_batch(
            snapshot_to_ingest_batch(
                _fixture("snapshot_v1_valid.json"), tenant_id=TENANT
            ),
            TENANT,
            store,
        )
        for row in store.events:
            assert row.tag_path in CANONICAL_TAGS
            assert row.source_system == FACTORYLM_SOURCE_SYSTEM
