"""Review queue — inspect, decide, deliver, audit (commercial PR-3)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import intake  # noqa: E402
from printsense.review_queue import ReviewQueue  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic"
PAYLOADS = {"pA": {"devices": [{"tag": "-91/K01", "bbox": [1, 2, 3, 4]}]}}
XREFS = [{"raw_reference": "92.1 / K911", "source_page": "91",
          "target_page": "pB", "resolution": "resolved",
          "pattern_class": "SHEET_COL_ANCHOR", "confidence": 0.9,
          "evidence_bbox": [10, 10, 60, 20]}]


def _setup(tmp_path):
    req = intake.IntakeRequest(
        work_email="tech@example.com", company="Ex", machine_type="conv",
        question="Why does K01 trip?", consent_confidentiality=True)
    out = intake.submit_intake(req, [("p.png", PNG)], tmp_path, "t1")
    q = ReviewQueue(tmp_path)
    q.enqueue(tmp_path, "t1", out["intake_id"], PAYLOADS, XREFS)
    return q, out["intake_id"]


def test_enqueue_sets_needs_review_and_lists(tmp_path):
    q, iid = _setup(tmp_path)
    assert q.list_pending() == [iid]
    assert intake.get_intake(tmp_path, "t1", iid)["status"] == "needs_review"
    item = q.inspect(iid)
    assert item["source_files"][0]["sha256"]
    assert item["evidence"]["xref_records"] == XREFS
    assert item["machine_original"]["devices"]


def test_approve_delivers_and_preserves_original(tmp_path):
    q, iid = _setup(tmp_path)
    item = q.act(iid, "approve", reviewer="mike", pilot_suitable=True)
    assert item["state"] == "approved" and item["pilot_suitable"] is True
    assert "PrintSense report" in item["final_markdown"]
    assert item["machine_original"]["devices"]  # verbatim original kept
    assert intake.get_intake(tmp_path, "t1", iid)["status"] == "delivered"
    assert [a.get("action") for a in item["audit"] if "action" in a] == ["approve"]


def test_correct_changes_final_but_not_original(tmp_path):
    q, iid = _setup(tmp_path)
    fixed = {"payloads": {"pA": {"devices": [{"tag": "-91/K01A",
                                              "bbox": [1, 2, 3, 4]}]}}}
    item = q.act(iid, "correct", reviewer="mike", corrections=fixed)
    assert "`-91/K01A`" in item["final_markdown"]
    assert item["machine_original"]["devices"][0]["tag"] == "-91/K01"


def test_reject_fails_intake(tmp_path):
    q, iid = _setup(tmp_path)
    q.act(iid, "reject", reviewer="mike", note="unusable capture")
    assert intake.get_intake(tmp_path, "t1", iid)["status"] == "failed"


def test_double_decision_refused(tmp_path):
    q, iid = _setup(tmp_path)
    q.act(iid, "approve", reviewer="mike")
    with pytest.raises(ValueError):
        q.act(iid, "reject", reviewer="mike")


def test_run_step_hook(tmp_path):
    q, iid = _setup(tmp_path)
    names = []
    q.act(iid, "approve", reviewer="mike",
          run_step=lambda n, fn: (names.append(n), fn())[1])
    assert names == ["review_approve"]
