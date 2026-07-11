"""Deterministic guard: every deployed service that runs the MIRA diagnostic
``Supervisor`` receives all three CMMS work-order-evidence settings, default OFF.

Context (#2445, Step 1). The work-order-history evidence path
(``engine.py::_build_wo_evidence_context`` -> ``wo_evidence.recall_work_orders``)
is flag-gated by ``ENABLE_WO_EVIDENCE`` + tuning vars ``MIRA_WO_EVIDENCE_TIMEOUT_S``
/ ``MIRA_WO_EVIDENCE_LIMIT``. Those vars are wired **default-off** into every
saas service that instantiates ``shared.engine.Supervisor`` so enabling is a
one-Doppler-var flip with zero runtime behavior change until then.

ENGINE_SERVICES below is the set of ``docker-compose.saas.yml`` services whose
build entrypoint instantiates ``Supervisor(...)`` — established by grepping
``Supervisor(`` and mapping each hit to its saas build:

  - mira-pipeline     -> mira-pipeline/main.py:256   (dockerfile mira-pipeline/Dockerfile)
  - mira-bot-telegram -> mira-bots/telegram/bot.py:100 (dockerfile mira-bots/telegram/Dockerfile)
  - mira-bot-slack    -> mira-bots/slack/bot.py:39    (context ./mira-bots, slack/Dockerfile)
  - mira-ask          -> mira-bots/ask_api/app.py:44  (context ./mira-bots, ask_api/Dockerfile)

Deliberately EXCLUDED (verified): mira-mcp proxies to mira-pipeline over HTTP
(``PIPELINE_BASE_URL``) and instantiates no engine; mira-relay / mira-sparkplug
-consumer are ingest-only (no ``Supervisor``); the teams/whatsapp/reddit/gchat/
email_adapter adapters instantiate ``Supervisor`` in code but have NO service in
``docker-compose.saas.yml`` (not deployed there).

If a NEW engine service is added to saas.yml, add it to ENGINE_SERVICES here so
this guard forces the same wiring.
"""

from __future__ import annotations

from pathlib import Path

import yaml

_COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.saas.yml"

# saas services that run shared.engine.Supervisor (see module docstring).
ENGINE_SERVICES = (
    "mira-pipeline",
    "mira-bot-telegram",
    "mira-bot-slack",
    "mira-ask",
)

# Each WO var -> the exact default-bearing expression that keeps the feature OFF
# with no behavior change until the operator sets the Doppler value.
EXPECTED = {
    "ENABLE_WO_EVIDENCE": "${ENABLE_WO_EVIDENCE:-0}",
    "MIRA_WO_EVIDENCE_TIMEOUT_S": "${MIRA_WO_EVIDENCE_TIMEOUT_S:-3.0}",
    "MIRA_WO_EVIDENCE_LIMIT": "${MIRA_WO_EVIDENCE_LIMIT:-5}",
}


def _load_services() -> dict:
    return yaml.safe_load(_COMPOSE.read_text())["services"]


def _env_map(service_cfg: dict) -> dict[str, str]:
    """Normalize a compose ``environment:`` (list ``- K=V`` or map ``K: V``) to a dict."""
    env = service_cfg.get("environment", {})
    out: dict[str, str] = {}
    if isinstance(env, list):
        for item in env:
            if isinstance(item, str) and "=" in item:
                k, v = item.split("=", 1)
                out[k] = v
    elif isinstance(env, dict):
        out = {k: str(v) for k, v in env.items()}
    return out


def test_compose_parses_and_engine_services_exist():
    services = _load_services()
    for svc in ENGINE_SERVICES:
        assert svc in services, f"engine service {svc} missing from docker-compose.saas.yml"


def test_every_engine_service_has_all_three_wo_vars_default_off():
    services = _load_services()
    for svc in ENGINE_SERVICES:
        env = _env_map(services[svc])
        for var, expected in EXPECTED.items():
            assert var in env, f"{svc} is missing {var}"
            assert expected in env[var], (
                f"{svc}: {var}={env[var]!r} does not carry the expected "
                f"default expression {expected!r}"
            )
        # Explicit: the feature must be OFF by default (:-0), not just present.
        assert ":-0" in env["ENABLE_WO_EVIDENCE"], (
            f"{svc}: ENABLE_WO_EVIDENCE must default to 0 (OFF), got {env['ENABLE_WO_EVIDENCE']!r}"
        )


def test_non_engine_services_do_not_receive_wo_vars():
    """Scope guard: only engine services get the vars (keeps the diff honest)."""
    services = _load_services()
    for name, cfg in services.items():
        if name in ENGINE_SERVICES:
            continue
        env = _env_map(cfg)
        leaked = [v for v in EXPECTED if v in env]
        assert not leaked, f"non-engine service {name} unexpectedly has {leaked}"


def test_wo_vars_are_documented_in_env_vars_md():
    """Every wired var must be documented (env-drift: documented + used)."""
    doc = (Path(__file__).resolve().parents[1] / "docs" / "env-vars.md").read_text()
    for var in EXPECTED:
        assert f"`{var}`" in doc, f"{var} is not documented in docs/env-vars.md"
