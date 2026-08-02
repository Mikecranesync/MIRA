"""PR-4 — FactoryLM live state is read back and served through the ONE context path.

Covers the PRD #3048 PR-4 acceptance requirements at the unit seam:

- The overlay is built from persisted ``live_signal_cache`` rows read back at turn
  time (never a snapshot threaded inline).
- Freshness/timestamps come from the stored row, never ``now()`` — two reads of
  the same rows produce a byte-identical overlay and a stable manifest hash.
- A ``simulated`` row is never presented as real telemetry (→ SIMULATED); a stale
  row maps to STALE (not dropped).
- The overlay folds into ``TechnicianContext.live`` so prompt AND manifest carry
  the SAME live overlay (lockstep).
- The FactoryLM live block does not create duplicate ``[LIVE EQUIPMENT STATUS]``
  content.
- Flag off / no confirmed asset → no overlay (no behavior change).
"""

from __future__ import annotations

import datetime
import os
import sys
import types
import unittest.mock

os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_flm_live_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "staging")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

for _mod in ("PIL", "PIL.Image", "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors"):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

from shared.factorylm_live import (  # noqa: E402
    _freshness_for,
    fetch_live_signal_cache,
    overlay_from_cache_rows,
)
from shared.technician_context import (  # noqa: E402
    augment_with_live,
    build_turn_context,
    live_prompt_block,
    manifest_of,
)

TENANT = "staging"

