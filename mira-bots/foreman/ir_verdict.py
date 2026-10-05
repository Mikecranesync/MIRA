"""Independent-review verdict contract (Foreman coordinator policy).

Pure policy — no I/O. Used by Foreman skills/routines and regression tests.
A review is never complete without a persisted artifact tied to the exact tip SHA.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class Outcome(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    BLOCKED = "BLOCKED"
    ERROR = "ERROR"


TERMINAL_REVIEW = {Outcome.PASS, Outcome.FAIL}
INCOMPLETE = {Outcome.BLOCKED, Outcome.ERROR}
MAX_IDENTICAL_EMPTY_RELAUNCHES = 2


@dataclass(frozen=True)
class ReviewArtifact:
    repo: str
    pr: int
    head_sha: str  # full 40-char preferred; short OK if >= 7
    base_sha: str
    reviewer: str
    task_id: str
    session_id: str
    outcome: Outcome
    evidence: str = ""


@dataclass(frozen=True)
class TaskSnapshot:
    task_id: str
    session_id: str
    commit: str
    status: str  # running | stopped | unknown
    review_verdict: Optional[str]
    done: bool
    handoff: Optional[str]


def normalize_sha(sha: str) -> str:
    return (sha or "").strip().lower()


def shas_match(a: str, b: str) -> bool:
    a_n, b_n = normalize_sha(a), normalize_sha(b)
    if not a_n or not b_n:
        return False
    n = min(len(a_n), len(b_n))
    if n < 7:
        return False
    return a_n[:n] == b_n[:n] or a_n.startswith(b_n) or b_n.startswith(a_n)


def is_stale_for_head(artifact: ReviewArtifact, current_head: str) -> bool:
    """Older tip SHA must not approve a newer head."""
    return not shas_match(artifact.head_sha, current_head)


def counts_as_approval(artifact: ReviewArtifact, current_head: str) -> bool:
    if artifact.outcome != Outcome.PASS:
        return False
    return not is_stale_for_head(artifact, current_head)


def parse_github_ir_comment(body: str) -> Optional[Outcome]:
    """Extract durable IR outcome from a PR comment body."""
    if not body:
        return None
    upper = body.upper()
    # Require independent-review framing so staging-gate PASS etc. do not count.
    if "INDEPENDENT REVIEW" not in upper and "[INDEPENDENT-REVIEW]" not in upper:
        return None
    # Prefer explicit tagged form
    for tag, outcome in (
        ("[INDEPENDENT-REVIEW] PASS", Outcome.PASS),
        ("[INDEPENDENT-REVIEW] FAIL", Outcome.FAIL),
        ("[INDEPENDENT-REVIEW] BLOCKED", Outcome.BLOCKED),
        ("[INDEPENDENT-REVIEW] ERROR", Outcome.ERROR),
        ("INDEPENDENT REVIEW — PASS", Outcome.PASS),
        ("INDEPENDENT REVIEW — FAIL", Outcome.FAIL),
        ("INDEPENDENT REVIEW - PASS", Outcome.PASS),
        ("INDEPENDENT REVIEW - FAIL", Outcome.FAIL),
        ("INDEPENDENT REVIEW — PASS", Outcome.PASS),
    ):
        if tag in upper.replace("—", "-").replace("–", "-") or tag in upper:
            return outcome
    # Title form used historically: "## Independent Review — PASS"
    if "INDEPENDENT REVIEW" in upper and "PASS" in upper and "FAIL" not in upper.split("PASS")[0][-40:]:
        # Heuristic: first outcome word after Independent Review
        idx = upper.find("INDEPENDENT REVIEW")
        window = upper[idx : idx + 80]
        if "PASS" in window and "FAIL" not in window[: window.find("PASS") + 4]:
            return Outcome.PASS
        if "FAIL" in window:
            return Outcome.FAIL
    return None


def classify_terminal_session(
    task: TaskSnapshot,
    *,
    expected_head: str,
    github_outcome: Optional[Outcome] = None,
) -> Outcome:
    """When a session is no longer running, classify the durable outcome.

    A successful process exit without a valid review artifact is ERROR —
    never silent approval, never an excuse to relaunch forever.
    """
    if task.status == "running":
        raise ValueError("classify_terminal_session only applies to non-running sessions")

    # Prefer GitHub durable comment if present and SHA matches
    if github_outcome in TERMINAL_REVIEW:
        return github_outcome
    if github_outcome in INCOMPLETE:
        return github_outcome

    verdict = (task.review_verdict or "").strip().upper()
    if verdict in ("PASS", "FAIL"):
        if shas_match(task.commit, expected_head):
            return Outcome[verdict]
        return Outcome.ERROR  # verdict for wrong SHA

    if verdict in ("BLOCKED", "ERROR"):
        return Outcome[verdict]

    # Session stopped/exited with null verdict and no GitHub IR artifact
    return Outcome.ERROR


def should_relaunch_ir(
    *,
    current_head: str,
    latest_artifact: Optional[ReviewArtifact],
    empty_exit_count_for_head: int,
    latch_free: bool,
    active_claim_covers_tip: bool,
) -> tuple[bool, str]:
    """Coordinator gate before launch_worker for independent review."""
    if not latch_free:
        return False, "latch busy"
    if active_claim_covers_tip:
        return False, "ACTIVE claim already covers this tip IR"
    if latest_artifact and counts_as_approval(latest_artifact, current_head):
        return False, "PASS already persisted for this tip"
    if latest_artifact and latest_artifact.outcome == Outcome.FAIL and not is_stale_for_head(
        latest_artifact, current_head
    ):
        return False, "FAIL already persisted for this tip — remediate, do not re-IR"
    if empty_exit_count_for_head >= MAX_IDENTICAL_EMPTY_RELAUNCHES:
        return (
            False,
            f"stop: {empty_exit_count_for_head} empty IR exits on this tip "
            f"(max {MAX_IDENTICAL_EMPTY_RELAUNCHES}) — diagnose, do not relaunch",
        )
    return True, "relaunch allowed"


def coordinator_ack_required(artifact: ReviewArtifact, current_head: str) -> bool:
    """Review complete only after coordinator validates artifact against live head."""
    if is_stale_for_head(artifact, current_head):
        return False
    return artifact.outcome in TERMINAL_REVIEW | INCOMPLETE
