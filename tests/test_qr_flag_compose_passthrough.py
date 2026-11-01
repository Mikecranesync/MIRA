"""MIRA_QR_IDENTIFICATION_LINK reaches the services that read it — compose contract (#5077).

The flag is read by the Slack fast path (``shared/chat/fast_paths.py``) and the
manual-discovery endpoint (``ask_api/manual_discovery.py``). These compose
files use explicit environment allowlists, so a Doppler value that no compose
file forwards never reaches the container. The default stays off.

Run: python -m pytest tests/test_qr_flag_compose_passthrough.py -q
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
FLAG = "MIRA_QR_IDENTIFICATION_LINK"
EXPECTED = "${MIRA_QR_IDENTIFICATION_LINK:-0}"
SERVICES = (
    ("docker-compose.saas.yml", "mira-bot-slack"),
    ("docker-compose.saas.yml", "mira-ask"),
    ("docker-compose.staging-vps.yml", "mira-ask"),
)


def _env(service: dict) -> dict[str, str]:
    env = service.get("environment") or {}
    if isinstance(env, list):
        return dict(item.split("=", 1) if "=" in item else (item, "") for item in env)
    return {k: "" if v is None else str(v) for k, v in env.items()}


@pytest.mark.parametrize(("rel", "name"), SERVICES)
def test_flag_is_forwarded_default_off(rel, name):
    services = yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))["services"]
    env = _env(services[name])
    assert "OPENAI_MODEL" in env or "SERPER_API_KEY" in env, f"{rel}:{name} parse is wrong"
    assert env.get(FLAG) == EXPECTED, f"{rel}:{name} forwards {FLAG}={env.get(FLAG)!r}"


def test_flag_is_documented_default_off():
    text = (ROOT / "docs" / "env-vars.md").read_text(encoding="utf-8")
    rows = [ln for ln in text.splitlines() if re.match(rf"^\|\s*`{FLAG}`\s*\|", ln)]
    assert len(rows) == 1, f"expected one {FLAG} row in docs/env-vars.md, found {len(rows)}"
    assert "default off" in rows[0].lower()
