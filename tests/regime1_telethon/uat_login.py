"""One-time Telethon login for the UAT test account (two-step, non-interactive).

Step A (agent):   doppler run -p factorylm -c stg -- py -3 uat_login.py --request
                  → sends a login code to the test account's Telegram/SMS.
Step B (owner supplies code): ... uat_login.py --code 12345
                  → completes sign-in and writes uat_account.session.

Env (Doppler stg): TELEGRAM_TEST_API_ID, TELEGRAM_TEST_API_HASH, TELEGRAM_TEST_PHONE.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

HERE = Path(__file__).parent
SESSION = str(HERE / "uat_account.session")
STATE = HERE / ".login_state.json"


async def amain(args) -> int:
    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    phone = os.environ["TELEGRAM_TEST_PHONE"]

    client = TelegramClient(SESSION, api_id, api_hash)
    await client.connect()

    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"Already authorized as {me.first_name} (@{me.username or me.phone}).")
        await client.disconnect()
        return 0

    if args.request:
        sent = await client.send_code_request(phone)
        STATE.write_text(json.dumps({"phone_code_hash": sent.phone_code_hash}))
        print(f"Code requested for {phone}. It arrives in the test account's "
              "Telegram app (or SMS). Re-run with --code <the code>.")
    elif args.code:
        state = json.loads(STATE.read_text())
        try:
            await client.sign_in(
                phone, args.code, phone_code_hash=state["phone_code_hash"]
            )
        except SessionPasswordNeededError:
            if not args.password:
                print("2FA password required — re-run with --code <code> --password <pw>")
                await client.disconnect()
                return 2
            await client.sign_in(password=args.password)
        me = await client.get_me()
        print(f"Signed in as {me.first_name} (@{me.username or me.phone}). "
              f"Session saved: {SESSION}")
        STATE.unlink(missing_ok=True)
    else:
        print("Use --request first, then --code <code>.")
        await client.disconnect()
        return 1

    await client.disconnect()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--request", action="store_true")
    ap.add_argument("--code", default="")
    ap.add_argument("--password", default="")
    return asyncio.run(amain(ap.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
