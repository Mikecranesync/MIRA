# Slack Recovery Across FactoryLM + MIRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `mira-maintenance-agent` Slack app so Slack works as the documented front door across MIRA and FactoryLM: DMs, `#all-mira` / `#all-factorylm` mentions, and slash commands reach the deployed MIRA engine, while the FactoryLM Hub Slack connector reports the same workspace identity.

**Current incident signal:** After the rebuild around PR #2803, the Slack app exists in Slack (`mira-maintenance-agent (local)`, bot/user/member ID `U0B3V3QLUFP`, DM `D0B3YF4DU1Y`) but does not respond to `hello`, channel mentions, or slash-command smoke.

**Grounded repo specs this plan follows:**

- `NORTH_STAR.md`: FactoryLM is the context layer; MIRA is the grounded agent; Slack is a valued consumption surface, not the wedge.
- `docs/THEORY_OF_OPERATIONS.md`: Slack is the primary front door, using slack-bolt Socket Mode; all front doors call the shared engine and never bypass it.
- `.claude/CLAUDE.md`: Slack lives in `mira-bots/slack/bot.py`; it uses `slack-bolt` `AsyncApp` + Socket Mode; the UNS confirmation gate and grounded/cited answers are non-negotiable.
- `docs/ADAPTER_ARCHITECTURE.md`: Slack adapter must normalize inbound events, route through `ChatDispatcher`, call `Supervisor`, then render Slack Block Kit responses.
- `docs/specs/maintenance-namespace-builder-spec.md`: Slack and Hub must not drift; both must follow the same UNS gate and evidence rules.
- `docs/environments.md`: no direct VPS docker compose/restart from Claude sessions; deploy via `deploy-vps.yml`. Staging intentionally omits Slack bot because a second Slack connection against the prod token can steal events.
- `docs/env-vars.md` and `docker-compose.saas.yml`: production Slack bot requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`; Hub also uses Slack OAuth/client env.

**Important spec reconciliation:** Older Hub integration docs describe Slack as Events API/webhook and "not deployed." Current deploy truth is Socket Mode: `.claude/CLAUDE.md`, `docs/THEORY_OF_OPERATIONS.md`, `docs/env-vars.md`, `docker-compose.saas.yml`, and `mira-bots/slack/bot.py` all use `SLACK_APP_TOKEN` + `AsyncSocketModeHandler`. Do not migrate to Events API in this recovery unless Mike explicitly changes the architecture.

**Constraints:**

- Do not build a generic chatbot. Plain `hello` is only a connectivity smoke; if it reaches the engine, the engine can ask for useful maintenance context.
- Do not weaken the UNS confirmation gate or citation/grounding rules.
- Do not print or commit real Slack/Doppler tokens. Redact `xox*`, `xapp*`, signing secrets, OAuth client secrets, and bearer headers in logs/docs.
- Do not add Slack to staging while it uses the shared production Slack token. A staging Slack bot needs a separate Slack app/token first.
- Do not merge or deploy without Mike approval.

**Secret injection model:**

- Runtime secrets come from Doppler only. Production deploy already runs compose under `doppler run --project factorylm --config prd`; local/operator diagnostics should use the same pattern.
- Unit tests must not call Doppler, Slack, or the network. They use explicit fake constructor values like `xoxb-test-secret`, or an env mapping passed into `SlackSettings.from_env(...)`; they do not patch real `os.environ` to simulate production secrets.
- Refactor `mira-bots/slack/bot.py` so importing the module is secret-free. Environment reads happen in `main()` / `SlackSettings.from_env()`, not at module import time.
- Any live identity proof should be a small CLI/doctor command run under Doppler, not a pytest test that needs real secrets.

## Task 1: Prove the failure layer before changing product logic

**Files changed:** none.

**Purpose:** Determine whether Slack events fail before the Python handler, at Socket Mode auth/connection, in event filtering, in the #2803 fast-path fallthrough, or in outbound posting.

Run these from the repo root for branch freshness and PR context:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
git fetch origin
git log HEAD..origin/main --oneline
gh pr view 2803 --json state,mergedAt,mergeCommit,title,url
gh pr view 2634 --json state,mergedAt,title,url
gh pr view 2647 --json state,mergedAt,title,url
```

