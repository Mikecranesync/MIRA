"""Slack runtime doctor for MIRA. Run under Doppler; never prints token values."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from bot import SlackConfigError, SlackSettings, _redact_secret

SlackCall = Callable[[str, str], Awaitable[dict[str, Any]]]


async def _call_slack(method: str, token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"https://slack.com/api/{method}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()


async def run(
    *,
    settings: SlackSettings,
    expected_user_id: str = "",
    call_slack: SlackCall = _call_slack,
) -> int:
    auth = await call_slack("auth.test", settings.bot_token)
    app_conn = await call_slack("apps.connections.open", settings.app_token)
    summary: dict[str, Any] = {
        "ok": bool(auth.get("ok")) and bool(app_conn.get("ok")),
        "bot_token_ok": bool(auth.get("ok")),
        "app_token_ok": bool(app_conn.get("ok")),
        "team_id": auth.get("team_id", ""),
        "team": auth.get("team", ""),
        "user_id": auth.get("user_id", ""),
        "bot_id": auth.get("bot_id", ""),
        "expected_user_id": expected_user_id or settings.expected_bot_user_id,
    }
    expected = summary["expected_user_id"]
    if expected and summary["user_id"] and expected != summary["user_id"]:
        summary["ok"] = False
        summary["error"] = "bot_user_id_mismatch"
    if not auth.get("ok"):
        summary["bot_token_error"] = auth.get("error", "unknown")
    if not app_conn.get("ok"):
        summary["app_token_error"] = app_conn.get("error", "unknown")
    print(_redact_secret(json.dumps(summary, sort_keys=True)))
    return 0 if summary["ok"] else 1


async def run_from_env(expected_user_id: str = "") -> int:
    try:
        settings = SlackSettings.from_env()
    except SlackConfigError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    return await run(settings=settings, expected_user_id=expected_user_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expected-user-id", default=os.environ.get("SLACK_EXPECTED_BOT_USER_ID", "")
    )
    args = parser.parse_args()
    return asyncio.run(run_from_env(args.expected_user_id))


if __name__ == "__main__":
    raise SystemExit(main())
