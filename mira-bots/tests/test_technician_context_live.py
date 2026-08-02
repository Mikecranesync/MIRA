"""WS1 — the LIVE-STATE family folds into the one turn context (PRD #3048, PR 1).

`augment_with_live` sets `TechnicianContext.live` on the SAME context
`build_turn_context` produced, re-validates, and the live payload is present in
`manifest_of(...)` — one context, one manifest (same shape as
`augment_with_retrieval`, #3041).
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import unittest.mock

os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_tc_live_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "staging")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

for _mod in ("PIL", "PIL.Image", "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors"):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

from shared.technician_context import (  # noqa: E402
    augment_with_live,
    build_turn_context,
    manifest_of,
)

TENANT = "staging"
_FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "machine_snapshot"


def _snapshot(name: str = "snapshot_v1_valid.json") -> dict:
    return json.loads((_FIXTURES / name).read_text())


def _base_ctx():
    ctx, violations = build_turn_context(
        tenant_id=TENANT, question="why is the conveyor slow?", uns_context={}, prior_decisions=[]
    )
    assert ctx is not None and violations == []
    return ctx


def test_augment_sets_live_on_the_same_context():
    ctx = _base_ctx()
    assert ctx.live is None
    combined, violations = augment_with_live(ctx, _snapshot())
    assert violations == []
    assert combined is not None
    assert combined.live is not None
    assert combined.live.machine_state == "running"
    # same context object otherwise — evidence untouched, tenant preserved
    assert combined.tenant_id == ctx.tenant_id
    assert combined.evidence == ctx.evidence


def test_manifest_carries_the_live_payload():
    combined, _ = augment_with_live(_base_ctx(), _snapshot())
    payload, sha = manifest_of(combined)
    assert len(sha) == 64
    assert payload["live"] is not None
    assert payload["live"]["machine_state"] == "running"
    assert any(t["tag_path"] == "conv_simple.vfd_speed_hz" for t in payload["live"]["tags"])


def test_invalid_snapshot_yields_no_live_and_a_violation():
    combined, violations = augment_with_live(
        _base_ctx(), _snapshot("snapshot_v1_invalid_missing_tenant.json")
    )
    assert combined is None
    assert "tenant_id:missing" in violations


def test_no_base_context_fails_closed():
    combined, violations = augment_with_live(None, _snapshot())
    assert combined is None
    assert "no_base_context" in violations


def test_accepts_a_prebuilt_overlay_too():
    from materialized_evidence.context_contract import overlay_from_factorylm_snapshot

    overlay, _ = overlay_from_factorylm_snapshot(_snapshot())
    combined, violations = augment_with_live(_base_ctx(), overlay)
    assert violations == []
    assert combined.live is overlay


def test_manifest_hash_changes_only_when_the_context_changes():
    ctx = _base_ctx()
    base_sha = manifest_of(ctx)[1]
    with_live = augment_with_live(ctx, _snapshot())[0]
    assert manifest_of(with_live)[1] != base_sha  # live payload changed the context
    # re-augmenting the SAME snapshot onto the SAME base is deterministic
    again = augment_with_live(ctx, _snapshot())[0]
    assert manifest_of(with_live)[1] == manifest_of(again)[1]
