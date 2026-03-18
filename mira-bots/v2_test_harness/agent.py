"""
agent.py — Autonomous release decision agent.
"""
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Decision:
    action: str          # "STOP" | "COMMIT_NO_TAG" | "RELEASE" | "REPORT_ONLY" | "RELEASE_INGEST_ONLY"
    version: str         # e.g. "v1.1" or "" if no tag
    message: str
    ingest_rate: float
    tele_rate: float | None


def make_decision(
    ingest_results: list[dict],
    telegram_results: list[dict] | None,
    fix_cycles: int,
    changed_files: list[str],
    release_requested: bool,
) -> Decision:
    total = len(ingest_results)
    passed = sum(1 for r in ingest_results if r.get("passed"))
    ingest_rate = round(passed / total, 4) if total > 0 else 0.0

    tele_rate = None
    if telegram_results:
        t_passed = sum(1 for r in telegram_results if r.get("passed") or r.get("reply"))
        tele_rate = round(t_passed / len(telegram_results), 4) if telegram_results else None

    repo_path = str(Path(__file__).parent.parent)
    current_tag = get_current_tag(repo_path)
    next_ver = get_next_version(current_tag, changed_files)

    if ingest_rate < 0.90:
        return Decision(
            action="STOP",
            version="",
            message=f"STOP — ingest rate {ingest_rate:.1%} below 90% threshold. Fix failures before release.",
            ingest_rate=ingest_rate,
            tele_rate=tele_rate,
        )

    if ingest_rate < 0.95:
        return Decision(
            action="COMMIT_NO_TAG",
            version="",
            message=f"Ingest rate {ingest_rate:.1%} — commit progress but no tag. Target ≥95% for release.",
            ingest_rate=ingest_rate,
            tele_rate=tele_rate,
        )

    # >= 95%
    if not release_requested:
        return Decision(
            action="REPORT_ONLY",
            version=next_ver,
            message=f"Ingest rate {ingest_rate:.1%} — ready for release. Run with --release to tag {next_ver}.",
            ingest_rate=ingest_rate,
            tele_rate=tele_rate,
        )

    # release requested
    tele_ok = telegram_results is None or (tele_rate is not None and tele_rate >= 0.90)
    if tele_ok:
        return Decision(
            action="RELEASE",
            version=next_ver,
            message=f"MIRA {next_ver} RELEASED — ingest {ingest_rate:.1%}"
                    + (f", Telegram {tele_rate:.1%}" if tele_rate is not None else ", Telegram skipped"),
            ingest_rate=ingest_rate,
            tele_rate=tele_rate,
        )
    else:
        return Decision(
            action="RELEASE_INGEST_ONLY",
            version=next_ver,
            message=f"MIRA {next_ver} RELEASED — ingest {ingest_rate:.1%} validated. "
                    f"Telegram {tele_rate:.1%} below 90% — note Telegram gap.",
            ingest_rate=ingest_rate,
            tele_rate=tele_rate,
        )


def get_current_tag(repo_path: str) -> str:
    result = subprocess.run(
        ["git", "-C", repo_path, "describe", "--tags", "--abbrev=0"],
        capture_output=True,
        text=True,
    )
    tag = result.stdout.strip()
    return tag if tag else "v0.0"


def get_next_version(current_tag: str, changed_files: list[str]) -> str:
    # Major bump: judge_v2.py or runner.py changed
    if any("judge_v2.py" in f or "runner.py" in f for f in changed_files):
        return _bump_major(current_tag)
    # Minor bump: mira-ingest/main.py DESCRIBE_SYSTEM or gsd_engine.py changed
    if any("mira-ingest/main.py" in f or "gsd_engine.py" in f for f in changed_files):
        return _bump_minor(current_tag)
    # Patch bump: only manifest or report changed
    return _bump_patch(current_tag)


def _bump_major(tag: str) -> str:
    parts = _parse_tag(tag)
    return f"v{parts[0] + 1}.0"


def _bump_minor(tag: str) -> str:
    parts = _parse_tag(tag)
    return f"v{parts[0]}.{parts[1] + 1}"


def _bump_patch(tag: str) -> str:
    parts = _parse_tag(tag)
    patch = parts[2] + 1 if len(parts) > 2 else 1
    return f"v{parts[0]}.{parts[1]}.{patch}"


def _parse_tag(tag: str) -> list[int]:
    """Parse 'v1.2.3' → [1, 2, 3]. Tolerant of missing parts."""
    clean = tag.lstrip("v")
    try:
        parts = [int(x) for x in clean.split(".")]
    except ValueError:
        parts = [1, 0]
    while len(parts) < 3:
        parts.append(0)
    return parts
