"""
MIRA Async Telegram Test Runner
- Uses shared session from session.py (no new login per run)
- Sends results summary to operator's Telegram after every run
- Exposes results at http://localhost:8021/results
"""
import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

import yaml

HERE = Path(__file__).parent
MANIFEST_PATH = HERE / "test_manifest.yaml"
ARTIFACTS_DIR = HERE.parent / "artifacts"
LATEST_RUN_DIR = ARTIFACTS_DIR / "latest_run"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def load_manifest(path: Path | None = None) -> list[dict]:
    target = path if path is not None else MANIFEST_PATH
    with open(target) as f:
        data = yaml.safe_load(f)
    return data["cases"]


# ---------------------------------------------------------------------------
# Prompt metadata
# ---------------------------------------------------------------------------

def load_prompt_meta() -> dict:
    prompt_path = HERE.parent / "prompts" / "diagnose" / "active.yaml"
    try:
        with open(prompt_path) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        log.warning("active.yaml not found at %s — using defaults", prompt_path)
        return {}


# ---------------------------------------------------------------------------
# Reply collection
# ---------------------------------------------------------------------------

async def collect_reply(client, bot_entity, image_path: str | None, caption: str, timeout: int) -> str | None:
    """Send message (with optional image) and poll for bot reply using silence-detection."""
    if image_path:
        sent = await client.send_file(bot_entity, image_path, caption=caption)
    else:
        sent = await client.send_message(bot_entity, caption)

    collected = []
    last_id = sent.id
    silence_ticks = 0
    elapsed = 0

    while elapsed < timeout:
        await asyncio.sleep(2)
        elapsed += 2
        new = []
        async for msg in client.iter_messages(bot_entity, limit=20, min_id=last_id):
            if not msg.out and msg.text:
                new.append(msg)
        new.sort(key=lambda m: m.id)
        if new:
            collected.extend(new)
            last_id = new[-1].id
            silence_ticks = 0
        else:
            silence_ticks += 1
            if collected and silence_ticks >= 30:
                break

    if not collected:
        return None
    substantive = [m for m in collected if len(m.text) > 50]
    return substantive[-1].text if substantive else collected[-1].text


# ---------------------------------------------------------------------------
# Results persistence
# ---------------------------------------------------------------------------

def save_results(results: list[dict], run_id: str) -> None:
    LATEST_RUN_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"run_id": run_id, "cases": results}
    with open(LATEST_RUN_DIR / "results.json", "w") as f:
        json.dump(payload, f, indent=2)


# ---------------------------------------------------------------------------
# Telegram summary notification
# ---------------------------------------------------------------------------

async def send_summary(client, results: list[dict], prompt_meta: dict, elapsed: float, run_id: str) -> None:
    chat_id_raw = os.environ.get("TELEGRAM_TEST_RESULTS_CHAT_ID", "")
    if not chat_id_raw:
        log.warning("TELEGRAM_TEST_RESULTS_CHAT_ID not set — skipping results notification")
        return

    try:
        chat_id = int(chat_id_raw)
    except ValueError:
        log.warning("TELEGRAM_TEST_RESULTS_CHAT_ID is not a valid integer — skipping")
        return

    passed = sum(1 for r in results if r.get("passed"))
    total = len(results)
    failed_ids = [r["case"] for r in results if not r.get("passed")]
    failed_str = ", ".join(failed_ids) if failed_ids else "none"

    codename = prompt_meta.get("codename", "unknown")
    model = prompt_meta.get("model", "unknown")

    msg = (
        f"✅ Test run complete\n"
        f"Score: {passed}/{total} passed\n"
        f"Prompt: {codename}\n"
        f"Model: {model}\n"
        f"Time: {elapsed:.1f}s\n"
        f"Run ID: {run_id}\n\n"
        f"Failed cases: {failed_str}"
    )

    try:
        await client.send_message(chat_id, msg)
        log.info("Results summary sent to Telegram chat %s", chat_id)
    except Exception as exc:
        log.warning("Failed to send Telegram summary: %s", exc)


# ---------------------------------------------------------------------------
# Summary table (console)
# ---------------------------------------------------------------------------