Expected:

- PR #2803 is merged and is on `origin/main`.
- PR #2634 is merged and only default-off WO evidence env wiring should be considered after connectivity is proven.
- PR #2647 explains why staging has no Slack bot.

Collect current deploy/build evidence through the approved production workflow or an operator-approved prod shell. If an operator runs shell commands, use read-only inspection first and redact all secrets:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | rg 'mira-bot-slack|mira-hub'
docker logs --tail=200 mira-bot-slack 2>&1 \
  | sed -E 's/(xox[a-zA-Z0-9-]*-|xapp-)[A-Za-z0-9-]+/\1REDACTED/g' \
  | sed -E 's/(Authorization: Bearer )[A-Za-z0-9._-]+/\1REDACTED/g'
docker inspect mira-bot-slack --format '{{json .Config.Env}}' \
  | sed -E 's/(xox[a-zA-Z0-9-]*-|xapp-)[A-Za-z0-9-]+/\1REDACTED/g'
```

Use Doppler only to prove presence/absence, never values:

```bash
doppler run --project factorylm --config prd -- sh -lc '
for k in SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_ALLOWED_CHANNELS SLACK_EXPECTED_BOT_USER_ID SLACK_CLIENT_ID SLACK_CLIENT_SECRET; do
  if [ -n "${!k:-}" ]; then
    echo "$k=SET"
  else
    echo "$k=MISSING"
  fi
done
'
```

If direct prod shell access is not approved, use GitHub Actions logs and post-deploy health evidence only:

```bash
gh run list --workflow deploy-vps.yml --branch main --limit 10
gh run view <run-id> --log | rg 'mira-bot-slack|Deploy identity|Rebuild targets|Health check'
```

Decision points:

- If the container is absent, crashed, or stale: fix deploy/config only.
- If the container runs but lacks `SLACK_APP_TOKEN` or `SLACK_BOT_TOKEN`: fix Doppler/compose docs only.
- If Socket Mode connects but no event logs appear after Mike sends a DM: verify Slack app Event Subscriptions/Socket Mode dashboard config and token/app identity.
- If events reach `handle_message` but are ignored: fix filter/allowlist/dedupe observability and the specific ignore bug.
- If events reach dispatch but no post appears: fix outbound `chat.postMessage` error handling/scope/channel permission.

## Task 2: Add failing Slack runtime tests first

**Files changed:**

- `mira-bots/tests/test_slack_runtime_diagnostics.py` (new)
- `mira-bots/tests/test_slack_doctor.py` (new)
- `mira-bots/tests/test_slack_fast_paths.py` (extend)

**Purpose:** Reproduce the incident without live Slack: a DM `hello` must fall through fast paths and reach the dispatcher/render path; event ignore decisions and token redaction must be testable without secrets.

Create the new diagnostics test file. This deliberately avoids Doppler and avoids patching `os.environ`; production secrets are a runtime concern, not a unit-test dependency:

```python
# mira-bots/tests/test_slack_runtime_diagnostics.py
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
    env["PYTHONPATH"] = f"{_repo_root}:{_repo_root / 'mira-bots' / 'slack'}:{env.get('PYTHONPATH', '')}"

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
```

Create the doctor test file. It injects fake settings and a fake Slack API caller; it does not patch env, call Doppler, or hit Slack:

```python
# mira-bots/tests/test_slack_doctor.py
import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parents[2]
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_repo_root / "mira-bots" / "slack") not in sys.path:
    sys.path.insert(0, str(_repo_root / "mira-bots" / "slack"))


