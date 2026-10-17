"""OpenRouter reaches every container that runs the provider cascade — compose contract.

A key in Doppler that no compose file forwards never reaches the container, and
the backup tier silently does not exist. Every service that receives the cascade
block (it carries ``OPENAI_MODEL``) must also receive ``OPENROUTER_API_KEY``.

The model ids are deliberately NOT forwarded: the code defaults
(``meta-llama/llama-3.3-70b-instruct`` / ``qwen/qwen3-vl-30b-a3b-instruct``) are the
ones verified live on 2026-10-14. The old compose anchors defaulted
``OPENROUTER_MODEL`` to ``meta-llama/llama-3.3-70b-instruct:free`` and the vision
model to a delisted Llama 4 Scout id — neither exists, and a forwarded value
would override the code default and turn every OpenRouter call into a 400.

Run: python -m pytest tests/test_openrouter_compose_passthrough.py -q
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILES = (
    "docker-compose.saas.yml",
    "docker-compose.staging-vps.yml",
    "mira-bots/docker-compose.yml",
)


def _env(service: dict) -> dict[str, str]:
    env = service.get("environment") or {}
    if isinstance(env, list):
        return dict(item.split("=", 1) if "=" in item else (item, "") for item in env)
    return {k: "" if v is None else str(v) for k, v in env.items()}


def _services(rel: str) -> dict[str, dict]:
    data = yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))
    return data.get("services") or {}


@pytest.mark.parametrize("rel", COMPOSE_FILES)
def test_every_cascade_service_gets_the_openrouter_key(rel):
    cascade = {n: _env(s) for n, s in _services(rel).items() if "OPENAI_MODEL" in _env(s)}
    assert cascade, f"{rel}: no service carries the cascade block — the parse is wrong"
    missing = [n for n, env in cascade.items() if "OPENROUTER_API_KEY" not in env]
    assert missing == [], f"{rel}: cascade services without OPENROUTER_API_KEY: {missing}"
    for n, env in cascade.items():
        assert env["OPENROUTER_API_KEY"] == "${OPENROUTER_API_KEY:-}", n


@pytest.mark.parametrize("rel", COMPOSE_FILES)
def test_openrouter_model_ids_are_not_forwarded(rel):
    for name, service in _services(rel).items():
        env = _env(service)
        for var in ("OPENROUTER_MODEL", "OPENROUTER_VISION_MODEL"):
            assert var not in env, f"{rel}:{name} forwards {var}={env.get(var)!r}"
