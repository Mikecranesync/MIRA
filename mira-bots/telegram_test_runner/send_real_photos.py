"""
send_real_photos.py — Send real factory photos to MIRA bot and collect replies.
No scoring/pass-fail. Pure exploratory output.

Usage (inside container):
    python send_real_photos.py [--photos-dir /photos] [--timeout 120]

Correct host invocation (Doppler — no key mapping needed):
    cd ~/Mira/mira-bots && \\
    doppler run --project factorylm --config prd -- \\
      sh -c 'export TELEGRAM_BOT_USERNAME="@FactoryLMDiagnose_bot" && \\
      docker compose --profile test run --rm \\
        -v "/path/to/photos:/photos:ro" \\
        -v "mira-bots_telegram_test_session:/session:rw" \\
        -e TELEGRAM_TEST_API_ID \\
        -e TELEGRAM_TEST_API_HASH \\
        -e TELEGRAM_TEST_PHONE \\
        -e TELEGRAM_BOT_USERNAME \\
        --entrypoint python \\
        telegram-test-runner send_real_photos.py \\
        --photos-dir /photos --timeout 120'

Credential note: Doppler project factorylm/prd has TELEGRAM_TEST_API_ID directly
(with underscore between TEST and API). No remapping needed. Bot username in Doppler
is missing the _bot suffix — always pass TELEGRAM_BOT_USERNAME explicitly as shown.
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

CAPTION = "Please identify this industrial equipment. Note the make, model, and any issues visible."
ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


async def collect_reply(client, bot_entity, image_path: str, caption: str, timeout: int) -> str | None:
    """Send photo and poll for bot reply using silence-detection. Copied from run_test.py."""
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
            if collected and silence_ticks >= 45:
                break

    if not collected:
        return None
    substantive = [m for m in collected if len(m.text) > 50]
    return substantive[-1].text if substantive else collected[-1].text


async def run(photos_dir: Path, timeout: int) -> None:
    try:
        from telethon import TelegramClient
    except ImportError:
        print("ERROR: telethon not installed. Check requirements.txt")
        sys.exit(1)

    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", "@MIRABot")
    session_env = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "/session/test_account.session")

    if not os.path.exists(session_env):
        print(f"ERROR: No Telethon session at {session_env}")
        print("Run session setup first:")
        print("  docker compose run -it --entrypoint python telegram-test-runner session_setup.py")
        sys.exit(1)

    session_path = session_env[: -len(".session")] if session_env.endswith(".session") else session_env

    photos = sorted(p for p in photos_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not photos:
        print(f"No images found in {photos_dir}")
        sys.exit(1)

    print(f"Found {len(photos)} photo(s) in {photos_dir}")
    print(f"Bot: {bot_username}  |  Timeout: {timeout}s per photo")
    print("-" * 70)

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = ARTIFACTS_DIR / "real_photos_report.txt"
    lines = [
        f"MIRA Real Photo Test — {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        f"Photos dir: {photos_dir}",
        f"Bot: {bot_username}",
        "=" * 70,
        "",
    ]

    async with TelegramClient(session_path, api_id, api_hash) as client:
        await client.start()
        bot_entity = await client.get_entity(bot_username)

        for photo in photos:
            print(f"\n[{photo.name}] Sending ({photo.stat().st_size // 1024} KB) ...")
            try:
                reply = await collect_reply(client, bot_entity, str(photo), CAPTION, timeout)
            except Exception as exc:
                reply = f"ERROR: {exc}"

            if reply:
                preview = reply[:120].replace("\n", " ")
                print(f"  → {preview}{'...' if len(reply) > 120 else ''}")
            else:
                print("  → (no reply within timeout)")

            lines += [
                f"## {photo.name}",
                "",
                f"Caption: {CAPTION}",
                "",
                reply if reply else "(no reply)",
                "",
                "-" * 70,
                "",
            ]

    report_path.write_text("\n".join(lines))
    print(f"\nFull report saved to: {report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Send real photos to MIRA bot")
    parser.add_argument("--photos-dir", default="/photos", help="Directory of photos to send")
    parser.add_argument("--timeout", type=int, default=120, help="Seconds to wait per photo")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    if not photos_dir.exists():
        print(f"ERROR: photos dir not found: {photos_dir}")
        sys.exit(1)

    asyncio.run(run(photos_dir, args.timeout))


if __name__ == "__main__":
    main()
