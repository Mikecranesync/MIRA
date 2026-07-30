"""Bravo VisualSession → TechnicianContext adapter — hermetic tests.

Proves the one seam this slice adds: serialized VisualSession
evidence/observation/region rows (migration 063 shape) become typed
``EvidenceKind.PRINT_OBSERVATION`` candidate evidence on the common context
contract, with provenance and trust preserved and never fabricated.

No network, no DB, no cross-package import — pure dict-in / EvidenceItem-out.
"""

from __future__ import annotations

import pytest

from materialized_evidence.context_contract import (
    CONTEXT_CONTRACT_VERSION,
    EvidenceKind,
    TaskMode,
    TechnicianContext,
    evidence_from_visual_session,
    to_prompt_block,
    validate_context,
)

# --------------------------------------------------------------------------
# Fixtures — faithful to mira-bots/shared/visual/models.py from_row() shapes
# (the exact serialized column names of migration 063's four ledger tables).
# --------------------------------------------------------------------------


def _evidence_row(**kw):
    row = {
        "evidence_id": "ev-1",
        "session_id": "sess-1",
        "tenant_id": "t-1",
        "source_type": "vision",
        "original_hash": "sha256:aaaa",
        "page_ref": "12",
        "capture_meta": {},
        "metadata": {},
    }
    row.update(kw)
    return row


