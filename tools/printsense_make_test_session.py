#!/usr/bin/env python3
"""One-time: generate the Telethon USER StringSession for the Layer-3 staging E2E.

The live E2E (`tests/printsense/test_staging_e2e.py`) drives `@Mira_stagong_bot`
from a **dedicated test USER account** (a bot can't message another bot). Telethon
needs a *session* for that user, created by an interactive login (Telegram sends a
code to the account; you type it in). This is that one-time login — it runs
INTERACTIVELY and prints a `StringSession`.

Run it ONCE (it needs a human to type the login code). By default it stores the
session STRAIGHT into Doppler as `TELEGRAM_TEST_SESSION` (factorylm/stg) via stdin —
never printed, never logged, never in the process arg list. NEVER commit it — it is a
live credential for the test account.

    doppler run -p factorylm -c stg -- py -3 tools/printsense_make_test_session.py
    # …type the code Telegram sends to TELEGRAM_TEST_PHONE…
    # → stored in Doppler factorylm/stg as TELEGRAM_TEST_SESSION (not shown).
    #
    # Fallback — print it instead of storing (then store it yourself):
    #   doppler run -p factorylm -c stg -- py -3 tools/printsense_make_test_session.py --print

Reads TELEGRAM_TEST_API_ID / TELEGRAM_TEST_API_HASH / TELEGRAM_TEST_PHONE from the
environment (Doppler). Requires the optional `telethon` dependency. This tool does
NOT touch production secrets and never sends a message — it only authenticates.
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    try:
        from telethon.sessions import StringSession
        from telethon.sync import TelegramClient
    except ImportError:
        print("telethon not installed — `pip install telethon` first.", file=sys.stderr)
        return 2

    try:
        api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
        api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
        phone = os.environ["TELEGRAM_TEST_PHONE"]
    except KeyError as e:
        print(f"missing {e} — run under `doppler run -p factorylm -c stg --`.", file=sys.stderr)
        return 2

    print(f"Logging in as {phone} (a code will be sent to that Telegram account)…", file=sys.stderr)
    with TelegramClient(StringSession(), api_id, api_hash) as client:
        client.start(phone=phone)
        me = client.get_me()
        if getattr(me, "bot", False):
            print("ERROR: this account is a BOT — use a real user account for the E2E.", file=sys.stderr)
            return 1
        session = client.session.save()

    # Default: store the session STRAIGHT into Doppler (factorylm/stg) via stdin so it
    # is never printed to the terminal or a log. `--print` falls back to stdout (copy it
    # yourself). Passing the value on stdin keeps it out of the process argument list.
    if "--print" in sys.argv:
        print(session)  # stdout only — `... --print > /dev/null` hides it
        print("\n^ store as TELEGRAM_TEST_SESSION in Doppler (factorylm/stg). Do NOT commit it.", file=sys.stderr)
        return 0

    import subprocess

    proc = subprocess.run(
        ["doppler", "secrets", "set", "TELEGRAM_TEST_SESSION", "--project", "factorylm", "--config", "stg"],
        input=session,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        print("could not store to Doppler (is the CLI installed + DOPPLER_TOKEN set?):", file=sys.stderr)
        print(proc.stderr.strip()[:500], file=sys.stderr)
        print("re-run with --print to get the session and store it manually.", file=sys.stderr)
        return 1
    print("✓ stored TELEGRAM_TEST_SESSION in Doppler factorylm/stg (not printed). Never commit it.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
