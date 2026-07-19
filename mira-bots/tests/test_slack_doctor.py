"""Slack doctor is injectable for tests and never prints secrets."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_tests_dir = Path(__file__).resolve().parent
if str(_tests_dir) not in sys.path:
    sys.path.insert(0, str(_tests_dir))

from slack_test_imports import load_slack_doctor


@pytest.mark.asyncio
async def test_doctor_reports_identity_without_tokens_or_socket_url(capsys):
    bot, doctor = load_slack_doctor()

    settings = bot.SlackSettings(
        bot_token="xoxb-test-secret",
        app_token="xapp-test-secret",
        expected_bot_user_id="U0B3V3QLUFP",
    )

    async def fake_call_slack(method, token):
        assert token in {"xoxb-test-secret", "xapp-test-secret"}
        if method == "auth.test":
            return {
                "ok": True,
                "team_id": "T1",
                "team": "FactoryLM",
                "user_id": "U0B3V3QLUFP",
                "bot_id": "B1",
            }
        if method == "apps.connections.open":
            return {"ok": True, "url": "wss://secret-websocket-url"}
        raise AssertionError(method)

    code = await doctor.run(
        settings=settings,
        expected_user_id="U0B3V3QLUFP",
        call_slack=fake_call_slack,
    )

    out = capsys.readouterr().out
    assert code == 0
    assert '"ok": true' in out
    assert '"user_id": "U0B3V3QLUFP"' in out
    assert "xoxb-test-secret" not in out
    assert "xapp-test-secret" not in out
    assert "wss://secret-websocket-url" not in out


@pytest.mark.asyncio
async def test_doctor_fails_on_expected_user_mismatch(capsys):
    bot, doctor = load_slack_doctor()

    settings = bot.SlackSettings(
        bot_token="xoxb-test-secret",
        app_token="xapp-test-secret",
        expected_bot_user_id="U0B3V3QLUFP",
    )

    async def fake_call_slack(method, token):
        if method == "auth.test":
            return {"ok": True, "team_id": "T1", "team": "FactoryLM", "user_id": "UWRONG"}
        return {"ok": True, "url": "wss://secret-websocket-url"}

    code = await doctor.run(settings=settings, call_slack=fake_call_slack)

    out = capsys.readouterr().out
    assert code == 1
    assert "bot_user_id_mismatch" in out
    assert "wss://secret-websocket-url" not in out
