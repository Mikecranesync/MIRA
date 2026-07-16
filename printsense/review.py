"""Human confirmation workflow for ambiguous xrefs (PR-E).

Compact review contract + durable, idempotent decision records. A confirmed
edge is pinned to ``(source_doc_sha, extractor_version)`` and is never
recomputed unless either changes or the user forces reanalysis.

Durable storage is file-based (append-only JSONL + one JSON per decision,
content-keyed). Callers running under ``mira-bots/shared/workflow.WorkflowRun``
pass its ``step`` as ``run_step`` — printsense stays import-decoupled while
the pipeline gets resumable/idempotent step accounting.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

ALLOWED_ACTIONS = ("confirm_candidate", "mark_unknown", "enter_correct_target")


def build_review_request(record: dict) -> dict:
    """Ambiguous evidence record -> the compact review contract."""
    cands = sorted(record.get("candidates", []),
                   key=lambda c: -float(c.get("confidence", 0) or 0))
    return {
        "question": f"Page {record.get('source_page')} appears to reference:",
        "raw_reference": record.get("raw_reference"),
        "candidates": [{"page": c.get("page"), "anchor":
                        c.get("anchor", record.get("target_anchor")),
                        "confidence": c.get("confidence",
                                            record.get("confidence"))}
                       for c in cands],
        "allowed_actions": list(ALLOWED_ACTIONS),
        "machine_proposal": record,
        "extractor_version": record.get("extractor_version"),
    }


def decision_key(source_doc_sha: str, raw_reference: str,
                 extractor_version: str) -> str:
    return hashlib.sha256(
        f"{source_doc_sha}|{raw_reference}|{extractor_version}".encode()
    ).hexdigest()[:24]


def apply_decision(request: dict, action: str, reviewer: str,
                   source_doc_sha: str, selected: dict | None = None,
                   source_crop_ref: str | None = None,
                   now: float | None = None) -> dict:
    if action not in request.get("allowed_actions", ALLOWED_ACTIONS):
        raise ValueError(f"action {action!r} not allowed")
    if action == "confirm_candidate":
        if selected not in [{k: c[k] for k in ("page", "anchor")}
                            for c in request["candidates"]] and (
                selected is None or
                not any(c.get("page") == selected.get("page")
                        and c.get("anchor") == selected.get("anchor")
                        for c in request["candidates"])):
            raise ValueError("confirm_candidate requires one of the candidates")
    if action == "enter_correct_target" and not selected:
        raise ValueError("enter_correct_target requires a target")
    ts = now if now is not None else time.time()
    key = decision_key(source_doc_sha, request.get("raw_reference") or "",
                       request.get("extractor_version") or "")
    return {
        "decision_id": key,
        "reviewer": reviewer,
        "timestamp": ts,
        "action": action,
        "selected_target": selected if action != "mark_unknown" else None,
        "machine_proposal": request.get("machine_proposal"),
        "source_doc_sha": source_doc_sha,
        "source_crop_ref": source_crop_ref,
        "extractor_version": request.get("extractor_version"),
        "review_status": ("confirmed" if action != "mark_unknown"
                          else "unknown"),
        "audit_trail": [{"at": ts, "by": reviewer, "action": action}],
    }


def needs_recompute(decision: dict, source_doc_sha: str,
                    extractor_version: str, force: bool = False) -> bool:
    """A confirmed edge is recomputed ONLY on source/extractor change or force."""
    if force:
        return True
    return (decision.get("source_doc_sha") != source_doc_sha
            or decision.get("extractor_version") != extractor_version)


class DecisionStore:
    """Append-only, idempotent, file-based durable decision store."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._log = self.root / "decisions.jsonl"

    def save(self, decision: dict, run_step=None) -> dict:
        """Idempotent: an existing decision_id returns the stored record
        with the new attempt appended to its audit trail."""
        path = self.root / f"{decision['decision_id']}.json"
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            existing["audit_trail"] = (existing.get("audit_trail", [])
                                       + decision.get("audit_trail", []))
            path.write_text(json.dumps(existing, indent=1, sort_keys=True),
                            encoding="utf-8")
            return existing

        def _write():
            path.write_text(json.dumps(decision, indent=1, sort_keys=True),
                            encoding="utf-8")
            with open(self._log, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(decision, sort_keys=True) + "\n")
            return decision

        return run_step("review_decision_save", _write) if run_step else _write()

    def get(self, decision_id: str) -> dict | None:
        path = self.root / f"{decision_id}.json"
        return (json.loads(path.read_text(encoding="utf-8"))
                if path.exists() else None)
