"""Create real isolated git worktrees — node-locally, with a bounded retention sweep.

No Gateway *tool* can delete a worktree: ``delete_worktree`` is hard-denied in
``contract`` and ``stop_worker`` raises on it. That stays true. What this module
adds is an internal, create-time bound so Gateway-created ``fleet-e2e-*``
directories cannot accumulate without limit — every ``launch_worker`` used to
strand ~561 MB forever, which filled Charlie's disk to 100% on 2026-09-04 (#3546).

The sweep never uses ``rm -rf`` on a worktree. It clears only the artifact files
the Gateway itself writes, then calls ``git worktree remove`` WITHOUT ``--force``
so that **git refuses** on any real modification or unexpected untracked file.
That refusal is the safety property: anything a human might care about survives.

A worktree must be created on the SAME physical machine the worker runs on. The
Gateway process runs on Bravo, so a Bravo worker's worktree is created with a
plain local ``git``, but a Charlie worker's worktree MUST be created on Charlie's
own filesystem (``/Users/charlienode/MIRA[-worktrees]``) — never a Bravo path
handed to Charlie (that was #3552). When ``ssh_host`` is set, EVERY filesystem
operation (repo check, dir test, ``git worktree add``, proof write) is executed
on that host over SSH; nothing touches the local disk. When it is unset, the
behavior is exactly the local one it always was.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import uuid
from pathlib import Path

from fleet_gateway.errors import ContractViolation

# Bravo (the node the Gateway runs on) — local, no SSH.
DEFAULT_REPO = Path("/Users/bravonode/Mira")
DEFAULT_PARENT = Path("/Users/bravonode/Mira-worktrees")

# Charlie — a DIFFERENT physical machine; worktrees are created over SSH under
# Charlie's own home, never a Bravo path. These are the node-local truths.
CHARLIE_REPO = Path("/Users/charlienode/MIRA")
CHARLIE_PARENT = Path("/Users/charlienode/MIRA-worktrees")
CHARLIE_SSH_HOST = "charlie"

# Alpha — the orchestrator Mac mini (user factorylm). Reached over SSH via the
# `alpha` config alias (Tailscale 100.107.140.12); its worktrees live under
# Alpha's own home, never a Bravo/Charlie path.
ALPHA_REPO = Path("/Users/factorylm/MIRA")
ALPHA_PARENT = Path("/Users/factorylm/MIRA-worktrees")
ALPHA_SSH_HOST = "alpha"

# Retention bound for Gateway-created worktrees. 0 disables the sweep.
RETAIN_ENV = "FLEET_GATEWAY_WORKTREE_RETAIN"
DEFAULT_RETAIN = 12

# Only these machine-written files may be cleared to let `git worktree remove`
# proceed. Anything else (source edits, hand-written .fleet/*.md handoffs) makes
# git refuse, and the worktree is skipped. Keep this list minimal and boring.
DISPOSABLE_ARTIFACTS: tuple[str, ...] = (
    "FOREMAN-GATEWAY-PROOF.txt",
    ".enum-drift-allowlist.txt",
)

# Gateway-created worktrees carry this prefix. Human-made siblings (e.g. a CAO
# session's own working directory) do not, and are therefore never candidates.
WORKTREE_PREFIX = "fleet-e2e-"

PROOF_TASK_ID = "foreman-gateway-proof"
PROOF_MARKER = "FOREMAN-GATEWAY-PROOF"
PROOF_FILENAME = "FOREMAN-GATEWAY-PROOF.txt"

_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(value: str, *, max_len: int = 48) -> str:
    cleaned = _SAFE_RE.sub("-", (value or "").strip()).strip("-.") or "task"
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned[:max_len]


def _short_session(session_id: str) -> str:
    compact = "".join(ch for ch in (session_id or "") if ch.isalnum())
    return (compact[-12:] or uuid.uuid4().hex[:12])[:12]


class WorktreeProvisioner:
    """``git worktree add --detach`` into a unique sibling directory. Never rm -rf.

    ``ssh_host=None`` → all operations run on the local machine (Bravo).
    ``ssh_host="charlie"`` → all operations run ON Charlie over SSH, so both the
    ``git`` command and the returned path live on Charlie's filesystem.
    """

    def __init__(self, *, repo: Path, parent: Path, ssh_host: str | None = None) -> None:
        self.repo = Path(repo)
        self.parent = Path(parent)
        self.ssh_host = (ssh_host or "").strip() or None

    # ── execution primitives (local OR remote-over-ssh) ──────────────────────
    def _run(self, argv: list[str], *, timeout: float) -> subprocess.CompletedProcess[str]:
        """Run argv locally, or as a single quoted command on ssh_host."""
        if self.ssh_host:
            remote = " ".join(shlex.quote(a) for a in argv)
            full = ["ssh", "-o", "BatchMode=yes", self.ssh_host, remote]
        else:
            full = argv
        return subprocess.run(  # noqa: S603 — argv only; remote is shlex-quoted, no injection
            full,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )

    def _isdir(self, path: Path) -> bool:
        if self.ssh_host:
            return self._run(["test", "-d", str(path)], timeout=15).returncode == 0
        return Path(path).is_dir()

    def _commit_present(self, commit: str) -> bool:
        """True if `commit` is a commit object already in the node's local repo."""
        return (
            self._run(
                ["git", "-C", str(self.repo), "cat-file", "-e", f"{commit}^{{commit}}"],
                timeout=15,
            ).returncode
            == 0
        )

    def _ensure_commit(self, commit: str) -> None:
        """Make `commit` available locally, fetching from origin if it's missing.

        The #3566 blocker: launch_worker passes a base_commit that is a fresh tip
        of an origin branch (e.g. main just advanced), but the node's local repo
        has never fetched it, so `git worktree add … <commit>` fails with
        `fatal: bad object` and the create is reported as a generic failure — with
        NO Claude/Codex session ever started. Fetch-if-missing closes that: it runs
        on the SAME machine as the worktree (local, or ON the node over SSH via
        self._run), so on-node workers stop failing every time main moves.
        """
        if self._commit_present(commit):
            return
        # Try the specific SHA first (GitHub allows reachable-SHA fetch); if the
        # server refuses a bare SHA, fall back to a full origin fetch which pulls
        # every branch tip and will include a reachable commit.
        self._run(
            ["git", "-C", str(self.repo), "fetch", "--no-tags", "origin", commit], timeout=120
        )
        if self._commit_present(commit):
            return
        self._run(["git", "-C", str(self.repo), "fetch", "--no-tags", "origin"], timeout=180)
        if not self._commit_present(commit):
            raise ContractViolation(
                f"base_commit {commit!r} not found in the repo even after fetching origin "
                "(check the commit exists on the remote and this node can reach it)"
            )

    # ── public API ───────────────────────────────────────────────────────────
    def create(self, *, task_id: str, session_id: str, base_commit: str) -> Path:
        if not self._isdir(self.repo):
            raise ContractViolation("isolated worktree source repo is not available")
        commit = (base_commit or "").strip()
        if not commit:
            raise ContractViolation("base_commit is required to create an isolated worktree")
        # Make the base commit available locally (fetch-if-missing) so a fresh
        # origin SHA doesn't fail as `bad object` before any worker starts (#3566).
        self._ensure_commit(commit)
        # Ensure the parent dir exists on the target machine.
        mkdir = self._run(["mkdir", "-p", str(self.parent)], timeout=15)
        if mkdir.returncode != 0:
            raise ContractViolation("failed to create isolated worktree parent directory")
        # Bound accumulation BEFORE adding another. Best-effort; never fatal.
        self.reap(retain=retain_from_env())
        path = self.parent / f"fleet-e2e-{_safe_segment(task_id)}-{_short_session(session_id)}"
        while self._isdir(path):
            path = self.parent / (
                f"fleet-e2e-{_safe_segment(task_id)}-{_short_session(session_id)}-"
                f"{uuid.uuid4().hex[:6]}"
            )
        cmd = [
            "git",
            "-C",
            str(self.repo),
            "worktree",
            "add",
            "--detach",
            str(path),
            commit,
        ]
        try:
            completed = self._run(cmd, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ContractViolation(f"failed to create isolated worktree: {exc}") from exc
        if completed.returncode != 0 or not self._isdir(path):
            # Surface the REAL git error instead of a generic message — the #3566
            # investigation was slowed by the swallowed `fatal: bad object`.
            detail = (completed.stderr or completed.stdout or "").strip()[:300]
            raise ContractViolation(
                f"failed to create isolated worktree (git rc={completed.returncode}): {detail}"
            )
        return path

    # ── retention ────────────────────────────────────────────────────────────
    def _candidates_oldest_first(self, retain: int) -> list[str]:
        """`fleet-e2e-*` dirs on the owning node beyond the newest `retain`."""
        # -d dirs only, -t newest first; run on the node that owns the parent.
        listing = self._run(
            ["sh", "-c", f"ls -dt {shlex.quote(str(self.parent))}/{WORKTREE_PREFIX}* 2>/dev/null"],
            timeout=30,
        )
        if listing.returncode != 0:
            return []
        paths = [ln.strip() for ln in listing.stdout.splitlines() if ln.strip()]
        return paths[retain:]

    def reap(self, *, retain: int | None = None) -> list[str]:
        """Remove Gateway worktrees beyond the retention bound. Never raises.

        Safety comes from git, not from a predicate we invented: after clearing
        the known machine-written artifacts we call ``git worktree remove``
        WITHOUT ``--force``, so a worktree holding real work is refused and
        skipped. Returns the paths actually removed.
        """
        bound = DEFAULT_RETAIN if retain is None else retain
        if bound <= 0:
            return []
        removed: list[str] = []
        try:
            for path in self._candidates_oldest_first(bound):
                # Never touch anything outside the Gateway's own naming scheme.
                if not os.path.basename(path).startswith(WORKTREE_PREFIX):
                    continue
                if not path.startswith(str(self.parent) + os.sep):
                    continue
                for artifact in DISPOSABLE_ARTIFACTS:
                    self._run(
                        ["rm", "-f", os.path.join(path, artifact)],
                        timeout=15,
                    )
                # No --force: git refuses if anything of value remains.
                done = self._run(
                    ["git", "-C", str(self.repo), "worktree", "remove", path],
                    timeout=60,
                )
                if done.returncode == 0:
                    removed.append(path)
            if removed:
                self._run(["git", "-C", str(self.repo), "worktree", "prune"], timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            # A sweep failure must never break a launch.
            return removed
        return removed

    def maybe_write_proof(
        self,
        worktree: Path,
        *,
        task_id: str,
        acceptance_criteria: str,
    ) -> None:
        criteria = acceptance_criteria or ""
        if task_id != PROOF_TASK_ID and PROOF_MARKER not in criteria:
            return
        target = Path(worktree) / PROOF_FILENAME
        if self.ssh_host:
            # Write on the SAME machine the worktree lives on — a local write_text
            # from Bravo to a Charlie path would silently land nowhere (advisor note).
            inner = f"printf '%s' {shlex.quote(PROOF_MARKER)} > {shlex.quote(str(target))}"
            self._run(["sh", "-c", inner], timeout=15)
        else:
            target.write_text(PROOF_MARKER, encoding="utf-8")


def retain_from_env() -> int:
    """Retention bound from env; invalid or negative disables the sweep."""
    raw = (os.environ.get(RETAIN_ENV) or "").strip()
    if not raw:
        return DEFAULT_RETAIN
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_RETAIN
    return max(value, 0)


def _provisioner(
    *,
    repo_env: str,
    parent_env: str,
    default_repo: Path,
    default_parent: Path,
    ssh_host: str | None,
) -> WorktreeProvisioner:
    repo_raw = (os.environ.get(repo_env) or "").strip()
    parent_raw = (os.environ.get(parent_env) or "").strip()
    repo = Path(repo_raw) if repo_raw else default_repo
    parent = Path(parent_raw) if parent_raw else default_parent
    return WorktreeProvisioner(repo=repo, parent=parent, ssh_host=ssh_host)


def worktrees_from_env() -> WorktreeProvisioner:
    """Bravo-local provisioner (backward-compatible default)."""
    return _provisioner(
        repo_env="FLEET_GATEWAY_REPO",
        parent_env="FLEET_GATEWAY_WORKTREE_PARENT",
        default_repo=DEFAULT_REPO,
        default_parent=DEFAULT_PARENT,
        ssh_host=None,
    )


def bravo_worktrees_from_env() -> WorktreeProvisioner:
    """Explicit Bravo node provisioner (same as worktrees_from_env)."""
    return worktrees_from_env()


def charlie_worktrees_from_env() -> WorktreeProvisioner:
    """Charlie node provisioner — creates worktrees ON Charlie over SSH."""
    ssh_host = (os.environ.get("FLEET_GATEWAY_CHARLIE_SSH_HOST") or "").strip() or CHARLIE_SSH_HOST
    return _provisioner(
        repo_env="FLEET_GATEWAY_CHARLIE_REPO",
        parent_env="FLEET_GATEWAY_CHARLIE_WORKTREE_PARENT",
        default_repo=CHARLIE_REPO,
        default_parent=CHARLIE_PARENT,
        ssh_host=ssh_host,
    )


def alpha_worktrees_from_env() -> WorktreeProvisioner:
    """Alpha node provisioner — creates worktrees ON Alpha over SSH."""
    ssh_host = (os.environ.get("FLEET_GATEWAY_ALPHA_SSH_HOST") or "").strip() or ALPHA_SSH_HOST
    return _provisioner(
        repo_env="FLEET_GATEWAY_ALPHA_REPO",
        parent_env="FLEET_GATEWAY_ALPHA_WORKTREE_PARENT",
        default_repo=ALPHA_REPO,
        default_parent=ALPHA_PARENT,
        ssh_host=ssh_host,
    )
