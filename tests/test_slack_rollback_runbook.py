from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_slack_rollback_runbook_has_deploy_and_secret_safe_steps():
    text = (ROOT / "docs/runbooks/slack-recovery-rollback.md").read_text()

    assert "docs/runbooks/slack-recovery-human-testing.md" in text
    assert "gh workflow run deploy-vps.yml" in text
    assert "services='mira-bot-slack'" in text
    assert "git revert" in text
    assert "mira-bots/slack/doctor.py" in text
    assert "doppler run --project factorylm --config prd" in text
    assert "Do not print token values" in text
    assert "SLACK_EXPECTED_BOT_USER_ID" in text


def test_slack_human_testing_guide_covers_core_probes_and_rollback():
    text = (ROOT / "docs/runbooks/slack-recovery-human-testing.md").read_text()

    for probe in (
        "DM `hello`",
        "FactoryLM",
        "factorylm.slack.com",
        "U0AM3EZBSNQ",
        "#all-factorylm",
        "/mira-help",
        "Upload an equipment/nameplate photo",
        "Upload a small non-sensitive PDF",
    ):
        assert probe in text
    assert "docs/runbooks/slack-recovery-rollback.md" in text
    assert "docs/runbooks/slack-production-system-map.md" in text
    assert "Do not use staging" in text


def test_slack_system_map_pins_canonical_production_identity():
    text = (ROOT / "docs/runbooks/slack-production-system-map.md").read_text()

    for expected in (
        "FactoryLM",
        "factorylm.slack.com",
        "T0AK2CU16T1",
        "U0AM3EZBSNQ",
        "B0ALXRE4CDU",
        "#all-factorylm",
        "C0AKBEL8C4T",
        "mira-maintenance-agent (local)",
        "mira-gaq9414.slack.com",
        "SLACK_CLIENT_ID",
        "SLACK_CLIENT_SECRET",
        "SLACK_WEBHOOK_URL",
        "Socket Mode",
    ):
        assert expected in text