@pytest.mark.asyncio
async def test_doctor_reports_identity_without_tokens_or_socket_url(capsys):
    import bot
    import doctor

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
    import bot
    import doctor

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
```

Extend the Slack fast-path tests with the live incident shape. Do not replace module globals; instantiate a runtime with fake dependencies:

```python
# append to mira-bots/tests/test_slack_fast_paths.py
@pytest.mark.asyncio
async def test_dm_hello_falls_through_to_dispatcher_without_env_patch(tmp_path):
    import bot
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    sent = []

    async def say(text=None, thread_ts=None, **kw):
        sent.append({"text": text, "thread_ts": thread_ts})

    async def no_fast_path(event, engine):
        return None

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event["client_msg_id"],
                platform="slack",
                tenant_id="T1",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event["ts"],
                text=raw_event["text"],
                attachments=[],
                event_type="dm",
                raw=raw_event,
            )

        async def render_outgoing(self, response, event):
            sent.append({"text": response.text, "thread_ts": event.external_thread_id})

    class FakeDispatcher:
        async def dispatch(self, event):
            assert event.platform == "slack"
            assert event.event_type == "dm"
            assert event.text == "hello"
            return NormalizedChatResponse(text="What machine are you looking at?")

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=no_fast_path,
    )

    event = {
        "channel": "D0B3YF4DU1Y",
        "channel_type": "im",
        "user": "U0B3V3QLUFP",
        "text": "hello",
        "ts": "1710000000.000300",
        "client_msg_id": "dm-hello-1",
    }

    await runtime.handle_message(event, say, client=None)

    assert sent == [{"text": "What machine are you looking at?", "thread_ts": "1710000000.000300"}]
```

Run the targeted red tests:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan/mira-bots
python3.12 -m pytest tests/test_slack_runtime_diagnostics.py tests/test_slack_doctor.py tests/test_slack_fast_paths.py -q
```

Expected before implementation:

- `test_bot_module_imports_without_slack_env` fails because `bot.py` currently reads Slack secrets at import time.
- Settings/runtime/helper tests fail because `SlackSettings`, `SlackConfigError`, `SlackRuntime`, and the diagnostics helpers do not exist yet.
- Doctor tests fail because `mira-bots/slack/doctor.py` does not exist yet.
- `test_dm_hello_falls_through_to_dispatcher_without_env_patch` passes after the runtime refactor and proves #2803 fast-path fallthrough remains intact.

## Task 3: Add safe Slack runtime diagnostics, settings injection, and identity proof

**Files changed:**

- `mira-bots/slack/bot.py`
- `mira-bots/slack/doctor.py` (new)
- `docs/env-vars.md`
- `docker-compose.saas.yml`

**Purpose:** Make secrets a runtime dependency only. Production values are injected by Doppler; tests instantiate `SlackSettings` with fake values. Startup should prove Socket Mode auth identity, event handlers should log safe route decisions, and plain DMs should not disappear silently.

In `mira-bots/slack/bot.py`, replace import-time secret reads with an explicit settings object:

