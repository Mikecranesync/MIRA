"""
One-time interactive Telethon session setup.
Run with: docker compose run -it --entrypoint python telegram-test-runner session_setup.py
"""
import asyncio
import os


async def main() -> None:
    try:
        from telethon import TelegramClient
    except ImportError:
        print("ERROR: telethon not installed. Run: pip install telethon")
        raise SystemExit(1)

    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    phone = os.environ["TELEGRAM_TEST_PHONE"]
    session_path = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "test_account.session")

    # Strip .session extension if present — Telethon adds it automatically
    if session_path.endswith(".session"):
        session_path = session_path[: -len(".session")]

    client = TelegramClient(session_path, api_id, api_hash)
    await client.start(phone=phone)
    print(f"\nSession saved to {session_path}.session")
    print("You can now run the test harness.")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
