"""Universal VFD manual compiler — orchestrator + CLI.

Runs the full deterministic-first pipeline over one OEM drive manual PDF:

    document_ir -> table_discovery -> [dialect_registry | generic_table_parser]
                -> llm_region_repair (optional) -> evidence_validator
                -> canonical JSON + evidence dir

and reports an HONEST per-manual status:

    COMPLETE | PARTIAL | NO_TABLES_FOUND | TABLES_FOUND_NOT_PARSED | FAILED

A run with zero validated records is NEVER labelled a success — that was the
original bug (0/0 reported as "EXTRACTED"). Deterministic routes run first and
fully offline; the LLM region-repair fallback is region-bounded and off unless
explicitly enabled.

Canonical output: ``faults[]`` (string ``id``), ``parameters[]`` (string
``id``), document identity + provenance, extraction status + coverage report,
rejected candidates with reasons, field-level citations + confidence. The legacy
integer ``fault_codes`` map is DERIVED (compat only) from numeric fault ids —
a mnemonic code is never assigned an invented integer.

    python universal_extract.py MANUAL.pdf --output result.json --evidence-dir evidence/

Pure read-only / offline (unless ``MIRA_DRIVE_LLM_REPAIR=1``).
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import dialect_registry
import evidence_validator
import llm_region_repair
import table_discovery
from document_ir import DocumentIR, build_document_ir
from generic_table_parser import parse_candidate

logger = logging.getLogger("drive-pack-extract.universal")

EXTRACTOR_VERSION = "universal-1.0"

# Status vocabulary — the extraction-layer field. Deliberately ORTHOGONAL to the
# scorecard/grading ``trust_status`` vocabulary (candidate/beta/bench-proven/…).
STATUS_COMPLETE = "COMPLETE"
STATUS_PARTIAL = "PARTIAL"
STATUS_NO_TABLES = "NO_TABLES_FOUND"
STATUS_NOT_PARSED = "TABLES_FOUND_NOT_PARSED"
STATUS_FAILED = "FAILED"

_LLM_REPAIR_CONF = 0.5  # candidates below this get the optional LLM fallback


def _dedup(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Unique by (record_type, id); keep the richest (most fields, then highest
    confidence). Distinct fault/parameter ids — the honest record count."""
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for r in records:
        key = (r["record_type"], r["id"])
        cur = best.get(key)
        if cur is None or (len(r["fields"]), r["confidence"]) > (len(cur["fields"]), cur["confidence"]):
            best[key] = r
    return list(best.values())


def _compute_status(candidates: list, validated: list) -> str:
    if not candidates:
        return STATUS_NO_TABLES
    if not validated:
        return STATUS_NOT_PARSED
    cand_pages = {c.page for c in candidates}
    parsed_pages = {r["page"] for r in validated}
    ratio = len(parsed_pages & cand_pages) / max(len(cand_pages), 1)
    return STATUS_COMPLETE if ratio >= 0.8 else STATUS_PARTIAL


