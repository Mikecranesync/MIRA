"""Slack runtime diagnostics stay secret-free and import-safe."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parents[2]
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_repo_root / "mira-bots" / "slack") not in sys.path:
    sys.path.insert(0, str(_repo_root / "mira-bots" / "slack"))


def _import_bot():
    sys.modules.pop("bot", None)
    import bot

    return bot


def test_bot_module_imports_without_slack_env():
    env = os.environ.copy()
    for key in (
        "SLACK_BOT_TOKEN",
        "SLACK_APP_TOKEN",
        "SLACK_SIGNING_SECRET",
        "SLACK_ALLOWED_CHANNELS",
        "SLACK_EXPECTED_BOT_USER_ID",
    ):
        env.pop(key, None)
    env["PYTHONPATH"] = (
        f"{_repo_root}:{_repo_root / 'mira-bots'}:"
        f"{_repo_root / 'mira-bots' / 'slack'}:{env.get('PYTHONPATH', '')}"
    )

    proc = subprocess.run(
        [sys.executable, "-c", "import bot; print('ok')"],
        cwd=_repo_root / "mira-bots" / "slack",
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "ok"


def test_settings_from_env_requires_runtime_tokens():
    bot = _import_bot()

    with pytest.raises(bot.SlackConfigError, match="SLACK_BOT_TOKEN"):
        bot.SlackSettings.from_env({})

    with pytest.raises(bot.SlackConfigError, match="SLACK_APP_TOKEN"):
        bot.SlackSettings.from_env({"SLACK_BOT_TOKEN": "xoxb-test-secret"})


def test_settings_from_env_parses_non_secret_runtime_options():
    bot = _import_bot()

    settings = bot.SlackSettings.from_env(
        {
            "SLACK_BOT_TOKEN": "xoxb-test-secret",
            "SLACK_APP_TOKEN": "xapp-test-secret",
            "SLACK_ALLOWED_CHANNELS": "C1, C2",
            "SLACK_EXPECTED_BOT_USER_ID": "U0B3V3QLUFP",
            "MIRA_DB_PATH": "/tmp/mira-test.db",
        }
    )

    assert settings.bot_token == "xoxb-test-secret"
    assert settings.app_token == "xapp-test-secret"
    assert settings.allowed_channels == ("C1", "C2")
    assert settings.expected_bot_user_id == "U0B3V3QLUFP"
    assert settings.db_path == "/tmp/mira-test.db"


def test_redact_secret_masks_slack_tokens():
    bot = _import_bot()
    text = "bot=xoxb-test-secret app=xapp-test-secret"

    redacted = bot._redact_secret(text)

    assert "test-secret" not in redacted
    assert "xoxb-" in redacted
    assert "xapp-" in redacted
    assert "REDACTED" in redacted


def test_event_meta_never_logs_message_text():
    bot = _import_bot()
    event = {
        "channel": "C1",
        "channel_type": "im",
        "user": "U1",
        "text": "the private customer symptom",
        "ts": "1710000000.000100",
        "client_msg_id": "abc",
    }

    meta = bot._event_meta(event)

    assert meta["channel"] == "C1"
    assert meta["channel_type"] == "im"
    assert "private" not in repr(meta)
    assert "text" not in meta


def test_ignore_decision_logged_without_body(caplog):
    bot = _import_bot()
    caplog.set_level(logging.INFO, logger="mira-slack")
    event = {
        "channel": "C2",
        "channel_type": "channel",
        "user": "U1",
        "text": "do not log this",
        "ts": "1710000000.000200",
    }

    bot._log_event_decision(event, decision="ignored", reason="channel_not_allowed")

    out = caplog.text
    assert "channel_not_allowed" in out
    assert "C2" in out
    assert "do not log this" not in out