```python
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass


class SlackConfigError(RuntimeError):
    """Raised when required Slack runtime configuration is missing."""


@dataclass(frozen=True, slots=True)
class SlackSettings:
    bot_token: str
    app_token: str
    signing_secret: str = ""
    allowed_channels: tuple[str, ...] = ()
    expected_bot_user_id: str = ""
    db_path: str = "/data/mira.db"
    openwebui_base_url: str = "http://mira-core:8080"
    openwebui_api_key: str = ""
    mcp_base_url: str = "http://mira-mcp:8001"
    mcp_rest_api_key: str = ""
    knowledge_collection_id: str = ""
    vision_model: str = "qwen2.5vl:7b"
    tenant_id: str = ""

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "SlackSettings":
        source = os.environ if env is None else env
        bot_token = source.get("SLACK_BOT_TOKEN", "").strip()
        app_token = source.get("SLACK_APP_TOKEN", "").strip()
        if not bot_token:
            raise SlackConfigError("SLACK_BOT_TOKEN is required for mira-bot-slack")
        if not app_token:
            raise SlackConfigError("SLACK_APP_TOKEN is required for mira-bot-slack Socket Mode")
        allowed_channels = tuple(
            c.strip() for c in source.get("SLACK_ALLOWED_CHANNELS", "").split(",") if c.strip()
        )
        return cls(
            bot_token=bot_token,
            app_token=app_token,
            signing_secret=source.get("SLACK_SIGNING_SECRET", ""),
            allowed_channels=allowed_channels,
            expected_bot_user_id=source.get("SLACK_EXPECTED_BOT_USER_ID", "").strip(),
            db_path=source.get("MIRA_DB_PATH", "/data/mira.db"),
            openwebui_base_url=source.get("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
            openwebui_api_key=source.get("OPENWEBUI_API_KEY", ""),
            mcp_base_url=source.get("MCP_BASE_URL", "http://mira-mcp:8001"),
            mcp_rest_api_key=source.get("MCP_REST_API_KEY", ""),
            knowledge_collection_id=source.get("KNOWLEDGE_COLLECTION_ID", ""),
            vision_model=source.get("VISION_MODEL", "qwen2.5vl:7b"),
            tenant_id=source.get("MIRA_TENANT_ID", ""),
        )
```

Add diagnostics helpers near the settings code:

```python
_SECRET_PREFIX_RE = re.compile(r"(xox[a-zA-Z0-9-]*-|xapp-)[A-Za-z0-9-]+")


def _redact_secret(value: object) -> str:
    return _SECRET_PREFIX_RE.sub(r"\1REDACTED", str(value))


def _event_meta(event: dict) -> dict[str, object]:
    return {
        "channel": event.get("channel", ""),
        "channel_type": event.get("channel_type", ""),
        "user": event.get("user", ""),
        "bot_id": bool(event.get("bot_id")),
        "subtype": event.get("subtype", ""),
        "thread_ts": event.get("thread_ts", ""),
        "ts": event.get("ts", ""),
        "file_count": len(event.get("files", []) or []),
    }


def _log_event_decision(event: dict, *, decision: str, reason: str, path: str = "") -> None:
    logger.info(
        "slack_event decision=%s reason=%s path=%s meta=%s",
        decision,
        reason,
        path,
        _event_meta(event),
    )
```

Wrap existing handler state in a runtime object so tests can inject fake dependencies without patching module globals:

```python
FastPathFn = Callable[[object, object], Awaitable[object | None]]


class SlackRuntime:
    def __init__(
        self,
        *,
        settings: SlackSettings,
        engine: object,
        adapter: SlackChatAdapter,
        dispatcher: ChatDispatcher,
        fast_paths: FastPathFn = try_fast_paths,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.adapter = adapter
        self.dispatcher = dispatcher
        self.fast_paths = fast_paths
        self.seen_events: set[str] = set()

    def thread_ts(self, event: dict) -> str:
        return event.get("thread_ts", event.get("ts", ""))

    async def log_startup_auth_identity(self, app: AsyncApp) -> None:
        try:
            auth = await app.client.auth_test()
        except Exception as exc:
            logger.error("slack_auth_test_failed error=%s", type(exc).__name__)
            return

        user_id = auth.get("user_id", "")
        bot_id = auth.get("bot_id", "")
        team_id = auth.get("team_id", "")
        team = auth.get("team", "")
        expected = self.settings.expected_bot_user_id
        mismatch = bool(expected and user_id and user_id != expected)
        if mismatch:
            logger.error(
                "slack_auth_identity_mismatch expected_user_id=%s actual_user_id=%s bot_id=%s team_id=%s team=%s",
                expected,
                user_id,
                bot_id,
                team_id,
                team,
            )
        else:
            logger.info(
                "slack_auth_identity_ok user_id=%s bot_id=%s team_id=%s team=%s expected_configured=%s",
                user_id,
                bot_id,
                team_id,
                team,
                bool(expected),
            )
```

Move the existing top-level `handle_message(event, say, client)` body into a new `SlackRuntime.handle_message(self, event, say, client)` method. Keep the current message/PDF/photo/fast-path/dispatcher behavior, but make these exact substitutions inside the moved method:

