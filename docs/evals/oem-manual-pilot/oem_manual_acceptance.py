#!/usr/bin/env python3
"""Offline retrieval-evidence gate; never a generated-answer acceptance claim.

No providers, database connections, or OEM content acquisition. Inputs are frozen
case requirements and previously recorded retrieval observations.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

SCOPE = "retrieval_evidence_only"
EXIT_CODES = {"pass": 0, "fail": 1, "inconclusive": 2}


def _page(value):
    return type(value) is int and value > 0


def _identifier(value):
    return isinstance(value, str) and bool(value.strip())


def _normalize(text):
    return " ".join(text.casefold().split())


def _verdict(case_id, status, reasons, missing_pages=None, missing_evidence=None):
    return {
        "id": case_id,
        "scope": SCOPE,
        "status": status,
        "reasons": reasons,
        "missing_pages": missing_pages or [],
        "missing_evidence": missing_evidence or [],
        "generated_answer_acceptance": "not_evaluated",
    }


def evaluate_case(case, result):
    """Require every declared page/span; missing observations cannot pass.

    Relationship verification is an explicit caller-supplied observation, not a
    table parser or a semantic correctness judgment performed by this evaluator.
    """
    case_id = case.get("id") if isinstance(case, dict) else None

    def invalid(reason):
        return _verdict(case_id, "fail", [reason])

    if not isinstance(case, dict) or not _identifier(case_id):
        return invalid("invalid_case_id")
    required = case.get("required_pdf_pages")
    if not isinstance(required, list) or not all(_page(p) for p in required):
        return invalid("invalid_required_pdf_pages")
    if len(required) != len(set(required)):
        return invalid("duplicate_required_pdf_pages")
    relationships = case.get("source_relationships_required", False)
    if type(relationships) is not bool:
        return invalid("invalid_source_relationships_required")
    evidence = case.get("required_evidence", [])
    if not isinstance(evidence, list):
        return invalid("invalid_required_evidence")
    for span in evidence:
        if (
            not isinstance(span, dict)
            or not _page(span.get("page"))
            or span["page"] not in required
            or not _identifier(span.get("text"))
        ):
            return invalid("invalid_required_evidence_span")
    hashes = case.get("required_chunk_hashes", [])
    if not isinstance(hashes, list) or any(
        not isinstance(item, dict)
        or not _page(item.get("page"))
        or item["page"] not in required
        or not isinstance(item.get("sha256"), str)
        or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None
        for item in hashes
    ):
        return invalid("invalid_required_chunk_hashes")
    if result is None:
        return _verdict(case_id, "inconclusive", ["missing_result"])
    if not isinstance(result, dict) or result.get("id") != case_id:
        return invalid("invalid_or_mismatched_result_id")
    for observation in (case, result):
        if "corpus_id" in observation and not _identifier(observation["corpus_id"]):
            return invalid("invalid_corpus_id")
    if "corpus_id" in case and "corpus_id" in result and case["corpus_id"] != result["corpus_id"]:
        return invalid("corpus_id_mismatch")
    if result.get("error") or result.get("errors"):
        return invalid("retrieval_error_reported")
    if result.get("status") == "blocked_by_ingest_failure":
        return _verdict(case_id, "inconclusive", ["blocked_by_ingest_failure"])
    if "status" in result and result["status"] not in ("pass", "success", "ok"):
        return _verdict(case_id, "inconclusive", ["retrieval_not_confirmed"])

    failures = []
    unknowns = []
    if "document_isolation" not in result:
        unknowns.append("document_isolation_not_observed")
    elif result["document_isolation"] is not True:
        failures.append("document_isolation_not_true")
    if "foreign_tenant_hits" not in result:
        unknowns.append("foreign_tenant_isolation_not_observed")
    elif type(result["foreign_tenant_hits"]) is not int or result["foreign_tenant_hits"] != 0:
        failures.append("foreign_tenant_hits_not_zero")

    pages = result.get("returned_pages")
    if pages is None:
        unknowns.append("returned_pages_not_observed")
        missing_pages = []
    elif not isinstance(pages, list) or not all(_page(p) for p in pages):
        return invalid("invalid_returned_pages")
    else:
        missing_pages = [p for p in required if p not in pages]
        if missing_pages:
            failures.append("required_pages_missing")

    chunks = result.get("chunks", [])
    if not isinstance(chunks, list) or any(
        not isinstance(c, dict)
        or not _page(c.get("sourcePage"))
        or not isinstance(c.get("content"), str)
        for c in chunks
    ):
        return invalid("invalid_chunks")
    # Chunks may be an optional subset retained for span inspection. Every
    # supplied chunk must nevertheless agree with the reported retrieved pages.
    if "chunks" in result and pages is not None:
        if (pages and not chunks) or any(c["sourcePage"] not in pages for c in chunks):
            failures.append("chunks_contradict_returned_pages")
    missing_evidence = [
        span
        for span in evidence
        if not any(
            c["sourcePage"] == span["page"] and _normalize(span["text"]) in _normalize(c["content"])
            for c in chunks
        )
    ]
    if missing_evidence:
        failures.append("required_evidence_missing")
    observed_hashes = {
        (c["sourcePage"], hashlib.sha256(_normalize(c["content"]).encode("utf-8")).hexdigest())
        for c in chunks
    }
    missing_hashes = [
        item for item in hashes if (item["page"], item["sha256"]) not in observed_hashes
    ]
    if missing_hashes:
        failures.append("required_chunk_hashes_missing")
    if not required:
        unknowns.append("no_retrieval_evidence_targets")
    if relationships and result.get("source_relationships_verified") is not True:
        unknowns.append("source_relationships_not_verified")

    status = "fail" if failures else "inconclusive" if unknowns else "pass"
    verdict = _verdict(case_id, status, failures + unknowns, missing_pages, missing_evidence)
    verdict["missing_chunk_hashes"] = missing_hashes
    return verdict


def evaluate_packet(cases, results):
    """Evaluate complete sets; duplicates or unmatched IDs invalidate a packet."""
    errors = []
    verdicts = []
    for name, envelope in (("cases", cases), ("results", results)):
        if isinstance(envelope, dict):
            if "status" in envelope and envelope["status"] not in (
                "pass",
                "success",
                "ok",
                "completed",
            ):
                errors.append(name + "_envelope_not_successful")
            if envelope.get("error") or envelope.get("errors"):
                errors.append(name + "_envelope_error_reported")
    if isinstance(cases, dict):
        cases = cases.get("cases")
    if isinstance(results, dict):
        results = results.get("cases")
    if not isinstance(cases, list) or not isinstance(results, list):
        errors.append("cases_and_results_must_be_lists")
    elif not cases:
        errors.append("empty_case_packet")
    else:
        case_ids = [c.get("id") if isinstance(c, dict) else None for c in cases]
        result_ids = [r.get("id") if isinstance(r, dict) else None for r in results]
        if not all(_identifier(i) for i in case_ids + result_ids):
            errors.append("invalid_packet_ids")
        else:
            if len(set(case_ids)) != len(case_ids):
                errors.append("duplicate_case_ids")
            if len(set(result_ids)) != len(result_ids):
                errors.append("duplicate_result_ids")
            if set(result_ids) - set(case_ids):
                errors.append("unexpected_result_ids")
            if set(case_ids) - set(result_ids):
                errors.append("missing_result_ids")
            if not errors or errors == ["missing_result_ids"]:
                by_id = {r["id"]: r for r in results}
                verdicts = [evaluate_case(c, by_id.get(c["id"])) for c in cases]
    counts = {status: sum(v["status"] == status for v in verdicts) for status in EXIT_CODES}
    status = (
        "fail" if errors or counts["fail"] else "inconclusive" if counts["inconclusive"] else "pass"
    )
    return {
        "scope": SCOPE,
        "status": status,
        "errors": errors,
        "counts": counts,
        "cases": verdicts,
        "generated_answer_acceptance": "not_evaluated",
        "machine_applicability": "not_evaluated",
        "citation_opening": "not_evaluated",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        cases = json.loads(args.cases.read_text(encoding="utf-8"))
        results = json.loads(args.results.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        print(
            json.dumps(
                {
                    "scope": SCOPE,
                    "status": "fail",
                    "errors": ["input_read_or_json_error"],
                    "error_type": type(error).__name__,
                    "generated_answer_acceptance": "not_evaluated",
                }
            )
        )
        return 1
    verdict = evaluate_packet(cases, results)
    print(json.dumps(verdict, indent=2))
    return EXIT_CODES[verdict["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
