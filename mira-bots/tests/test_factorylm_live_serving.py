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


def test_overlay_maps_tags_quality_freshness_and_absolute_timestamp():
    overlay = overlay_from_cache_rows(_rows())
    assert overlay is not None
    assert overlay.machine_state == "unknown"  # cache has no snapshot-level state
    assert overlay.active_conditions == []
    tags = {t.tag_path: t for t in overlay.tags}
    assert set(tags) == {"conv_simple.vfd_speed_hz", "conv_simple.run_state"}
    spd = tags["conv_simple.vfd_speed_hz"]
    assert spd.value == 42.5
    assert spd.quality == "good"
    assert spd.freshness.value == "live"
    # observed_at is the STORED timestamp verbatim (absolute), not a read-time delta
    assert spd.observed_at == _T0.isoformat()
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
    assert "[live_tag conv_simple.run_state" in block
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
    with unittest.mock.patch.object(engine, "_FACTORYLM_LIVE_ENABLED", flag), \
         unittest.mock.patch.dict(os.environ, {"MIRA_CONTEXT_CONTRACT": contract}):
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


def test_readback_scopes_to_the_turns_asset_subtree():
    captured = {}

    def _fake_fetch(tenant_id, ltree_prefix):
        captured["tenant"] = tenant_id
        captured["prefix"] = ltree_prefix
        return _rows()

    fake_uns = unittest.mock.MagicMock(uns_path="enterprise.site1.line1.conv_simple")
    with unittest.mock.patch("shared.factorylm_live.fetch_live_signal_cache", _fake_fetch), \
         unittest.mock.patch.object(engine, "resolve_uns_path", return_value=fake_uns):
        out = _call_overlay({"asset_identified": "CV-101"}, TENANT, flag=True)

    assert out is not None
    assert len(out.tags) == 2
    # scoped to the resolved asset subtree, and to the caller's tenant
    assert captured["prefix"] == "enterprise.site1.line1.conv_simple"
    assert captured["tenant"] == TENANT