- `ALLOWED_CHANNELS` -> `self.settings.allowed_channels`
- `_SEEN_EVENTS` -> `self.seen_events`
- `adapter` -> `self.adapter`
- `dispatcher` -> `self.dispatcher`
- `engine` -> `self.engine`
- `try_fast_paths(...)` -> `self.fast_paths(...)`
- `_thread_ts(event)` -> `self.thread_ts(event)`

In the moved handler, replace silent returns with safe decision logs:

```python
    if ts in _SEEN_EVENTS:
        _log_event_decision(event, decision="ignored", reason="duplicate")
        return

    if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
        _log_event_decision(event, decision="ignored", reason=f"subtype:{event.get('subtype')}")
        return
    if event.get("bot_id"):
        _log_event_decision(event, decision="ignored", reason="bot_event")
        return

    if ALLOWED_CHANNELS and event.get("channel") not in ALLOWED_CHANNELS:
        _log_event_decision(event, decision="ignored", reason="channel_not_allowed")
        return
```

Log the route decisions:

```python
    _log_event_decision(event, decision="accepted", reason="message_handler")
```

Before returning from each path:

```python
        _log_event_decision(event, decision="handled", reason="pdf")
        return
```

```python
        _log_event_decision(event, decision="handled", reason="fast_path")
        return
```

```python
        _log_event_decision(event, decision="handled", reason="dispatcher")
```

For empty events:

```python
    if not normalized.text and not any(a.kind == "image" for a in normalized.attachments):
        _log_event_decision(event, decision="ignored", reason="empty")
        return
```

Build the runtime from Doppler-injected env only in `main()`:

```python
def create_runtime(settings: SlackSettings) -> SlackRuntime:
    engine = Supervisor(
        db_path=settings.db_path,
        openwebui_url=settings.openwebui_base_url,
        api_key=settings.openwebui_api_key,
        collection_id=settings.knowledge_collection_id,
        vision_model=settings.vision_model,
        tenant_id=settings.tenant_id,
    )
    adapter = SlackChatAdapter(
        bot_token=settings.bot_token,
        signing_secret=settings.signing_secret,
    )
    identity_service = get_identity_service()
    if identity_service is None:
        logger.warning(
            "NEON_DATABASE_URL not set or sqlalchemy missing - Slack dispatcher will fail closed "
            "until identity service is configured (multi-tenant gate)"
        )
    dispatcher = ChatDispatcher(engine, identity_service=identity_service)
    return SlackRuntime(
        settings=settings,
        engine=engine,
        adapter=adapter,
        dispatcher=dispatcher,
    )


def create_app(runtime: SlackRuntime) -> AsyncApp:
    app = AsyncApp(token=runtime.settings.bot_token)

    @app.event("app_mention")
    async def handle_mention(event, say, client):
        await runtime.handle_message(event, say, client)

    @app.event("message")
    async def handle_message(event, say, client):
        await runtime.handle_message(event, say, client)

    # Register each existing slash command from this file inside create_app().
    # Preserve the current command bodies and replace MCP_BASE_URL/MCP_REST_API_KEY
    # reads with runtime.settings.mcp_base_url/runtime.settings.mcp_rest_api_key.
    return app


async def main():
    settings = SlackSettings.from_env()
    runtime = create_runtime(settings)
    app = create_app(runtime)
    await runtime.log_startup_auth_identity(app)
    handler = AsyncSocketModeHandler(app, settings.app_token)
    logger.info("MIRA Slack bot started (Socket Mode)")
    await handler.start_async()
```

Create `mira-bots/slack/doctor.py` for explicit operator diagnostics under Doppler. This command must print identity, not token values:

