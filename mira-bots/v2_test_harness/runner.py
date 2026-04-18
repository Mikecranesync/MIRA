#!/usr/bin/env python3
"""
runner.py — MIRA v2 Autonomous Test Harness entry point.

Usage:
  python3 v2_test_harness/runner.py [--all] [--cases NAME...] [--release]
                                     [--skip-probe] [--skip-generate] [--tag-v1]
"""
import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml

_HERE = Path(__file__).parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_ROOT / "telegram_test_runner"))

from judge_v2 import create_judge           # noqa: E402
from healer import Healer                   # noqa: E402
from generator import generate_cases, write_manifest_v2, is_stale  # noqa: E402
import telegram_probe                        # noqa: E402
import agent                                 # noqa: E402
from report_v2 import write_report_v2, _write_evidence  # noqa: E402

_MIRA_SERVER = os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost")
INGEST_URL = os.getenv("INGEST_URL", f"{_MIRA_SERVER}:8002/ingest/photo")
ARTIFACTS_DIR = str(_ROOT / "artifacts")
MIRA_BOTS_ROOT = _ROOT
MIRA_CORE_ROOT = Path.home() / "Mira" / "mira-core"
CORE_COMPOSE_PATH = str(MIRA_CORE_ROOT / "docker-compose.yml")

MANIFEST_100_PATH = str(_ROOT / "telegram_test_runner" / "test_manifest_100.yaml")
MANIFEST_V2_PATH = str(_ROOT / "v2_test_harness" / "manifest_v2.yaml")
ENGINE_PATH = str(_ROOT / "shared" / "engine.py")
INGEST_MAIN_PATH = str(MIRA_CORE_ROOT / "mira-ingest" / "main.py")


def main():
    parser = argparse.ArgumentParser(description="MIRA v2 Autonomous Test Harness")
    parser.add_argument("--all", action="store_true", help="Run all 120 cases")
    parser.add_argument("--cases", nargs="+", metavar="NAME", help="Run specific case names")
    parser.add_argument("--release", action="store_true", help="Tag and push if ≥95%%")
    parser.add_argument("--skip-probe", action="store_true", help="Skip Telegram probe")
    parser.add_argument("--skip-generate", action="store_true", help="Skip case generation (reuse existing manifest_v2.yaml)")
    parser.add_argument("--tag-v1", action="store_true", help="Tag v1.0 on both repos and exit")
    args = parser.parse_args()

    if args.tag_v1:
        _phase0_tag_v1()
        return

    ingest_results, tele_results, heal_log, decision = asyncio.run(run_all(args))

    # Phase 5 — report + optional release
    write_report_v2(
        ingest_results,
        tele_results,
        heal_log,
        len(heal_log),
        decision,
        ARTIFACTS_DIR,
    )
    print(f"Report: {ARTIFACTS_DIR}/v2/latest_run/report_v2.md")

    if decision.action in ("RELEASE", "RELEASE_INGEST_ONLY"):
        ok_bots = git_tag_and_push(str(MIRA_BOTS_ROOT), decision.version)
        ok_core = git_tag_and_push(str(MIRA_CORE_ROOT), decision.version)
        if ok_bots and ok_core:
            print(f"\nMIRA {decision.version} RELEASED — ingest path field validated")
            if tele_results:
                print("+ Telegram path validated")
        else:
            print("WARNING: tag push failed for one or more repos")


