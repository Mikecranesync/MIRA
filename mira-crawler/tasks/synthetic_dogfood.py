"""Celery task for synthetic persona dogfooding.

This task runs the existing Hub Playwright synthetic-day suite, parses JSON
reporter output, and sends actionable findings to GitHub with fingerprint
dedupe. It is disabled by default and should be enabled only for a seeded QA
tenant.
"""

from __future__ import annotations

import json
import os
import shutil
import shlex
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

class _OfflineTaskApp:
    def task(self, *args: Any, **kwargs: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return func

        return decorator


try:
    from mira_crawler.celery_app import app
except (ImportError, ModuleNotFoundError):
    try:
        from celery_app import app
    except (ImportError, ModuleNotFoundError):
        app = _OfflineTaskApp()

from agents.github_issue_reporter import GitHubIssueReporter, IssueAction
from agents.synthetic_dogfood import (
    DogfoodFinding,
    parse_playwright_json,
    summarize_findings,
    utc_now_iso,
)


DEFAULT_PLAYWRIGHT_COMMAND = [
    "npx",
    "playwright",
    "test",
    "tests/e2e/synthetic-day.spec.ts",
    "--project=chromium",
    "--reporter=json",
]


@dataclass
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str


@dataclass
class DogfoodTaskConfig:
    enabled: bool
    dry_run: bool
    target_url: str
    hub_dir: str
    report_dir: str
    github_repository: str
    github_token: str | None
    command: list[str] | None = None
    timeout_seconds: int = 600

    @classmethod
    def from_env(cls) -> "DogfoodTaskConfig":
        issue_mode = os.getenv("DOGFOOD_ISSUE_MODE", "dry_run").strip().lower()
        return cls(
            enabled=os.getenv("SYNTHETIC_DOGFOOD_ENABLED") == "1",
            dry_run=issue_mode != "write",
            target_url=os.getenv("DOGFOOD_TARGET_URL", os.getenv("HUB_URL", "https://app.factorylm.com")),
            hub_dir=os.getenv("DOGFOOD_HUB_DIR", "/app/mira-hub"),
            report_dir=os.getenv("DOGFOOD_REPORT_DIR", "/mira-db/synthetic-dogfood"),
            github_repository=os.getenv("GITHUB_REPOSITORY", "Mikecranesync/MIRA"),
            github_token=os.getenv("GITHUB_ISSUE_TOKEN") or os.getenv("GITHUB_TOKEN"),
            command=_command_from_env(),
            timeout_seconds=int(os.getenv("DOGFOOD_TIMEOUT_SECONDS", "600")),
        )


CommandRunner = Callable[[list[str], str, dict[str, str], int], CommandResult]


@app.task(name="tasks.synthetic_dogfood.run_synthetic_dogfood_cycle")
def run_synthetic_dogfood_cycle() -> dict[str, Any]:
    """Run one synthetic dogfood pass and report actionable findings."""
    return run_synthetic_dogfood_once(DogfoodTaskConfig.from_env())


def run_synthetic_dogfood_once(
    config: DogfoodTaskConfig,
    *,
    command_runner: CommandRunner | None = None,
    reporter: GitHubIssueReporter | Any | None = None,
) -> dict[str, Any]:
    run_id = f"dogfood-{uuid.uuid4().hex[:12]}"
    started_at = utc_now_iso()
    if not config.enabled:
        return {
            "enabled": False,
            "run_id": run_id,
            "reason": "SYNTHETIC_DOGFOOD_ENABLED is not 1",
        }

    report_dir = Path(config.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    command = config.command or DEFAULT_PLAYWRIGHT_COMMAND
    runner = command_runner or _run_command
    env = _build_env(config)

    try:
        command_result = runner(command, config.hub_dir, env, config.timeout_seconds)
    except FileNotFoundError as exc:
        command_result = CommandResult(exit_code=127, stdout="", stderr=str(exc))
    except subprocess.TimeoutExpired as exc:
        command_result = CommandResult(
            exit_code=124,
            stdout=(exc.stdout or "") if isinstance(exc.stdout, str) else "",
            stderr=(exc.stderr or "") if isinstance(exc.stderr, str) else str(exc),
        )

    raw_report_path = _write_raw_report(report_dir, run_id, command_result)
    findings = _findings_from_command_result(command_result)
    actions = _report_findings(
        findings,
        config=config,
        run_id=run_id,
        reporter=reporter,
    )
    summary_path = _write_summary(
        report_dir,
        run_id,
        {
            "enabled": True,
            "run_id": run_id,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "exit_code": command_result.exit_code,
            "target_url": config.target_url,
            "dry_run": config.dry_run,
            "raw_report_path": str(raw_report_path),
            "summary": summarize_findings(findings),
            "actions": actions,
        },
    )

    return {
        "enabled": True,
        "run_id": run_id,
        "exit_code": command_result.exit_code,
        "target_url": config.target_url,
        "dry_run": config.dry_run,
        "total_findings": len(findings),
        "actions": _count_actions(actions),
        "raw_report_path": str(raw_report_path),
        "summary_path": str(summary_path),
    }


def _command_from_env() -> list[str] | None:
    raw = os.getenv("DOGFOOD_PLAYWRIGHT_COMMAND")
    if not raw:
        return None
    return shlex.split(raw)


def _build_env(config: DogfoodTaskConfig) -> dict[str, str]:
    env = dict(os.environ)
    env["HUB_URL"] = config.target_url
    env["SYNTHETIC_USERS_ENABLED"] = "1"
    return env


def _run_command(command: list[str], cwd: str, env: dict[str, str], timeout: int) -> CommandResult:
    command = _resolve_command(command)
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return CommandResult(
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def _resolve_command(command: list[str]) -> list[str]:
    if not command:
        return command
    executable = shutil.which(command[0])
    if not executable:
        return command
    return [executable, *command[1:]]


def _write_raw_report(report_dir: Path, run_id: str, result: CommandResult) -> Path:
    path = report_dir / f"{run_id}.json"
    payload = {
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": _trim(result.stderr, 20_000),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def _write_summary(report_dir: Path, run_id: str, payload: dict[str, Any]) -> Path:
    path = report_dir / f"{run_id}.summary.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return path


def _findings_from_command_result(result: CommandResult) -> list[DogfoodFinding]:
    payload = _load_playwright_json(result.stdout)
    if payload is not None:
        findings = parse_playwright_json(payload)
        if findings:
            return findings
    if result.exit_code != 0:
        return [
            DogfoodFinding(
                persona="Synthetic Runner",
                surface="hub",
                scenario="runner",
                failure_code="playwright-runner-failed",
                severity="P2",
                title="Synthetic dogfood runner failed before producing findings",
                expected="The synthetic Playwright suite should execute and produce a JSON report.",
                actual=_trim(result.stderr or result.stdout or "Playwright exited non-zero", 1000),
                evidence={"exit_code": result.exit_code, "stderr": _trim(result.stderr, 4000)},
            )
        ]
    return []


def _load_playwright_json(stdout: str) -> dict[str, Any] | None:
    if not stdout.strip():
        return None
    try:
        loaded = json.loads(stdout)
        return loaded if isinstance(loaded, dict) else None
    except json.JSONDecodeError:
        start = stdout.find("{")
        end = stdout.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            loaded = json.loads(stdout[start : end + 1])
            return loaded if isinstance(loaded, dict) else None
        except json.JSONDecodeError:
            return None


def _report_findings(
    findings: list[DogfoodFinding],
    *,
    config: DogfoodTaskConfig,
    run_id: str,
    reporter: GitHubIssueReporter | Any | None,
) -> list[dict[str, Any]]:
    active_reporter = reporter or GitHubIssueReporter(
        token=config.github_token,
        repository=config.github_repository,
        dry_run=config.dry_run,
    )
    actions: list[dict[str, Any]] = []
    try:
        for finding in findings:
            action = active_reporter.report(finding, run_id=run_id, target_url=config.target_url)
            actions.append(_action_to_dict(action))
    finally:
        close = getattr(active_reporter, "close", None)
        if close:
            close()
    return actions


def _action_to_dict(action: IssueAction | Any) -> dict[str, Any]:
    return {
        "action": getattr(action, "action", None),
        "issue_number": getattr(action, "issue_number", None),
        "issue_url": getattr(action, "issue_url", None),
        "reason": getattr(action, "reason", None),
    }


def _count_actions(actions: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for action in actions:
        name = action.get("action") or "unknown"
        counts[name] = counts.get(name, 0) + 1
    return counts


def _trim(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."
