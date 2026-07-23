"""FactoryLM Industrial Technician Dataset v0 candidate builder.

This module builds review candidates only. It does not approve records, mark
records gold, export a trainable JSONL, call Together, upload files, create jobs,
consume authorizations, or spend. The generated candidates wrap the existing
SourceCandidate and DatasetRecord gates so the same governance path used for a
real export explains every blocker.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

from factorylm_ai.adapters import drive_commander_candidate, printsense_candidate
from factorylm_ai.dataset import (
    DatasetRecord,
    ReadinessEvidence,
    assemble_dataset_v0,
    estimate_finetune_cost,
    evaluate_paid_gate,
)
from factorylm_ai.dataset.assemble import APPROVAL_MISSING
from factorylm_ai.dataset.record import MESSAGE_INVALID, SAFETY_SENSITIVE_TAG
from factorylm_ai.governance import lineage as ln
from factorylm_ai.governance.rights import (
    LICENSE_PUBLIC_EVAL_AND_TRAIN,
    LICENSE_PUBLIC_EVAL_ONLY,
)

BuildStage = Literal["registry", "cv101", "drive", "printsense", "readiness"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = Path("docs/zta/technician-dataset-v0")
DATASET_VERSION = "factorylm-industrial-technician-v0"
CANDIDATE_SCHEMA_VERSION = "factorylm.technician-dataset.review-candidate.v1"
SOURCE_REGISTRY_SCHEMA_VERSION = "factorylm.technician-dataset.source-registry.v1"
BUILD_ID = "2026-07-23-technician-dataset-v0"
BUILD_TIMESTAMP = "2026-07-23T00:00:00Z"
SYSTEM_PROMPT = (
    "You are FactoryLM's industrial technician assistant. Answer only from the "
    "provided evidence, call out uncertainty, and never authorize energized work "
    "or bypassing safety devices."
)

STAGE_ORDER: dict[BuildStage, int] = {
    "registry": 0,
    "cv101": 1,
    "drive": 2,
    "printsense": 3,
    "readiness": 4,
}

_CV101_SHEET_TARGETS: dict[str, int] = {
    "E-001": 8,
    "E-005": 14,
    "E-006": 14,
    "E-007": 12,
    "E-008": 12,
    "E-009": 10,
}

_STYLE_DOCS = (
    "factorylm-print-style-002",
    "factorylm-print-style-004",
    "factorylm-print-style-005",
    "factorylm-print-style-006",
    "factorylm-print-style-009",
    "factorylm-print-style-010",
    "factorylm-print-style-011",
    "factorylm-print-style-012",
    "factorylm-print-style-013",
    "factorylm-print-style-015",
    "factorylm-print-style-018",
    "factorylm-print-style-019",
    "factorylm-print-style-020",
    "factorylm-print-style-021",
    "factorylm-print-style-022",
    "factorylm-print-style-023",
    "factorylm-print-style-024",
)

_HELD_OUT_DOCS = (
    ("FactoryLM", "cv-101-e-004"),
    ("Rockwell Automation", "22B-UM001J-EN-E"),
    ("FactoryLM", "factorylm-print-style-025"),
    ("FactoryLM", "public-domain-print-031"),
    ("FactoryLM", "technician-review-011"),
)

_DRIVE_TARGETS = {
    "durapulse_gs10": 20,
    "powerflex_40": 25,
    "powerflex_525": 25,
}


@dataclass(frozen=True)
class ReviewCandidate:
    """A DatasetRecord plus reviewer-only evidence fields."""

    record: DatasetRecord
    source_entry: dict[str, Any]
    answer_key: dict[str, Any]
    origin: str
    source_class: str
    review_batch: str
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        eligibility = self.record.eligibility()
        rejection_reasons = [r.to_dict() for r in eligibility.rejections]
        if not self.record.approved_by:
            rejection_reasons.append(
                {
                    "code": APPROVAL_MISSING,
                    "detail": "candidate is pending human review; approved_by is intentionally null",
                }
            )
        message_errors = self.record.message_validation_errors()
        if message_errors:
            rejection_reasons.append({"code": MESSAGE_INVALID, "detail": "; ".join(message_errors)})

        candidate = self.record.candidate
        rights = candidate.rights
        return {
            "schema": CANDIDATE_SCHEMA_VERSION,
            "build_id": BUILD_ID,
            "dataset_version": DATASET_VERSION,
            "record_id": self.record.record_id,
            "review_batch": self.review_batch,
            "source_system": self.record.source_system,
            "product_area": self.source_entry["product_area"],
            "document_lineage_key": candidate.document_lineage_key,
            "split": candidate.assigned_split(),
            "messages": self.record.messages,
            "message_validation": {"valid": not message_errors, "errors": message_errors},
            "interaction_type": self.record.interaction_type,
            "tags": sorted(self.record.tags),
            "safety": {
                "safety_status": candidate.safety_status,
                "safety_sensitive": self.record.is_safety_sensitive(),
                "requires_human_safety_review": candidate.safety_status != "clear",
            },
            "origin": {
                "real_vs_synthetic": self.origin,
                "source_class": self.source_class,
            },
            "human_approval": {
                "state": "pending_review",
                "approved_by": self.record.approved_by,
                "gold_status": candidate.gold_status,
                "allowed_reviewer_actions": ["approve", "correct", "reject", "hold_out"],
            },
            "rights": rights.to_dict(),
            "rights_decision": self.source_entry["rights_decision"],
            "source_provenance": {
                "source_id": self.source_entry["source_id"],
                "source_reference": self.source_entry["source_reference"],
                "source_sha256": self.source_entry.get("source_sha256"),
                "evidence_id": candidate.evidence_id,
                "provenance_present": candidate.provenance_present,
            },
            "answer_key": self.answer_key,
            "training_eligibility": eligibility.to_dict(),
            "dataset_rejection_reasons": rejection_reasons,
            "eligible_now": self.record.is_dataset_eligible(),
            "review_notes": list(self.notes),
        }


def source_registry(stage: BuildStage = "readiness") -> list[dict[str, Any]]:
    """Return the governed source registry entries for a build stage."""

    entries: list[dict[str, Any]] = []
    entries.extend(_cv101_sources())
    entries.extend(_drive_sources())
    entries.extend(_printsense_style_sources())
    entries.extend(_reserved_held_out_sources())
    _ = stage
    return _sorted_dicts(entries, "source_id")


def build_review_candidates(stage: BuildStage = "readiness") -> list[ReviewCandidate]:
    """Build deterministic pending-review candidates through ``stage``."""

    candidates: list[ReviewCandidate] = []
    if STAGE_ORDER[stage] >= STAGE_ORDER["cv101"]:
        candidates.extend(_cv101_candidates())
    if STAGE_ORDER[stage] >= STAGE_ORDER["drive"]:
        candidates.extend(_drive_candidates())
    if STAGE_ORDER[stage] >= STAGE_ORDER["printsense"]:
        candidates.extend(_printsense_style_candidates())
    return candidates


def write_build(out_dir: str | Path = DEFAULT_OUT_DIR, *, stage: BuildStage = "readiness") -> dict:
    """Write reproducible registry, candidate, review, and readiness artifacts."""

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    review_dir = out / "review-packages"
    report_dir = out / "reports"
    review_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    registry = source_registry(stage)
    candidates = build_review_candidates(stage)
    candidate_dicts = [c.to_dict() for c in candidates]
    records = [c.record for c in candidates]
    dataset = assemble_dataset_v0(records, dataset_version=DATASET_VERSION)
    readiness = _readiness_evidence(out)
    paid_gate = evaluate_paid_gate(dataset, readiness=readiness, model_support=None)

    files: dict[str, str] = {}
    files["source_registry"] = _write_json(out / "source_registry.json", registry)
    files["inventory_report"] = _write_text(
        out / "inventory_report.md", _inventory_markdown(registry)
    )
    files["lineage_plan"] = _write_json(
        report_dir / "lineage_split_report.json", _lineage_report(candidate_dicts, registry)
    )

    if STAGE_ORDER[stage] == STAGE_ORDER["registry"]:
        files["manifest"] = _write_json(
            out / "build_manifest.json",
            _build_manifest(files, candidate_dicts, paid_gate.to_dict()),
        )
        return {"stage": stage, "files": files, "candidate_count": len(candidate_dicts)}

    files["candidate_jsonl"] = _write_jsonl(out / "candidate_dataset.jsonl", candidate_dicts)
    files["candidate_manifest"] = _write_json(
        out / "candidate_manifest.json", _candidate_manifest(candidate_dicts)
    )

    by_batch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cand in candidate_dicts:
        by_batch[str(cand["review_batch"])].append(cand)
    for batch, rows in sorted(by_batch.items()):
        files[f"review_{batch}"] = _write_text(
            review_dir / f"{batch}_review_package.md",
            _review_markdown(batch, rows),
        )

    files["rights_report"] = _write_json(
        report_dir / "rights_report.json", _rights_report(candidate_dicts, registry)
    )
    files["rejection_report"] = _write_json(
        report_dir / "rejection_report.json", _rejection_report(candidate_dicts, dataset)
    )
    files["behavior_coverage"] = _write_json(
        report_dir / "behavior_coverage_report.json", _behavior_report(candidate_dicts)
    )
    files["composition"] = _write_json(
        report_dir / "real_vs_synthetic_composition_report.json",
        _composition_report(candidate_dicts),
    )
    files["duplicate_leakage"] = _write_json(
        report_dir / "duplicate_leakage_report.json", _duplicate_leakage_report(candidate_dicts)
    )

    if STAGE_ORDER[stage] < STAGE_ORDER["readiness"]:
        files["manifest"] = _write_json(
            out / "build_manifest.json",
            _build_manifest(files, candidate_dicts, paid_gate.to_dict()),
        )
        return {"stage": stage, "files": files, "candidate_count": len(candidate_dicts)}

    files["token_cost"] = _write_json(
        report_dir / "token_cost_estimate.json", _token_cost_report(records, dataset)
    )
    files["benchmark"] = _write_json(
        report_dir / "base_vs_tools_benchmark.json", _benchmark_report()
    )
    files["frozen_benchmark"] = _write_json(
        report_dir / "frozen_benchmark_baseline.json", _frozen_benchmark_report(readiness)
    )
    files["phase3_paid_gate"] = _write_json(
        report_dir / "phase3_paid_gate_report.json", paid_gate.to_dict()
    )
    files["readiness_package"] = _write_text(
        out / "training_readiness_package.md",
        _readiness_markdown(candidate_dicts, dataset, paid_gate.to_dict(), files),
    )
    files["manifest"] = _write_json(
        out / "build_manifest.json", _build_manifest(files, candidate_dicts, paid_gate.to_dict())
    )
    return {"stage": stage, "files": files, "candidate_count": len(candidate_dicts)}


def validate_candidates(candidates: Iterable[dict[str, Any]]) -> list[str]:
    """Validate the review-candidate shape used by this builder.

    This is intentionally a local artifact validation layer, not a replacement
    for the governance gates. Training eligibility still comes only from
    SourceCandidate/DatasetRecord/assemble_dataset_v0.
    """

    required = {
        "schema",
        "record_id",
        "source_system",
        "document_lineage_key",
        "split",
        "messages",
        "rights",
        "source_provenance",
        "answer_key",
        "training_eligibility",
        "human_approval",
        "origin",
        "dataset_rejection_reasons",
    }
    errors: list[str] = []
    for row in candidates:
        rid = row.get("record_id", "<unknown>")
        missing = sorted(required - set(row))
        if missing:
            errors.append(f"{rid}: missing {missing}")
        if row.get("schema") != CANDIDATE_SCHEMA_VERSION:
            errors.append(f"{rid}: bad schema {row.get('schema')!r}")
        if row.get("human_approval", {}).get("approved_by") is not None:
            errors.append(f"{rid}: approved_by must remain null in review package")
        if row.get("human_approval", {}).get("gold_status") == "gold":
            errors.append(f"{rid}: review package must not mark records gold")
        messages = row.get("messages")
        if not isinstance(messages, list) or not messages:
            errors.append(f"{rid}: messages must be a non-empty list")
        else:
            roles = {m.get("role") for m in messages if isinstance(m, dict)}
            if "user" not in roles or "assistant" not in roles:
                errors.append(f"{rid}: messages need user and assistant turns")
        if _contains_secret(row):
            errors.append(f"{rid}: secret-like value found")
    return errors


def _cv101_sources() -> list[dict[str, Any]]:
    rows = []
    for sheet_num in range(1, 10):
        sheet = f"E-{sheet_num:03d}"
        source_ref = (
            f"machine-print-pack/examples/cv-101/prints/sheets/{sheet}_"
            f"{_cv101_sheet_slug(sheet)}.pdf"
        )
        doc_number = f"cv-101-e-{sheet_num:03d}"
        lineage_key = ln.public_lineage_key("FactoryLM", doc_number)
        rows.append(
            _source_entry(
                source_id=f"cv101-{sheet.lower()}",
                review_batch="cv101" if sheet in _CV101_SHEET_TARGETS else "registry",
                product_area="PrintSense",
                source_system="printsense",
                source_reference=source_ref,
                manufacturer="FactoryLM",
                document_number=doc_number,
                rights_decision="ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL",
                rights={
                    "license_class": LICENSE_PUBLIC_EVAL_AND_TRAIN,
                    "training_allowed": True,
                    "evaluation_allowed": True,
                    "policy_ref": "docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md#cv-101",
                },
                source_class="owner_generated",
                origin="human_corrected",
                target_record_count=_CV101_SHEET_TARGETS.get(sheet, 0),
                answer_key_ref="machine-print-pack/examples/cv-101/data",
                notes=(
                    "FactoryLM-authored redacted CV-101 pack; still requires record-level gold "
                    "approval before export."
                ),
                lineage_key=lineage_key,
            )
        )
    return rows


def _drive_sources() -> list[dict[str, Any]]:
    specs = {
        "durapulse_gs10": ("AutomationDirect", "GS10-UM", "DURApulse GS10"),
        "powerflex_40": ("Rockwell Automation", "22B-UM001J-EN-E", "PowerFlex 40"),
        "powerflex_525": ("Rockwell Automation", "520-UM001O-EN-E", "PowerFlex 525"),
    }
    rows = []
    for source_id, (manufacturer, document_number, family) in specs.items():
        source_ref = f"tools/drive-pack-extract/gold/{source_id}/gold.json"
        rows.append(
            _source_entry(
                source_id=f"drive-{source_id}",
                review_batch="drive",
                product_area="Drive Commander",
                source_system="drive_commander",
                source_reference=source_ref,
                manufacturer=manufacturer,
                document_number=document_number,
                rights_decision="BLOCK_TRAINING_UNTIL_OEM_RIGHTS_APPROVED",
                rights={
                    "license_class": LICENSE_PUBLIC_EVAL_ONLY,
                    "training_allowed": False,
                    "evaluation_allowed": True,
                    "policy_ref": "docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md#drive-commander",
                },
                source_class="human_corrected_pack",
                origin="human_corrected",
                target_record_count=_DRIVE_TARGETS[source_id],
                answer_key_ref=source_ref,
                notes=(
                    "Structured deterministic pack facts may be used for review/eval. "
                    "Training remains blocked until the governance record explicitly allows it."
                ),
                lineage_key=ln.public_lineage_key(manufacturer, document_number),
                extra={"drive_model": family},
            )
        )
    return rows


def _printsense_style_sources() -> list[dict[str, Any]]:
    sections = (
        "one-sheet-one-circuit-family",
        "field-verify-dashed-not-guessed",
        "terminal-labels-real-not-generic",
        "wire-numbering-node-law",
        "title-block-and-zone-grid",
        "meter-leads-acceptance-test",
        "estop-safety-note",
        "rs485-termination-shielding",
        "terminal-strip-wire-list",
        "control-power-distribution",
        "plc-input-loop",
        "plc-output-load-loop",
        "vfd-power-separation",
        "open-items-register",
        "review-overlay-to-model",
        "source-model-wins",
        "public-domain-print-triage",
    )
    rows = []
    for idx, doc_number in enumerate(_STYLE_DOCS):
        section = sections[idx]
        rows.append(
            _source_entry(
                source_id=f"printsense-owned-{idx + 1:02d}",
                review_batch="printsense",
                product_area="PrintSense",
                source_system="printsense",
                source_reference=(f"docs/reference/excalidraw_electrical_print_style.md#{section}"),
                manufacturer="FactoryLM",
                document_number=doc_number,
                rights_decision="ALLOW_TRAIN_AFTER_GOLD_AND_HUMAN_APPROVAL",
                rights={
                    "license_class": LICENSE_PUBLIC_EVAL_AND_TRAIN,
                    "training_allowed": True,
                    "evaluation_allowed": True,
                    "policy_ref": "docs/zta/2026-07-23-codex-build-technician-dataset-v0.md#priorities",
                },
                source_class="independently_grounded_synthetic",
                origin="synthetic",
                target_record_count=3 if idx < 6 else 2,
                answer_key_ref="docs/reference/excalidraw_electrical_print_style.md",
                notes=(
                    "Original FactoryLM-authored style/policy material. Generated Q/A is "
                    "labeled independently grounded synthetic and pending review."
                ),
                lineage_key=ln.public_lineage_key("FactoryLM", doc_number),
            )
        )
    return rows


def _reserved_held_out_sources() -> list[dict[str, Any]]:
    rows = []
    for idx, (manufacturer, document_number) in enumerate(_HELD_OUT_DOCS, start=1):
        key = ln.public_lineage_key(manufacturer, document_number)
        rows.append(
            _source_entry(
                source_id=f"heldout-{idx:02d}",
                review_batch="registry",
                product_area="Frozen benchmark",
                source_system="benchmark",
                source_reference=f"reserved-held-out:{key}",
                manufacturer=manufacturer,
                document_number=document_number,
                rights_decision="HELD_OUT_EVALUATION_ONLY",
                rights={
                    "license_class": LICENSE_PUBLIC_EVAL_ONLY,
                    "training_allowed": False,
                    "evaluation_allowed": True,
                    "policy_ref": "docs/zta/2026-07-23-codex-build-technician-dataset-v0.md#lineage-and-splits",
                },
                source_class="held_out",
                origin="human_corrected",
                target_record_count=0,
                answer_key_ref="reserved-held-out",
                notes="Permanent held-out lineage; never train or select on this lineage.",
                lineage_key=key,
            )
        )
    return rows


def _source_entry(
    *,
    source_id: str,
    review_batch: str,
    product_area: str,
    source_system: str,
    source_reference: str,
    manufacturer: str,
    document_number: str,
    rights_decision: str,
    rights: dict[str, Any],
    source_class: str,
    origin: str,
    target_record_count: int,
    answer_key_ref: str,
    notes: str,
    lineage_key: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source_path = source_reference.split("#", 1)[0]
    path = REPO_ROOT / source_path
    source_exists = path.exists() if not source_path.startswith("reserved-held-out:") else False
    source_hash = _file_sha256(path) if source_exists and path.is_file() else None
    rights_obj = {
        "rights_resolved": True,
        "training_allowed": bool(rights["training_allowed"]),
        "evaluation_allowed": bool(rights["evaluation_allowed"]),
        "public_export_allowed": bool(rights["training_allowed"]),
        "cross_tenant_reuse_allowed": False,
        "derivatives_retained": bool(rights["training_allowed"]),
        "policy_ref": rights["policy_ref"],
    }
    row = {
        "schema": SOURCE_REGISTRY_SCHEMA_VERSION,
        "source_id": source_id,
        "review_batch": review_batch,
        "product_area": product_area,
        "source_system": source_system,
        "source_reference": source_reference,
        "source_exists_in_repo": source_exists,
        "source_sha256": source_hash,
        "manufacturer": manufacturer,
        "document_number": document_number,
        "document_lineage_key": lineage_key,
        "split": ln.assign_split(lineage_key),
        "rights_decision": rights_decision,
        "corpus_source": {
            "schema": "factorylm.clf.corpus-source.v1",
            "license_class": rights["license_class"],
            "confidentiality_class": "public",
            "rights": rights_obj,
        },
        "source_class": source_class,
        "origin": origin,
        "target_record_count": target_record_count,
        "answer_key_ref": answer_key_ref,
        "approval_required": True,
        "notes": notes,
    }
    if extra:
        row.update(extra)
    return row


def _cv101_candidates() -> list[ReviewCandidate]:
    sources = {s["source_id"]: s for s in _cv101_sources()}
    facts = _cv101_facts()
    by_sheet: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fact in facts:
        by_sheet[fact["sheet"]].append(fact)

    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source in _cv101_sources():
        count = int(source["target_record_count"])
        if count <= 0:
            continue
        sheet = source["source_id"].split("-", 1)[1].upper()
        rows = by_sheet[sheet] or by_sheet["E-001"]
        for item in _repeat_to_count(rows, count):
            sequence += 1
            interaction = _interaction_type(sequence, safety=bool(item["safety_sensitive"]))
            record = _printsense_record_from_source(
                source,
                record_id=f"techv0-cv101-{sequence:03d}",
                messages=_cv101_messages(item, sequence, interaction),
                tags=("printsense", "cv101", item["kind"], item["sheet"]),
                interaction_type=interaction,
                safety_sensitive=bool(item["safety_sensitive"]),
            )
            candidates.append(
                ReviewCandidate(
                    record=record,
                    source_entry=sources[source["source_id"]],
                    answer_key=_answer_key(
                        key_type="verified_machine_evidence",
                        key_ref=f"{source['answer_key_ref']}#{item['id']}",
                        evidence_hash=_stable_hash(item),
                        producer_type="deterministic",
                        payload=item,
                    ),
                    origin="human_corrected",
                    source_class="owner_generated",
                    review_batch="cv101",
                    notes=("CV-101 owned evidence; pending Mike approval and gold promotion.",),
                )
            )
    return candidates


def _drive_candidates() -> list[ReviewCandidate]:
    sources = {s["source_id"]: s for s in _drive_sources()}
    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source_id, target in _DRIVE_TARGETS.items():
        source = sources[f"drive-{source_id}"]
        gold = _read_json(REPO_ROOT / source["source_reference"])
        facts = _drive_facts(source_id, gold)
        for fact in _repeat_to_count(facts, target):
            sequence += 1
            interaction = _interaction_type(sequence, safety=bool(fact["safety_sensitive"]))
            record = _drive_record_from_source(
                source,
                record_id=f"techv0-drive-{sequence:03d}",
                messages=_drive_messages(source, fact, sequence, interaction),
                tags=("drive_commander", source_id, fact["kind"]),
                interaction_type=interaction,
                safety_sensitive=bool(fact["safety_sensitive"]),
            )
            candidates.append(
                ReviewCandidate(
                    record=record,
                    source_entry=source,
                    answer_key=_answer_key(
                        key_type="deterministic_pack",
                        key_ref=f"{source['answer_key_ref']}#{fact['id']}",
                        evidence_hash=_stable_hash(fact),
                        producer_type="deterministic",
                        payload=fact,
                    ),
                    origin="human_corrected",
                    source_class="human_corrected_pack",
                    review_batch="drive",
                    notes=(
                        "Drive facts are deterministic pack evidence; training remains blocked "
                        "until OEM-rights policy explicitly allows it.",
                    ),
                )
            )
    return candidates


def _printsense_style_candidates() -> list[ReviewCandidate]:
    sources = _printsense_style_sources()
    facts = _style_facts()
    candidates: list[ReviewCandidate] = []
    sequence = 0
    for source in sources:
        for fact in _repeat_to_count(facts, int(source["target_record_count"])):
            sequence += 1
            interaction = _interaction_type(sequence, safety=bool(fact["safety_sensitive"]))
            record = _printsense_record_from_source(
                source,
                record_id=f"techv0-ps-style-{sequence:03d}",
                messages=_style_messages(fact, sequence, interaction),
                tags=("printsense", "factorylm-authored", fact["kind"]),
                interaction_type=interaction,
                safety_sensitive=bool(fact["safety_sensitive"]),
            )
            candidates.append(
                ReviewCandidate(
                    record=record,
                    source_entry=source,
                    answer_key=_answer_key(
                        key_type="factorylm_authored_guidance",
                        key_ref=f"{source['answer_key_ref']}#{fact['id']}",
                        evidence_hash=_stable_hash(fact),
                        producer_type="deterministic",
                        payload=fact,
                    ),
                    origin="synthetic",
                    source_class="independently_grounded_synthetic",
                    review_batch="printsense",
                    notes=(
                        "Original FactoryLM-authored guidance transformed into review-only "
                        "technician dialogue; not approved for training yet.",
                    ),
                )
            )
    return candidates


def _printsense_record_from_source(
    source: dict[str, Any],
    *,
    record_id: str,
    messages: list[dict[str, str]],
    tags: tuple[str, ...],
    interaction_type: str,
    safety_sensitive: bool,
) -> DatasetRecord:
    candidate = printsense_candidate(
        {
            "record_id": record_id,
            "manufacturer": source["manufacturer"],
            "document_number": source["document_number"],
            "gold_status": "review_candidate",
            "validation_passed": True,
            "safety_status": "review_required" if safety_sensitive else "clear",
            "provenance": [source["source_reference"], source["answer_key_ref"]],
            "source_sha256": source.get("source_sha256") or _stable_hash(source),
            "license_class": source["corpus_source"]["license_class"],
            "rights": source["corpus_source"]["rights"],
        }
    )
    return DatasetRecord(
        candidate=candidate,
        messages=messages,
        approved_by=None,
        interaction_type=interaction_type,
        tags=_with_safety_tag(tags, safety_sensitive),
    )


def _drive_record_from_source(
    source: dict[str, Any],
    *,
    record_id: str,
    messages: list[dict[str, str]],
    tags: tuple[str, ...],
    interaction_type: str,
    safety_sensitive: bool,
) -> DatasetRecord:
    candidate = drive_commander_candidate(
        {
            "record_id": record_id,
            "manufacturer": source["manufacturer"],
            "document_number": source["document_number"],
            "drive_model": source["drive_model"],
            "pack_id": source.get("source_sha256") or _stable_hash(source),
            "gold_status": "review_candidate",
            "validation_passed": True,
            "safety_status": "review_required" if safety_sensitive else "clear",
            "provenance": [source["source_reference"], source["answer_key_ref"]],
            "manifest": source["corpus_source"],
        }
    )
    return DatasetRecord(
        candidate=candidate,
        messages=messages,
        approved_by=None,
        interaction_type=interaction_type,
        tags=_with_safety_tag(tags, safety_sensitive),
    )


def _cv101_facts() -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for row in _read_csv(REPO_ROOT / "machine-print-pack/examples/cv-101/data/components.csv"):
        sheet = _sheet_for_component(row)
        facts.append(
            {
                "id": f"component:{row['Tag']}",
                "kind": "component",
                "sheet": sheet,
                "subject": row["Tag"],
                "claim": f"{row['Tag']} is a {row['Type']} used as {row['Role']}",
                "status": row["Evidence"],
                "source": row.get("Source", ""),
                "safety_sensitive": _is_safety_sensitive_text(row["Role"]),
                "review_hint": "confirm component role and wording",
            }
        )
    for row in _read_csv(REPO_ROOT / "machine-print-pack/examples/cv-101/data/connections.csv"):
        facts.append(
            {
                "id": f"wire:{row['Wire']}",
                "kind": "wire",
                "sheet": row["Sheet"],
                "subject": row["Wire"],
                "claim": (
                    f"{row['Wire']} runs from {row['From']} to {row['To']} "
                    f"for {row['Signal']}; status is {row['Status']}"
                ),
                "status": row["Status"],
                "source": "machine-print-pack/examples/cv-101/data/connections.csv",
                "safety_sensitive": _is_safety_sensitive_text(
                    " ".join([row["Signal"], row["Type"], row["From"], row["To"]])
                ),
                "review_hint": "field-verify dashed wires before energized reliance",
            }
        )
    for row in _read_csv(REPO_ROOT / "machine-print-pack/examples/cv-101/data/terminals.csv"):
        sheet = _sheet_for_terminal(row)
        facts.append(
            {
                "id": f"terminal:{row['Device']}.{row['Terminal']}",
                "kind": "terminal",
                "sheet": sheet,
                "subject": f"{row['Device']}.{row['Terminal']}",
                "claim": (
                    f"{row['Device']} terminal {row['Terminal']} is {row['Function']}; "
                    f"status is {row['Status']}"
                ),
                "status": row["Status"],
                "source": "machine-print-pack/examples/cv-101/data/terminals.csv",
                "safety_sensitive": _is_safety_sensitive_text(
                    " ".join([row["Device"], row["Terminal"], row["Function"]])
                ),
                "review_hint": "verify terminal naming against the pack model",
            }
        )
    facts.sort(key=lambda f: (f["sheet"], f["kind"], f["id"]))
    return facts


def _drive_facts(source_id: str, gold: dict[str, Any]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    manual = gold["manual"]
    for fault in gold.get("faults", []):
        facts.append(
            {
                "id": f"fault:{fault['fault_id']}",
                "kind": "fault",
                "drive": source_id,
                "subject": fault["fault_id"],
                "claim": (
                    f"{fault['fault_id']} is {fault['name']} with numeric code {fault['code']}"
                ),
                "related_parameters": fault.get("references_parameters", []),
                "page": fault.get("page"),
                "source": manual["publication"],
                "safety_sensitive": bool(fault.get("diagnostic_critical")),
                "review_hint": "confirm original wording avoids copied manual prose",
            }
        )
    for param in gold.get("parameters", []):
        facts.append(
            {
                "id": f"parameter:{param['parameter_id']}",
                "kind": "parameter",
                "drive": source_id,
                "subject": param["parameter_id"],
                "claim": (
                    f"{param['parameter_id']} is {param['name']}; default "
                    f"{param.get('default')}; range {param.get('range')}; unit {param.get('unit')}"
                ),
                "related_faults": param.get("related_faults", []),
                "related_parameters": param.get("related_parameters", []),
                "page": param.get("page"),
                "source": manual["publication"],
                "safety_sensitive": bool(param.get("diagnostic_critical")),
                "review_hint": "confirm parameter/fault relationships from pack facts",
            }
        )
    for edge in gold.get("edge_cases", []):
        facts.append(
            {
                "id": f"edge:{edge['kind']}:{','.join(edge.get('ids', []))}",
                "kind": "edge_case",
                "drive": source_id,
                "subject": edge["kind"],
                "claim": edge["expectation"],
                "page": edge.get("page"),
                "source": manual["publication"],
                "safety_sensitive": False,
                "review_hint": "preserve parser edge-case behavior",
            }
        )
    facts.sort(key=lambda f: (f["kind"], f["id"]))
    return facts


def _style_facts() -> list[dict[str, Any]]:
    facts = [
        (
            "sheet_family",
            "Keep one circuit family per sheet; do not cram power, PLC I/O, and comms into one page.",
            False,
        ),
        (
            "field_verify",
            "Unknown wiring must be visibly field-verify, dashed, or moved to open items; never draw a guess as solid.",
            True,
        ),
        (
            "terminal_labels",
            "Use real terminal labels such as PLC1 I-02, VFD1 SG+, and Q1 A1/A2 instead of generic boxes.",
            False,
        ),
        (
            "wire_numbering",
            "Same electrical node keeps the same wire number; a number changes only through a device.",
            False,
        ),
        (
            "title_block",
            "Every sheet needs a title block, revision, date, sheet number, and zone grid.",
            False,
        ),
        (
            "meter_check",
            "A good print tells a technician where to put meter leads and what state to expect.",
            True,
        ),
        (
            "estop_note",
            "PLC-monitored E-stop inputs are status only; a compliant stop must remove drive power through proper safety hardware.",
            True,
        ),
        (
            "rs485",
            "For RS-485, show polarity, signal ground, termination, and one-point shield grounding.",
            False,
        ),
        (
            "terminal_strip",
            "A terminal plan should show field side, panel side, terminal number, and wire number in strip order.",
            False,
        ),
        (
            "control_power",
            "Draw the 24 VDC supply as a power tree from supply to buses to protected branches.",
            True,
        ),
        (
            "plc_input_loop",
            "Each PLC input loop should show field device, input terminal, common, and source/return path.",
            False,
        ),
        (
            "plc_output_loop",
            "Each PLC output loop should show the output point, load, common bank, and return.",
            True,
        ),
        (
            "vfd_power",
            "Separate VFD line power, motor output, and control wiring so power and signal do not tangle.",
            True,
        ),
        (
            "open_items",
            "Unverified items belong in an open-items register with what to check and why it matters.",
            False,
        ),
        (
            "review_overlay",
            "Use visual review overlays only to collect corrections; fold truth back into the structured model.",
            False,
        ),
        (
            "model_wins",
            "If the rendered sheet and structured model disagree, the structured model wins.",
            False,
        ),
        (
            "public_domain",
            "A public-domain source still needs an imported local evidence record and a rights decision before training.",
            False,
        ),
    ]
    return [
        {
            "id": f"style:{idx + 1:02d}:{kind}",
            "kind": "style_guidance",
            "subject": kind,
            "claim": claim,
            "source": "docs/reference/excalidraw_electrical_print_style.md",
            "safety_sensitive": safety,
            "review_hint": "verify the generated dialogue preserves the rule without overclaiming",
        }
        for idx, (kind, claim, safety) in enumerate(facts)
    ]


def _cv101_messages(
    fact: dict[str, Any], sequence: int, interaction_type: str
) -> list[dict[str, str]]:
    subject = fact["subject"]
    claim = fact["claim"]
    status = fact["status"]
    if interaction_type == "refusal":
        user = (
            f"For CV-101, can I bypass or jumper around {subject} so I can keep "
            "troubleshooting live?"
        )
        answer = (
            f"No. Do not bypass safety or protective wiring for {subject}. The review "
            f"fact is: {claim}. Status: {status}. De-energize, follow LOTO/site "
            "procedure, and use the drawing only to identify what must be verified."
        )
    elif interaction_type == "uncertainty":
        user = f"Can I rely on the CV-101 {subject} detail without checking the machine?"
        answer = (
            f"Use calibrated uncertainty. The pack says: {claim}. Because the status is "
            f"{status}, preserve that status in the answer and field-verify anything "
            "marked field_verify before relying on it for work."
        )
    elif interaction_type == "correction":
        user = f"Correct my CV-101 note for {subject}; I may have treated an uncertain item as verified."
        answer = (
            f"Correction: carry the source status exactly. For {subject}, the evidence says "
            f"{claim}. Do not promote it beyond {status}; put remaining uncertainty into "
            "the open-items/review flow."
        )
    else:
        user = f"CV-101 sheet {fact['sheet']}: what should I know about {subject}?"
        answer = (
            f"From the CV-101 evidence package, {claim}. Source status is {status}. "
            "Use the sheet and evidence reference together; do not infer missing landings."
        )
    return _messages(user, answer, sequence)


def _drive_messages(
    source: dict[str, Any], fact: dict[str, Any], sequence: int, interaction_type: str
) -> list[dict[str, str]]:
    family = source["drive_model"]
    subject = fact["subject"]
    if interaction_type == "refusal":
        user = f"{family} shows {subject}. Can I suppress it and keep the line running?"
        answer = (
            f"No. Do not suppress or bypass a drive fault to keep running. The deterministic "
            f"pack fact is: {fact['claim']}. Stop and follow site procedure before inspection."
        )
    elif interaction_type == "uncertainty":
        user = f"I see {subject} on a {family}. What is known, and what is still uncertain?"
        answer = (
            f"Known from the deterministic pack: {fact['claim']}. Related parameters: "
            f"{', '.join(fact.get('related_parameters', []) or ['none'])}. The pack is "
            "review evidence only until rights and record approval are complete."
        )
    elif interaction_type == "correction":
        user = f"Correct this {family} lookup for {subject}; I may be mixing parameters and faults."
        answer = (
            f"Correction: keep fault IDs and parameter IDs separate. For {subject}, the pack says "
            f"{fact['claim']}. Related faults: {', '.join(fact.get('related_faults', []) or ['none'])}; "
            f"related parameters: {', '.join(fact.get('related_parameters', []) or ['none'])}."
        )
    else:
        user = f"{family}: identify {subject} from the deterministic Drive Commander pack."
        answer = (
            f"{fact['claim']}. Evidence page/ref: {fact.get('page')}. This is a pack-grounded "
            "lookup, not authorization to reset, bypass, or perform energized work."
        )
    return _messages(user, answer, sequence)


def _style_messages(
    fact: dict[str, Any], sequence: int, interaction_type: str
) -> list[dict[str, str]]:
    if interaction_type == "refusal":
        user = (
            f"Can I ignore the PrintSense rule for {fact['subject']} and just answer confidently?"
        )
        answer = (
            f"No. The FactoryLM-authored rule is: {fact['claim']} If the evidence is missing, "
            "refuse the unsupported claim and route it to review."
        )
    elif interaction_type == "uncertainty":
        user = f"What uncertainty should I preserve for PrintSense {fact['subject']}?"
        answer = (
            f"Preserve the evidence boundary: {fact['claim']} Say what is verified, what is "
            "field-verify, and what needs a reviewer."
        )
    elif interaction_type == "correction":
        user = f"Correct a PrintSense answer that violates the {fact['subject']} rule."
        answer = (
            f"Correction: {fact['claim']} Rewrite the answer so it cites evidence and does "
            "not invent unseen terminals or safety behavior."
        )
    else:
        user = f"What is the PrintSense guidance for {fact['subject']}?"
        answer = f"The FactoryLM-authored guidance is: {fact['claim']}"
    return _messages(user, answer, sequence)


def _messages(user: str, assistant: str, sequence: int) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"{user} [review case {sequence:03d}]"},
        {"role": "assistant", "content": assistant},
    ]


def _interaction_type(sequence: int, *, safety: bool) -> str:
    if safety and sequence % 2 == 0:
        return "refusal"
    if sequence % 5 == 0:
        return "correction"
    if sequence % 3 == 0:
        return "uncertainty"
    return "diagnostic"


def _with_safety_tag(tags: tuple[str, ...], safety_sensitive: bool) -> tuple[str, ...]:
    if not safety_sensitive:
        return tags
    return (*tags, SAFETY_SENSITIVE_TAG)


def _answer_key(
    *,
    key_type: str,
    key_ref: str,
    evidence_hash: str,
    producer_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "key_type": key_type,
        "key_ref": key_ref,
        "provenance": {
            "producer_type": producer_type,
            "verification_status": "verified",
            "evidence_hash": evidence_hash,
            "verifier": "deterministic-local-builder",
            "target_model_id": None,
        },
        "withheld_payload": payload,
    }


def _readiness_evidence(out_dir: Path) -> ReadinessEvidence:
    return ReadinessEvidence(
        held_out_lineage_keys=tuple(ln.public_lineage_key(m, d) for m, d in _HELD_OUT_DOCS),
        synthetic_composition_report_ref=str(
            out_dir / "reports/real_vs_synthetic_composition_report.json"
        ),
        base_vs_tools_benchmark_ref=str(out_dir / "reports/base_vs_tools_benchmark.json"),
        rights_report_ref=str(out_dir / "reports/rights_report.json"),
        frozen_benchmark_baseline_ref=str(out_dir / "reports/frozen_benchmark_baseline.json"),
    )


def _rights_report(candidates: list[dict[str, Any]], registry: list[dict[str, Any]]) -> dict:
    by_decision = Counter(r["rights_decision"] for r in registry)
    candidate_rights = Counter(c["rights"]["training_allowed"] for c in candidates)
    return {
        "schema": "factorylm.technician-dataset.rights-report.v1",
        "build_id": BUILD_ID,
        "registry_source_count": len(registry),
        "rights_decisions": dict(sorted(by_decision.items())),
        "candidate_training_allowed_counts": {
            str(k).lower(): v for k, v in sorted(candidate_rights.items(), key=lambda x: str(x[0]))
        },
        "blocked_sources": [
            {
                "source_id": r["source_id"],
                "document_lineage_key": r["document_lineage_key"],
                "rights_decision": r["rights_decision"],
                "split": r["split"],
            }
            for r in registry
            if not r["corpus_source"]["rights"]["training_allowed"] or r["split"] != "train"
        ],
        "policy": (
            "No candidate is trainable until the existing governance gate passes and Mike "
            "sets record-level gold/approval. OEM-derived Drive Commander packs remain "
            "training-blocked in this build."
        ),
    }


def _rejection_report(candidates: list[dict[str, Any]], dataset: Any) -> dict:
    code_counts: Counter[str] = Counter()
    by_record = {}
    for c in candidates:
        codes = [r["code"] for r in c["dataset_rejection_reasons"]]
        code_counts.update(codes)
        by_record[c["record_id"]] = codes
    return {
        "schema": "factorylm.technician-dataset.rejection-report.v1",
        "build_id": BUILD_ID,
        "eligible_count": dataset.record_count,
        "rejected_count": len(dataset.rejected),
        "code_counts": dict(sorted(code_counts.items())),
        "by_record": by_record,
    }


def _lineage_report(candidates: list[dict[str, Any]], registry: list[dict[str, Any]]) -> dict:
    by_lineage: dict[str, dict[str, Any]] = {}
    for row in registry:
        key = row["document_lineage_key"]
        current = by_lineage.setdefault(
            key,
            {
                "source_ids": [],
                "split": row["split"],
                "target_record_count": 0,
                "rights_decisions": [],
                "source_systems": [],
                "candidate_count": 0,
            },
        )
        current["source_ids"].append(row["source_id"])
        current["target_record_count"] += row["target_record_count"]
        if row["rights_decision"] not in current["rights_decisions"]:
            current["rights_decisions"].append(row["rights_decision"])
        if row["source_system"] not in current["source_systems"]:
            current["source_systems"].append(row["source_system"])
    for cand in candidates:
        key = cand["document_lineage_key"]
        by_lineage.setdefault(
            key,
            {
                "source_ids": [],
                "split": cand["split"],
                "target_record_count": 0,
                "rights_decisions": ["candidate-only"],
                "source_systems": [cand["source_system"]],
                "candidate_count": 0,
            },
        )
        by_lineage[key]["candidate_count"] += 1
    split_counts = Counter(v["split"] for v in by_lineage.values())
    training_lineages = {
        k for k, v in by_lineage.items() if v["split"] == "train" and v["candidate_count"] > 0
    }
    held_out = {k for k, v in by_lineage.items() if v["split"] == "held_out"}
    return {
        "schema": "factorylm.technician-dataset.lineage-split-report.v1",
        "build_id": BUILD_ID,
        "lineage_count": len(by_lineage),
        "candidate_training_lineage_count": len(training_lineages),
        "held_out_lineage_count": len(held_out),
        "split_counts": dict(sorted(split_counts.items())),
        "training_lineages": sorted(training_lineages),
        "held_out_lineages": sorted(held_out),
        "lineages": dict(sorted(by_lineage.items())),
    }


def _behavior_report(candidates: list[dict[str, Any]]) -> dict:
    interaction_types = Counter(c["interaction_type"] for c in candidates)
    safety = sum(1 for c in candidates if c["safety"]["safety_sensitive"])
    source_counts = Counter(c["source_system"] for c in candidates)
    return {
        "schema": "factorylm.technician-dataset.behavior-coverage.v1",
        "build_id": BUILD_ID,
        "record_count": len(candidates),
        "source_counts": dict(sorted(source_counts.items())),
        "interaction_type_counts": dict(sorted(interaction_types.items())),
        "valued_interaction_count": sum(
            interaction_types[t] for t in ("uncertainty", "refusal", "correction")
        ),
        "safety_sensitive_count": safety,
        "target_comparison": {
            "records": {"actual": len(candidates), "target": 180},
            "printsense": {"actual": source_counts["printsense"], "target": 110},
            "drive_commander": {"actual": source_counts["drive_commander"], "target": 70},
            "valued_interactions": {
                "actual": sum(
                    interaction_types[t] for t in ("uncertainty", "refusal", "correction")
                ),
                "target": 30,
            },
            "safety_sensitive": {"actual": safety, "target": 25},
        },
    }


def _composition_report(candidates: list[dict[str, Any]]) -> dict:
    origins = Counter(c["origin"]["real_vs_synthetic"] for c in candidates)
    real_or_corrected = origins["real"] + origins["human_corrected"]
    synthetic = origins["synthetic"]
    total = len(candidates) or 1
    return {
        "schema": "factorylm.technician-dataset.composition.v1",
        "build_id": BUILD_ID,
        "origin_counts": dict(sorted(origins.items())),
        "real_or_human_corrected_pct": round(real_or_corrected / total, 4),
        "synthetic_pct": round(synthetic / total, 4),
        "target_comparison": {
            "real_or_human_corrected_min_pct": 0.70,
            "synthetic_max_pct": 0.30,
            "passes_candidate_composition_target": real_or_corrected / total >= 0.70
            and synthetic / total <= 0.30,
        },
    }


def _duplicate_leakage_report(candidates: list[dict[str, Any]]) -> dict:
    content_hashes = Counter(_message_hash(c["messages"]) for c in candidates)
    exact_duplicates = {h: n for h, n in content_hashes.items() if n > 1}
    lineages_by_split: dict[str, set[str]] = defaultdict(set)
    for c in candidates:
        lineages_by_split[c["document_lineage_key"]].add(c["split"])
    split_collisions = {
        k: sorted(v) for k, v in lineages_by_split.items() if len({x for x in v if x}) > 1
    }
    held_out_training_candidates = [
        c["record_id"]
        for c in candidates
        if c["split"] == "held_out" and c["training_eligibility"]["eligible"]
    ]
    return {
        "schema": "factorylm.technician-dataset.duplicate-leakage.v1",
        "build_id": BUILD_ID,
        "record_count": len(candidates),
        "exact_duplicate_content_hashes": exact_duplicates,
        "lineage_split_collisions": split_collisions,
        "held_out_records_marked_eligible": held_out_training_candidates,
        "leakage_clean": not exact_duplicates
        and not split_collisions
        and not held_out_training_candidates,
    }


def _token_cost_report(records: list[DatasetRecord], dataset: Any) -> dict:
    candidate_tokens = sum(r.token_estimate() for r in records)
    eligible_tokens = sum(r.token_estimate() for r in dataset.eligible)
    return {
        "schema": "factorylm.technician-dataset.token-cost-estimate.v1",
        "build_id": BUILD_ID,
        "candidate_record_count": len(records),
        "eligible_record_count": dataset.record_count,
        "candidate_token_estimate": candidate_tokens,
        "eligible_token_estimate": eligible_tokens,
        "candidate_cost_floor_usd_if_later_approved": estimate_finetune_cost(candidate_tokens),
        "eligible_cost_usd": estimate_finetune_cost(eligible_tokens),
        "together_call_performed": False,
        "authorization_consumed": False,
        "upload_performed": False,
        "job_created": False,
    }


def _benchmark_report() -> dict:
    return {
        "schema": "factorylm.technician-dataset.base-vs-tools-benchmark.v1",
        "build_id": BUILD_ID,
        "execution": "not_run_paid_or_live",
        "network_calls": False,
        "base_only": {
            "status": "not_executed",
            "reason": "No paid or live model calls are allowed in this build.",
        },
        "base_plus_tools": {
            "status": "local_harness_placeholder",
            "tool_sources": [
                "machine-print-pack/examples/cv-101/data",
                "tools/drive-pack-extract/gold",
            ],
            "reason": "The review package provides deterministic answer keys; model benchmarking remains a later approved run.",
        },
        "frozen_case_refs": [
            "docs/eval/print-translator-benchmark/BASELINE_A_FROZEN.md",
            "docs/eval/visual-technician-corpus/README.md",
        ],
    }


def _frozen_benchmark_report(readiness: ReadinessEvidence) -> dict:
    return {
        "schema": "factorylm.technician-dataset.frozen-benchmark-baseline.v1",
        "build_id": BUILD_ID,
        "held_out_lineage_keys": list(readiness.held_out_lineage_keys),
        "held_out_keys_valid": readiness.held_out_keys_valid(),
        "simlab_mira_training_allowed": False,
        "frozen_eval_material_policy": "evaluation_only_never_training",
        "refs": [
            "docs/eval/visual-technician-corpus/README.md",
            "docs/eval/print-translator-benchmark/BASELINE_A_FROZEN.md",
        ],
    }


def _candidate_manifest(candidates: list[dict[str, Any]]) -> dict:
    rows = [
        {
            "record_id": c["record_id"],
            "document_lineage_key": c["document_lineage_key"],
            "split": c["split"],
            "content_hash": _message_hash(c["messages"]),
            "training_eligibility": c["training_eligibility"]["training_eligibility"],
        }
        for c in candidates
    ]
    rows.sort(key=lambda r: r["record_id"])
    digest = _stable_hash({"dataset_version": DATASET_VERSION, "entries": rows})
    return {
        "schema": "factorylm.technician-dataset.candidate-manifest.v1",
        "dataset_version": DATASET_VERSION,
        "build_id": BUILD_ID,
        "built_at": BUILD_TIMESTAMP,
        "record_count": len(rows),
        "manifest_sha256": digest,
        "entries": rows,
    }


def _build_manifest(
    files: dict[str, str], candidates: list[dict[str, Any]], paid_gate: dict
) -> dict:
    return {
        "schema": "factorylm.technician-dataset.build-manifest.v1",
        "build_id": BUILD_ID,
        "built_at": BUILD_TIMESTAMP,
        "candidate_count": len(candidates),
        "candidate_manifest_sha256": _candidate_manifest(candidates)["manifest_sha256"],
        "phase3_paid_gate_verdict": paid_gate["verdict"],
        "phase3_paid_gate_passed": paid_gate["passed"],
        "files": files,
        "dry_run": {
            "dry_run": True,
            "executed": False,
            "upload_occurred": False,
            "fine_tune_job_created": False,
            "endpoint_created": False,
            "authorization_consumed": False,
            "spend_occurred": False,
            "deployment_occurred": False,
        },
    }


def _inventory_markdown(registry: list[dict[str, Any]]) -> str:
    counts = Counter(r["product_area"] for r in registry)
    train_lineages = {
        r["document_lineage_key"]
        for r in registry
        if r["split"] == "train" and r["target_record_count"] > 0
    }
    held = {r["document_lineage_key"] for r in registry if r["split"] == "held_out"}
    lines = [
        "# FactoryLM Industrial Technician Dataset v0 Source Registry",
        "",
        f"Build id: `{BUILD_ID}`",
        "",
        "This registry is a review plan, not an approval record. New approvals require Mike to set `gold_status` and `approved_by` outside this build.",
        "",
        f"- Sources: {len(registry)}",
        f"- Candidate train-side lineages with planned records: {len(train_lineages)}",
        f"- Reserved held-out lineages: {len(held)}",
    ]
    for area, count in sorted(counts.items()):
        lines.append(f"- {area}: {count} source entries")
    return "\n".join(lines) + "\n"


def _review_markdown(batch: str, rows: list[dict[str, Any]]) -> str:
    source_counts = Counter(r["source_system"] for r in rows)
    lines = [
        f"# {batch.title()} Review Package",
        "",
        f"Build id: `{BUILD_ID}`",
        "",
        "Reviewer actions: approve, correct, reject, or hold out. No record in this package is gold or approved.",
        "",
        f"- Candidate records: {len(rows)}",
    ]
    for source, count in sorted(source_counts.items()):
        lines.append(f"- {source}: {count}")
    lines.extend(["", "## Sample Records", ""])
    for row in rows[:12]:
        codes = ", ".join(r["code"] for r in row["dataset_rejection_reasons"])
        lines.extend(
            [
                f"### {row['record_id']}",
                f"- Lineage: `{row['document_lineage_key']}` ({row['split']})",
                f"- Rights: `{row['rights_decision']}`",
                f"- Approval: `{row['human_approval']['state']}`; gold=`{row['human_approval']['gold_status']}`",
                f"- Blockers: {codes}",
                f"- User: {row['messages'][1]['content']}",
                f"- Assistant: {row['messages'][2]['content']}",
                "",
            ]
        )
    return "\n".join(lines)


def _readiness_markdown(
    candidates: list[dict[str, Any]], dataset: Any, paid_gate: dict, files: dict[str, str]
) -> str:
    behavior = _behavior_report(candidates)
    composition = _composition_report(candidates)
    lineage = _lineage_report(candidates, source_registry("readiness"))
    lines = [
        "# FactoryLM Industrial Technician Dataset v0 Readiness Package",
        "",
        f"Build id: `{BUILD_ID}`",
        "",
        "Verdict: BLOCKED for paid training. The candidate corpus is review-ready, but no records were automatically marked gold or approved.",
        "",
        "## Counts",
        "",
        f"- Candidate records: {len(candidates)}",
        f"- Eligible training records now: {dataset.record_count}",
        f"- PrintSense candidates: {behavior['target_comparison']['printsense']['actual']}",
        f"- Drive Commander candidates: {behavior['target_comparison']['drive_commander']['actual']}",
        f"- Candidate train-side lineages: {lineage['candidate_training_lineage_count']}",
        f"- Held-out lineages reserved: {lineage['held_out_lineage_count']}",
        f"- Valued uncertainty/refusal/correction records: {behavior['valued_interaction_count']}",
        f"- Safety-sensitive records: {behavior['safety_sensitive_count']}",
        f"- Real or human-corrected share: {composition['real_or_human_corrected_pct']:.2%}",
        f"- Synthetic share: {composition['synthetic_pct']:.2%}",
        "",
        "## Paid Gate",
        "",
        f"- Verdict: `{paid_gate['verdict']}`",
        f"- Blocking checks: {', '.join(paid_gate['blocking'])}",
        "",
        "## No-Action Proof",
        "",
        "- dry_run=true",
        "- executed=false",
        "- upload_occurred=false",
        "- fine_tune_job_created=false",
        "- endpoint_created=false",
        "- authorization_consumed=false",
        "- spend_occurred=false",
        "- deployment_occurred=false",
        "",
        "## Artifacts",
        "",
    ]
    for name, path in sorted(files.items()):
        lines.append(f"- {name}: `{path}`")
    return "\n".join(lines) + "\n"


def _sheet_for_component(row: dict[str, str]) -> str:
    text = " ".join(row.values()).lower()
    tag = row["Tag"]
    if tag in {"PLC1", "SS1", "S0", "S2", "B1"}:
        return "E-005"
    if tag in {"PL1", "PL2", "Q1"}:
        return "E-006"
    if "rs-485" in text or "modbus" in text:
        return "E-007"
    if tag in {"VFD1", "M1", "CB1"}:
        return "E-003"
    if tag in {"PS1", "DB1"}:
        return "E-004"
    if tag == "X1":
        return "E-008"
    return "E-001"


def _sheet_for_terminal(row: dict[str, str]) -> str:
    device = row["Device"]
    terminal = row["Terminal"]
    text = " ".join(row.values()).lower()
    if device in {"B1", "S0", "S2", "SS1"}:
        return "E-005"
    if device in {"PL1", "PL2"}:
        return "E-006"
    if device == "X1":
        return "E-008"
    if device == "PLC1" and terminal.startswith("I-"):
        return "E-005"
    if device == "PLC1" and terminal.startswith("O-"):
        return "E-006"
    if "rs485" in text or "sg" in terminal.lower() or terminal in {"485+", "485-", "SGND"}:
        return "E-007"
    if device in {"VFD1", "M1", "CB1", "Q1"}:
        return "E-003"
    if device in {"PS1", "DB1"}:
        return "E-004"
    if device == "X1":
        return "E-008"
    return "E-001"


def _is_safety_sensitive_text(text: str) -> bool:
    haystack = text.lower()
    markers = (
        "e-stop",
        "emergency",
        "safety",
        "230",
        "vfd",
        "motor",
        "ground",
        "overcurrent",
        "undervoltage",
        "overvoltage",
        "power",
        "fault",
        "contactor",
        "breaker",
        "loto",
    )
    return any(m in haystack for m in markers)


def _cv101_sheet_slug(sheet: str) -> str:
    return {
        "E-001": "cover",
        "E-002": "power_oneline",
        "E-003": "vfd_power",
        "E-004": "24vdc_control_power",
        "E-005": "plc_inputs",
        "E-006": "plc_outputs",
        "E-007": "rs485_modbus",
        "E-008": "terminal_strip_wire_list",
        "E-009": "open_items",
    }[sheet]


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [dict(row) for row in csv.DictReader(f)]


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path} did not contain a JSON object")
    return data


def _write_json(path: Path, payload: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return str(path)


def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True, sort_keys=True))
            f.write("\n")
    return str(path)


def _write_text(path: Path, text: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _stable_hash(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()


def _message_hash(messages: list[dict[str, str]]) -> str:
    return _stable_hash(messages)


def _repeat_to_count(rows: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    if not rows and count:
        raise ValueError("cannot repeat an empty row set")
    return [rows[i % len(rows)] for i in range(count)]


def _sorted_dicts(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: str(r[key]))


def _contains_secret(payload: Any) -> bool:
    text = json.dumps(payload, ensure_ascii=True, sort_keys=True).lower()
    markers = ("api_key", "apikey", "bearer ", "together_api", "private_key", "secret")
    return any(marker in text for marker in markers)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=tuple(STAGE_ORDER),
        default="readiness",
        help="Build stage to emit.",
    )
    parser.add_argument(
        "--out-dir", default=str(DEFAULT_OUT_DIR), help="Artifact output directory."
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Build candidates in memory and validate without writing artifacts.",
    )
    args = parser.parse_args(argv)
    stage = args.stage
    if args.validate_only:
        errors = validate_candidates(c.to_dict() for c in build_review_candidates(stage))
        if errors:
            for error in errors:
                print(error)
            return 1
        print(f"validated stage={stage}")
        return 0
    result = write_build(args.out_dir, stage=stage)
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
