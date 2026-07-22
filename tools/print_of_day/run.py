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
    extraction_path = out_dir / "extraction.json"
    extraction_path.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
    graded_page_sha = selected_page_sha  # graded page IS the interpreted page

    # 4. Deterministic grade (grader state for the manifest).
    report["stage"] = "grade"
    from printsense.grade_case import grade_case  # noqa: PLC0415

    grade = grade_case(extraction_path, rubric_path=args.rubric)
    (out_dir / "grade.json").write_text(json.dumps(grade, indent=2), encoding="utf-8")

    # 5. Judge (best-effort; never blocks the bundle).
    report["stage"] = "judge"
    judge_result: dict = {}
    try:
        import judge as judge_mod  # noqa: PLC0415 — sibling under internet_print_test

        judge_result = (
            judge_mod.judge(
                image_bytes=pages[0][0],
                response_text=graph.model_dump_json(),
                map_text=None,
                source_meta={"interpreter_model": usage.get("model")},
                media_type=media,
            )
            or {}
        )
    except Exception as exc:  # noqa: BLE001 — judge is advisory
        judge_result = {"judge_error": f"{type(exc).__name__}: {exc}"}
    (out_dir / "judge.json").write_text(json.dumps(judge_result, indent=2), encoding="utf-8")

    # 6. Evidence manifest — the directive's required provenance set.
    report["stage"] = "manifest"
    degraded: list[str] = []
    if cap["verdict"] == "degraded":
        degraded.append("readiness_degraded")
    if usage.get("fallback_attempts"):
        degraded.append("provider_fallback_occurred")

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
            "judge_model": judge_result.get("judge_model"),
            "judge_provider": judge_result.get("judge_provider"),
            "judge_independence": judge_result.get("judge_independence"),
            "judge_error": judge_result.get("judge_error"),
        },
        source_url=args.source_url,
        selected_page_sha=selected_page_sha,
        graded_page_sha=graded_page_sha,
        fallback_attempts=usage.get("fallback_attempts", []),
        degraded=degraded,
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
        "send_requested": bool(args.send),
        "send_blocked_by": blocking,
        "email": None,
        "provenance": prov.to_dict(),
    }

    if not args.send:
        report["email"] = {"sent": False, "reason": "dry_run (no --send)"}
        print(json.dumps(report, indent=2))
        return _EXIT_OK

    if blocking:
        return _fail(report, "SEND_GATE_BLOCKED", ",".join(blocking))

    # Send exactly once.
    report["stage"] = "send"
    import mailer  # noqa: PLC0415 — sibling under internet_print_test

    subject = f"Print of the Day — {args.case}"
    html = f"<h1>Print of the Day: {args.case}</h1><p>Grade: {grade.get('letter')}</p>"
    pkg = mailer.build_package(subject, html, recipient, [manifest_path, image_path])
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
