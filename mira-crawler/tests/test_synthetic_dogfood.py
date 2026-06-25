"""Tests for the synthetic dogfood issue pipeline.

These tests stay offline: no Playwright browser, Redis, or GitHub network.
"""

from __future__ import annotations

from agents.github_issue_reporter import GitHubIssueReporter
from agents.synthetic_dogfood import (
    DogfoodFinding,
    build_issue_body,
    classify_playwright_failure,
    fingerprint_finding,
    parse_playwright_json,
    redact_secrets,
)
from tasks.synthetic_dogfood import CommandResult, DogfoodTaskConfig, run_synthetic_dogfood_once


class FakeGitHubClient:
    def __init__(self, search_items=None):
        self.search_items = search_items or []
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return FakeResponse({"items": self.search_items})

    def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return FakeResponse({"number": 42, "html_url": "https://github.test/issues/42"})

    def patch(self, url, **kwargs):
        self.calls.append(("PATCH", url, kwargs))
        return FakeResponse({"number": 7, "html_url": "https://github.test/issues/7"})


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def _finding(severity: str = "P1", fingerprint: str | None = None) -> DogfoodFinding:
    return DogfoodFinding(
        persona="Carlos",
        surface="hub",
        scenario="asset_detail",
        failure_code="missing-ask-mira-tab",
        severity=severity,
        title="Ask MIRA tab missing for technician",
        expected="Technician can open Ask MIRA on the selected asset.",
        actual="Asset detail loaded but Ask MIRA tab was not visible.",
        evidence={"url": "https://app.factorylm.com/assets/123", "trace": "trace.zip"},
        fingerprint=fingerprint,
    )


def test_redact_secrets_removes_credentials_and_tokens():
    text = (
        "email=carlos@example.com password=TopSecret123! "
        "Authorization: Bearer ghp_1234567890abcdef cookie=next-auth.session-token=abc"
    )

    redacted = redact_secrets(text)

    assert "TopSecret123" not in redacted
    assert "ghp_1234567890abcdef" not in redacted
    assert "next-auth.session-token=abc" not in redacted
    assert "[REDACTED]" in redacted


def test_classify_playwright_failure_promotes_persona_workflow_failures():
    failure = {
        "title": "Carlos (Technician) asset detail page has Ask MIRA tab",
        "error": {
            "message": "Error: expect(locator).toBeVisible() failed: Ask MIRA tab not found"
        },
        "projectName": "chromium",
    }

    finding = classify_playwright_failure(failure)

    assert finding.severity == "P1"
    assert finding.persona == "Carlos"
    assert finding.failure_code == "missing-ask-mira-tab"


def test_classify_playwright_failure_downgrades_transient_network_noise():
    failure = {
        "title": "Dana (Manager) work orders page loads",
        "error": {"message": "net::ERR_CONNECTION_RESET while loading /workorders"},
    }

    finding = classify_playwright_failure(failure)

    assert finding.severity == "P3"
    assert finding.failure_code == "transient-network"


def test_fingerprint_is_stable_and_does_not_include_evidence_values():
    first = _finding()
    second = _finding()
    second.evidence["url"] = "https://app.factorylm.com/assets/other"

    assert fingerprint_finding(first) == fingerprint_finding(second)
    assert "assets/123" not in fingerprint_finding(first)


def test_issue_body_contains_redacted_evidence_and_fingerprint():
    finding = _finding()
    finding.evidence["stderr"] = "password=TopSecret123!"

    body = build_issue_body(finding, run_id="run-001", target_url="https://app.factorylm.com")

    assert "DOGFOOD-FINGERPRINT:" in body
    assert "run-001" in body
    assert "TopSecret123" not in body
    assert "[REDACTED]" in body