def extract_manual(
    pdf_path: str | Path,
    *,
    min_conf: float = 0.35,
    pages: list[int] | None = None,
    evidence_dir: str | Path | None = None,
    doc_id: str | None = None,
) -> dict[str, Any]:
    pdf_path = str(pdf_path)
    result: dict[str, Any] = {
        "document": {"doc_id": doc_id or Path(pdf_path).stem, "path": pdf_path,
                     "extractor_version": EXTRACTOR_VERSION},
        "dialects_available": dialect_registry.DIALECTS,
    }
    try:
        ir: DocumentIR = build_document_ir(pdf_path, pages=pages, doc_id=doc_id)
    except Exception as exc:  # noqa: BLE001 — report, never raise to caller
        logger.exception("build_document_ir failed for %s", pdf_path)
        result["status"] = STATUS_FAILED
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result

    result["document"].update({"sha256": ir.sha256, "pages_total": ir.n_pages_total})

    candidates = table_discovery.discover_document(ir.pages, min_conf=min_conf)
    cand_pages = sorted({c.page for c in candidates})

    # --- Dialects first (proven, high precision) over candidate pages ---------
    dialect_records = dialect_registry.run_dialects(pdf_path, cand_pages) if cand_pages else []
    claimed = dialect_registry.dialect_pages(dialect_records)

    # --- Generic (+ optional LLM repair) where no dialect claimed the page ----
    generic_records: list[dict[str, Any]] = []
    learning: list[dict[str, Any]] = []
    empty_candidates: list[dict[str, Any]] = []
    ir_by_page = {p.number: p for p in ir.pages}
    for cand in candidates:
        if cand.page in claimed:
            continue
        page_ir = ir_by_page.get(cand.page)
        if page_ir is None:
            continue
        recs = parse_candidate(page_ir, cand)
        if not recs and cand.confidence < _LLM_REPAIR_CONF and llm_region_repair.is_enabled():
            repaired, artifact = llm_region_repair.repair_region(page_ir, cand)
            learning.append(artifact)
            recs = repaired
        if recs:
            generic_records.extend(recs)
        else:
            empty_candidates.append({"page": cand.page, "kind": cand.kind,
                                     "confidence": cand.confidence, "reasons": cand.reasons})

    all_records = dialect_records + generic_records
    validated, rejected = evidence_validator.validate_records(pdf_path, all_records)
    validated = _dedup(validated)

    faults = [r for r in validated if r["record_type"] == "fault"]
    params = [r for r in validated if r["record_type"] == "parameter"]

    # Derived legacy compat map — numeric fault ids only, never invented.
    fault_codes: dict[int, str] = {}
    for f in faults:
        if f["id_kind"] == "numeric":
            try:
                fault_codes[int(f["id"])] = f["name"]
            except (TypeError, ValueError):
                pass

    by_route: dict[str, int] = {}
    for r in validated:
        by_route[r["route"]] = by_route.get(r["route"], 0) + 1

    status = _compute_status(candidates, validated)
    parsed_pages = sorted({r["page"] for r in validated})

    result.update({
        "status": status,
        "coverage": {
            "candidate_table_pages": len(cand_pages),
            "candidate_pages": cand_pages,
            "parsed_pages": parsed_pages,
            "fault_count": len(faults),
            "parameter_count": len(params),
            "record_count": len(validated),
            "by_route": by_route,
            "rejected_record_count": len(rejected),
            "empty_candidate_count": len(empty_candidates),
        },
        "faults": faults,
        "parameters": params,
        "fault_codes": fault_codes,
        "rejected_candidates": empty_candidates,
        "rejected_records": [
            {"id": r.get("id"), "page": r.get("page"), "reason": r.get("reject_reason")}
            for r in rejected
        ],
        "learning_artifacts": learning,
    })

    if evidence_dir:
        _write_evidence(evidence_dir, result, validated, rejected, learning)
    return result


def _write_evidence(evidence_dir, result, validated, rejected, learning) -> None:
    d = Path(evidence_dir)
    d.mkdir(parents=True, exist_ok=True)
    doc_id = result["document"]["doc_id"]
    (d / f"{doc_id}.records.json").write_text(json.dumps(validated, indent=2))
    (d / f"{doc_id}.rejected.json").write_text(json.dumps(rejected, indent=2))
    if learning:
        (d / f"{doc_id}.learning.json").write_text(json.dumps(learning, indent=2))
    (d / f"{doc_id}.summary.json").write_text(json.dumps(
        {"document": result["document"], "status": result["status"],
         "coverage": result["coverage"]}, indent=2))


def main() -> int:
    logging.basicConfig(level=logging.WARNING)
    ap = argparse.ArgumentParser(description="Universal VFD manual compiler")
    ap.add_argument("pdf")
    ap.add_argument("--output", "-o", help="write full canonical JSON here")
    ap.add_argument("--evidence-dir", help="write per-record evidence artifacts here")
    ap.add_argument("--min-conf", type=float, default=0.35)
    ap.add_argument("--pages", help="comma-separated 1-indexed pages (default: all)")
    ap.add_argument("--doc-id")
    args = ap.parse_args()

    pages = [int(x) for x in args.pages.split(",")] if args.pages else None
    result = extract_manual(
        args.pdf, min_conf=args.min_conf, pages=pages,
        evidence_dir=args.evidence_dir, doc_id=args.doc_id,
    )
    cov = result.get("coverage", {})
    print(f"{result['document']['doc_id']}: status={result['status']} "
          f"faults={cov.get('fault_count', 0)} params={cov.get('parameter_count', 0)} "
          f"cand_pages={cov.get('candidate_table_pages', 0)} "
          f"parsed_pages={len(cov.get('parsed_pages', []))} routes={cov.get('by_route', {})}")
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2))
        print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