```python
# mira-bots/slack/doctor.py
"""Slack runtime doctor for MIRA. Run under Doppler; never prints token values."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from typing import Any

import httpx
from bot import SlackConfigError, SlackSettings, _redact_secret


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
    call_slack=_call_slack,
) -> int:
    auth = await call_slack("auth.test", settings.bot_token)
    app_conn = await call_slack("apps.connections.open", settings.app_token)
    summary = {
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
    parser.add_argument("--expected-user-id", default=os.environ.get("SLACK_EXPECTED_BOT_USER_ID", ""))
    args = parser.parse_args()
    return asyncio.run(run_from_env(args.expected_user_id))


if __name__ == "__main__":
    raise SystemExit(main())
```

Run the doctor only as an operator/live diagnostic:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
doppler run --project factorylm --config prd -- \
  python3.12 mira-bots/slack/doctor.py --expected-user-id U0B3V3QLUFP
```

Expected safe output shape:

```json
{"app_token_ok": true, "bot_id": "B123456", "bot_token_ok": true, "expected_user_id": "U0B3V3QLUFP", "ok": true, "team": "FactoryLM", "team_id": "T123456", "user_id": "U0B3V3QLUFP"}
```

If `apps.connections.open` succeeds, do not print the returned websocket URL.

Add the optional identity guard env to production compose:

```yaml
      - SLACK_EXPECTED_BOT_USER_ID=${SLACK_EXPECTED_BOT_USER_ID:-}
```

Add documentation to `docs/env-vars.md` near the Slack rows:

```markdown
| `SLACK_EXPECTED_BOT_USER_ID` | mira-bot-slack - optional non-secret startup diagnostic. If set, the bot logs an error when Slack `auth.test` returns a different bot user id. Use to prove prod is connected to the expected Slack app without printing tokens. |
| `SLACK_SIGNING_SECRET` | mira-bot-slack - optional; retained for Slack request verification / OAuth-era compatibility. Socket Mode runtime requires `SLACK_APP_TOKEN`. |
| `SLACK_ALLOWED_CHANNELS` | mira-bot-slack - optional comma-separated Slack channel IDs. If set, the bot ignores other channels and logs `channel_not_allowed` without message bodies. |
```

Run:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan/mira-bots
python3.12 -m pytest tests/test_slack_runtime_diagnostics.py tests/test_slack_doctor.py tests/test_slack_fast_paths.py -q
```

Expected:

- Runtime diagnostics tests pass.
- Doctor tests pass without Doppler/network access.
- DM `hello` still reaches dispatcher when `try_fast_paths` returns `None`.

## Task 4: Add deploy/config contract tests for MIRA and FactoryLM Hub

**Files changed:**

- `tests/test_slack_deploy_contract.py` (new)
- `docs/env-vars.md` if missing Hub Slack env rows

**Purpose:** Guard the documented Slack architecture across both product halves:

- MIRA responder: `mira-bot-slack` must exist in prod compose, must require Socket Mode env, and must be part of prod deploy targets.
- Staging: Slack bot must remain intentionally absent until it has a separate Slack app/token.
- FactoryLM Hub: Slack auth/status routes need client/OAuth env and bot-token fallback documented.

Create:

```python
# tests/test_slack_deploy_contract.py
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _workflow_text(name: str) -> str:
    return (ROOT / ".github" / "workflows" / name).read_text()


def test_prod_compose_runs_slack_socket_mode_bot():
    compose = yaml.safe_load((ROOT / "docker-compose.saas.yml").read_text())
    svc = compose["services"]["mira-bot-slack"]
    env = "\n".join(svc["environment"])
    assert svc["build"]["context"] == "./mira-bots"
    assert svc["build"]["dockerfile"] == "slack/Dockerfile"
    assert "SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}" in env
    assert "SLACK_APP_TOKEN=${SLACK_APP_TOKEN}" in env
    assert "SLACK_EXPECTED_BOT_USER_ID=${SLACK_EXPECTED_BOT_USER_ID:-}" in env
    assert svc["restart"] == "unless-stopped"


def test_staging_does_not_run_prod_slack_bot_token():
    staging = (ROOT / "docker-compose.staging-vps.yml").read_text()
    assert "mira-bot-slack:" not in staging
    assert "SLACK_BOT_TOKEN is intentionally omitted" in staging


def test_prod_deploy_default_targets_include_slack_bot():
    workflow = _workflow_text("deploy-vps.yml")
    assert "mira-bot-slack" in workflow
    assert 'TARGETS="${SERVICES:-' in workflow


def test_hub_slack_routes_are_present_and_env_documented():
    auth_route = (ROOT / "mira-hub/src/app/api/auth/slack/route.ts").read_text()
    callback_route = (ROOT / "mira-hub/src/app/api/auth/slack/callback/route.ts").read_text()
    status_route = (ROOT / "mira-hub/src/app/api/auth/status/route.ts").read_text()
    env_docs = (ROOT / "docs/env-vars.md").read_text()

    assert "SLACK_CLIENT_ID" in auth_route
    assert "SLACK_BOT_TOKEN" in auth_route
    assert "oauth.v2.access" in callback_route
    assert "bot_user_id" in callback_route
    assert "SLACK_BOT_TOKEN" in status_route
    assert "SLACK_BOT_TOKEN" in env_docs
    assert "SLACK_APP_TOKEN" in env_docs
    assert "SLACK_CLIENT_ID" in env_docs
    assert "SLACK_CLIENT_SECRET" in env_docs
```

If `docs/env-vars.md` does not currently include Hub Slack OAuth rows, add:

```markdown
| `SLACK_CLIENT_ID` | mira-hub - Slack OAuth client id for the FactoryLM Hub channel connector. |
| `SLACK_CLIENT_SECRET` | mira-hub - Slack OAuth client secret for the FactoryLM Hub channel connector callback. |
```

Run:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
python3.12 -m pytest tests/test_slack_deploy_contract.py tests/test_wo_evidence_compose.py -q
```

Expected:

- The deploy contract passes.
- Staging remains Slack-bot-free by design.
- FactoryLM Hub Slack status/OAuth env is covered by docs.

## Task 5: Fix only the proven broken layer

**Files changed:** depends on Task 1 evidence.

Use this decision table:

| Proven cause | Minimal fix |
|---|---|
| Prod `mira-bot-slack` absent/stale | Re-run `deploy-vps.yml` with `services=mira-bot-slack` after PR merge; no code change beyond diagnostics/contracts. |
| `SLACK_APP_TOKEN` missing/wrong | Fix Doppler `factorylm/prd` secret value out-of-band; keep PR to add identity diagnostics/docs. |
| `SLACK_BOT_TOKEN` belongs to wrong Slack app | Fix Doppler token; set `SLACK_EXPECTED_BOT_USER_ID=U0B3V3QLUFP`; keep PR to log mismatch safely. |
| Socket Mode disabled or event subscriptions missing in Slack app config | Fix Slack dashboard config; keep repo PR with diagnostics so this is visible next time. |
| `SLACK_ALLOWED_CHANNELS` excludes `D0B3YF4DU1Y`, `#all-mira`, or `#all-factorylm` | Fix Doppler allowlist or document expected channel IDs; keep safe ignore logging. |
| DM `hello` does not fall through | Patch `mira-bots/slack/bot.py` in the narrowest handler branch and keep `test_dm_hello_falls_through_to_dispatcher`. |
| `chat.postMessage` errors | Patch `SlackChatAdapter.render_outgoing` to return/log safe Slack error metadata and add a unit test for the exact Slack API error. |
| FactoryLM Hub says Slack disconnected while bot works | Verify `SLACK_BOT_TOKEN` or `SLACK_CLIENT_ID/SLACK_CLIENT_SECRET` are present in `mira-hub` prod env; patch docs/status tests only unless route behavior is wrong. |

Do not touch `shared.engine.Supervisor`, `uns_resolver`, or inference routing unless Task 1 proves Slack events reach the engine and the engine itself is returning a wrong response.

## Task 6: Full local verification