# A fixed observation time — the whole point is that nothing here reads now().
_T0 = datetime.datetime(2026, 8, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
_SOURCE_T0 = datetime.datetime(2026, 8, 1, 11, 59, 30, tzinfo=datetime.timezone.utc)


def _snapshot_metadata(**overrides):
    """The snapshot-scoped metadata PR 3 persists on every cache row."""
    meta = {
        "schema_version": "factorylm.machine-snapshot.v1",
        "snapshot_id": "b0f4e2a1-3c5d-4e6f-8a90-1b2c3d4e5f60",
        "captured_at": _T0.isoformat(),
        "machine_state": "faulted",
        "active_conditions": ["fault_code_active"],
    }
    meta.update(overrides)
    return meta


def _rows(**overrides):
    """Two live_signal_cache rows for one asset, unsorted, with a fixed timestamp."""
    base = [
        {
            "tag_path": "conv_simple.vfd_speed_hz",
            "last_value_text": None,
            "last_value_numeric": 42.5,
            "last_value_bool": None,
            "last_seen_at": _T0,
            "latest_quality": "good",
            "freshness_status": "live",
            "simulated": False,
            "properties": {"factorylm_snapshot": _snapshot_metadata()},
            "event_timestamp": _SOURCE_T0,
        },
        {
            "tag_path": "conv_simple.run_state",
            "last_value_text": None,
            "last_value_numeric": None,
            "last_value_bool": True,
            "last_seen_at": _T0,
            "latest_quality": "good",
            "freshness_status": "live",
            "simulated": False,
            "properties": {"factorylm_snapshot": _snapshot_metadata()},
            "event_timestamp": _SOURCE_T0,
        },
    ]
    for r in base:
        r.update(overrides)
    return base


# --- the freshness mapping ------------------------------------------------------


def test_simulated_row_never_becomes_live():
    assert _freshness_for("live", simulated=True) == "simulated"
    assert _freshness_for("good", simulated=True) == "simulated"


def test_stale_row_maps_to_stale_not_dropped():
    assert _freshness_for("stale", simulated=False) == "stale"


def test_unknown_band_never_upgraded():
    assert _freshness_for(None, simulated=False) == "unknown"
    assert _freshness_for("weird", simulated=False) == "unknown"


# --- the pure overlay builder ---------------------------------------------------


def test_overlay_preserves_snapshot_state_and_source_timestamp():
    overlay = overlay_from_cache_rows(_rows())
    assert overlay is not None
    # PR 3 persisted these under properties.factorylm_snapshot. Losing them would
    # make a real fault look like an unknown state even with healthy cache tags.
    assert overlay.machine_state == "faulted"
    assert overlay.active_conditions == ["fault_code_active"]
    tags = {t.tag_path: t for t in overlay.tags}
    assert set(tags) == {"conv_simple.vfd_speed_hz", "conv_simple.run_state"}
    spd = tags["conv_simple.vfd_speed_hz"]
    assert spd.value == 42.5
    assert spd.quality == "good"
    assert spd.freshness.value == "live"
    # observed_at is the source event time from tag_events, not cache receipt time.
    assert spd.observed_at == _SOURCE_T0.isoformat()
    assert spd.observed_at != _T0.isoformat()
    assert overlay.freshness_summary == {"live": 2}


def test_empty_rows_yield_no_overlay():
    assert overlay_from_cache_rows([]) is None


def test_simulated_rows_render_as_simulated():
    overlay = overlay_from_cache_rows(_rows(simulated=True))
    assert all(t.freshness.value == "simulated" for t in overlay.tags)
    assert overlay.freshness_summary == {"simulated": 2}


def test_overlay_is_deterministic_regardless_of_row_order():
    forward = overlay_from_cache_rows(_rows())
    reversed_rows = list(reversed(_rows()))
    backward = overlay_from_cache_rows(reversed_rows)
    # byte-identical serialization → identical manifest contribution
    assert forward.to_dict() == backward.to_dict()


def test_overlay_rejects_mixed_snapshot_cache_rows():
    """A state claim cannot be combined with tags from a different snapshot."""
    rows = _rows()
    rows[1]["properties"]["factorylm_snapshot"] = _snapshot_metadata(snapshot_id="other-snapshot")

    assert overlay_from_cache_rows(rows) is None


def test_overlay_rejects_cache_rows_without_factorylm_snapshot_metadata():
    """A generic PLC row must never be relabeled as FactoryLM evidence."""
    rows = _rows()
    rows[0]["properties"] = {}

    assert overlay_from_cache_rows(rows) is None


def test_overlay_rejects_rows_without_a_source_event_timestamp():
    """Cache receipt time is not a safe substitute for a source observation time."""
    rows = _rows()
    rows[0]["event_timestamp"] = None

    assert overlay_from_cache_rows(rows) is None


# --- lockstep: prompt AND manifest carry the SAME overlay -----------------------


def _base_ctx():
    ctx, violations = build_turn_context(
        tenant_id=TENANT, question="why is the conveyor slow?", uns_context={}, prior_decisions=[]
    )
    assert ctx is not None and violations == []
    return ctx


def test_fold_puts_the_same_overlay_in_prompt_and_manifest():
    overlay = overlay_from_cache_rows(_rows())
    combined, violations = augment_with_live(_base_ctx(), overlay)
    assert violations == [] and combined is not None

    payload, sha = manifest_of(combined)
    assert len(sha) == 64
    manifest_tags = {t["tag_path"] for t in payload["live"]["tags"]}

    block = live_prompt_block(overlay)
    # the prompt block names every tag the manifest carries — one overlay, two views
    for tp in manifest_tags:
        assert tp in block


def test_live_block_is_not_the_legacy_equipment_status_block():
    block = live_prompt_block(overlay_from_cache_rows(_rows()))
    assert "LIVE MACHINE STATE" in block
    assert "[machine_state: faulted" in block
    assert "[active_condition: fault_code_active]" in block
    assert "[live_tag conv_simple.run_state" in block
    assert _SOURCE_T0.isoformat() in block
    # the dedup contract: this is NOT the legacy fault-detective block
    assert "LIVE EQUIPMENT STATUS" not in block


def test_empty_overlay_costs_zero_prompt_bytes():
    assert live_prompt_block(None) == ""
    assert live_prompt_block(overlay_from_cache_rows([])) == ""


def test_manifest_hash_stable_across_two_reads_of_the_same_rows():
    a = augment_with_live(_base_ctx(), overlay_from_cache_rows(_rows()))[0]
    b = augment_with_live(_base_ctx(), overlay_from_cache_rows(_rows()))[0]
    assert manifest_of(a)[1] == manifest_of(b)[1]


# --- the engine read-back seam (gating + asset scoping) -------------------------

import asyncio  # noqa: E402

import shared.engine as engine  # noqa: E402


def _call_overlay(state, tenant, *, flag):
    """Drive Supervisor._build_factorylm_live_overlay with a bare self.

    ``flag=True`` enables the full PR-4 path — both the FactoryLM sub-flag and the
    context contract it folds into (the overlay only reaches prompt+manifest via
    the contract's turn_ctx, so the read is gated under both).
    """
    contract = "1" if flag else ""
    with (
        unittest.mock.patch.object(engine, "_FACTORYLM_LIVE_ENABLED", flag),
        unittest.mock.patch.dict(os.environ, {"MIRA_CONTEXT_CONTRACT": contract}),
    ):
        method = engine.Supervisor._build_factorylm_live_overlay
        return asyncio.run(method(unittest.mock.MagicMock(), state, tenant))


def test_readback_returns_none_when_flag_off():
    # Flag off → no read at all, no behavior change (the fetch is never reached).
    with unittest.mock.patch("shared.factorylm_live.fetch_live_signal_cache") as fetch:
        out = _call_overlay({"asset_identified": "PowerFlex 525"}, TENANT, flag=False)
    assert out is None
    fetch.assert_not_called()


def test_readback_returns_none_without_a_confirmed_asset():
    out = _call_overlay({"asset_identified": ""}, TENANT, flag=True)
    assert out is None
    out2 = _call_overlay({}, TENANT, flag=True)
    assert out2 is None


def test_readback_scopes_to_the_turns_established_asset_subtree():
    captured = {}

    def _fake_fetch(tenant_id, ltree_prefix):
        captured["tenant"] = tenant_id
        captured["prefix"] = ltree_prefix
        return _rows()

    with (
        unittest.mock.patch("shared.factorylm_live.fetch_live_signal_cache", _fake_fetch),
        unittest.mock.patch.object(engine, "resolve_uns_path") as resolve,
    ):
        out = _call_overlay(
            {
                "asset_identified": "CV-101",
                "context": {"uns_context": {"uns_path": "enterprise.site1.line1.conv_simple"}},
            },
            TENANT,
            flag=True,
        )

    assert out is not None
    assert len(out.tags) == 2
    # Use the same persisted turn identity that TechnicianContext carries. A
    # display-name re-resolution can only produce a KB taxonomy path (or none),
    # not the confirmed physical asset that the relay allowlist bound.
    resolve.assert_not_called()
    # scoped to the established asset subtree, and to the caller's tenant
    assert captured["prefix"] == "enterprise.site1.line1.conv_simple"
    assert captured["tenant"] == TENANT


def test_cache_readback_queries_only_v1_factorylm_rows_and_keeps_event_time():
    """The database boundary must not relabel arbitrary PLC cache rows as FactoryLM."""

    class _Cursor:
        def __init__(self):
            self.query = ""
            self.params = ()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, query, params):
            self.query = query
            self.params = params

        def fetchall(self):
            return [
                (
                    "conv_simple.motor_run",
                    None,
                    None,
                    True,
                    _T0,
                    "good",
                    "live",
                    False,
                    {"factorylm_snapshot": _snapshot_metadata()},
                    _SOURCE_T0,
                )
            ]

    class _Connection:
        def __init__(self):
            self.cursor_obj = _Cursor()
            self.closed = False

        def cursor(self):
            return self.cursor_obj

        def close(self):
            self.closed = True

    connection = _Connection()
    fake_psycopg2 = types.SimpleNamespace(connect=lambda _url: connection)
    with (
        unittest.mock.patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://test"}),
        unittest.mock.patch.dict(sys.modules, {"psycopg2": fake_psycopg2}),
    ):
        rows = fetch_live_signal_cache(TENANT, "enterprise.site1.line1.conv_simple")

    assert connection.closed is True
    assert rows[0]["event_timestamp"] == _SOURCE_T0
    assert rows[0]["properties"]["factorylm_snapshot"]["machine_state"] == "faulted"
    assert "properties ? 'factorylm_snapshot'" in connection.cursor_obj.query
    assert "tag_events" in connection.cursor_obj.query
    assert "event_timestamp" in connection.cursor_obj.query
    assert connection.cursor_obj.params[2:4] == ("plc_bridge", "factorylm.machine-snapshot.v1")


