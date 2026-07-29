"""PrintSenseCommercialService — seam contracts (commercial PR-A)."""

from __future__ import annotations

import logging

import pytest

pytest.importorskip("pydantic")

from printsense.commercial_service import (  # noqa: E402
    PrintSenseCommercialService, Survey)
from printsense.intake import IntakeRequest  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic"


class FakeProcessing:
    def process(self, files, file_bytes, question):
        assert file_bytes  # bytes really loaded from CAS
        return ({"p1": {"devices": [{"tag": "-91/K01", "bbox": [1, 2, 3, 4]}]}},
                [{"raw_reference": "92.1 / K911", "source_page": "91",
                  "target_page": "p92", "resolution": "resolved",
                  "pattern_class": "SHEET_COL_ANCHOR", "confidence": 0.9,
                  "evidence_bbox": [9, 9, 20, 20]}], {})


class FakeDelivery:
    def __init__(self):
        self.sent = []

    def deliver(self, tenant_id, intake_id, markdown, report):
        self.sent.append((tenant_id, intake_id, markdown[:40]))


def _svc(tmp_path, delivery=None):
    return PrintSenseCommercialService(
        tmp_path, "tenant-a", processing=FakeProcessing(),
        delivery=delivery or FakeDelivery())


def _submit(svc):
    req = IntakeRequest(work_email="t@example.com", company="Ex",
                        machine_type="conveyor", question="Why trip?",
                        consent_confidentiality=True,
                        request_full_package=True)
    return svc.submit_intake(req, [("p.png", PNG)])["intake_id"]


def test_full_journey_delivery_only_after_review(tmp_path):
    d = FakeDelivery()
    svc = _svc(tmp_path, d)
    iid = _submit(svc)
    svc.process_submission(iid)
    assert svc.get_status(iid)["status"] == "needs_review"
    assert d.sent == []  # nothing delivered pre-review
    svc.approve(iid, reviewer="mike", pilot_suitable=True)
    assert svc.get_status(iid)["status"] == "delivered"
    assert d.sent and d.sent[0][1] == iid
    counts = svc.funnel.counts()
    assert counts["report_delivered"] == 1 and counts["report_reviewed"] == 1


def test_process_is_idempotent_retry_safe(tmp_path):
    svc = _svc(tmp_path)
    iid = _submit(svc)
    svc.process_submission(iid)
    again = svc.process_submission(iid)  # no double enqueue, no crash
    assert again["status"] == "needs_review"
    assert svc.funnel.counts()["processing_completed"] == 1


def test_direct_deliver_of_unreviewed_item_refused(tmp_path):
    svc = _svc(tmp_path)
    iid = _submit(svc)
    svc.process_submission(iid)
    with pytest.raises(ValueError):
        svc.deliver(iid, svc.queue.inspect(iid))  # state pending_review


def test_reject_marks_failed_and_never_delivers(tmp_path):
    d = FakeDelivery()
    svc = _svc(tmp_path, d)
    iid = _submit(svc)
    svc.process_submission(iid)
    svc.reject(iid, reviewer="mike", note="unusable")
    assert svc.get_status(iid)["status"] == "failed" and d.sent == []


def test_survey_and_qualification(tmp_path):
    svc = _svc(tmp_path)
    iid = _submit(svc)
    svc.process_submission(iid)
    svc.approve(iid, reviewer="mike", pilot_suitable=True)
    assert svc.qualify(iid) == (False, "survey_not_recorded")
    svc.record_survey(iid, Survey(
        saved_time=True, identified_useful=True,
        would_trust_troubleshooting=True, has_complete_package=True,
        consider_paid_pilot=True))
    ok, reason = svc.qualify(iid)
    assert ok and svc.funnel.counts()["pilot_qualified"] == 1


def test_tenant_scoping(tmp_path):
    svc_a = _svc(tmp_path)
    iid = _submit(svc_a)
    svc_b = PrintSenseCommercialService(tmp_path, "tenant-b")
    with pytest.raises(KeyError):
        svc_b.get_status(iid)


def test_report_keeps_reconstruction_unavailable(tmp_path):
    svc = _svc(tmp_path)
    iid = _submit(svc)
    svc.process_submission(iid)
    item = svc.approve(iid, reviewer="mike")
    assert item["final_report"]["unavailable_capabilities"][0]["state"] == \
        "advanced_reasoning_unavailable"


def test_logs_content_free(tmp_path, caplog):
    svc = _svc(tmp_path)
    with caplog.at_level(logging.INFO):
        req = IntakeRequest(work_email="t@example.com", company="SecretCo",
                            machine_type="conv",
                            question="SECRET-MARKER in question",
                            consent_confidentiality=True)
        iid = svc.submit_intake(req, [("SECRET-NAME.png", PNG)])["intake_id"]
        svc.process_submission(iid)
        svc.approve(iid, reviewer="mike")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "SECRET" not in joined
