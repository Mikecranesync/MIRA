"""Contract: the Hub's manual discovery reaches a running mira-ask on OVH.

Until 2026-09-27 the #3800 minimal model ran no mira-ask anywhere: production
stubbed the Hub's MIRA_ASK_URL to an ``*.invalid`` host and staging had no
mira-ask service, so every nameplate "find the manual" call returned
search_unavailable. These pin the restored wiring. Hermetic — reads files only.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[1]
_PROD_OVERLAY = (_ROOT / "docker-compose.production.yml").read_text()
_STAGING = yaml.safe_load((_ROOT / "docker-compose.staging-vps.yml").read_text())
_DEPLOY_VPS = (_ROOT / ".github" / "workflows" / "deploy-vps.yml").read_text()
_DEPLOY_STG = (_ROOT / ".github" / "workflows" / "deploy-staging.yml").read_text()
_TARGETS_RE = re.compile(r'TARGETS="\$\{SERVICES:-([^}]*)\}"')


def _targets(text: str) -> list[str]:
    m = _TARGETS_RE.search(text)
    assert m, "default TARGETS line not found"
    return m.group(1).split()


def test_production_hub_is_not_stubbed_away_from_mira_ask():
    assert "mira-ask-not-started" not in _PROD_OVERLAY


def test_production_mira_ask_publishes_no_host_port():
    """The base publish binds the retired droplet's Tailscale IP; on OVH that
    address does not exist and `compose up` would fail."""
    block = _PROD_OVERLAY[_PROD_OVERLAY.index("\n  mira-ask:") :]
    block = block[: block.index("\nvolumes:")]
    assert "ports: !reset []" in block


def test_production_deploy_rebuilds_mira_ask_by_default():
    assert "mira-ask" in _targets(_DEPLOY_VPS)


def test_staging_runs_mira_ask_internally_and_the_hub_points_at_it():
    ask = _STAGING["services"]["mira-ask"]
    assert ask["container_name"] == "stg-mira-ask"
    assert "ports" not in ask
    assert ask["networks"] == ["staging-net"]
    assert "SERPER_API_KEY=${SERPER_API_KEY:-}" in ask["environment"]
    hub_env = _STAGING["services"]["mira-hub"]["environment"]
    assert "MIRA_ASK_URL=http://stg-mira-ask:8011" in hub_env


def test_staging_deploy_rebuilds_mira_ask_by_default():
    assert "mira-ask" in _targets(_DEPLOY_STG)