# ── asset-resolution fallback (2026-08-02 live-probe finding) ────────────────
#
# The vendor/model resolver returns uns_path=None for equipment names like
# "CV-101", so a turn whose uns_context carries no path could NEVER reach the
# overlay — on the chat path AND the QR path. The fallback resolves the same
# physical identity source the allowlist seed and QR deep-link use
# (cmms_equipment.uns_path), tenant-scoped, fail-open.


def test_readback_falls_back_to_equipment_lookup_when_no_uns_path():
    captured = {}

    def _fake_fetch(tenant_id, ltree_prefix):
        captured["prefix"] = ltree_prefix
        return _rows()

    def _fake_lookup(tenant_id, *candidates):
        captured["lookup"] = (tenant_id, candidates)
        return "enterprise.home_garage.conveyor_lab.conveyor_1"

    with (
        unittest.mock.patch("shared.factorylm_live.fetch_live_signal_cache", _fake_fetch),
        unittest.mock.patch("shared.factorylm_live.uns_prefix_for_asset", _fake_lookup),
    ):
        out = _call_overlay(
            {"asset_identified": "CV-101", "context": {"asset_tag": "CV-101"}},
            TENANT,
            flag=True,
        )

    assert out is not None
    assert captured["lookup"] == (TENANT, ("CV-101", "CV-101"))
    assert captured["prefix"] == "enterprise.home_garage.conveyor_lab.conveyor_1"