def _region_row(**kw):
    row = {
        "region_id": "rg-1",
        "evidence_id": "ev-1",
        "tenant_id": "t-1",
        # stored geometry shape from region_schema.to_storage_geometry: a rect
        # is stored as {"type": "bbox", "x", "y", "w", "h"} (normalized 0..1).
        "geometry": {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        "origin": "system",
    }
    row.update(kw)
    return row


def _obs_row(**kw):
    row = {
        "observation_id": "ob-1",
        "session_id": "sess-1",
        "tenant_id": "t-1",
        "evidence_id": "ev-1",
        "region_id": "rg-1",
        "obs_kind": "entity",
        "raw_value": "M1 contactor",
        "normalized_value": "M1 contactor",
        "evidence_state": "VISIBLE",
        "confidence": 0.82,
        "extractor": "vision_worker",
        "review_state": "unreviewed",
        "superseded_by": None,
        "created_at": "2026-07-29T10:00:00Z",
        "metadata": {},
    }
    row.update(kw)
    return row


# --------------------------------------------------------------------------
# 1. Deterministic + unique citation ids
# --------------------------------------------------------------------------
def test_deterministic_and_unique_citation_ids():
    obs = [_obs_row(observation_id="ob-1"), _obs_row(observation_id="ob-2")]
    ev = [_evidence_row()]
    rg = [_region_row()]

    first = evidence_from_visual_session(obs, evidence=ev, regions=rg)
    second = evidence_from_visual_session(obs, evidence=ev, regions=rg)

    assert [e.to_dict() for e in first] == [e.to_dict() for e in second]  # deterministic
    ids = [e.citation_id for e in first]
    assert ids == ["V1", "V2"]
    assert len(set(ids)) == len(ids)  # unique
    assert all(e.kind is EvidenceKind.PRINT_OBSERVATION for e in first)


# --------------------------------------------------------------------------
# 2. Rejected and superseded observations are excluded
# --------------------------------------------------------------------------
def test_rejected_and_superseded_excluded():
    obs = [
        _obs_row(observation_id="keep"),
        _obs_row(observation_id="es-rejected", evidence_state="REJECTED"),
        _obs_row(observation_id="es-superseded", evidence_state="SUPERSEDED"),
        _obs_row(observation_id="review-rejected", review_state="rejected"),
        _obs_row(observation_id="ptr-superseded", superseded_by="ob-99"),
    ]
    out = evidence_from_visual_session(obs, evidence=[_evidence_row()], regions=[_region_row()])
    assert [e.source_locator.split("#observation:")[1] for e in out] == ["keep"]
    assert [e.citation_id for e in out] == ["V1"]  # numbering is over KEPT rows only


# --------------------------------------------------------------------------
# 3. VLM/OCR output cannot self-promote to human-verified trust
# --------------------------------------------------------------------------
def test_model_output_cannot_self_promote_to_verified():
    # Unreviewed model output with max confidence AND a machine-verified state
    # must still be a candidate — only the human review_state raises trust.
    obs = [
        _obs_row(
            review_state="unreviewed",
            confidence=1.0,
            evidence_state="MACHINE_VERIFIED",
        )
    ]
    (item,) = evidence_from_visual_session(obs, evidence=[_evidence_row()], regions=[_region_row()])
    assert item.trust == "candidate"

    # Only human review promotes.
    confirmed = evidence_from_visual_session(
        [_obs_row(review_state="confirmed")], evidence=[_evidence_row()], regions=[_region_row()]
    )
    assert confirmed[0].trust == "verified"


# --------------------------------------------------------------------------
# 4. Existing provenance survives when explicitly present
# --------------------------------------------------------------------------
def test_provenance_survives_when_present():
    (item,) = evidence_from_visual_session(
        [_obs_row()], evidence=[_evidence_row()], regions=[_region_row()]
    )
    assert item.evidence_hash == "sha256:aaaa"  # original_hash carried
    assert item.producer_name == "vision_worker"  # extractor carried
    assert item.observed_at == "2026-07-29T10:00:00Z"  # observation timestamp
    assert item.page == 12  # evidence.page_ref, numeric
    # region stored rect {x,y,w,h} -> contract bbox [x0,y0,x1,y1] = [x, y, x+w, y+h]
    assert item.bbox == [0.1, 0.2, 0.4, 0.6000000000000001] or item.bbox == [
        0.1,
        0.2,
        round(0.1 + 0.3, 6),
        round(0.2 + 0.4, 6),
    ]
    assert item.source_locator == "visual_session:sess-1#observation:ob-1"


def test_model_version_survives_only_when_explicit():
    with_version = _obs_row(metadata={"model_version": "qwen2.5vl:7b"})
    (item,) = evidence_from_visual_session(
        [with_version], evidence=[_evidence_row()], regions=[_region_row()]
    )
    assert item.producer_version == "qwen2.5vl:7b"


# --------------------------------------------------------------------------
# 5. Missing page/bbox/asset stays absent — nothing invented
# --------------------------------------------------------------------------
def test_missing_coordinates_stay_absent():
    # observation with no region link, evidence with no page_ref
    obs = [_obs_row(region_id=None)]
    ev = [_evidence_row(page_ref=None)]
    (item,) = evidence_from_visual_session(obs, evidence=ev, regions=[])
    assert item.page is None
    assert item.bbox is None
    assert item.section is None
    assert item.document_lineage_key is None  # session data is not corpus lineage


def test_non_numeric_page_ref_is_not_invented():
    (item,) = evidence_from_visual_session(
        [_obs_row()], evidence=[_evidence_row(page_ref="sheet A3")], regions=[_region_row()]
    )
    assert item.page is None  # prose page ref never coerced to a number


def test_non_rect_geometry_yields_no_bbox():
    point = _region_row(geometry={"type": "point", "x": 0.5, "y": 0.5})
    (item,) = evidence_from_visual_session(
        [_obs_row()], evidence=[_evidence_row()], regions=[point]
    )
    assert item.bbox is None  # never synthesize a rectangle from a point


def test_missing_evidence_text_is_dropped():
    blank = _obs_row(raw_value=None, normalized_value=None)
    out = evidence_from_visual_session([blank], evidence=[_evidence_row()], regions=[_region_row()])
    assert out == []  # fail-closed: no citable content


# --------------------------------------------------------------------------
# 6. Legacy rendering remains byte-compatible (items flow through the
#    UNCHANGED to_prompt_block renderer)
# --------------------------------------------------------------------------
def test_render_is_byte_stable():
    obs = [
        _obs_row(observation_id="ob-1", normalized_value="M1 contactor", review_state="unreviewed"),
        _obs_row(
            observation_id="ob-2",
            normalized_value="F1 fuse 10A",
            review_state="confirmed",
            region_id=None,
        ),
    ]
    items = evidence_from_visual_session(obs, evidence=[_evidence_row()], regions=[_region_row()])
    ctx = TechnicianContext(
        contract_version=CONTEXT_CONTRACT_VERSION,
        task_mode=TaskMode.PRINTSENSE,
        tenant_id="t-1",
        environment="dev",
        evidence=items,
    )
    expected = (
        "[task_mode: printsense]\n"
        "Evidence [V1] (print_observation, candidate, confidence 0.82, page 12): M1 contactor\n"
        "Evidence [V2] (print_observation, verified, confidence 0.82, page 12): F1 fuse 10A"
    )
    assert to_prompt_block(ctx) == expected
    assert validate_context(ctx) == []  # unique citations, read-only, valid


# --------------------------------------------------------------------------
# 7. A representative VisionWorker→VisualSession serialized shape feeds the
#    adapter with no network access
# --------------------------------------------------------------------------
def test_representative_vision_worker_shape():
    # What session_service persists after a VisionWorker ELECTRICAL_PRINT pass:
    # an evidence row (the captured image), a region (the detected box), and
    # observations tagged with the producing extractor.
    evidence = [
        _evidence_row(
            evidence_id="ev-print",
            source_type="ELECTRICAL_PRINT",
            drawing_type="ladder",
            original_hash="sha256:print",
            page_ref=None,
        )
    ]
    regions = [
        _region_row(
            region_id="rg-print",
            evidence_id="ev-print",
            geometry={"type": "bbox", "x": 0.0, "y": 0.0, "w": 0.5, "h": 0.25},
            origin="system",
        )
    ]
    observations = [
        _obs_row(
            observation_id="ob-vision",
            evidence_id="ev-print",
            region_id="rg-print",
            obs_kind="entity",
            raw_value="contactor",
            normalized_value="M1 contactor (NO)",
            extractor="vision_worker",
            evidence_state="LIKELY",
            review_state="unreviewed",
        ),
        _obs_row(
            observation_id="ob-ocr",
            evidence_id="ev-print",
            region_id=None,
            obs_kind="property",
            raw_value="480VAC",
            normalized_value="480 VAC",
            extractor="ocr",
            evidence_state="VISIBLE",
            review_state="unreviewed",
        ),
    ]
    out = evidence_from_visual_session(observations, evidence=evidence, regions=regions)
    assert len(out) == 2
    # vision prose and OCR text stay distinguishable by producer
    producers = {e.source_locator.split("#observation:")[1]: e.producer_name for e in out}
    assert producers == {"ob-vision": "vision_worker", "ob-ocr": "ocr"}
    # all candidate (unreviewed), all PRINT_OBSERVATION, hash carried
    assert all(e.trust == "candidate" for e in out)
    assert all(e.kind is EvidenceKind.PRINT_OBSERVATION for e in out)
    assert all(e.evidence_hash == "sha256:print" for e in out)
    # the vision obs had a region -> bbox present; the ocr obs had none -> absent
    by_id = {e.source_locator.split("#observation:")[1]: e for e in out}
    assert by_id["ob-vision"].bbox == [0.0, 0.0, 0.5, 0.25]
    assert by_id["ob-ocr"].bbox is None


# --------------------------------------------------------------------------
# 8. Non-grounding evidence states are PRESERVED, not erased (review P1a)
#    CONFLICTING / NEEDS_CONTEXT / FIELD_VERIFICATION_REQUIRED must reach the
#    policy so it can reconcile / ask for the next-best evidence (ADR-0033).
#    Regression guard: the reviewer reproduced a CONFLICTING row rendering as an
#    ordinary "candidate" grounded fact, erasing the stop/reconcile signal.
# --------------------------------------------------------------------------
def _one(state, **kw):
    (item,) = evidence_from_visual_session(
        [_obs_row(normalized_value="F1 is 10 A", evidence_state=state, confidence=0.82, **kw)],
        evidence=[_evidence_row()],
        regions=[_region_row()],
    )
    return item


def _last_line(item):
    ctx = TechnicianContext(
        contract_version=CONTEXT_CONTRACT_VERSION,
        task_mode=TaskMode.PRINTSENSE,
        tenant_id="t-1",
        environment="dev",
        evidence=[item],
    )
    return to_prompt_block(ctx).splitlines()[-1]


@pytest.mark.parametrize("state", ["CONFLICTING", "NEEDS_CONTEXT", "FIELD_VERIFICATION_REQUIRED"])
def test_non_grounding_state_preserved_and_rendered(state):
    item = _one(state)
    assert item.evidence_state == state  # preserved on the contract item
    line = _last_line(item)
    assert state in line  # the stop/reconcile signal is visible to the policy
    # and it is NOT the erased "plain candidate grounded fact" the reviewer saw
    assert (
        line != "Evidence [V1] (print_observation, candidate, confidence 0.82, page 12): F1 is 10 A"
    )


def test_grounded_state_carries_no_marker_and_is_byte_stable():
    # A grounded VISIBLE observation renders exactly as before — no state marker,
    # no evidence_state signal. This is the byte-stability invariant the shared
    # 27-test contract suite protects.
    item = _one("VISIBLE")
    assert item.evidence_state is None  # grounded states carry no non-grounding signal
    assert (
        _last_line(item)
        == "Evidence [V1] (print_observation, candidate, confidence 0.82, page 12): F1 is 10 A"
    )


# --------------------------------------------------------------------------
# 9. Provenance must belong to the SAME session/tenant/evidence — never mixed
#    across unrelated ledger rows (review P1b). Each linkage failure is covered
#    independently so each assertion pins which guard fired.
# --------------------------------------------------------------------------
def test_evidence_from_other_session_drops_its_hash_and_page():
    # evidence row physically belongs to a different session -> its hash/page must
    # NOT ride with this observation, and the region (chained to a valid evidence
    # link) drops too.
    ev = [_evidence_row(session_id="OTHER-sess", original_hash="sha256:foreign", page_ref="99")]
    (item,) = evidence_from_visual_session([_obs_row()], evidence=ev, regions=[_region_row()])
    assert item.evidence_hash is None
    assert item.page is None
    assert item.bbox is None
    assert item.payload["summary"] == "M1 contactor"  # the claim itself survives


def test_region_of_other_evidence_drops_only_bbox():
    # region belongs to a different evidence_id than the observation -> bbox dropped,
    # but the VALID evidence hash/page still ride.
    rg = [_region_row(evidence_id="OTHER-ev")]
    (item,) = evidence_from_visual_session([_obs_row()], evidence=[_evidence_row()], regions=rg)
    assert item.bbox is None
    assert item.evidence_hash == "sha256:aaaa"
    assert item.page == 12


def test_cross_tenant_provenance_is_dropped():
    ev = [_evidence_row(tenant_id="OTHER-tenant")]
    rg = [_region_row(tenant_id="OTHER-tenant")]
    (item,) = evidence_from_visual_session([_obs_row()], evidence=ev, regions=rg)
    assert item.evidence_hash is None
    assert item.page is None
    assert item.bbox is None


# --------------------------------------------------------------------------
# 10. No durable audit anchor -> dropped (review P2). A missing session_id or
#     observation_id yields the un-anchored locator "visual_session:#observation:"
#     — drop it, as the prior-decision / correction adapters drop id-less rows.
# --------------------------------------------------------------------------
def test_missing_session_id_is_dropped():
    out = evidence_from_visual_session(
        [_obs_row(session_id=None)], evidence=[_evidence_row()], regions=[_region_row()]
    )
    assert out == []


def test_missing_observation_id_is_dropped():
    out = evidence_from_visual_session(
        [_obs_row(observation_id=None)], evidence=[_evidence_row()], regions=[_region_row()]
    )
    assert out == []
