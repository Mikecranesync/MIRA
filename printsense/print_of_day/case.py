"""POTD case orchestration + evidence manifest (`factorylm.print-of-day.v1`).

Ties one day's run together WITHOUT re-implementing any factory stage
(POTD surface contract §0/§2): it references the reused stages' outputs and
records the runtime provenance the directive requires in every artifact —
provider/model identity, image revision, git SHA, OCR state, grader state, and
artifact hashes.

The heavy stages (interpret / grade / judge / mail) are injected as callables
so the orchestration is unit-testable with no network and no paid call. The
one-command entrypoint (`tools/print_of_day/run.py`) wires the real ones.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .provenance import Provenance, artifact_hashes

MANIFEST_SCHEMA = "factorylm.print-of-day.v1"


@dataclass
class CaseEvidence:
    """The evidence manifest for one POTD case — the directive's required set."""

    case_id: str
    run_id: str
    generated_at: str
    environment: str
    provenance: Provenance
    provider: dict[str, Any]  # {requested, resolved, model, endpoint_class, ...}
    ocr: dict[str, Any]  # {required, available, tesseract_version, pytesseract_version, source}
    grader: dict[str, Any]  # {score, letter, import_verdict, hard_failures, ...}
    judge: dict[str, Any]  # {judge_model, judge_provider, judge_independence, ...}
    source_url: str | None
    selected_page_sha: str | None
    graded_page_sha: str | None
    fallback_attempts: list[dict] = field(default_factory=list)
    artifact_sha256: dict[str, str] = field(default_factory=dict)
    degraded: list[str] = field(default_factory=list)
    email: dict[str, Any] | None = None
    gold_eligible: bool = False

    def to_dict(self) -> dict:
        return {
            "schema": MANIFEST_SCHEMA,
            "case_id": self.case_id,
            "run_id": self.run_id,
            "generated_at": self.generated_at,
            "environment": self.environment,
            "provenance": self.provenance.to_dict(),
            "provider": self.provider,
            "ocr": self.ocr,
            "grader": self.grader,
            "judge": self.judge,
            "source_url": self.source_url,
            "selected_page_sha": self.selected_page_sha,
            "graded_page_sha": self.graded_page_sha,
            "fallback_attempts": self.fallback_attempts,
            "artifact_sha256": self.artifact_sha256,
            "degraded": self.degraded,
            "email": self.email,
            "gold_eligible": self.gold_eligible,
        }


def gold_eligible(evidence: CaseEvidence) -> bool:
    """A case is gold-ELIGIBLE (never gold — a human authorizes that) only when
    the run was clean: no fallback occurred, no degraded capability, the graded
    page is the selected page, and the provider/model are the approved POTD
    pair. Fail-closed: any doubt -> not eligible (QR-1)."""
    return (
        not evidence.fallback_attempts
        and not evidence.degraded
        and evidence.selected_page_sha == evidence.graded_page_sha
        and evidence.provider.get("resolved") == "together"
        and evidence.provider.get("model") == "MiniMaxAI/MiniMax-M3"
    )


def build_manifest(evidence: CaseEvidence, artifact_paths: list[str | Path]) -> dict:
    """Finalize the manifest: stamp artifact hashes + gold eligibility."""
    evidence.artifact_sha256 = artifact_hashes(artifact_paths)
    evidence.gold_eligible = gold_eligible(evidence)
    return evidence.to_dict()


def write_manifest(out_dir: str | Path, manifest: dict) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "print_of_day_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return path
