"""GitHub issue reporter for synthetic dogfood findings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from agents.synthetic_dogfood import (
    ACTIONABLE_SEVERITIES,
    DogfoodFinding,
    build_issue_body,
    build_issue_title,
)


@dataclass(slots=True)
class IssueAction:
    action: str
    issue_number: int | None = None
    issue_url: str | None = None
    reason: str | None = None


class GitHubIssueReporter:
    """Create, comment, or reopen GitHub issues with fingerprint dedupe."""

    def __init__(
        self,
        *,
        token: str | None,
        repository: str,
        client: Any | None = None,
        dry_run: bool = True,
        base_url: str = "https://api.github.com",
        labels: list[str] | None = None,
    ) -> None:
        self.token = token
        self.repository = repository
        self.owner, self.repo = repository.split("/", 1)
        self.base_url = base_url.rstrip("/")
        self.dry_run = dry_run
        self.labels = labels if labels is not None else ["bug", "needs-triage"]
        self.client = client or httpx.Client(timeout=30, headers=self._headers())

    def report(
        self,
        finding: DogfoodFinding,
        *,
        run_id: str,
        target_url: str = "",
    ) -> IssueAction:
        if finding.severity not in ACTIONABLE_SEVERITIES:
            return IssueAction("skipped", reason=f"{finding.severity} findings are report-only")

        fingerprint = finding.resolved_fingerprint()
        if self.dry_run:
            return IssueAction("dry_run", reason=f"would report {fingerprint}")

        if not self.token:
            return IssueAction("skipped", reason="GITHUB_ISSUE_TOKEN is not set")

        existing = self._find_existing(fingerprint)
        body = build_issue_body(finding, run_id=run_id, target_url=target_url)
        if existing:
            number = int(existing["number"])
            html_url = existing.get("html_url")
            if existing.get("state") == "closed" and finding.severity in {"P0", "P1"}:
                self._patch_issue(number, {"state": "open"})
                self._comment_issue(number, self._rerun_comment(finding, run_id))
                return IssueAction("reopened", issue_number=number, issue_url=html_url)
            self._comment_issue(number, self._rerun_comment(finding, run_id))
            return IssueAction("commented", issue_number=number, issue_url=html_url)

        created = self._create_issue(
            {
                "title": build_issue_title(finding),
                "body": body,
                "labels": self._labels_for(finding),
            }
        )
        return IssueAction(
            "created",
            issue_number=created.get("number"),
            issue_url=created.get("html_url"),
        )

    def close(self) -> None:
        close = getattr(self.client, "close", None)
        if close:
            close()

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "mira-synthetic-dogfood",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _find_existing(self, fingerprint: str) -> dict[str, Any] | None:
        query = quote(f'repo:{self.repository} "{fingerprint}" in:body,title')
        response = self.client.get(f"{self.base_url}/search/issues?q={query}", headers=self._headers())
        response.raise_for_status()
        items = response.json().get("items") or []
        return items[0] if items else None

    def _create_issue(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/repos/{self.owner}/{self.repo}/issues",
            headers=self._headers(),
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    def _comment_issue(self, issue_number: int, body: str) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/repos/{self.owner}/{self.repo}/issues/{issue_number}/comments",
            headers=self._headers(),
            json={"body": body},
        )
        response.raise_for_status()
        return response.json()

    def _patch_issue(self, issue_number: int, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.client.patch(
            f"{self.base_url}/repos/{self.owner}/{self.repo}/issues/{issue_number}",
            headers=self._headers(),
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    def _labels_for(self, finding: DogfoodFinding) -> list[str]:
        labels = list(dict.fromkeys([*self.labels, finding.severity, *finding.labels]))
        return [label for label in labels if label]

    def _rerun_comment(self, finding: DogfoodFinding, run_id: str) -> str:
        return "\n".join(
            [
                "Synthetic dogfood reproduced this finding.",
                "",
                f"- Run ID: `{run_id}`",
                f"- Severity: `{finding.severity}`",
                f"- Fingerprint: `{finding.resolved_fingerprint()}`",
            ]
        )
