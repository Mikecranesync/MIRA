from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from check_agent_identity import (  # noqa: E402
    extract_markers,
    validate_commit_messages,
    validate_identity,
    validate_metadata,
    validate_role,
)


def test_accepts_valid_multi_machine_identity() -> None:
    assert validate_identity("codex/charlie/2026-08-18-pr3302") == []
    assert validate_identity("hermes/bravo/session-42") == []


def test_rejects_malformed_identity() -> None:
    assert validate_identity("Codex/Charlie/session")
    assert validate_identity("codex/charlie")
    assert validate_identity("codex/charlie/session with spaces")


def test_codex_cannot_claim_implementation_role() -> None:
    assert validate_role("codex/charlie/session", "implementation")
    assert validate_role("codex/charlie/session", "review") == []


def test_human_authorization_allows_codex_governance_implementation() -> None:
    body = """Agent-Identity: codex/charlie/session
Agent-Role: implementation
Human-Owner: @mikecranesync
Human-Authorization: @mikecranesync authorized Codex to implement this governance PR
"""
    assert validate_metadata(
        extract_markers(body),
        "pull request body",
        allow_codex_implementation=True,
    ) == []


def test_extracts_required_pr_markers() -> None:
    body = """Agent-Identity: claude/alpha/session-7
Agent-Role: implementation
Human-Owner: @mikecranesync
"""
    assert extract_markers(body) == {
        "Agent-Identity": "claude/alpha/session-7",
        "Agent-Role": "implementation",
        "Human-Owner": "@mikecranesync",
    }


def test_validates_every_commit_message() -> None:
    messages = [
        "feat: add policy\n\nAgent-Identity: claude/alpha/session-7\nAgent-Role: implementation\n",
        "docs: explain policy\n\nAgent-Identity: claude/alpha/session-7\nAgent-Role: implementation\n",
    ]
    assert validate_commit_messages(messages, allow_codex_implementation=False) == []


def test_reports_commit_without_identity() -> None:
    errors = validate_commit_messages(["docs: missing trailer\n\nAgent-Role: implementation\n"])
    assert any("missing Agent-Identity" in error for error in errors)
