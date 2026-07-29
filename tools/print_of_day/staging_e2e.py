#!/usr/bin/env python3
"""Budget-capped live staging E2E for Print of the Day (ADR-0031 PR 7).

Drives the pinned POTD container through one real Together/MiniMax case and
proves the seven activation requirements, enforcing a HARD USD ceiling on the
metered vision spend. Manual, owner-permissioned; not wired into any scheduled
workflow. Run under staging Doppler:

    doppler run -p factorylm -c stg -- \\
        python tools/print_of_day/staging_e2e.py --image <print.png> \\
        --recipient <you@example.com> --budget-usd 0.50

Proves:
  1. correct deployed container revision (image label == requested SHA)
  2. known-token vision canary passes (readiness --live)
  3. Tesseract available
  4. one real POTD case completes
  5. grading + provenance survive end to end
  6. exactly one gated email is sent
  7. duplicate delivery is prevented (second run blocked, $0)

Spend enforcement: MiniMax-M3 is not in the pricing table, so cost is estimated
conservatively from the recorded token usage at a high assumed rate; if the
estimate meets or exceeds the ceiling the run ABORTS before the (would-be)
duplicate second pass. The interpret call is the only material spend; the two
readiness probes are token-tiny.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# Conservative assumed Together price for the un-tabled MiniMax-M3 (USD per 1M
# tokens). Deliberately high so the ceiling binds early rather than late.
ASSUMED_IN_USD_PER_M = 3.0
ASSUMED_OUT_USD_PER_M = 6.0


def _est_cost(usage: dict) -> float:
    return (usage.get("input_tokens", 0) / 1e6) * ASSUMED_IN_USD_PER_M + (
        usage.get("output_tokens", 0) / 1e6
    ) * ASSUMED_OUT_USD_PER_M


def _image_revision(image: str) -> str | None:
    out = subprocess.run(
        ["docker", "inspect", "--format", "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}", image],
        capture_output=True,
        text=True,
    )
    rev = out.stdout.strip()
    return rev or None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--image-tag", required=True, help="POTD docker image tag (mira-print-of-day:<sha>)")
    p.add_argument("--sha", required=True, help="expected git SHA (must equal the image label)")
    p.add_argument("--print", dest="print_image", required=True, help="print page image on the host")
    p.add_argument("--recipient", required=True)
    p.add_argument("--case", default="potd-staging-e2e")
    p.add_argument("--source-url", default="https://example.com/potd-e2e-print.png")
    p.add_argument("--budget-usd", type=float, default=0.50)
    p.add_argument("--work", default="potd_staging_work")
    args = p.parse_args(argv)

    evidence: dict = {"budget_usd": args.budget_usd, "spend_estimate_usd": 0.0, "calls": []}

    # 1. correct deployed container revision.
    rev = _image_revision(args.image_tag)
    evidence["image_revision"] = rev
    evidence["requested_sha"] = args.sha
    if rev != args.sha:
        evidence["error"] = f"image revision {rev} != requested {args.sha}"
        print(json.dumps(evidence, indent=2))
        return 1

    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    ledger = work / "sent.jsonl"
    if ledger.exists():
        ledger.unlink()  # a clean E2E starts with an empty ledger

    host_print = Path(args.print_image).resolve()

    def _docker_run(extra: list[str]) -> tuple[int, dict]:
        cmd = [
            "docker", "run", "--rm",
            "-e", "TOGETHERAI_API_KEY",
            "-e", "RESEND_API_KEY",
            "-e", "FACTORYLM_NETWORK_MODE=enabled",
            "-e", "PRINT_RECALL_ENV=staging",
            "-e", "PRINT_VISION_MAX_TOKENS=4000",
            "-v", f"{host_print}:/in/print.png:ro",
            "-v", f"{work}:/work",
            args.image_tag,
            "--case", args.case,
            "--image", "/in/print.png",
            "--out", "/work/out",
            "--send-ledger", "/work/sent.jsonl",
            "--recipient", args.recipient,
            "--source-url", args.source_url,
            *extra,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        # The entrypoint prints exactly one pretty-printed JSON object on stdout
        # (stderr carries incidental warnings). Parse the whole thing; fall back
        # to the last JSON object if extra lines ever appear.
        out = proc.stdout.strip()
        payload: dict = {}
        try:
            payload = json.loads(out) if out else {}
        except Exception:  # noqa: BLE001
            start = out.rfind("{")
            try:
                payload = json.loads(out[start:]) if start >= 0 else {}
            except Exception:  # noqa: BLE001
                payload = {"raw_stdout": out[-500:], "raw_stderr": proc.stderr[-500:]}
        return proc.returncode, payload

    # 2-6. Live run: readiness --live (canary + tesseract), one case, one send.
    rc, run1 = _docker_run(["--live", "--send"])
    evidence["run1_exit"] = rc
    evidence["run1"] = run1
    manifest_path = work / "out" / "print_of_day_manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        evidence["manifest"] = {
            "provider": manifest.get("provider"),
            "ocr": manifest.get("ocr"),
            "grader": manifest.get("grader"),
            "judge": manifest.get("judge"),
            "provenance": manifest.get("provenance"),
            "artifact_sha256": manifest.get("artifact_sha256"),
            "gold_eligible": manifest.get("gold_eligible"),
            "fallback_attempts": manifest.get("fallback_attempts"),
        }
        # Spend from the recorded interpreter usage in the extraction/run.
        # The manifest doesn't carry raw tokens; read the entrypoint's report.
    # The entrypoint prints token usage in its report → capture from run1 if present.
    usage = run1.get("usage") or {}
    est = _est_cost(usage) if usage else None
    evidence["interpret_usage"] = usage
    evidence["spend_estimate_usd"] = round(est, 4) if est is not None else None
    evidence["email"] = run1.get("email")

    if rc != 0:
        evidence["error"] = f"live run failed at stage {run1.get('stage')}: {run1.get('error')}"
        print(json.dumps(evidence, indent=2))
        return 1

    if est is not None and est >= args.budget_usd:
        evidence["error"] = f"spend estimate {est:.4f} >= ceiling {args.budget_usd} — aborting before dup pass"
        print(json.dumps(evidence, indent=2))
        return 1

    # 7. duplicate delivery prevented — second --send run must block ($0, no interpret).
    rc2, run2 = _docker_run(["--send"])
    evidence["run2_exit"] = rc2
    evidence["run2_error"] = run2.get("error")
    evidence["duplicate_blocked"] = rc2 != 0 and run2.get("error") == "DUPLICATE_RUN"

    evidence["all_proofs"] = {
        "container_revision_correct": rev == args.sha,
        "vision_canary_passed": rc == 0,  # readiness --live passed → text+vision probes ok
        "tesseract_available": bool(evidence.get("manifest", {}).get("ocr", {}).get("tesseract_version")),
        "case_completed": manifest_path.exists(),
        "provenance_survived": bool(evidence.get("manifest", {}).get("provenance", {}).get("image_revision")),
        "exactly_one_email": bool((run1.get("email") or {}).get("sent")) and evidence["duplicate_blocked"],
        "duplicate_prevented": evidence["duplicate_blocked"],
        "under_budget": est is None or est < args.budget_usd,
    }
    ok = all(evidence["all_proofs"].values())
    evidence["verdict"] = "PASS" if ok else "FAIL"
    print(json.dumps(evidence, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