def print_summary_table(results: list[dict]) -> None:
    header = f"{'Case':<30} {'Result':<10} {'Score':<10} {'Confidence':<12} {'Bucket'}"
    print("\n" + header)
    print("-" * 80)
    for r in results:
        result_str = "PASS ✅" if r["passed"] else "FAIL ❌"
        bucket = r.get("failure_bucket") or ""
        score_str = f"{r['score']}/{r['max_score']}"
        print(
            f"{r['case']:<30} {result_str:<10} {score_str:<10} {r['confidence']:<12.2f} {bucket}"
        )
    print()


# ---------------------------------------------------------------------------
# Core runner
# ---------------------------------------------------------------------------

async def run_cases(cases: list[dict], dry_run: bool, timeout: int) -> list[dict]:
    from judge import score as judge_score
    from report import write_report

    bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", "@MIRABot")
    prompt_meta = load_prompt_meta()
    run_id = f"run-{int(time.time())}"
    t_start = time.monotonic()
    results = []

    if dry_run:
        log.info("[DRY RUN] Skipping Telethon — scoring all cases as TRANSPORT_FAILURE")
        for case in cases:
            log.info("  [DRY RUN] Would send: %s caption='%s'", case.get("image", ""), case.get("caption", ""))
            result = judge_score(case, None)
            result["reply_text"] = ""
            results.append(result)
        print_summary_table(results)
        save_results(results, run_id)
        write_report(results, bot_username, dry_run=True, artifacts_dir=str(ARTIFACTS_DIR))
        return results

    # --- Live Telethon run ---
    session_path = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "/session/test_account.session")
    if not os.path.exists(session_path):
        log.error("Telethon session not found at %s — run session_setup.py first", session_path)
        sys.exit(1)

    from session import get_client

    client = await get_client()
    bot_entity = await client.get_entity(bot_username)

    for case in cases:
        image_path = str(HERE / case["image"]) if case.get("image") else None
        caption = case.get("caption", "")
        log.info("Sending %s → %s ...", case["name"], bot_username)
        try:
            reply_text = await collect_reply(client, bot_entity, image_path, caption, timeout)
        except Exception as exc:
            log.error("  ERROR collecting reply: %s", exc)
            reply_text = None

        result = judge_score(case, reply_text)
        result["reply_text"] = reply_text or ""
        results.append(result)
        status = "PASS ✅" if result["passed"] else f"FAIL ❌ [{result.get('failure_bucket')}]"
        log.info("  %s  confidence=%.2f", status, result["confidence"])

    elapsed = time.monotonic() - t_start
    print_summary_table(results)
    save_results(results, run_id)
    write_report(results, bot_username, dry_run=False, artifacts_dir=str(ARTIFACTS_DIR))
    await send_summary(client, results, prompt_meta, elapsed, run_id)
    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    from results_server import start as start_results_server

    # Start HTTP results server in daemon thread
    threading.Thread(target=lambda: start_results_server(port=8021), daemon=True).start()
    log.info("Results server started at http://0.0.0.0:8021/results")

    parser = argparse.ArgumentParser(description="MIRA Async Telegram Test Runner")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--case", metavar="CASE_NAME", help="Run one named case")
    group.add_argument("--all", action="store_true", help="Run all cases")
    group.add_argument("--cases", nargs="+", metavar="CASE_NAME",
                       help="Run specific named cases (space-separated)")
    parser.add_argument("--manifest", default=None,
                        help="Path to manifest YAML (default: test_manifest.yaml)")
    parser.add_argument("--dry-run", action="store_true", help="Skip Telethon, test scoring only")
    parser.add_argument("--timeout", type=int, default=60, help="Seconds to wait for reply")
    args = parser.parse_args()

    if not args.case and not args.all and not args.cases and not args.dry_run:
        parser.print_help()
        sys.exit(0)

    manifest_path = (HERE / args.manifest) if args.manifest else None
    all_cases = load_manifest(manifest_path)

    if args.case:
        cases = [c for c in all_cases if c["name"] == args.case]
        if not cases:
            log.error("Case '%s' not found in manifest", args.case)
            sys.exit(1)
    elif args.cases:
        not_found = [n for n in args.cases if not any(c["name"] == n for c in all_cases)]
        if not_found:
            log.error("Cases not in manifest: %s", not_found)
            sys.exit(1)
        cases = [c for c in all_cases if c["name"] in args.cases]
    else:
        cases = all_cases

    results = asyncio.run(run_cases(cases, dry_run=args.dry_run, timeout=args.timeout))

    any_failed = any(not r["passed"] for r in results)
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
