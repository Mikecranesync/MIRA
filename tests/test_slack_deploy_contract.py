from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _workflow_text(name: str) -> str:
    return (ROOT / ".github" / "workflows" / name).read_text()


def test_prod_compose_runs_slack_socket_mode_bot():
    compose = yaml.safe_load((ROOT / "docker-compose.saas.yml").read_text())
    svc = compose["services"]["mira-bot-slack"]
    env = "\n".join(svc["environment"])
    assert svc["build"]["context"] == "."
    assert svc["build"]["dockerfile"] == "mira-bots/slack/Dockerfile"
    assert "SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}" in env
    assert "SLACK_APP_TOKEN=${SLACK_APP_TOKEN}" in env
    assert "SLACK_EXPECTED_BOT_USER_ID=${SLACK_EXPECTED_BOT_USER_ID:-}" in env
    assert "OPENAI_API_KEY=${OPENAI_API_KEY:-}" in env
    assert "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" in env
    assert "PRINT_VISION_PROVIDER=${PRINT_VISION_PROVIDER:-openai}" in env
    assert "PRINT_VISION_EFFORT=${PRINT_VISION_EFFORT:-xhigh}" in env
    assert "PRINT_VISION_MODEL=${PRINT_VISION_MODEL:-}" in env
    assert "PRINT_VISION_MAX_TOKENS=${PRINT_VISION_MAX_TOKENS:-}" in env
    assert "PRINT_BENCH_BUDGET_USD=${PRINT_BENCH_BUDGET_USD:-}" in env
    assert "PRINT_AUTOEVAL_ENABLED=${PRINT_AUTOEVAL_ENABLED:-}" in env
    assert "PRINT_THEORY_MAX_TOKENS=${PRINT_THEORY_MAX_TOKENS:-2000}" in env
    assert "MIRA_PROCESS_TIMEOUT=${MIRA_PROCESS_TIMEOUT:-60}" in env
    assert "OCR_MODEL_LANE=${OCR_MODEL_LANE:-off}" in env
    assert "OCR_EXPECT_TESSERACT=${OCR_EXPECT_TESSERACT:-1}" in env
    assert svc["restart"] == "unless-stopped"


def test_staging_does_not_run_prod_slack_bot_token():
    staging = (ROOT / "docker-compose.staging-vps.yml").read_text()
    assert "mira-bot-slack:" not in staging
    assert "SLACK_BOT_TOKEN is intentionally omitted" in staging


def test_local_compose_slack_is_dev_profile_and_root_context():
    compose = yaml.safe_load((ROOT / "mira-bots/docker-compose.yml").read_text())
    svc = compose["services"]["slack-bot"]
    env = svc["environment"]

    assert "slack-dev" in svc.get("profiles", [])
    assert svc["build"]["context"] == ".."
    assert svc["build"]["dockerfile"] == "mira-bots/slack/Dockerfile"
    assert env["OPENAI_API_KEY"] == "${OPENAI_API_KEY:-}"
    assert env["PRINT_VISION_PROVIDER"] == "${PRINT_VISION_PROVIDER:-openai}"
    assert env["PRINT_THEORY_MAX_TOKENS"] == "${PRINT_THEORY_MAX_TOKENS:-2000}"
    assert env["MIRA_PROCESS_TIMEOUT"] == "${MIRA_PROCESS_TIMEOUT:-60}"
    assert env["OCR_MODEL_LANE"] == "${OCR_MODEL_LANE:-off}"


def test_prod_deploy_default_targets_include_slack_bot():
    workflow = _workflow_text("deploy-vps.yml")
    assert "mira-bot-slack" in workflow
    assert 'TARGETS="${SERVICES:-' in workflow


def test_slack_docker_image_includes_doctor_cli():
    dockerfile = (ROOT / "mira-bots/slack/Dockerfile").read_text()
    assert "mira-bots/slack/doctor.py" in dockerfile


def test_slack_docker_image_ships_printsense_like_telegram():
    dockerfile = (ROOT / "mira-bots/slack/Dockerfile").read_text()
    requirements = (ROOT / "mira-bots/slack/requirements.txt").read_text()

    assert "COPY mira-bots/shared/ ./shared/" in dockerfile
    assert "COPY printsense/ ./printsense/" in dockerfile
    assert "COPY mira-bots/prompts/ ./prompts/" in dockerfile
    assert "COPY VERSION ." in dockerfile
    assert "pytesseract>=0.3.13" in requirements
    assert "pydantic>=2.0" in requirements
    assert "anthropic>=" in requirements
    assert "openai>=" in requirements


def test_ci_builds_slack_image_from_repo_root():
    workflow = _workflow_text("ci.yml")

    assert "-f mira-bots/slack/Dockerfile . \\" in workflow
    assert "-f mira-bots/slack/Dockerfile mira-bots/ \\" not in workflow


def test_slack_healthcheck_proves_printsense_ocr_imports():
    compose = yaml.safe_load((ROOT / "docker-compose.saas.yml").read_text())
    svc = compose["services"]["mira-bot-slack"]
    healthcheck = " ".join(svc["healthcheck"]["test"])

    assert "printsense" in healthcheck
    assert "pytesseract" in healthcheck
    assert "ocr_lane_report" in healthcheck


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
