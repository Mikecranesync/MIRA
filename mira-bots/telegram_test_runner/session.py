"""
Shared Telethon TelegramClient singleton.
One connection, reused across all test cases in a run.
"""
import os
from telethon import TelegramClient

_client: TelegramClient | None = None


async def get_client() -> TelegramClient:
    global _client
    if _client is None or not _client.is_connected():
        session_path = os.environ["TELEGRAM_TEST_SESSION_PATH"]
        api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
        api_hash = os.environ["TELEGRAM_TEST_API_HASH"]

        # Strip .session suffix — TelegramClient appends it automatically
        if session_path.endswith(".session"):
            session_path = session_path[: -len(".session")]

        _client = TelegramClient(session_path, api_id, api_hash)
        await _client.connect()
        if not await _client.is_user_authorized():
            raise RuntimeError(
                "Telethon session not authorized. Run session_setup.py first."
            )
    return _client
