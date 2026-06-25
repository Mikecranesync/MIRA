"""Synthetic dogfood finding helpers.

The Celery task owns process execution. This module keeps the finding model,
redaction, Playwright result parsing, and issue text generation pure enough to
test without Redis, browsers, or GitHub.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


ACTIONABLE_SEVERITIES = {"P0", "P1", "P2"}

_PERSONA_RE = re.compile(r"\b(Carlos|Dana|Jordan|Pat|Plant Manager|CFO)\b", re.IGNORECASE)
_SECRET_PATTERNS = [
    re.compile(r"(?i)(password\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"(?i)(authorization\s*:\s*bearer\s+)([A-Za-z0-9._\-]+)"),
    re.compile(r"(?i)(cookie\s*[:=]\s*)([^\r\n]+)"),
    re.compile(r"(?i)(next-auth\.[A-Za-z0-9._\-]+\s*=\s*)([^\s,;]+)"),
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{10,})\b"),
    re.compile(r"\b(sk_(?:live|test)_[A-Za-z0-9_]{10,})\b"),
]


@dataclass(slots=True)
class DogfoodFinding:
    persona: str
    surface: str
    scenario: str
    failure_code: str
    severity: str
    title: str
    expected: str
    actual: str
    evidence: dict[str, Any] = field(default_factory=dict)
    fingerprint: str | None = None
    labels: list[str] = field(default_factory=list)

    def resolved_fingerprint(self) -> str:
        if self.fingerprint:
            return self.fingerprint
        self.fingerprint = fingerprint_finding(self)
        return self.fingerprint


@dataclass(slots=True)
class DogfoodRunSummary:
    run_id: str
    target_url: str
    started_at: str
    finished_at: str
    exit_code: int
    findings: list[DogfoodFinding]
    raw_report_path: str | None = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def redact_secrets(value: Any) -> str:
    """Return a printable string with likely credentials removed."""
    text = value if isinstance(value, str) else json.dumps(value, sort_keys=True, default=str)
    redacted = text
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub(lambda m: _redact_match(m), redacted)
    return redacted


def _redact_match(match: re.Match[str]) -> str:
    if match.lastindex and match.lastindex >= 2:
        return f"{match.group(1)}[REDACTED]"
    return "[REDACTED]"


def fingerprint_finding(finding: DogfoodFinding) -> str:
    """Stable dedupe key that avoids evidence URLs, traces, and secrets."""
    raw = "|".join(
        [
            finding.persona.lower().strip(),
            finding.surface.lower().strip(),
            finding.scenario.lower().strip(),
            finding.failure_code.lower().strip(),
        ]
    )
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"synthetic-dogfood:{digest}"


def classify_playwright_failure(test_failure: dict[str, Any]) -> DogfoodFinding:
    """Map a failed Playwright test result to a product finding."""
    title = str(test_failure.get("title") or test_failure.get("name") or "synthetic dogfood failure")
    error = test_failure.get("error") or {}
    message = str(error.get("message") if isinstance(error, dict) else error)
    combined = f"{title}\n{message}"
    combined_lower = combined.lower()

    persona = _infer_persona(combined)
    surface = "hub"
    scenario = _infer_scenario(combined_lower)
    failure_code = _infer_failure_code(combined_lower)
    severity = _infer_severity(combined_lower, failure_code)

    expected = _expected_for_failure(failure_code, scenario)
    actual = _shorten(message or title, 500)
    finding = DogfoodFinding(
        persona=persona,
        surface=surface,
        scenario=scenario,
        failure_code=failure_code,
        severity=severity,
        title=_build_human_title(persona, scenario, failure_code),
        expected=expected,
        actual=actual,
        evidence={
            "playwright_title": title,
            "project": test_failure.get("projectName") or test_failure.get("project"),
            "error": message,
        },
    )
    finding.fingerprint = fingerprint_finding(finding)
    return finding


def parse_playwright_json(payload: dict[str, Any]) -> list[DogfoodFinding]:
    """Extract failed tests from Playwright's JSON reporter payload."""
    findings: list[DogfoodFinding] = []
    for suite in _walk_suites(payload.get("suites") or []):
        for spec in suite.get("specs") or []:
            spec_title = str(spec.get("title") or "")
            for test in spec.get("tests") or []:
                test_title = str(test.get("title") or spec_title)
                project_name = test.get("projectName") or test.get("project")
                for result in test.get("results") or []:
                    status = result.get("status")
                    if status not in {"failed", "timedOut", "interrupted"}:
                        continue
                    failure = {
                        "title": test_title or spec_title,
                        "projectName": project_name,
                        "error": result.get("error") or _first_error(result.get("errors")),
                    }
                    findings.append(classify_playwright_failure(failure))
    return _dedupe_findings(findings)


