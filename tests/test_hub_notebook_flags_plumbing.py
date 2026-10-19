"""Hub notebook flags must be FORWARDED by compose, not just set in Doppler.

#4486 shipped the PLC-5 decoder behind NOTEBOOK_GARBLE_DECODE and #4487 shipped
the vector lane behind NOTEBOOK_HYBRID_RETRIEVAL. Neither name was in the Hub's
compose environment, so no Doppler value could reach the container: the decoder
never ran on staging or prod (Release 2 Lane B, 2026-10-18; #4512) and the vector
lane could not be measured (#4513). Same class as #3328.
"""

from __future__ import annotations

import pathlib

import pytest
import yaml

_ROOT = pathlib.Path(__file__).resolve().parents[1]

# (compose file, hub container_name)
HUBS = [
    (_ROOT / "docker-compose.saas.yml", "mira-hub"),
    (_ROOT / "docker-compose.staging-vps.yml", "stg-mira-hub"),
]
# flag → the compose default, which must match the code's default behaviour.
FLAGS = {"NOTEBOOK_HYBRID_RETRIEVAL": "0", "NOTEBOOK_GARBLE_DECODE": "1"}


def _hub_env(compose: pathlib.Path, container: str) -> dict[str, str]:
    services = yaml.safe_load(compose.read_text())["services"]
    (svc,) = [s for s in services.values() if s.get("container_name") == container]
    env = svc.get("environment") or []
    if isinstance(env, dict):
        return {k: str(v) for k, v in env.items()}
    return dict(item.split("=", 1) for item in env)


@pytest.mark.parametrize("compose,container", HUBS, ids=[c for _, c in HUBS])
@pytest.mark.parametrize("flag", sorted(FLAGS))
def test_hub_forwards_notebook_flag(compose: pathlib.Path, container: str, flag: str) -> None:
    env = _hub_env(compose, container)
    assert flag in env, f"{container} in {compose.name} does not forward {flag}"
    assert env[flag] == f"${{{flag}:-{FLAGS[flag]}}}", (
        f"{container} forwards {flag} as {env[flag]!r}; expected the environment value "
        f"with default {FLAGS[flag]!r} (the code's own default)"
    )


# CU-RR1: the cross-encoder reranker is STAGING ONLY until its walk gate passes and
# Mike gives a separate GO for production (docs/architecture/convergence/units/CU-RR1.md).
_STAGING = _ROOT / "docker-compose.staging-vps.yml"
_PROD = _ROOT / "docker-compose.saas.yml"


def test_staging_hub_forwards_rerank_flag_default_off() -> None:
    env = _hub_env(_STAGING, "stg-mira-hub")
    assert env.get("NOTEBOOK_RERANK") == "${NOTEBOOK_RERANK:-0}"
    assert env.get("NOTEBOOK_RERANK_TIMEOUT_MS") == "${NOTEBOOK_RERANK_TIMEOUT_MS:-}"


def test_staging_reranker_url_names_a_service_in_the_same_file() -> None:
    env = _hub_env(_STAGING, "stg-mira-hub")
    url = env.get("RERANKER_URL", "")
    services = yaml.safe_load(_STAGING.read_text())["services"]
    host = url.removeprefix("http://").split(":", 1)[0]
    assert host in services, f"RERANKER_URL {url!r} points at no service in {_STAGING.name}"
    svc = services[host]
    assert "ports" not in svc, "the reranker has no auth; it must not publish a port"
    assert svc.get("cpus") and svc.get("mem_limit"), (
        "shared prod host: CPU and memory must be capped"
    )


def test_reranker_is_not_in_production_compose() -> None:
    prod = yaml.safe_load(_PROD.read_text())["services"]
    assert "mira-reranker" not in prod
    assert "NOTEBOOK_RERANK" not in _hub_env(_PROD, "mira-hub")


def test_staging_reranker_defaults_to_the_int8_model_with_a_rollback_knob() -> None:
    services = yaml.safe_load(_STAGING.read_text())["services"]
    env = dict(item.split("=", 1) for item in services["mira-reranker"]["environment"])
    assert env.get("RERANKER_MODEL") == "${RERANKER_MODEL:-int8-avx2}"