Run from repo root:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
python3.12 -m pytest tests/test_slack_deploy_contract.py tests/test_wo_evidence_compose.py -q
cd mira-bots
python3.12 -m pytest tests/test_slack_adapter.py tests/test_slack_fast_paths.py tests/test_fast_paths_router.py tests/test_slack_runtime_diagnostics.py tests/test_slack_doctor.py -q
ruff check slack shared/chat tests/test_slack_adapter.py tests/test_slack_fast_paths.py tests/test_fast_paths_router.py tests/test_slack_runtime_diagnostics.py tests/test_slack_doctor.py
```

Run Docker build proof:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
docker buildx build -f mira-bots/slack/Dockerfile mira-bots/ -t mira-slack:diagnostic --load
```

If Slack handler code touches the shared engine or gate, also run:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
mira-run-hallucination-audit
```

Expected:

- Slack adapter tests pass.
- Fast-path plain text fallthrough passes.
- Deploy contract proves prod includes Slack and staging excludes it intentionally.
- Docker image builds from the exact Slack Dockerfile used in production.

## Task 7: PR and deploy path

Commit only touched files:

```bash
cd /Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan
git status --short
git add mira-bots/slack/bot.py \
  mira-bots/slack/doctor.py \
  mira-bots/tests/test_slack_runtime_diagnostics.py \
  mira-bots/tests/test_slack_doctor.py \
  mira-bots/tests/test_slack_fast_paths.py \
  tests/test_slack_deploy_contract.py \
  docs/env-vars.md \
  docker-compose.saas.yml
git commit -m "fix(slack): restore Slack runtime observability and fallthrough"
git push -u origin docs/slack-recovery-plan
gh pr create --draft --title "fix(slack): restore mira-maintenance-agent responsiveness after Slack rebuild" --body-file /tmp/slack-recovery-pr.md
```

PR body must include:

- Root cause evidence from Task 1.
- Whether the live issue was code, deploy, Doppler, Slack dashboard, or allowlist.
- Local test evidence from Task 6.
- Explicit note that staging still does not run Slack because it lacks a separate Slack app/token.
- Confirmation that no tokens or message bodies were logged.

After merge and Mike approval, deploy only the Slack service if this is a hotfix:

```bash
gh workflow run deploy-vps.yml --ref main -f services='mira-bot-slack' -f skip_staging_gate=false
```

If normal merge-to-main already triggers smoke and deploy, watch that deploy instead:

```bash
gh run list --workflow deploy-vps.yml --branch main --limit 5
gh run watch <run-id>
```

## Task 8: Production acceptance

Ask Mike to send these live Slack probes after deploy:

1. DM `hello` to `mira-maintenance-agent (local)`.
2. Mention the app in `#all-mira`.
3. Mention the app in `#all-factorylm`.
4. Run `/mira-help`.

Acceptance evidence:

- Startup log has `slack_auth_identity_ok user_id=U0B3V3QLUFP` or a documented, corrected actual bot user id.
- For every probe, logs show `slack_event decision=accepted` then `handled`.
- DM `hello` receives a MIRA response instead of silence. The response may ask for machine/work context; it must not bypass the UNS gate.
- Channel mentions receive a threaded MIRA response.
- `/mira-help` responds. If Slack says the command is not configured, record that as Slack dashboard config, not Python handler failure.
- FactoryLM Hub `/channels` shows Slack enabled when either `SLACK_BOT_TOKEN` or OAuth client credentials are present in the Hub production env.

If any acceptance probe fails, capture the exact safe log line and return to Task 5's decision table.

## Done Definition

- Root cause is identified with evidence.
- Minimal PR is open and scoped to Slack runtime observability/fallthrough/config contracts unless evidence proves a narrower config-only fix.
- Tests pass locally.
- Docker Slack image builds.
- Post-merge deploy is run through `deploy-vps.yml`, not direct VPS compose.
- Live Slack DM, channel mention, and `/mira-help` acceptance are verified.
- FactoryLM Hub Slack connector status matches the runtime Slack app identity or the remaining config gap is documented.
