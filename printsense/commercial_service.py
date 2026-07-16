"""PrintSenseCommercialService — platform-neutral commercial seam (PR-A).

One service wraps the commercial modules (intake, review_queue,
customer_report, funnel, pilot) so every chat platform (Telegram, Slack,
web) drives the SAME business logic. No platform imports here; processing
and delivery are injected adapters. Human review stays mandatory before any
delivery; full reconstruction stays capability-gated; analytics stay
content-free; state transitions are the intake module's fixed vocabulary
and every entry point is idempotent-retry safe.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol

from . import funnel as funnel_mod
from . import intake as intake_mod
from .funnel import Funnel, Survey, qualify_pilot
from .review_queue import ReviewQueue

logger = logging.getLogger("printsense.commercial")


class ProcessingAdapter(Protocol):
    def process(self, files: list[dict], file_bytes: dict,
                question: str) -> tuple[dict, list[dict], dict]:
        """-> (payloads, xref_records, purposes). Deterministic-first."""


class DeliveryAdapter(Protocol):
    def deliver(self, tenant_id: str, intake_id: str, markdown: str,
                report: dict) -> None:
        """Send the APPROVED report to the technician on their platform."""


class PrintSenseCommercialService:
    def __init__(self, root: str | Path, tenant_id: str,
                 processing: ProcessingAdapter | None = None,
                 delivery: DeliveryAdapter | None = None):
        self.root = Path(root)
        self.tenant_id = tenant_id
        self.processing = processing
        self.delivery = delivery
        self.queue = ReviewQueue(self.root)
        self.funnel = Funnel(self.root)

    # -- intake ----------------------------------------------------------
    def submit_intake(self, request: intake_mod.IntakeRequest,
                      files: list[tuple[str, bytes]]) -> dict:
        self.funnel.emit("intake_started", self.tenant_id, "pre")
        out = intake_mod.submit_intake(request, files, self.root,
                                       self.tenant_id)
        self.funnel.emit("upload_completed", self.tenant_id,
                         out["intake_id"], props={"files": out["files"]})
        return out

    def get_status(self, intake_id: str) -> dict:
        rec = intake_mod.get_intake(self.root, self.tenant_id, intake_id)
        return {"intake_id": intake_id, "status": rec["status"],
                "history": [h["status"] for h in rec["history"]]}

    # -- processing ------------------------------------------------------
    def process_submission(self, intake_id: str) -> dict:
        rec = intake_mod.get_intake(self.root, self.tenant_id, intake_id)
        if rec["status"] in ("needs_review", "delivered"):
            return self.get_status(intake_id)  # idempotent retry
        if rec["status"] not in ("queued", "processing", "failed"):
            raise ValueError(f"cannot process from state {rec['status']!r}")
        intake_mod.set_status(self.root, self.tenant_id, intake_id,
                              "processing")
        try:
            file_bytes = self._load_files(intake_id, rec)
            if self.processing is None:
                payloads, xrefs, purposes = {}, [], {}
            else:
                payloads, xrefs, purposes = self.processing.process(
                    rec["files"], file_bytes, rec["request"]["question"])
            self.enqueue_review(intake_id, payloads, xrefs, purposes)
        except Exception as exc:
            intake_mod.set_status(self.root, self.tenant_id, intake_id,
                                  "failed", note=type(exc).__name__)
            self.funnel.emit("processing_failed", self.tenant_id, intake_id,
                             props={"failed_stage": "processing"})
            raise
        return self.get_status(intake_id)

    def _load_files(self, intake_id: str, rec: dict) -> dict:
        from .cas import CAS

        cas = CAS(self.root / "tenants" / self.tenant_id / intake_id / "cas")
        return {f["sha256"]: cas.get("upload", f["sha256"])
                for f in rec["files"]}

    def enqueue_review(self, intake_id: str, payloads: dict,
                       xrefs: list[dict], purposes: dict | None = None) -> dict:
        item = self.queue.enqueue(self.root, self.tenant_id, intake_id,
                                  payloads, xrefs, purposes)
        self.funnel.emit(
            "processing_completed", self.tenant_id, intake_id,
            props={"devices_found": len(item["machine_original"]["devices"]),
                   "xrefs_proven": len(item["machine_original"]
                                       ["proven_cross_references"])})
        return item

    # -- review + delivery (human gate is structural) ----------------------
    def _decide(self, intake_id: str, action: str, reviewer: str,
                **kw) -> dict:
        item = self.queue.act(intake_id, action, reviewer, **kw)
        self.funnel.emit("report_reviewed", self.tenant_id, intake_id,
                         props={"review_action": action})
        if item["state"] == "approved":
            self.deliver(intake_id, item)
        return item

    def approve(self, intake_id: str, reviewer: str,
                pilot_suitable: bool = False) -> dict:
        return self._decide(intake_id, "approve", reviewer,
                            pilot_suitable=pilot_suitable)

    def correct(self, intake_id: str, reviewer: str, corrections: dict,
                pilot_suitable: bool = False) -> dict:
        return self._decide(intake_id, "correct", reviewer,
                            corrections=corrections,
                            pilot_suitable=pilot_suitable)

    def reject(self, intake_id: str, reviewer: str, note: str) -> dict:
        return self._decide(intake_id, "reject", reviewer, note=note)

    def deliver(self, intake_id: str, item: dict) -> None:
        if item.get("state") != "approved":
            raise ValueError("only reviewed+approved reports are deliverable")
        if self.delivery is not None:
            self.delivery.deliver(self.tenant_id, intake_id,
                                  item["final_markdown"],
                                  item["final_report"])
        self.funnel.emit("report_delivered", self.tenant_id, intake_id)
        logger.info("delivered intake=%s tenant=%s", intake_id,
                    self.tenant_id)

    # -- survey + qualification -------------------------------------------
    def record_survey(self, intake_id: str, survey: Survey) -> dict:
        p = (self.root / "tenants" / self.tenant_id / intake_id
             / "survey.json")
        p.write_text(survey.model_dump_json(indent=1), encoding="utf-8")
        self.funnel.emit(
            "followup_question_submitted", self.tenant_id, intake_id,
            props={"survey_score": sum(survey.model_dump().values())})
        return survey.model_dump()

    def qualify(self, intake_id: str) -> tuple[bool, str]:
        rec = intake_mod.get_intake(self.root, self.tenant_id, intake_id)
        item = self.queue.inspect(intake_id)
        sp = (self.root / "tenants" / self.tenant_id / intake_id
              / "survey.json")
        if not sp.exists():
            return False, "survey_not_recorded"
        survey = Survey.model_validate_json(sp.read_text(encoding="utf-8"))
        if rec["request"]["request_full_package"]:
            self.funnel.emit("package_request_submitted", self.tenant_id,
                             intake_id)
        ok, reason = qualify_pilot(survey,
                                   rec["request"]["request_full_package"],
                                   item.get("pilot_suitable", False))
        if ok:
            self.funnel.emit("pilot_qualified", self.tenant_id, intake_id,
                             props={"qualified_reason":
                                    reason.replace("+", ".")})
        return ok, reason


__all__ = ["PrintSenseCommercialService", "ProcessingAdapter",
           "DeliveryAdapter", "Survey", "funnel_mod"]
