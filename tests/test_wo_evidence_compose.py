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

_REPO = Path(__file__).resolve().parents[1]
_COMPOSE = _REPO / "docker-compose.saas.yml"
# Staging compose files (#2445 Step 1.5). The DEPLOYED VPS staging stack and the
# local-dev staging stack each run the engine on only two surfaces — Slack is
# intentionally omitted (a shared token would dual-poll prod) and mira-ask is
# prod-only. Both must carry the flags default-off so Step 2 can enable them.
_STAGING_VPS = _REPO / "docker-compose.staging-vps.yml"
_STAGING_LOCAL = _REPO / "docker-compose.staging.yml"
STAGING_ENGINE_SERVICES = ("mira-pipeline", "mira-bot-telegram")

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


# ── #2445 Step 1.5: the staging compose files carry the flags default-off ──────
# The engine surfaces that actually exist on staging (pipeline + Telegram) must
# receive all three vars default-off so Step 2 can flip ENABLE_WO_EVIDENCE=1 in
# Doppler factorylm/stg without editing compose. PyYAML resolves `<<: *anchor`
# merge keys, so the local-dev file's anchor-inherited vars are visible too.


def _services_at(path: Path) -> dict:
    return yaml.safe_load(path.read_text())["services"]


def test_staging_vps_engine_services_have_all_three_wo_vars_default_off():
    services = _services_at(_STAGING_VPS)
    for svc in STAGING_ENGINE_SERVICES:
        assert svc in services, f"{svc} missing from docker-compose.staging-vps.yml"
        env = _env_map(services[svc])
        for var, expected in EXPECTED.items():
            assert var in env, f"staging-vps {svc} is missing {var}"
            assert expected in env[var], (
                f"staging-vps {svc}: {var}={env[var]!r} != expected {expected!r}"
            )
        assert ":-0" in env["ENABLE_WO_EVIDENCE"], (
            f"staging-vps {svc}: ENABLE_WO_EVIDENCE must default OFF, got {env['ENABLE_WO_EVIDENCE']!r}"
        )


def test_staging_local_engine_services_inherit_wo_vars_default_off():
    services = _services_at(_STAGING_LOCAL)
    # local-dev service keys are suffixed (mira-pipeline-staging, ...); they
    # inherit the flags from the x-staging-env anchor via `<<:`.
    local_engine = [n for n in services if n.startswith(tuple(f"{s}-staging" for s in STAGING_ENGINE_SERVICES))]
    assert local_engine, "no local staging engine services found"
    for svc in local_engine:
        env = _env_map(services[svc])
        for var, expected in EXPECTED.items():
            assert var in env, f"staging-local {svc} is missing {var} (anchor not inherited?)"
            assert expected in env[var], (
                f"staging-local {svc}: {var}={env[var]!r} != expected {expected!r}"
            )
        assert ":-0" in env["ENABLE_WO_EVIDENCE"], (
            f"staging-local {svc}: ENABLE_WO_EVIDENCE must default OFF, got {env['ENABLE_WO_EVIDENCE']!r}"
        )