def test_readback_returns_none_when_equipment_lookup_misses():
    with (
        unittest.mock.patch("shared.factorylm_live.fetch_live_signal_cache") as fetch,
        unittest.mock.patch(
            "shared.factorylm_live.uns_prefix_for_asset", return_value=None
        ),
    ):
        out = _call_overlay({"asset_identified": "Mystery Machine"}, TENANT, flag=True)
    assert out is None
    fetch.assert_not_called()


def _lookup_db(rows_by_query):
    """Fake psycopg2 whose cursor answers exact-tag then description queries."""

    class _Cursor:
        def __init__(self):
            self.queries = []
            self._last = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, query, params):
            self.queries.append((query, params))
            key = "tag" if "equipment_number" in query else "description"
            self._last = rows_by_query.get(key, [])

        def fetchone(self):
            return self._last[0] if self._last else None

        def fetchall(self):
            return list(self._last)

    class _Connection:
        def __init__(self):
            self.cursor_obj = _Cursor()

        def cursor(self):
            return self.cursor_obj

        def close(self):
            pass

    conn = _Connection()
    return conn, types.SimpleNamespace(connect=lambda _url: conn)


def test_uns_prefix_for_asset_matches_equipment_number_first():
    from shared.factorylm_live import uns_prefix_for_asset

    conn, fake = _lookup_db({"tag": [("enterprise.home_garage.conveyor_lab.conveyor_1",)]})
    with (
        unittest.mock.patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://test"}),
        unittest.mock.patch.dict(sys.modules, {"psycopg2": fake}),
    ):
        path = uns_prefix_for_asset(TENANT, "cv-101")
    assert path == "enterprise.home_garage.conveyor_lab.conveyor_1"
    query, params = conn.cursor_obj.queries[0]
    assert "upper(equipment_number) = upper(%s)" in query
    assert params == (TENANT, "cv-101")


def test_uns_prefix_for_asset_ambiguous_description_returns_none():
    """Two assets matching a display label must never silently pick one."""
    from shared.factorylm_live import uns_prefix_for_asset

    _conn, fake = _lookup_db(
        {"tag": [], "description": [("enterprise.a.b.c",), ("enterprise.a.b.d",)]}
    )
    with (
        unittest.mock.patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://test"}),
        unittest.mock.patch.dict(sys.modules, {"psycopg2": fake}),
    ):
        assert uns_prefix_for_asset(TENANT, "Conveyor") is None


def test_uns_prefix_for_asset_unique_description_matches():
    from shared.factorylm_live import uns_prefix_for_asset

    _conn, fake = _lookup_db({"tag": [], "description": [("enterprise.home_garage.conveyor_lab.conveyor_1",)]})
    with (
        unittest.mock.patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://test"}),
        unittest.mock.patch.dict(sys.modules, {"psycopg2": fake}),
    ):
        assert (
            uns_prefix_for_asset(TENANT, "Bench Conveyor")
            == "enterprise.home_garage.conveyor_lab.conveyor_1"
        )


def test_uns_prefix_for_asset_never_raises_without_db():
    from shared.factorylm_live import uns_prefix_for_asset

    with unittest.mock.patch.dict(os.environ, {"NEON_DATABASE_URL": ""}):
        assert uns_prefix_for_asset(TENANT, "CV-101") is None
    assert uns_prefix_for_asset("", "CV-101") is None
    assert uns_prefix_for_asset(TENANT) is None
