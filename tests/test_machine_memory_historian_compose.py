"""Static contracts for Machine Memory historian deployment wiring.

These tests deliberately inspect configuration rather than starting containers or
contacting Doppler.  The observable seam is the resolved compose service contract
plus the remote shell program shipped by the staging deploy workflow.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_COMPOSE = ROOT / "docker-compose.saas.yml"
STAGING_COMPOSE = ROOT / "docker-compose.staging-vps.yml"
STAGING_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-staging.yml"
PRODUCTION_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-vps.yml"


def _compose(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _environment(service: dict) -> dict[str, str]:
    environment = service.get("environment") or {}
    if isinstance(environment, dict):
        return {str(key): str(value) for key, value in environment.items()}

    result: dict[str, str] = {}
    for item in environment:
        key, separator, value = str(item).partition("=")
        if separator:
            result[key] = value
    return result


def _default_targets(workflow: str) -> list[str]:
    match = re.search(r'TARGETS="\$\{SERVICES:-([^}]*)\}"', workflow)
    assert match, "deploy-staging.yml no longer declares an explicit default TARGETS set"
    return match.group(1).split()


def _doppler_compose_invocations(workflow: str, compose_file: str) -> list[str]:
    """Return logical shell lines where Doppler wraps the selected Compose file."""
    logical_lines = re.sub(r"\\\r?\n\s*", " ", workflow)
    return [
        line.strip()
        for line in logical_lines.splitlines()
        if "doppler run" in line and f"docker compose -f {compose_file}" in line
    ]


def _build_and_up_invocations(invocations: list[str], compose_file: str) -> list[str]:
    command = re.compile(rf"docker compose -f {re.escape(compose_file)} (?:build|up)\b")
    return [invocation for invocation in invocations if command.search(invocation)]


def test_production_historian_worker_forwards_heartbeat_identity_and_config() -> None:
    services = _compose(PRODUCTION_COMPOSE)["services"]
    worker = services["mira-historian-worker"]
    environment = _environment(worker)

    expected = {
        "CELERY_BROKER_URL": "redis://mira-redis:6379/0",
        "CELERY_RESULT_BACKEND": "redis://mira-redis:6379/1",
        "MIRA_DEPLOYMENT_ENVIRONMENT": "production",
        "MIRA_GIT_SHA": "${MIRA_GIT_SHA:-unknown}",
        "NEON_DATABASE_URL": "${NEON_DATABASE_URL:-}",
        "MIRA_TENANT_ID": "${MIRA_TENANT_ID:-}",
        "TAG_DIFF_CONFIG_JSON": "${TAG_DIFF_CONFIG_JSON:-}",
        "MIRA_RUN_DIFF_ENABLED": "${MIRA_RUN_DIFF_ENABLED:-0}",
        "MIRA_RUN_TRIGGERS": "${MIRA_RUN_TRIGGERS:-}",
        "MIRA_MACHINE_MEMORY_UNS_PATHS": "${MIRA_MACHINE_MEMORY_UNS_PATHS:-}",
    }
    assert {name: environment.get(name) for name in expected} == expected
    assert "--concurrency=1 -Q historian" in worker["command"]
    assert worker["depends_on"]["mira-redis"]["condition"] == "service_healthy"
    assert worker["networks"] == ["mira-net"]
    assert worker["restart"] == "unless-stopped"


def test_staging_historian_services_are_isolated_and_fail_closed() -> None:
    compose = _compose(STAGING_COMPOSE)
    services = compose["services"]

    redis = services["stg-mira-redis"]
    assert redis["image"] == "redis:7.4.2-alpine"
    assert redis["container_name"] == "stg-mira-redis"
    assert redis["volumes"] == ["stg-mira-redis-data:/data"]
    assert redis["networks"] == ["staging-net"]
    assert redis["restart"] == "unless-stopped"
    assert redis["healthcheck"]["test"] == ["CMD", "redis-cli", "ping"]
    assert "stg-mira-redis-data" in compose["volumes"]
    assert "mira-redis-data" not in compose["volumes"]

    worker = services["stg-mira-historian-worker"]
    assert worker["container_name"] == "stg-mira-historian-worker"
    assert worker["build"]["dockerfile"] == "mira-crawler/Dockerfile.celery"
    assert "--concurrency=1 -Q historian" in worker["command"]
    assert worker["depends_on"] == {
        "stg-mira-redis": {"condition": "service_healthy"}
    }
    assert worker["networks"] == ["staging-net"]
    assert worker["restart"] == "unless-stopped"

    environment = _environment(worker)
    expected = {
        "CELERY_BROKER_URL": "redis://stg-mira-redis:6379/0",
        "CELERY_RESULT_BACKEND": "redis://stg-mira-redis:6379/1",
        "MIRA_DEPLOYMENT_ENVIRONMENT": "staging",
        "MIRA_GIT_SHA": "${MIRA_GIT_SHA:-unknown}",
        "NEON_DATABASE_URL": "${NEON_DATABASE_URL:-}",
        "MIRA_TENANT_ID": "${MIRA_TENANT_ID:-}",
        "TAG_DIFF_CONFIG_JSON": "${TAG_DIFF_CONFIG_JSON:-}",
        "MIRA_RUN_DIFF_ENABLED": "${MIRA_RUN_DIFF_ENABLED:-0}",
        "MIRA_RUN_TRIGGERS": "${MIRA_RUN_TRIGGERS:-}",
        "MIRA_MACHINE_MEMORY_UNS_PATHS": "${MIRA_MACHINE_MEMORY_UNS_PATHS:-}",
    }
    assert {name: environment.get(name) for name in expected} == expected

    beat = services["stg-mira-historian-beat"]
    assert beat["container_name"] == "stg-mira-historian-beat"
    assert beat["build"]["dockerfile"] == "mira-crawler/Dockerfile.celery"
    assert beat["depends_on"] == {
        "stg-mira-redis": {"condition": "service_healthy"}
    }
    assert beat["networks"] == ["staging-net"]
    assert beat["restart"] == "unless-stopped"
    assert _environment(beat) == {
        "CELERY_BROKER_URL": "redis://stg-mira-redis:6379/0",
        "CELERY_RESULT_BACKEND": "redis://stg-mira-redis:6379/1",
        "CELERY_BEAT_PROFILE": "historian",
    }


def test_staging_historian_never_borrows_production_configuration() -> None:
    services = _compose(STAGING_COMPOSE)["services"]
    names = ("stg-mira-redis", "stg-mira-historian-worker", "stg-mira-historian-beat")

    for name in names:
        assert services[name]["networks"] == ["staging-net"]
        serialized = json.dumps(services[name], sort_keys=True)
        assert not re.search(r"(?:PROD(?:UCTION)?)[A-Z0-9_]*", serialized, re.IGNORECASE)
        assert "redis://mira-redis:" not in serialized

def test_missing_sha_remains_unknown_in_compose_instead_of_being_fabricated() -> None:
    production = _compose(PRODUCTION_COMPOSE)["services"]["mira-historian-worker"]
    staging = _compose(STAGING_COMPOSE)["services"]["stg-mira-historian-worker"]

    for service in (production, staging):
        sha = _environment(service)["MIRA_GIT_SHA"]
        assert sha == "${MIRA_GIT_SHA:-unknown}"
        assert "GITHUB_SHA" not in sha


def test_staging_workflow_exports_exact_checked_out_sha_before_compose() -> None:
    workflow = STAGING_WORKFLOW.read_text(encoding="utf-8")
    reset = workflow.index("git reset --hard")
    sha_export = workflow.index('export MIRA_GIT_SHA="$(git rev-parse HEAD)"')
    sha_check = workflow.index("^[0-9a-f]{40}$")
    first_build = workflow.index("docker compose -f docker-compose.staging-vps.yml build")
    first_up = workflow.index("docker compose -f docker-compose.staging-vps.yml up -d")

    assert reset < sha_export < sha_check < first_build
    assert sha_check < first_up
    assert "git rev-parse --short" not in workflow
    assert "MIRA_GIT_SHA=${GITHUB_SHA" not in workflow


def test_staging_workflow_targets_and_reports_all_historian_services() -> None:
    workflow = STAGING_WORKFLOW.read_text(encoding="utf-8")
    workflow_document = yaml.safe_load(workflow)
    required = {
        "stg-mira-redis",
        "stg-mira-historian-worker",
        "stg-mira-historian-beat",
    }

    assert required <= set(_default_targets(workflow))
    status_invocations = re.findall(
        r"docker compose -f docker-compose\.staging-vps\.yml ps\s+([^\n]+)", workflow
    )
    assert any(required <= set(arguments.split()) for arguments in status_invocations), (
        "deploy-staging.yml lacks explicit historian service status output"
    )
    assert workflow_document["jobs"]["deploy"]["environment"] == "staging"
    assert "Production mira-* containers still running" in workflow


def test_staging_compose_calls_preserve_checked_out_sha_and_never_use_prd() -> None:
    workflow = STAGING_WORKFLOW.read_text(encoding="utf-8")
    invocations = _doppler_compose_invocations(workflow, "docker-compose.staging-vps.yml")
    relevant = _build_and_up_invocations(invocations, "docker-compose.staging-vps.yml")

    assert len(relevant) == 3, "expected staging build, full up, and force-recreate up"
    assert all('--preserve-env="MIRA_GIT_SHA"' in invocation for invocation in relevant)
    assert all("--config stg" in invocation for invocation in invocations)
    assert all("--config prd" not in invocation for invocation in invocations)
    assert "--preserve-env=true" not in workflow


def test_production_build_and_up_calls_preserve_exported_sha_narrowly() -> None:
    workflow = PRODUCTION_WORKFLOW.read_text(encoding="utf-8")
    invocations = _doppler_compose_invocations(workflow, "docker-compose.saas.yml")
    relevant = _build_and_up_invocations(invocations, "docker-compose.saas.yml")

    assert len(relevant) == 3, "expected production build, swap up, and recovery up"
    assert all('--preserve-env="MIRA_GIT_SHA"' in invocation for invocation in relevant)
    assert all("--config prd" in invocation for invocation in relevant)
    assert "--preserve-env=true" not in workflow


def test_production_default_targets_include_historian_worker_and_beat() -> None:
    """Would catch a normal production deploy leaving the heartbeat services stale."""
    workflow = PRODUCTION_WORKFLOW.read_text(encoding="utf-8")
    assert {"mira-historian-worker", "mira-historian-beat"} <= set(_default_targets(workflow))


def test_historian_and_redis_stanzas_do_not_reuse_dogfood_wiring() -> None:
    production = _compose(PRODUCTION_COMPOSE)["services"]
    staging = _compose(STAGING_COMPOSE)["services"]
    owned_services = (
        production["mira-historian-worker"],
        staging["stg-mira-redis"],
        staging["stg-mira-historian-worker"],
        staging["stg-mira-historian-beat"],
    )

    for service in owned_services:
        assert "dogfood" not in json.dumps(service, sort_keys=True).lower()
