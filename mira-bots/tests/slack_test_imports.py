"""Test-only helpers for loading Slack modules without polluting top-level imports."""

from __future__ import annotations

import contextlib
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
MIRA_BOTS = ROOT / "mira-bots"
SLACK_DIR = MIRA_BOTS / "slack"
_MISSING = object()


@contextlib.contextmanager
def _temporary_import_state(*module_names: str):
    saved_path = list(sys.path)
    saved_modules = {name: sys.modules.get(name, _MISSING) for name in module_names}
    sys.path.insert(0, str(MIRA_BOTS))
    sys.path.insert(0, str(SLACK_DIR))
    try:
        yield
    finally:
        sys.path[:] = saved_path
        for name, module in saved_modules.items():
            if module is _MISSING:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_slack_bot() -> ModuleType:
    with _temporary_import_state(
        "bot",
        "chat_adapter",
        "pdf_handler",
        "mira_slack_bot_under_test",
    ):
        return _load_module("mira_slack_bot_under_test", SLACK_DIR / "bot.py")


def load_slack_doctor() -> tuple[ModuleType, ModuleType]:
    bot = load_slack_bot()
    with _temporary_import_state("bot", "doctor", "mira_slack_doctor_under_test"):
        sys.modules["bot"] = bot
        doctor = _load_module("mira_slack_doctor_under_test", SLACK_DIR / "doctor.py")
    return bot, doctor


def load_slack_chat_adapter() -> ModuleType:
    with _temporary_import_state("chat_adapter", "mira_slack_chat_adapter_under_test"):
        return _load_module(
            "mira_slack_chat_adapter_under_test",
            SLACK_DIR / "chat_adapter.py",
        )