async def run_all(args) -> tuple[list, list | None, list, object]:
    # Phase 0 already done if --tag-v1 used separately

    # Phase 1 — generate manifest
    if not args.skip_generate:
        if is_stale(MANIFEST_V2_PATH):
            new_cases = generate_cases(MANIFEST_100_PATH, ENGINE_PATH, INGEST_MAIN_PATH)
            write_manifest_v2(MANIFEST_100_PATH, new_cases, MANIFEST_V2_PATH)
        else:
            print(f"manifest_v2.yaml is fresh — reusing")
    else:
        print("--skip-generate: reusing existing manifest_v2.yaml")

    cases_all = _load_manifest(MANIFEST_V2_PATH)

    if args.cases:
        cases_all = [c for c in cases_all if c.get("name") in args.cases]

    total = len(cases_all)
    print(f"Manifest ready: {total} cases")

    # Phase 2 — ingest path
    judge = create_judge()
    healer = Healer(judge, INGEST_URL, CORE_COMPOSE_PATH, str(MIRA_CORE_ROOT))
    results = []
    heal_log = []

    with httpx.Client(timeout=60) as client:
        for i, case in enumerate(cases_all, 1):
            img_rel = case.get("image", "")
            # Try root-relative first, then telegram_test_runner-relative
            img_path = _ROOT / img_rel
            if not img_path.exists():
                img_path = _ROOT / "telegram_test_runner" / img_rel
            img_b64 = None
            if img_path.exists():
                img_b64 = base64.b64encode(img_path.read_bytes()).decode()

            request_payload = {
                "asset_tag": case.get("name", "test_asset"),
                "notes": case.get("caption", ""),
                "image": f"<{len(img_b64 or '')} chars b64>" if img_b64 else "<fallback png>",
            }
            reply, elapsed = run_ingest_case(case, client, img_b64)
            result = judge.score(case, reply, elapsed)

            evidence_dir = os.path.join(ARTIFACTS_DIR, "v2", "evidence")
            _write_evidence(case, request_payload, reply, result, evidence_dir)

            if not result.get("passed"):
                heal_result = await healer.attempt_heal(
                    case, result, reply or "",
                    lambda c: run_ingest_case(c, client, img_b64),
                )
                result = heal_result.final_result
                if heal_result.heal_type:
                    heal_log.append({
                        "case": case.get("name"),
                        "heal_type": heal_result.heal_type,
                        "attempts": heal_result.attempts,
                        "original_bucket": heal_result.original_bucket,
                    })

            results.append(result)
            print_progress(i, total, result)

    ingest_rate = sum(1 for r in results if r.get("passed")) / len(results) if results else 0
    print(f"\nIngest path: {ingest_rate:.1%} ({sum(1 for r in results if r.get('passed'))}/{len(results)})")

    # Phase 3 — Telegram probe
    tele_results = None
    if not args.skip_probe:
        probe_cases_10 = telegram_probe._select_probe_cases(cases_all)
        probe_result = await telegram_probe.probe_cases(probe_cases_10, ARTIFACTS_DIR)
        if probe_result.skipped:
            print(f"Telegram probe: skipped ({probe_result.skip_reason})")
        else:
            tele_results = probe_result.results
            print(f"Telegram probe: {probe_result.path_used} — {len(tele_results)} cases")
    else:
        print("Telegram probe: skipped (--skip-probe)")

    # Phase 4 — decision
    changed_files = _get_changed_files_since_v1()
    decision = agent.make_decision(
        results,
        tele_results,
        len(heal_log),
        changed_files,
        args.release,
    )
    print(f"\nDecision: {decision.action} — {decision.message}")

    return results, tele_results, heal_log, decision


def run_ingest_case(
    case: dict,
    client: httpx.Client,
    img_b64: str | None = None,
) -> tuple[str | None, float]:
    """POST to ingest endpoint (multipart/form-data), return (reply_text, elapsed_seconds)."""
    import io
    asset_tag = case.get("name", "test_asset")
    notes = case.get("caption", "")
    t0 = time.time()
    try:
        if img_b64:
            img_bytes = base64.b64decode(img_b64)
        else:
            # 1×1 white PNG fallback
            img_bytes = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
                "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            )
        files = {"image": ("photo.jpg", io.BytesIO(img_bytes), "image/jpeg")}
        data = {"asset_tag": asset_tag, "notes": notes}
        resp = client.post(INGEST_URL, files=files, data=data, timeout=60)
        elapsed = time.time() - t0
        if resp.status_code == 200:
            rdata = resp.json()
            reply = rdata.get("description") or rdata.get("reply") or rdata.get("text") or str(rdata)
            return reply, elapsed
        return None, elapsed
    except Exception:
        return None, time.time() - t0


def print_progress(i: int, total: int, result: dict, window_size: int = 10):
    icon = "✅" if result.get("passed") else "❌"
    bucket = result.get("failure_bucket") or ""
    bucket_str = f" [{bucket}]" if bucket else ""
    print(f"  [{i:3d}/{total}] {icon} {result.get('case','?')}{bucket_str}")


def git_tag_and_push(repo_path: str, tag: str) -> bool:
    # Check if tag already exists
    check = subprocess.run(
        ["git", "-C", repo_path, "tag", "-l", tag],
        capture_output=True, text=True,
    )
    if check.stdout.strip() == tag:
        print(f"  Tag {tag} already exists in {repo_path}")
        return True
    r1 = subprocess.run(["git", "-C", repo_path, "tag", tag], capture_output=True)
    if r1.returncode != 0:
        print(f"  ERROR: git tag {tag} failed in {repo_path}")
        return False
    r2 = subprocess.run(["git", "-C", repo_path, "push", "origin", tag], capture_output=True)
    if r2.returncode != 0:
        print(f"  ERROR: git push {tag} failed in {repo_path}")
        return False
    print(f"  Tagged and pushed {tag} in {repo_path}")
    return True


def _phase0_tag_v1():
    for repo in [str(MIRA_BOTS_ROOT), str(MIRA_CORE_ROOT)]:
        ok = git_tag_and_push(repo, "v1.0")
        if not ok:
            print(f"WARNING: v1.0 tag issue in {repo}")
    print("V1 COMMITTED AND TAGGED. Starting v2 build.")


def _load_manifest(path: str) -> list[dict]:
    data = yaml.safe_load(Path(path).read_text())
    return data.get("cases", [])


def _get_changed_files_since_v1() -> list[str]:
    files = []
    for repo in [str(MIRA_BOTS_ROOT), str(MIRA_CORE_ROOT)]:
        result = subprocess.run(
            ["git", "-C", repo, "diff", "--name-only", "v1.0", "HEAD"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            files.extend(result.stdout.strip().splitlines())
    return files


if __name__ == "__main__":
    main()