def test_parse_playwright_json_extracts_failed_tests():
    payload = {
        "suites": [
            {
                "specs": [
                    {
                        "title": "asset detail page has Ask MIRA tab",
                        "tests": [
                            {
                                "projectName": "chromium",
                                "title": "Carlos (Technician) asset detail page has Ask MIRA tab",
                                "results": [
                                    {
                                        "status": "failed",
                                        "error": {"message": "Ask MIRA tab not found"},
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ]
    }

    findings = parse_playwright_json(payload)

    assert len(findings) == 1
    assert findings[0].persona == "Carlos"
    assert findings[0].severity == "P1"


def test_reporter_creates_new_actionable_issue():
    client = FakeGitHubClient()
    reporter = GitHubIssueReporter(
        token="token",
        repository="Mikecranesync/MIRA",
        client=client,
        dry_run=False,
    )

    action = reporter.report(_finding(fingerprint="fp-123"), run_id="run-001")

    assert action.action == "created"
    assert any(call[0] == "POST" and call[1].endswith("/issues") for call in client.calls)


def test_reporter_comments_on_open_duplicate_without_creating():
    client = FakeGitHubClient(
        search_items=[
            {
                "number": 7,
                "state": "open",
                "html_url": "https://github.test/issues/7",
            }
        ]
    )
    reporter = GitHubIssueReporter(
        token="token",
        repository="Mikecranesync/MIRA",
        client=client,
        dry_run=False,
    )

    action = reporter.report(_finding(fingerprint="fp-123"), run_id="run-001")

    assert action.action == "commented"
    assert not any(call[0] == "POST" and call[1].endswith("/issues") for call in client.calls)
    assert any(call[0] == "POST" and call[1].endswith("/comments") for call in client.calls)


def test_reporter_reopens_closed_p1_duplicate():
    client = FakeGitHubClient(
        search_items=[
            {
                "number": 7,
                "state": "closed",
                "html_url": "https://github.test/issues/7",
            }
        ]
    )
    reporter = GitHubIssueReporter(
        token="token",
        repository="Mikecranesync/MIRA",
        client=client,
        dry_run=False,
    )

    action = reporter.report(_finding(fingerprint="fp-123"), run_id="run-001")

    assert action.action == "reopened"
    assert any(call[0] == "PATCH" and call[1].endswith("/issues/7") for call in client.calls)


def test_reporter_skips_p3_noise():
    client = FakeGitHubClient()
    reporter = GitHubIssueReporter(
        token="token",
        repository="Mikecranesync/MIRA",
        client=client,
        dry_run=False,
    )

    action = reporter.report(_finding(severity="P3", fingerprint="fp-123"), run_id="run-001")

    assert action.action == "skipped"
    assert client.calls == []


def test_task_runner_writes_report_and_reports_actionable_findings(tmp_path):
    playwright_json = {
        "suites": [
            {
                "specs": [
                    {
                        "title": "asset detail page has Ask MIRA tab",
                        "tests": [
                            {
                                "projectName": "chromium",
                                "title": "Carlos (Technician) asset detail page has Ask MIRA tab",
                                "results": [
                                    {
                                        "status": "failed",
                                        "error": {"message": "Ask MIRA tab not found"},
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ]
    }

    class FakeReporter:
        def __init__(self):
            self.reported = []

        def report(self, finding, *, run_id, target_url):
            self.reported.append((finding, run_id, target_url))
            return type("Action", (), {"action": "created", "issue_number": 42, "issue_url": "url"})()

        def close(self):
            return None

    reporter = FakeReporter()

    def fake_runner(command, cwd, env, timeout):
        assert "SYNTHETIC_USERS_ENABLED" in env
        assert env["HUB_URL"] == "https://app.factorylm.com"
        return CommandResult(exit_code=1, stdout=json_dump(playwright_json), stderr="")

    config = DogfoodTaskConfig(
        enabled=True,
        dry_run=False,
        target_url="https://app.factorylm.com",
        hub_dir=str(tmp_path),
        report_dir=str(tmp_path / "reports"),
        github_repository="Mikecranesync/MIRA",
        github_token="token",
    )

    result = run_synthetic_dogfood_once(config, command_runner=fake_runner, reporter=reporter)

    assert result["enabled"] is True
    assert result["total_findings"] == 1
    assert result["actions"]["created"] == 1
    assert reporter.reported[0][0].severity == "P1"
    assert (tmp_path / "reports").exists()
    assert result["raw_report_path"].endswith(".json")


def json_dump(payload):
    import json

    return json.dumps(payload)
