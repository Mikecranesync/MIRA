"""
MIRA Telegram Vision Test Runner
CLI entry point using Telethon to send photos and collect bot replies.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

import yaml

# Resolve paths relative to this file
HERE = Path(__file__).parent
MANIFEST_PATH = HERE / "test_manifest.yaml"
ARTIFACTS_DIR = HERE.parent / "artifacts"


def load_manifest(path: Path | None = None) -> list[dict]:
    target = path if path is not None else MANIFEST_PATH
    with open(target) as f:
        data = yaml.safe_load(f)
    return data["cases"]


def print_summary_table(results: list[dict]) -> None:
    header = f"{'Case':<30} {'Result':<10} {'Score':<10} {'Confidence':<12} {'Bucket'}"
    print("\n" + header)
    print("-" * 80)
    for r in results:
        result_str = "PASS ✅" if r["passed"] else "FAIL ❌"
        bucket = r["failure_bucket"] or ""
        score_str = f"{r['score']}/{r['max_score']}"
        print(
            f"{r['case']:<30} {result_str:<10} {score_str:<10} {r['confidence']:<12.2f} {bucket}"
        )
    print()


async def collect_reply(client, bot_entity, image_path: str, caption: str, timeout: int) -> str | None:
    """Send photo and poll for bot reply using silence-detection."""
    sent = await client.send_file(bot_entity, image_path, caption=caption)
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


async def run_cases(cases: list[dict], dry_run: bool, timeout: int) -> list[dict]:
    from judge import score as judge_score
    from report import write_report

    bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", "@MIRABot")
    results = []

    # Check for Telethon session — if missing and not dry-run, suggest ingest fallback
    session_env = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "/session/test_account.session")
    if not dry_run and not os.path.exists(session_env):
        print("[INGEST FALLBACK] No Telethon session detected. Run: python3 run_ingest_fallback.py")
        sys.exit(1)

    if dry_run:
        print("[DRY RUN] Skipping Telethon — scoring all cases as TRANSPORT_FAILURE\n")
        for case in cases:
            print(f"  [DRY RUN] Would send: {case['image']} caption='{case.get('caption', '')}'")
            result = judge_score(case, None)
            result["reply_text"] = ""
            results.append(result)
        print()
        print_summary_table(results)
        write_report(results, bot_username, dry_run=True, artifacts_dir=str(ARTIFACTS_DIR))
        return results

    # --- Real Telethon run ---
    try:
        from telethon import TelegramClient
    except ImportError:
        print("ERROR: telethon not installed inside container. Check requirements.txt")
        sys.exit(1)

    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    session_env = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "/session/test_account.session")

    # Strip .session suffix for TelegramClient
    session_path = session_env[: -len(".session")] if session_env.endswith(".session") else session_env

    if not os.path.exists(session_env):
        print(f"ERROR: Telethon session not found at {session_env}")
        print("Run session setup first:")
        print("  docker compose run -it --entrypoint python telegram-test-runner session_setup.py")
        sys.exit(1)

    async with TelegramClient(session_path, api_id, api_hash) as client:
        await client.start()
        bot_entity = await client.get_entity(bot_username)

        for case in cases:
            image_path = str(HERE / case["image"])
            caption = case.get("caption", "")
            print(f"Sending {case['name']} → {bot_username} ...")
            try:
                reply_text = await collect_reply(client, bot_entity, image_path, caption, timeout)
            except Exception as exc:
                print(f"  ERROR collecting reply: {exc}")
                reply_text = None

            result = judge_score(case, reply_text)
            result["reply_text"] = reply_text or ""
            results.append(result)
            status = "PASS ✅" if result["passed"] else f"FAIL ❌ [{result['failure_bucket']}]"
            print(f"  {status}  confidence={result['confidence']:.2f}\n")

    print_summary_table(results)
    write_report(results, bot_username, dry_run=False, artifacts_dir=str(ARTIFACTS_DIR))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA Telegram Vision Test Runner")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--case", metavar="CASE_NAME", help="Run one named case")
    group.add_argument("--all", action="store_true", help="Run all cases")
    group.add_argument("--cases", nargs="+", metavar="CASE_NAME",
                       help="Run specific named cases (space-separated)")
    parser.add_argument("--manifest", default=None,
                        help="Path to manifest YAML, relative to /app (default: test_manifest.yaml)")
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
            print(f"ERROR: case '{args.case}' not found in manifest")
            sys.exit(1)
    elif args.cases:
        not_found = [n for n in args.cases if not any(c["name"] == n for c in all_cases)]
        if not_found:
            print(f"ERROR: cases not in manifest: {not_found}")
            sys.exit(1)
        cases = [c for c in all_cases if c["name"] in args.cases]
    else:
        cases = all_cases

    results = asyncio.run(run_cases(cases, dry_run=args.dry_run, timeout=args.timeout))

    any_failed = any(not r["passed"] for r in results)
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
