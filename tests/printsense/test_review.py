"""Human xref review — contract, durability, idempotency, pin rule (PR-E)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import review  # noqa: E402

RECORD = {"source_page": 18, "raw_reference": "12 / DA9.1",
          "target_anchor": "DA9.1", "confidence": 0.74,
          "resolution": "ambiguous",
          "candidates": [{"page": "p12", "anchor": "DA9.1", "confidence": 0.74},
                         {"page": "p21", "anchor": "DA9.1", "confidence": 0.19}],
          "extractor_version": "xref_extractor_v1"}


def test_contract_shape_and_confidence_order():
    req = review.build_review_request(RECORD)
    assert req["question"] == "Page 18 appears to reference:"
    assert [c["page"] for c in req["candidates"]] == ["p12", "p21"]
    assert req["allowed_actions"] == ["confirm_candidate", "mark_unknown",
                                      "enter_correct_target"]


def test_decision_record_fields_complete(tmp_path):
    req = review.build_review_request(RECORD)
    d = review.apply_decision(req, "confirm_candidate", reviewer="mike",
                              source_doc_sha="a" * 64,
                              selected={"page": "p12", "anchor": "DA9.1"},
                              source_crop_ref="cas://crop/123", now=1000.0)
    for field in ("decision_id", "reviewer", "timestamp", "machine_proposal",
                  "selected_target", "source_doc_sha", "source_crop_ref",
                  "review_status", "audit_trail"):
        assert d[field] is not None, field
    store = review.DecisionStore(tmp_path)
    saved = store.save(d)
    assert store.get(d["decision_id"]) == saved


def test_confirm_requires_a_listed_candidate():
    req = review.build_review_request(RECORD)
    with pytest.raises(ValueError):
        review.apply_decision(req, "confirm_candidate", "mike", "a" * 64,
                              selected={"page": "p99", "anchor": "DA9.1"})


def test_mark_unknown_needs_no_target_and_records_unknown():
    req = review.build_review_request(RECORD)
    d = review.apply_decision(req, "mark_unknown", "mike", "a" * 64)
    assert d["review_status"] == "unknown" and d["selected_target"] is None


def test_unknown_action_rejected():
    req = review.build_review_request(RECORD)
    with pytest.raises(ValueError):
        review.apply_decision(req, "auto_approve", "mike", "a" * 64)


def test_idempotent_save_appends_audit_only(tmp_path):
    req = review.build_review_request(RECORD)
    d = review.apply_decision(req, "mark_unknown", "mike", "a" * 64, now=1.0)
    store = review.DecisionStore(tmp_path)
    store.save(d)
    again = store.save(review.apply_decision(req, "mark_unknown", "mike",
                                             "a" * 64, now=2.0))
    assert again["timestamp"] == 1.0  # original preserved
    assert len(again["audit_trail"]) == 2  # attempt recorded


def test_pin_rule_no_recompute_unless_source_or_version_changes():
    req = review.build_review_request(RECORD)
    d = review.apply_decision(req, "confirm_candidate", "mike", "a" * 64,
                              selected={"page": "p12", "anchor": "DA9.1"})
    assert not review.needs_recompute(d, "a" * 64, "xref_extractor_v1")
    assert review.needs_recompute(d, "b" * 64, "xref_extractor_v1")
    assert review.needs_recompute(d, "a" * 64, "xref_extractor_v2")
    assert review.needs_recompute(d, "a" * 64, "xref_extractor_v1", force=True)


def test_run_step_hook_is_used(tmp_path):
    calls = []

    def run_step(name, fn):
        calls.append(name)
        return fn()

    req = review.build_review_request(RECORD)
    d = review.apply_decision(req, "mark_unknown", "mike", "a" * 64)
    review.DecisionStore(tmp_path).save(d, run_step=run_step)
    assert calls == ["review_decision_save"]
