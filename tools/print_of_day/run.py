#!/usr/bin/env python3
"""Print of the Day — the one-command controlled entrypoint (ADR-0031 PR 6).

The CLF POTD surface's "first useful release" (surface spec §4): ONE command
that produces the full inspectable review bundle — provenance-stamped manifest,
blind PrintSense response, deterministic grade, judge verdict, and email
package — BEFORE any send path is enabled. Send is opt-in and gated.

    python -m tools.print_of_day.run --case <id> --image <path> [--live] \
        [--send] [--out DIR]

Order of operations (fail closed at every gate — QR-1):

    provenance gate  (git SHA / dirty / image-revision match)
    -> readiness gate (Together+MiniMax-M3 + Tesseract + pytesseract, no fallback)
    -> blind interpret (printsense.interpret, strict provider policy)
    -> deterministic grade (printsense.grade_case)
    -> judge (tools/internet_print_test/judge)   [best-effort]
    -> build manifest (provider/model, image rev, git SHA, OCR, grader, hashes)
    -> pre-send gate (§19.3) + duplicate-send protection
    -> send exactly once  (only with --send AND all gates clear)

Exit codes: 0 ok · 1 a required capability/gate blocked · 2 invalid config.

Nothing here activates production. Send requires --send AND a configured
mailer; without --send it is a dry run that writes the full bundle to --out.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Repo root + the two sibling tool dirs (judge/mailer live under
# tools/internet_print_test/ and import each other by bare name).
_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "tools" / "internet_print_test"))

from factorylm_ai.capability_codes import (  # noqa: E402
    INVALID_CONFIGURATION,
    CapabilityError,
)
from printsense.print_of_day.case import (  # noqa: E402
    CaseEvidence,
    build_manifest,
    write_manifest,
)
from printsense.print_of_day.provenance import (  # noqa: E402
    Provenance,
    collect_provenance,
    sha256_file,
)
from printsense.print_of_day.readiness_gate import enforce_potd_readiness  # noqa: E402
from printsense.print_of_day.send_gate import SendContext, SendLedger, check_send_gate  # noqa: E402

_EXIT_OK = 0
_EXIT_BLOCKED = 1
_EXIT_INVALID = 2


def _fail(out: dict, code: str, detail: str, *, exit_code: int = _EXIT_BLOCKED) -> int:
    out["error"] = code
    out["detail"] = detail
    print(json.dumps(out, indent=2))
    return exit_code


def run(args: argparse.Namespace) -> int:
    report: dict = {"case_id": args.case, "stage": "start"}
    out_dir = Path(args.out or f"potd_out/{args.case}")
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Provenance gate (reproducibility, fail closed).
    report["stage"] = "provenance"
    try:
        prov: Provenance = collect_provenance()
    except CapabilityError as exc:
        return _fail(report, exc.code, exc.detail)

    # 2. Readiness gate (Together+MiniMax-M3 + Tesseract, fail closed, no fallback).
    report["stage"] = "readiness"
    try:
        cap = enforce_potd_readiness(live=args.live, environment=args.environment)
    except CapabilityError as exc:
        report["provenance"] = prov.to_dict()
        return _fail(report, exc.code, exc.detail)

    image_path = Path(args.image)
    if not image_path.exists():
        return _fail(
            report, INVALID_CONFIGURATION, f"image not found: {image_path}", exit_code=_EXIT_INVALID
        )
    selected_page_sha = sha256_file(image_path)

    # Early duplicate-send guard: a --send run for a case already in the ledger
    # is blocked BEFORE the paid interpret call — never pay to re-interpret a
    # case whose email already went out (duplicate-send protection at $0).
    run_id = args.run_id or f"{args.case}:{selected_page_sha[:12]}"
    ledger = SendLedger(args.send_ledger)
    if args.send and ledger.already_sent(run_id=run_id, case_id=args.case):
        report["provenance"] = prov.to_dict()
        report["run_id"] = run_id
        return _fail(
            report, "DUPLICATE_RUN", f"case {args.case!r} already emailed — refusing re-send"
        )

    # 3. Blind interpret — STRICT policy, no silent fallback (PR 3).
    report["stage"] = "interpret"
    os.environ.setdefault("PRINT_PROVIDER_POLICY", "strict")
    from printsense import interpret  # noqa: PLC0415

    media = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
    pages = [(image_path.read_bytes(), media)]
    try:
        graph = interpret.interpret_print(pages, question=args.question or "")
    except (interpret.PrintVisionUnavailable, CapabilityError) as exc:
        report["provenance"] = prov.to_dict()
        code = getattr(exc, "code", "INTERPRET_FAILED") or "INTERPRET_FAILED"
        return _fail(report, code, str(exc))
    usage = interpret.pop_last_usage() or {}
    recovery = interpret.pop_last_recovery() or {}
    extraction_path = out_dir / "extraction.json"
    extraction_path.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
    graded_page_sha = selected_page_sha  # graded page IS the interpreted page

    # 4. Deterministic grade (grader state for the manifest).
    report["stage"] = "grade"
    from printsense.grade_case import grade_case  # noqa: PLC0415

    grade = grade_case(extraction_path, rubric_path=args.rubric)
    (out_dir / "grade.json").write_text(json.dumps(grade, indent=2), encoding="utf-8")

    # 5. Independent judge — identity-honest, gold-gating (never self-judges).
    report["stage"] = "judge"
    from printsense.print_of_day import judge_runtime  # noqa: PLC0415

    interp_provider = cap["provider"].get("resolved")
    interp_model = usage.get("model") or cap["provider"].get("model")
    try:
        judge_result = judge_runtime.run_judge(
            image_bytes=pages[0][0],
            response_text=graph.model_dump_json(),
            source_meta={"interpreter_model": interp_model, "source_url": args.source_url},
            interpreter_provider=interp_provider,
            interpreter_model=interp_model,
            graph=None,
            media_type=media,
        )
    except Exception as exc:  # noqa: BLE001 — judge must never break the bundle
        judge_result = {
            "judge_error": f"{type(exc).__name__}: {exc}",
            "validation_status": "error",
            "gold_blocked": True,
            "provisional": True,
        }
    (out_dir / "judge.json").write_text(json.dumps(judge_result, indent=2), encoding="utf-8")

    # 6. Evidence manifest — the directive's required provenance set.
    report["stage"] = "manifest"
    degraded: list[str] = []
    if cap["verdict"] == "degraded":
        degraded.append("readiness_degraded")
    if usage.get("fallback_attempts"):
        degraded.append("provider_fallback_occurred")
    # A JSON-repaired response is visible as degraded and blocked from automatic
    # gold promotion (dense-sheet robustness, POTD directive) — never silent.
    if recovery.get("repair_attempted"):
        degraded.append("json_repaired")
    if recovery.get("truncated"):
        degraded.append("output_truncated")
    # A non-independent / unavailable judge is a NON-silent degradation that
    # blocks gold — never a quiet downgrade (POTD judge-independence directive).
    if judge_result.get("gold_blocked"):
        indep = judge_result.get("independence")
        degraded.append(
            {
                "unavailable": "judge_unavailable",
                "same_model": "judge_self_review",
                "unknown_identity": "judge_identity_unverified",
            }.get(indep, "judge_verdict_unusable")
        )

    evidence = CaseEvidence(
        case_id=args.case,
        run_id=run_id,
        generated_at=datetime.now(timezone.utc).isoformat(),
        environment=cap["environment"],
        provenance=prov,
        provider={
            "requested": cap["provider"]["requested"],
            "resolved": cap["provider"]["resolved"],
            "model": cap["provider"]["model"],
            "endpoint_class": usage.get("endpoint_class"),
            "responded_model": usage.get("model"),
        },
        ocr={
            "required": cap["ocr"]["required"],
            "available": cap["ocr"]["available"],
            "tesseract_version": cap["ocr"]["tesseract_version"],
            "pytesseract_version": cap["ocr"]["pytesseract_version"],
        },
        grader={
            "score": grade.get("score"),
            "letter": grade.get("letter"),
            "import_verdict": grade.get("import_verdict"),
            "hard_failures": grade.get("hard_failures", []),
            "safety_critical_misreads": grade.get("safety_critical_misreads", []),
        },
        judge={
            # Full identity + independence + integrity evidence (POTD directive):
            "requested_provider": judge_result.get("requested_provider"),
            "requested_model": judge_result.get("requested_model"),
            "policy": judge_result.get("policy"),
            "judge_provider": judge_result.get("judge_provider"),
            "judge_model": judge_result.get("judge_model"),
            "judge_usage": judge_result.get("judge_usage"),
            "independence": judge_result.get("independence"),
            "independence_class": judge_result.get("independence_class"),
            "self_review": judge_result.get("self_review"),
            "identity_verified": judge_result.get("identity_verified"),
            "prompt_sha256": judge_result.get("prompt_sha256"),
            "raw_sha256": judge_result.get("raw_sha256"),
            "validation_status": judge_result.get("validation_status"),
            "provisional": judge_result.get("provisional", True),
            "judge_error": judge_result.get("judge_error"),
            "gold_blocked": judge_result.get("gold_blocked"),
            "gold_block_reasons": judge_result.get("gold_block_reasons", []),
        },
        source_url=args.source_url,
        selected_page_sha=selected_page_sha,
        graded_page_sha=graded_page_sha,
        fallback_attempts=usage.get("fallback_attempts", []),
        degraded=degraded,
        recovery=recovery or None,
        valid_output=True,  # interpret_print raised otherwise
        graded=bool(args.rubric),  # a ground-truth rubric makes the run graded
    )
    manifest = build_manifest(
        evidence, [extraction_path, out_dir / "grade.json", out_dir / "judge.json", image_path]
    )
    manifest_path = write_manifest(out_dir, manifest)

    # 7. Send gate + duplicate protection. Send only with --send AND all clear.
    report["stage"] = "send_gate"
    recipient = args.recipient or os.getenv("MORNING_REPORT_EMAIL")
    ctx = SendContext(
        case_id=args.case,
        recipient=recipient,
        source_url=args.source_url,
        rights_complete=bool(args.source_url),  # minimal rights proxy for PR 6
        blind_response_present=True,
        script_ok=True,  # script generation is a later surface PR; not blocking here
        selected_page_sha=selected_page_sha,
        graded_page_sha=graded_page_sha,
        primary_attachments=[str(manifest_path)],
    )
    prior = ledger.already_sent(run_id=evidence.run_id, case_id=args.case)
    blocking = check_send_gate(ctx, prior_email_exists=prior)

    report = {
        "stage": "complete",
        "case_id": args.case,
        "run_id": evidence.run_id,
        "manifest": str(manifest_path),
        "gold_eligible": manifest["gold_eligible"],
        "eligibility": manifest["eligibility"],
        "recovery": manifest.get("recovery"),
        "judge": manifest.get("judge"),
        "degraded": manifest.get("degraded", []),
        "send_requested": bool(args.send),
        "send_blocked_by": blocking,
        "email": None,
        "provenance": prov.to_dict(),
        # Metered-spend evidence: the interpret call's token usage (the only
        # material cost; readiness probes are token-tiny). Keys always present.
        "usage": {
            "provider": usage.get("provider"),
            "model": usage.get("model"),
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "endpoint_class": usage.get("endpoint_class"),
        },
    }

    if not args.send:
        report["email"] = {"sent": False, "reason": "dry_run (no --send)"}
        print(json.dumps(report, indent=2))
        return _EXIT_OK

    if blocking:
        return _fail(report, "SEND_GATE_BLOCKED", ",".join(blocking))

    # Build the ONE view model + render the canonical report and the mobile-first
    # verdict-first email (v2) from it (email-review PRD §13.3/§19).
    report["stage"] = "render"
    from printsense.print_of_day import email_render, report_render, view_model  # noqa: PLC0415

    blind_summary = " ".join(
        e.detail or e.tag for e in graph.all_entities() if e.tag and e.tag != "UNREADABLE"
    )[:600]
    # Report is rendered first so the email can reference its version + hash.
    tmp_vm = view_model.build_view_model(
        manifest, recipient=recipient, title=args.title or args.case, blind_summary=blind_summary
    )
    md = report_render.render_markdown(tmp_vm, manifest, corrected_interpretation="")
    report_sha = report_render.report_version_hash(md)
    (out_dir / "report.md").write_text(md, encoding="utf-8")
    (out_dir / "report.html").write_text(report_render.render_html(tmp_vm, md), encoding="utf-8")
    vm = view_model.build_view_model(
        manifest,
        recipient=recipient,
        title=args.title or args.case,
        blind_summary=blind_summary,
        report_sha256=report_sha,
        report_url=args.report_url or "",
    )

    # Send exactly once.
    report["stage"] = "send"
    import mailer  # noqa: PLC0415 — sibling under internet_print_test

    # FR-15: verify the print attachment exists, is non-empty, matches the hash.
    att_problems = mailer.verify_attachments(
        [image_path], {image_path.name: manifest["artifact_sha256"].get("print.png", "")}
    )
    if att_problems:
        return _fail(report, "MAILER_NOT_READY", f"attachment verification: {att_problems}")

    subject = email_render.subject(vm)
    html = email_render.render_html(vm, image_cid="print")
    text = email_render.render_text(vm)
    pkg = mailer.build_package(subject, html, recipient, [manifest_path, out_dir / "report.md"])
    pkg.text = text
    pkg.inline_images = [{"cid": "print", "path": str(image_path)}]
    report["dedup_key"] = vm.dedup_key
    send_result = mailer.send(pkg)
    if not send_result.get("sent"):
        return _fail(report, "MAILER_NOT_READY", str(send_result.get("error")))
    ledger.record_sent(
        run_id=evidence.run_id,
        case_id=args.case,
        email_id=send_result.get("id"),
        sha=manifest["artifact_sha256"].get("print_of_day_manifest.json", ""),
    )
    report["email"] = {
        "sent": True,
        "id": send_result.get("id"),
        "status": send_result.get("status"),
    }
    print(json.dumps(report, indent=2))
    return _EXIT_OK


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="tools.print_of_day.run")
    p.add_argument("--case", required=True, help="case id (stable per print)")
    p.add_argument("--image", required=True, help="path to the print page image (PNG/JPEG)")
    p.add_argument("--run-id", default=None)
    p.add_argument("--question", default=None)
    p.add_argument("--rubric", default=None)
    p.add_argument("--source-url", default=None)
    p.add_argument("--title", default=None, help="human print title for the email subject")
    p.add_argument("--report-url", default=None, help="authenticated full-report URL (Phase 2)")
    p.add_argument("--recipient", default=None)
    p.add_argument("--environment", default=None)
    p.add_argument("--out", default=None)
    p.add_argument("--send-ledger", default=None)
    p.add_argument("--live", action="store_true", help="run the live vision readiness probe")
    p.add_argument("--send", action="store_true", help="actually send the email (gated)")
    args = p.parse_args(argv)
    try:
        return run(args)
    except CapabilityError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}, indent=2))
        return _EXIT_INVALID if exc.code == INVALID_CONFIGURATION else _EXIT_BLOCKED


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
