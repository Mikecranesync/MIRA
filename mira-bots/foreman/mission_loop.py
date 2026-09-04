"""Foreman autonomous management loop — pure policy.

No Slack Socket, no Doppler calls, no Gateway HTTP, no product file edits.
This module encodes the management loop as testable, serializable policy.

Foreman is the MANAGER. It dispatches workers; it never:
  - Opens an implementation worktree
  - Edits product files
  - Commits code

Dispatching a worker is the full extent of Foreman's implementation involvement.

AC reference: docs/missions/AUTONOMOUS-FOREMAN-V1.md
Issue: https://github.com/Mikecranesync/MIRA/issues/3566
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# PRs that must never be merged, unset-draft, or deployed by this loop (AC E).
HELD_PR_NUMBERS: frozenset[int] = frozenset({3533, 3558})
HELD_TITLE_MARKER: str = "HELD"

# Exact-SHA pattern: 40 lowercase hex characters (AC C).
SHA_RE: re.Pattern[str] = re.compile(r"^[0-9a-f]{40}$")

# Actions that Foreman must always refuse — no arguments override these (AC D, F).
FORBIDDEN_ACTIONS: frozenset[str] = frozenset(
    {
        "merge",
        "deploy",
        "gh_pr_merge",
        "deploy_vps",
        "vps_compose_restart",
        "vps_compose_up",
        "vps_compose_down",
        "gateway_config",
        "gateway_restart",
        "cloudflare_config",
        "tailscale_config",
        "tunnel_config",
        "doppler_read",
        "doppler_copy",
        "secret_print",
        "pay_vendor_bill",
        "stop_unowned_session",
        "delete_unowned_worktree",
    }
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


class WorkerRole(str, Enum):
    IMPLEMENTER = "implementer"
    REVIEWER = "reviewer"
    # Acceptance verification is a DIFFERENT question from adversarial review
    # ("is it correct?" vs "did it actually run?"), so it gets its own slot.
    # One shared slot silently overwrote the first verdict with the second.
    VERIFIER = "verifier"


class WorkerState(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"


@dataclass
class Worker:
    role: WorkerRole
    state: WorkerState
    session_id: str = ""
    node: str = ""
    provider: str = ""
    git_ref: str = ""  # For reviewers: the exact 40-char SHA under review.


@dataclass
class MissionState:
    """Serializable mission state. Persisted to docs/missions/ so a restarted
    Foreman can recover without relying on Slack history (AC G)."""

    mission_id: str
    base_sha: str
    branch: str
    pr_url: str = ""
    head_sha: str = ""
    implementer: Optional[Worker] = None
    reviewer: Optional[Worker] = None
    reviewer_verdict: str = ""  # "PASS" | "FAIL" | ""
    verifier: Optional[Worker] = None
    verifier_verdict: str = ""  # "PASS" | "FAIL" | ""
    go_no_go: str = ""  # "GO" | "NO-GO" | ""
    remaining_human_gates: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> MissionState:
        d = dict(data)
        # Every worker slot must be popped before cls(**d); a slot left in the
        # dict reaches the constructor as a raw dict instead of a Worker.
        slots = {name: d.pop(name, None) for name in ("implementer", "reviewer", "verifier")}
        obj = cls(**d)
        for name, raw in slots.items():
            if raw:
                setattr(obj, name, cls._worker_from_dict(raw))
        return obj

    @staticmethod
    def _worker_from_dict(raw: dict) -> Worker:
        return Worker(
            role=WorkerRole(raw["role"]),
            state=WorkerState(raw["state"]),
            session_id=raw.get("session_id", ""),
            node=raw.get("node", ""),
            provider=raw.get("provider", ""),
            git_ref=raw.get("git_ref", ""),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, s: str) -> MissionState:
        return cls.from_dict(json.loads(s))


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class PolicyResult:
    allowed: bool
    reason: str


@dataclass
class GoNoGo:
    """Terminal GO/NO-GO recommendation (AC H).

    verdict is exactly "GO" or "NO-GO". Nothing is auto-merged or auto-deployed;
    human_gates lists what Mike must do before any merge/deploy.
    """

    verdict: str  # "GO" | "NO-GO"
    pr_url: str
    head_sha: str
    reviewer_verdict: str
    human_gates: list[str]
    # Defaulted: AC H predates the verifier slot, so existing callers still work.
    verifier_verdict: str = ""

    def __post_init__(self) -> None:
        if self.verdict not in ("GO", "NO-GO"):
            raise ValueError(f"verdict must be 'GO' or 'NO-GO', got {self.verdict!r}")


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


class ForemanPolicy:
    """Pure policy for the Foreman autonomous management loop.

    No I/O, no network calls, no Slack, no Doppler, no Gateway HTTP.
    All decisions are deterministic given a MissionState.

    AC A: ForemanPolicy has NO methods to open_worktree, edit_file, or commit.
    Those belong to the implementer worker, not to the manager.
    """

    def __init__(self, state: MissionState) -> None:
        self._state = state

    @property
    def state(self) -> MissionState:
        return self._state

    # ------------------------------------------------------------------
    # AC B — max one implementation worker
    # ------------------------------------------------------------------

    def can_dispatch_implementer(self) -> PolicyResult:
        """Return allowed=True only when no implementer is currently running."""
        impl = self._state.implementer
        if impl is not None and impl.state == WorkerState.RUNNING:
            return PolicyResult(
                allowed=False,
                reason=(
                    f"Implementer already running (session={impl.session_id!r}). "
                    "Wait for it to stop before dispatching a new one."
                ),
            )
        return PolicyResult(allowed=True, reason="no active implementer")

    def dispatch_implementer(
        self,
        session_id: str,
        node: str = "bravo",
        provider: str = "claude",
    ) -> PolicyResult:
        """Register a new implementer worker if the slot is free (AC B)."""
        check = self.can_dispatch_implementer()
        if not check.allowed:
            return check
        self._state.implementer = Worker(
            role=WorkerRole.IMPLEMENTER,
            state=WorkerState.RUNNING,
            session_id=session_id,
            node=node,
            provider=provider,
        )
        return PolicyResult(allowed=True, reason="implementer dispatched")

    def stop_implementer(self, head_sha: str = "") -> None:
        """Mark the current implementer stopped; record the resulting head SHA."""
        if self._state.implementer is not None:
            self._state.implementer.state = WorkerState.STOPPED
            if head_sha:
                self._state.implementer.git_ref = head_sha
        if head_sha:
            self._state.head_sha = head_sha

    # ------------------------------------------------------------------
    # AC C — Charlie reviews an exact SHA
    # ------------------------------------------------------------------

    def can_dispatch_reviewer(self, git_ref: str) -> PolicyResult:
        """Validate git_ref is a 40-char hex SHA before allowing review dispatch."""
        if not SHA_RE.match(git_ref):
            return PolicyResult(
                allowed=False,
                reason=(
                    f"git_ref {git_ref!r} is not a 40-character hex commit SHA. "
                    "Review requires an exact SHA — branch names, 'origin/main', "
                    "and prose summaries are invalid."
                ),
            )
        return PolicyResult(allowed=True, reason="valid exact SHA")

    def dispatch_reviewer(
        self,
        git_ref: str,
        session_id: str,
        node: str = "charlie",
        provider: str = "codex",
    ) -> PolicyResult:
        """Register a reviewer worker on Charlie/Codex against an exact SHA (AC C)."""
        check = self.can_dispatch_reviewer(git_ref)
        if not check.allowed:
            return check
        if node != "charlie":
            return PolicyResult(
                allowed=False,
                reason=f"Reviewer must run on charlie, got {node!r}.",
            )
        if provider != "codex":
            return PolicyResult(
                allowed=False,
                reason=f"Reviewer must use codex provider, got {provider!r}.",
            )
        self._state.reviewer = Worker(
            role=WorkerRole.REVIEWER,
            state=WorkerState.RUNNING,
            session_id=session_id,
            node=node,
            provider=provider,
            git_ref=git_ref,
        )
        return PolicyResult(allowed=True, reason="reviewer dispatched")

    def record_reviewer_verdict(self, verdict: str) -> PolicyResult:
        """Record PASS or FAIL from the Charlie/Codex reviewer."""
        if verdict not in ("PASS", "FAIL"):
            return PolicyResult(
                allowed=False,
                reason=f"verdict must be 'PASS' or 'FAIL', got {verdict!r}",
            )
        self._state.reviewer_verdict = verdict
        if self._state.reviewer is not None:
            self._state.reviewer.state = WorkerState.STOPPED
        return PolicyResult(allowed=True, reason=f"verdict recorded: {verdict}")

    # ------------------------------------------------------------------
    # Verifier — acceptance verification, separate from adversarial review
    # ------------------------------------------------------------------

    def can_dispatch_verifier(self, git_ref: str) -> PolicyResult:
        """Verification runs on an exact SHA, and only after review has PASSed.

        Verifying before the reviewer has ruled wastes a worker on a SHA that may
        be about to be rejected, and produces two verdicts of unclear precedence.
        """
        if not SHA_RE.match(git_ref):
            return PolicyResult(
                allowed=False,
                reason=(
                    f"git_ref {git_ref!r} is not a 40-character hex commit SHA. "
                    "Verification requires an exact SHA."
                ),
            )
        if self._state.reviewer_verdict != "PASS":
            got = self._state.reviewer_verdict or "no verdict yet"
            return PolicyResult(
                allowed=False,
                reason=(
                    f"Verifier runs only after adversarial review PASSes (reviewer: {got})."
                ),
            )
        verifier = self._state.verifier
        if verifier is not None and verifier.state == WorkerState.RUNNING:
            return PolicyResult(
                allowed=False,
                reason="A verifier is already running. Wait for it to stop.",
            )
        return PolicyResult(allowed=True, reason="valid exact SHA, review passed")

    def dispatch_verifier(
        self,
        git_ref: str,
        session_id: str,
        node: str = "charlie",
        provider: str = "codex",
    ) -> PolicyResult:
        """Register a verifier worker against an exact SHA.

        Must not reuse the reviewer's session: the two ask different questions and
        a shared session id makes their verdicts indistinguishable in the audit.
        """
        check = self.can_dispatch_verifier(git_ref)
        if not check.allowed:
            return check
        reviewer = self._state.reviewer
        if reviewer is not None and session_id and session_id == reviewer.session_id:
            return PolicyResult(
                allowed=False,
                reason=(
                    "Verifier must use a different session than the adversarial "
                    f"reviewer (both are {session_id!r})."
                ),
            )
        self._state.verifier = Worker(
            role=WorkerRole.VERIFIER,
            state=WorkerState.RUNNING,
            session_id=session_id,
            node=node,
            provider=provider,
            git_ref=git_ref,
        )
        return PolicyResult(allowed=True, reason="verifier dispatched")

    def record_verifier_verdict(self, verdict: str) -> PolicyResult:
        """Record PASS or FAIL from the verifier. Separate from the reviewer's."""
        if verdict not in ("PASS", "FAIL"):
            return PolicyResult(
                allowed=False,
                reason=f"verdict must be 'PASS' or 'FAIL', got {verdict!r}",
            )
        self._state.verifier_verdict = verdict
        if self._state.verifier is not None:
            self._state.verifier.state = WorkerState.STOPPED
        return PolicyResult(allowed=True, reason=f"verifier verdict recorded: {verdict}")

    # ------------------------------------------------------------------
    # AC D — no merge / no deploy
    # ------------------------------------------------------------------

    def can_merge(self, pr_number: Optional[int] = None) -> PolicyResult:  # noqa: ARG002
        """Always refuse. Merge is a human-only gate."""
        return PolicyResult(
            allowed=False,
            reason="Foreman never merges. Human-only gate. Use 'gh pr merge' manually.",
        )

    def can_deploy(self) -> PolicyResult:
        """Always refuse. Deploy is a human-only gate."""
        return PolicyResult(
            allowed=False,
            reason=(
                "Foreman never deploys. Human-only gate. Run deploy-vps.yml after smoke tests pass."
            ),
        )

    # ------------------------------------------------------------------
    # AC E — HELD stays HELD
    # ------------------------------------------------------------------

    def is_pr_held(self, pr_number: int, title: str = "") -> bool:
        """Return True for known HELD PR numbers or any PR with HELD in its title."""
        if pr_number in HELD_PR_NUMBERS:
            return True
        if HELD_TITLE_MARKER in title.upper():
            return True
        return False

    def can_touch_pr(self, pr_number: int, title: str = "") -> PolicyResult:
        """Refuse any operation on a HELD PR (AC E)."""
        if self.is_pr_held(pr_number, title):
            return PolicyResult(
                allowed=False,
                reason=(
                    f"PR #{pr_number} is HELD. "
                    "Must not be merged, unset-draft, or deployed by this loop."
                ),
            )
        return PolicyResult(allowed=True, reason="PR not held")

    # ------------------------------------------------------------------
    # AC F — hard boundaries
    # ------------------------------------------------------------------

    def validate_action(self, action: str) -> PolicyResult:
        """Refuse any action in the hard-boundary set (AC F)."""
        if action in FORBIDDEN_ACTIONS:
            return PolicyResult(
                allowed=False,
                reason=(
                    f"Action {action!r} is in the hard-boundary set. "
                    "Foreman refuses: merge, deploy, gateway/tunnel config, "
                    "secret/Doppler ops, stopping unowned sessions, "
                    "deleting unowned worktrees, paying vendor bills."
                ),
            )
        return PolicyResult(allowed=True, reason="action not in hard-boundary list")

    # ------------------------------------------------------------------
    # AC G — GitHub is source of truth (serialization)
    # ------------------------------------------------------------------

    def save_state(self) -> str:
        """Return JSON string suitable for writing to docs/missions/."""
        return self._state.to_json()

    @classmethod
    def load_state(cls, json_str: str) -> ForemanPolicy:
        """Restore policy from a saved JSON state (AC G)."""
        return cls(MissionState.from_json(json_str))

    # ------------------------------------------------------------------
    # AC H — GO / NO-GO shape
    # ------------------------------------------------------------------

    def evaluate_go_no_go(self) -> GoNoGo:
        """Return the terminal GO/NO-GO recommendation (AC H).

        GO requires:
          - reviewer_verdict == "PASS"
          - head_sha is a valid 40-char exact SHA
          - pr_url is set

        Anything else is NO-GO. Nothing is auto-merged or auto-deployed;
        human_gates names what Mike must do.
        """
        gates: list[str] = [
            "Human must review and approve the Draft PR before any merge.",
            "Human must run deploy-vps.yml after smoke tests pass.",
        ]

        verdict: str
        if (
            self._state.reviewer_verdict == "PASS"
            and self._state.verifier_verdict != "FAIL"
            and SHA_RE.match(self._state.head_sha or "")
            and self._state.pr_url
        ):
            verdict = "GO"
            if not self._state.verifier_verdict:
                # Not a NO-GO: AC H defines GO without a verifier, and silently
                # redefining an accepted AC is not this change's job. Surfaced as
                # a gate so Mike sees acceptance was never independently checked.
                gates.insert(0, "Verifier has not run — acceptance not independently verified.")
        else:
            verdict = "NO-GO"
            if not self._state.reviewer_verdict:
                gates.insert(0, "Reviewer has not yet submitted a verdict.")
            elif self._state.reviewer_verdict != "PASS":
                gates.insert(
                    0,
                    f"Reviewer verdict is {self._state.reviewer_verdict!r} — must be PASS.",
                )
            if self._state.verifier_verdict == "FAIL":
                gates.insert(0, "Verifier verdict is 'FAIL' — acceptance checks did not pass.")
            if not SHA_RE.match(self._state.head_sha or ""):
                gates.insert(0, "head_sha is not a valid 40-char SHA.")
            if not self._state.pr_url:
                gates.insert(0, "PR URL not recorded.")

        self._state.go_no_go = verdict
        self._state.remaining_human_gates = gates
        return GoNoGo(
            verdict=verdict,
            pr_url=self._state.pr_url,
            head_sha=self._state.head_sha,
            reviewer_verdict=self._state.reviewer_verdict,
            human_gates=gates,
            verifier_verdict=self._state.verifier_verdict,
        )
