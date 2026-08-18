"""Deployment contract for the channel-neutral Hub workflow.

The flag remains off until Doppler contains the shared service token and a UUID
tenant. Once enabled, both thin-client containers and the Hub must receive the
same boundary configuration; otherwise the bot startup/Hub health validators
must fail before accepting user traffic.
"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _services(name: str) -> dict:
    return yaml.safe_load((ROOT / name).read_text())["services"]


def _env(service: dict) -> dict[str, str]:
    raw = service.get("environment", {})
    if isinstance(raw, dict):
        return {str(key): str(value) for key, value in raw.items()}
    result: dict[str, str] = {}
    for item in raw:
        if isinstance(item, str) and "=" in item:
            key, value = item.split("=", 1)
            result[key] = value
    return result


def _assert_bot_boundary(
    service: dict,
    *,
    expected_url: str,
    expected_base_path: str,
) -> None:
    env = _env(service)
    assert env["MIRA_CHANNEL_WORKFLOW_ENABLED"] == "${MIRA_CHANNEL_WORKFLOW_ENABLED:-0}"
    assert env["HUB_URL"] == expected_url
    assert env["HUB_BASE_PATH"] == expected_base_path
    assert env["HUB_INGEST_TOKEN"] == "${HUB_INGEST_TOKEN:-}"
    assert env["MIRA_CHANNEL_WORKFLOW_POLL_SECONDS"] == (
        "${MIRA_CHANNEL_WORKFLOW_POLL_SECONDS:-2}"
    )
    assert env["MIRA_CHANNEL_WORKFLOW_TIMEOUT_SECONDS"] == (
        "${MIRA_CHANNEL_WORKFLOW_TIMEOUT_SECONDS:-600}"
    )


def _assert_hub_boundary(service: dict) -> None:
    env = _env(service)
    assert env["MIRA_CHANNEL_WORKFLOW_ENABLED"] == "${MIRA_CHANNEL_WORKFLOW_ENABLED:-0}"
    assert env["HUB_INGEST_TOKEN"] == "${HUB_INGEST_TOKEN:-}"


def test_production_hub_telegram_and_slack_share_one_root_path_boundary() -> None:
    services = _services("docker-compose.saas.yml")
    for name in ("mira-bot-telegram", "mira-bot-slack"):
        _assert_bot_boundary(
            services[name],
            expected_url="http://mira-hub:3000",
            expected_base_path="",
        )
    _assert_hub_boundary(services["mira-hub"])


def test_vps_staging_hub_and_telegram_share_one_root_path_boundary() -> None:
    services = _services("docker-compose.staging-vps.yml")
    _assert_bot_boundary(
        services["mira-bot-telegram"],
        expected_url="http://stg-mira-hub:3000",
        expected_base_path="",
    )
    _assert_hub_boundary(services["mira-hub"])


def test_standalone_hub_and_bot_compose_keep_the_default_hub_base_path() -> None:
    bot_services = _services("mira-bots/docker-compose.yml")
    for name in ("telegram-bot", "slack-bot"):
        _assert_bot_boundary(
            bot_services[name],
            expected_url="${MIRA_HUB_URL:-http://mira-hub:3000}",
            expected_base_path="${HUB_BASE_PATH:-/hub}",
        )
    _assert_hub_boundary(_services("docker-compose.hub.yml")["mira-hub"])


def test_local_staging_forwards_boundary_but_keeps_it_disabled_by_default() -> None:
    service = _services("docker-compose.staging.yml")["mira-bot-telegram-staging"]
    env = _env(service)
    assert env["MIRA_CHANNEL_WORKFLOW_ENABLED"] == "${MIRA_CHANNEL_WORKFLOW_ENABLED:-0}"
    assert env["HUB_URL"] == "${MIRA_HUB_URL:-http://host.docker.internal:4101}"
    assert env["HUB_BASE_PATH"] == "${HUB_BASE_PATH:-}"
    assert env["HUB_INGEST_TOKEN"] == "${HUB_INGEST_TOKEN:-}"


def test_channel_workflow_environment_is_documented_without_secret_values() -> None:
    docs = (ROOT / "docs/env-vars.md").read_text()
    for name in (
        "MIRA_CHANNEL_WORKFLOW_ENABLED",
        "MIRA_CHANNEL_WORKFLOW_POLL_SECONDS",
        "MIRA_CHANNEL_WORKFLOW_TIMEOUT_SECONDS",
        "HUB_URL",
        "HUB_BASE_PATH",
        "HUB_INGEST_TOKEN",
        "MIRA_TENANT_ID",
    ):
        assert f"`{name}`" in docs
