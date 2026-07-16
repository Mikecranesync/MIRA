"""Internal review-and-delivery queue (commercial PR-3).

Every customer report passes a human before delivery. The reviewer inspects
the uploaded source (CAS refs) and the extracted evidence, then approves,
corrects, rejects, or marks unresolved. The original machine output is
preserved verbatim; every action lands in an audit history. Approval renders
the final customer report and flips the intake to ``delivered``; the
reviewer may mark the lead pilot-suitable. ``run_step`` hooks the caller's
``WorkflowRun`` for resumable, idempotent accounting (no import coupling).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from . import customer_report, intake

ACTIONS = ("approve", "correct", "reject", "mark_unresolved")


class ReviewQueue:
    def __init__(self, root: str | Path):
        self.root = Path(root) / "review_queue"
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, item_id: str) -> Path:
        return self.root / f"{item_id}.json"

    def enqueue(self, intake_root: str | Path, tenant_id: str,
                intake_id: str, payloads: dict, xref_records: list[dict],
                purposes: dict | None = None) -> dict:
        rec = intake.get_intake(intake_root, tenant_id, intake_id)
        draft = customer_report.build_customer_report(
            rec["request"]["question"], payloads, xref_records, purposes)
        item = {"item_id": intake_id, "tenant_id": tenant_id,
                "intake_root": str(intake_root),
                "state": "pending_review",
                "source_files": rec["files"],
                "evidence": {"payloads": payloads,
                             "xref_records": xref_records,
                             "purposes": purposes or {}},
                "machine_original": draft,
                "pilot_suitable": False,
                "audit": [{"at": time.time(), "event": "enqueued"}]}
        self._p(intake_id).write_text(
            json.dumps(item, indent=1, sort_keys=True), encoding="utf-8")
        intake.set_status(intake_root, tenant_id, intake_id, "needs_review")
        return item

    def list_pending(self) -> list[str]:
        return sorted(p.stem for p in self.root.glob("*.json")
                      if json.loads(p.read_text(encoding="utf-8"))["state"]
                      == "pending_review")

    def inspect(self, item_id: str) -> dict:
        return json.loads(self._p(item_id).read_text(encoding="utf-8"))

    def act(self, item_id: str, action: str, reviewer: str,
            corrections: dict | None = None, note: str | None = None,
            pilot_suitable: bool = False, run_step=None) -> dict:
        if action not in ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        item = self.inspect(item_id)
        if item["state"] != "pending_review":
            raise ValueError(f"item already decided: {item['state']}")

        def _apply():
            ev = item["evidence"]
            if action == "correct" and corrections:
                ev = json.loads(json.dumps(ev))  # never mutate the original
                for sha, devs in (corrections.get("payloads") or {}).items():
                    ev["payloads"][sha] = devs
                if corrections.get("xref_records") is not None:
                    ev["xref_records"] = corrections["xref_records"]
            if action in ("approve", "correct"):
                final = customer_report.build_customer_report(
                    item["machine_original"]["question"], ev["payloads"],
                    ev["xref_records"], ev.get("purposes"))
                item["final_report"] = final
                item["final_markdown"] = customer_report.render_markdown(final)
                item["state"] = "approved"
                new_status = "delivered"
            elif action == "reject":
                item["state"] = "rejected"
                new_status = "failed"
            else:
                item["state"] = "unresolved"
                new_status = "needs_review"
            item["pilot_suitable"] = bool(pilot_suitable)
            item["audit"].append({"at": time.time(), "by": reviewer,
                                  "action": action,
                                  **({"note": note} if note else {})})
            self._p(item_id).write_text(
                json.dumps(item, indent=1, sort_keys=True), encoding="utf-8")
            intake.set_status(item["intake_root"], item["tenant_id"],
                              item_id, new_status, note=f"review:{action}")
            return item

        return run_step(f"review_{action}", _apply) if run_step else _apply()
