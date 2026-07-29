"""Ops-alert routing must never default to the prod user-facing bot.

Guards the 2026-07-08 fix: heartbeat/probe/report/morning-brief traffic was
landing on @FactoryLM_Diagnose (TELEGRAM_BOT_TOKEN) because the senders defaulted
to the prod token+chat. They now resolve through a dedicated alert channel:
    TELEGRAM_ALERT_BOT_TOKEN → TELEGRAM_BOT_TOKEN_STG → TELEGRAM_BOT_TOKEN
    TELEGRAM_ALERT_CHAT_ID   → TELEGRAM_CHAT_ID       → TELEGRAM_REPORT_CHAT_ID
So when the alert vars are set (as they are in Doppler prd), ops traffic goes to
the staging bot, and the prod bot only falls through if nothing else is set.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_TN = Path(__file__).resolve().parents[1] / "mira-crawler" / "reporting" / "telegram_notify.py"
_spec = importlib.util.spec_from_file_location("telegram_notify", _TN)
tn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tn)

_VARS = [
    "TELEGRAM_ALERT_BOT_TOKEN", "TELEGRAM_BOT_TOKEN_STG", "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ALERT_CHAT_ID", "TELEGRAM_CHAT_ID", "TELEGRAM_REPORT_CHAT_ID",
]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for v in _VARS:
        monkeypatch.delenv(v, raising=False)
    yield


def test_token_prefers_alert_bot(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_BOT_TOKEN", "STAGING")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "PROD")
    assert tn.alert_token() == "STAGING"  # never the prod bot when alert is set


def test_token_falls_back_to_stg_then_prod(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN_STG", "STG")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "PROD")
    assert tn.alert_token() == "STG"
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN_STG")
    assert tn.alert_token() == "PROD"  # last-resort only


def test_chat_prefers_alert_chat(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_CHAT_ID", "8445149012")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "PROD_CHAT")
    assert tn.alert_chat_id() == "8445149012"


def test_explicit_arg_wins(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_BOT_TOKEN", "STAGING")
    assert tn.alert_token("EXPLICIT") == "EXPLICIT"


def test_unset_returns_empty(monkeypatch):
    assert tn.alert_token() == ""
    assert tn.alert_chat_id() == ""


# ── Architecture guard: no ops agent may send Telegram via the bare prod token ──
#
# The unit tests above lock the resolver *precedence*. This test locks its
# *usage*: a new ops/monitoring agent that does `os.getenv("TELEGRAM_BOT_TOKEN")`
# and posts directly would re-flood @FactoryLM_Diagnose — exactly the 2026-07-08
# regression PR #2558 fixed. Default-deny scan of the ops-agent dirs.
#
# The rule: any file under those dirs that SENDS Telegram (hits the Bot API or a
# telegram_notify sender) and references the prod token TELEGRAM_BOT_TOKEN must
# ALSO prove it routes through the alert channel — either the shared framework
# (telegram_notify's notify/notify_raw/alert_token/alert_chat_id) or an inline
# TELEGRAM_ALERT_BOT_TOKEN chain. A file that uses a dedicated non-prod ops
# channel (e.g. TELEGRAM_OPS_BOT_TOKEN) and never mentions TELEGRAM_BOT_TOKEN is
# fine — it can't leak. Test files are out of scope.

_ROOT = Path(__file__).resolve().parents[1]

# Directories that host ops / monitoring / reporting agents. A new agent dropped
# here is scanned automatically — that's the point.
_OPS_DIRS = [
    "scripts",
    "mira-crawler/reporting",
    "mira-crawler/agents",
    "mira-bots/agents",
]

# Files in the ops dirs that intentionally use the prod user-facing bot. Empty
# by design: ops traffic belongs on the alert bot. Add here ONLY with a reason.
_PROD_BOT_ALLOWLIST: set[str] = set()

_SENDS_TELEGRAM = ("api.telegram.org", "sendmessage", "notify_raw(", "notify(")
_ALERT_ROUTED = (
    "telegram_alert_bot_token",  # inline alert chain
    "alert_token",               # framework resolver
    "alert_chat_id",
    "telegram_notify",           # import of the framework
)


def _ops_sender_files() -> list[Path]:
    out: list[Path] = []
    for d in _OPS_DIRS:
        base = _ROOT / d
        if not base.exists():
            continue
        for p in base.rglob("*.py"):
            name = p.name
            if name.startswith("test_") or name.endswith("_test.py") or "tests" in p.parts:
                continue
            body = p.read_text(encoding="utf-8", errors="ignore").lower()
            if any(tok in body for tok in _SENDS_TELEGRAM):
                out.append(p)
    return out


def test_ops_senders_never_default_to_prod_bot():
    offenders: list[str] = []
    for p in _ops_sender_files():
        rel = str(p.relative_to(_ROOT))
        if rel in _PROD_BOT_ALLOWLIST:
            continue
        body = p.read_text(encoding="utf-8", errors="ignore").lower()
        if "telegram_bot_token" not in body:
            continue  # dedicated ops channel or framework-only — can't leak
        if not any(tok in body for tok in _ALERT_ROUTED):
            offenders.append(rel)
    assert not offenders, (
        "Ops agent(s) reference the prod bot token (TELEGRAM_BOT_TOKEN) without "
        "routing through the alert channel (TELEGRAM_ALERT_BOT_TOKEN / "
        "telegram_notify). This re-floods @FactoryLM_Diagnose — see PR #2558. "
        f"Fix by using telegram_notify.notify() or the alert-token chain: {offenders}"
    )


def test_guard_would_catch_a_leak():
    # Prove the guard actually fires: a fixture that posts via the bare prod token
    # with no alert routing must be flagged.
    leaky = "import os, httpx\n" \
            "t = os.getenv('TELEGRAM_BOT_TOKEN')\n" \
            "httpx.post(f'https://api.telegram.org/bot{t}/sendMessage', json={})\n"
    body = leaky.lower()
    assert any(tok in body for tok in _SENDS_TELEGRAM)
    assert "telegram_bot_token" in body
    assert not any(tok in body for tok in _ALERT_ROUTED)  # → would be an offender
