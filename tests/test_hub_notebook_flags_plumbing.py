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
