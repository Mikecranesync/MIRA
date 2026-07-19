from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_slack_rollback_runbook_has_deploy_and_secret_safe_steps():
    text = (ROOT / "docs/runbooks/slack-recovery-rollback.md").read_text()

    assert "gh workflow run deploy-vps.yml" in text
    assert "services='mira-bot-slack'" in text
    assert "git revert" in text
    assert "mira-bots/slack/doctor.py" in text
    assert "doppler run --project factorylm --config prd" in text
    assert "Do not print token values" in text
    assert "SLACK_EXPECTED_BOT_USER_ID" in text