def build_issue_title(finding: DogfoodFinding) -> str:
    return f"[{finding.severity}] Synthetic dogfood: {finding.title}"


def build_issue_body(
    finding: DogfoodFinding,
    *,
    run_id: str,
    target_url: str,
    generated_at: str | None = None,
) -> str:
    generated_at = generated_at or utc_now_iso()
    fingerprint = finding.resolved_fingerprint()
    evidence = redact_secrets(finding.evidence)
    actual = redact_secrets(finding.actual)
    expected = redact_secrets(finding.expected)
    return "\n".join(
        [
            "## Synthetic Dogfood Finding",
            "",
            f"- Severity: `{finding.severity}`",
            f"- Persona: `{finding.persona}`",
            f"- Surface: `{finding.surface}`",
            f"- Scenario: `{finding.scenario}`",
            f"- Failure code: `{finding.failure_code}`",
            f"- Run ID: `{run_id}`",
            f"- Target: `{target_url}`",
            f"- Generated: `{generated_at}`",
            "",
            "## Expected",
            "",
            expected,
            "",
            "## Actual",
            "",
            actual,
            "",
            "## Evidence",
            "",
            "```json",
            evidence,
            "```",
            "",
            f"<!-- DOGFOOD-FINGERPRINT: {fingerprint} -->",
        ]
    )


def summarize_findings(findings: list[DogfoodFinding]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.severity] = counts.get(finding.severity, 0) + 1
    return {
        "total": len(findings),
        "by_severity": counts,
        "actionable": sum(1 for finding in findings if finding.severity in ACTIONABLE_SEVERITIES),
    }


def _walk_suites(suites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    walked: list[dict[str, Any]] = []
    for suite in suites:
        walked.append(suite)
        walked.extend(_walk_suites(suite.get("suites") or []))
    return walked


def _first_error(errors: Any) -> dict[str, Any]:
    if isinstance(errors, list) and errors:
        first = errors[0]
        if isinstance(first, dict):
            return first
        return {"message": str(first)}
    return {}


def _infer_persona(text: str) -> str:
    match = _PERSONA_RE.search(text)
    if not match:
        return "Synthetic User"
    raw = match.group(1).lower()
    if raw == "plant manager":
        return "Jordan"
    if raw == "cfo":
        return "Pat"
    return raw.title()


def _infer_scenario(text: str) -> str:
    if "login" in text or "sign in" in text:
        return "login"
    if "asset detail" in text or "ask mira" in text:
        return "asset_detail"
    if "asset" in text:
        return "assets"
    if "work order" in text or "work-orders" in text or "workorders" in text:
        return "work_orders"
    if "schedule" in text or "pm " in text:
        return "pm_schedule"
    if "chat" in text or "sse" in text:
        return "chat"
    return "general"


def _infer_failure_code(text: str) -> str:
    if "err_connection" in text or "econnreset" in text or "timeout" in text:
        return "transient-network"
    if "login failed" in text or "incorrect" in text or "invalid" in text:
        return "persona-login-failed"
    if "ask mira" in text and ("not found" in text or "not visible" in text or "tobevisible" in text):
        return "missing-ask-mira-tab"
    if "500" in text or "server error" in text:
        return "server-error"
    if "401" in text or "unauthorized" in text:
        return "auth-guard"
    if "not visible" in text or "not found" in text:
        return "missing-ui-element"
    return "workflow-failed"


def _infer_severity(text: str, failure_code: str) -> str:
    if failure_code == "transient-network":
        return "P3"
    if failure_code in {"persona-login-failed", "server-error"}:
        return "P1"
    if failure_code == "missing-ask-mira-tab":
        return "P1"
    if "api:" in text or failure_code == "auth-guard":
        return "P2"
    return "P2"


def _expected_for_failure(failure_code: str, scenario: str) -> str:
    if failure_code == "persona-login-failed":
        return "Provisioned synthetic personas can sign in to the target Hub without developer help."
    if failure_code == "missing-ask-mira-tab":
        return "A technician can reach the Ask MIRA workflow from the selected asset detail page."
    if failure_code == "server-error":
        return "The Hub workflow should load without a 500 or uncaught server error."
    if failure_code == "transient-network":
        return "The synthetic dogfood run should complete without transient network failures."
    return f"The synthetic persona can complete the `{scenario}` workflow."


def _build_human_title(persona: str, scenario: str, failure_code: str) -> str:
    readable = failure_code.replace("-", " ")
    return f"{persona} {scenario.replace('_', ' ')} - {readable}"


def _shorten(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _dedupe_findings(findings: list[DogfoodFinding]) -> list[DogfoodFinding]:
    seen: set[str] = set()
    unique: list[DogfoodFinding] = []
    for finding in findings:
        fp = finding.resolved_fingerprint()
        if fp in seen:
            continue
        seen.add(fp)
        unique.append(finding)
    return unique
