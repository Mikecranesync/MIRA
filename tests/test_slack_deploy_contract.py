from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _workflow_text(name: str) -> str:
    return (ROOT / ".github" / "workflows" / name).read_text()


def test_prod_compose_runs_slack_socket_mode_bot():
    compose = yaml.safe_load((ROOT / "docker-compose.saas.yml").read_text())
    svc = compose["services"]["mira-bot-slack"]
    env = "\n".join(svc["environment"])
    assert svc["build"]["context"] == "./mira-bots"
    assert svc["build"]["dockerfile"] == "slack/Dockerfile"
    assert "SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}" in env
    assert "SLACK_APP_TOKEN=${SLACK_APP_TOKEN}" in env
    assert "SLACK_EXPECTED_BOT_USER_ID=${SLACK_EXPECTED_BOT_USER_ID:-}" in env
    assert svc["restart"] == "unless-stopped"


def test_staging_does_not_run_prod_slack_bot_token():
    staging = (ROOT / "docker-compose.staging-vps.yml").read_text()
    assert "mira-bot-slack:" not in staging
    assert "SLACK_BOT_TOKEN is intentionally omitted" in staging


def test_prod_deploy_default_targets_include_slack_bot():
    workflow = _workflow_text("deploy-vps.yml")
    assert "mira-bot-slack" in workflow
    assert 'TARGETS="${SERVICES:-' in workflow


def test_slack_docker_image_includes_doctor_cli():
    dockerfile = (ROOT / "mira-bots/slack/Dockerfile").read_text()
    assert "slack/doctor.py" in dockerfile


def test_hub_slack_routes_are_present_and_env_documented():
    auth_route = (ROOT / "mira-hub/src/app/api/auth/slack/route.ts").read_text()
    callback_route = (ROOT / "mira-hub/src/app/api/auth/slack/callback/route.ts").read_text()
    status_route = (ROOT / "mira-hub/src/app/api/auth/status/route.ts").read_text()
    env_docs = (ROOT / "docs/env-vars.md").read_text()

    assert "SLACK_CLIENT_ID" in auth_route
    assert "SLACK_BOT_TOKEN" in auth_route
    assert "oauth.v2.access" in callback_route
    assert "bot_user_id" in callback_route
    assert "SLACK_BOT_TOKEN" in status_route
    assert "SLACK_BOT_TOKEN" in env_docs
    assert "SLACK_APP_TOKEN" in env_docs
    assert "SLACK_EXPECTED_BOT_USER_ID" in env_docs
    assert "SLACK_ALLOWED_CHANNELS" in env_docs
    assert "SLACK_SIGNING_SECRET" in env_docs
    assert "SLACK_CLIENT_ID" in env_docs
    assert "SLACK_CLIENT_SECRET" in env_docs
