"""Create real isolated git worktrees — node-locally. Never delete them (deny-list).

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

# Safe git ref format validation — prevents injection of option-like strings.
# Mirrors git check-ref-format --branch rules:
# - Only letters, digits, '.', '_', '/', '-'
# - Must not start with '-' or '/'
# - No '..', no '@{', no trailing '/', no '.lock' suffix, no control chars
_SAFE_REF_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$")

# Safe commit SHA format: 7–40 hex characters (abbreviated or full)
_SAFE_COMMIT_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")

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

    # ── public API ───────────────────────────────────────────────────────────
    def _ensure_commit(self, commit: str, ref: str | None = None) -> None:
        """Fetch the base commit if it does not exist locally.

        Tries in order:
          1. Validate commit and ref against safe formats (prevent injection)
          2. Check presence locally
          3. If absent and commit is 40-hex SHA: fetch origin <commit>
          4. If ref is given: fetch origin <ref> (normalized to strip 'origin/' and 'refs/heads/' prefix)
          5. Fail closed with typed ContractViolation

        Raises ContractViolation if commit/ref are unsafe or commit remains unreachable after fetch.
        """
        # Validate commit format BEFORE any git call
        commit = (commit or "").strip()
        if not _SAFE_COMMIT_RE.match(commit):
            raise ContractViolation("github_ref is not a valid commit SHA")

        # Validate and normalize ref BEFORE any git call
        normalized_ref = None
        if ref:
            ref_stripped = (ref or "").strip()
            if ref_stripped:
                # Remove 'origin/' prefix if present, using removeprefix (exact, not lstrip)
                temp_ref = ref_stripped.removeprefix("origin/")
                # Also remove 'refs/heads/' prefix if present
                temp_ref = temp_ref.removeprefix("refs/heads/")

                # Validate the normalized ref against safe format
                if not _SAFE_REF_RE.match(temp_ref):
                    raise ContractViolation("github_ref is not a valid ref name")
                normalized_ref = temp_ref

        # Check if commit already exists
        try:
            check = self._run(
                ["git", "-C", str(self.repo), "cat-file", "-e", f"{commit}^{{commit}}"],
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ContractViolation("base_commit fetch failed") from exc

        if check.returncode == 0:
            # Commit exists, no fetch needed
            return

        # Commit is missing; try fetches in order
        attempts = []

        # Attempt 1: If it's a full 40-hex SHA, GitHub serves reachable SHAs by id
        if len(commit) == 40 and all(c in "0123456789abcdef" for c in commit.lower()):
            attempts.append(
                ["git", "-C", str(self.repo), "fetch", "--quiet", "--no-tags", "origin", commit]
            )

        # Attempt 2: If normalized ref is available, fetch the ref by name.
        # Note: Both fetches are scoped to exactly one SHA or one ref with --no-tags
        # and a 120s wall bound. We do NOT use --depth or --filter because the
        # worktree needs full history for 'git diff <base>..HEAD' during review.
        if normalized_ref:
            attempts.append(
                [
                    "git",
                    "-C",
                    str(self.repo),
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "origin",
                    normalized_ref,
                ]
            )

        # No fallback to fetch-all; fail closed instead

        for attempt_cmd in attempts:
            try:
                result = self._run(attempt_cmd, timeout=120)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise ContractViolation("base_commit fetch failed") from exc

            if result.returncode == 0:
                # Fetch succeeded, verify commit is now present
                try:
                    verify = self._run(
                        ["git", "-C", str(self.repo), "cat-file", "-e", f"{commit}^{{commit}}"],
                        timeout=15,
                    )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    raise ContractViolation("base_commit fetch failed") from exc

                if verify.returncode == 0:
                    # Success!
                    return

        # All attempts failed
        raise ContractViolation("base_commit is not reachable after fetch")

    def create(
        self, *, task_id: str, session_id: str, base_commit: str, ref: str | None = None
    ) -> Path:
        if not self._isdir(self.repo):
            raise ContractViolation("isolated worktree source repo is not available")
        commit = (base_commit or "").strip()
        if not commit:
            raise ContractViolation("base_commit is required to create an isolated worktree")
        # Ensure the parent dir exists on the target machine.
        self._ensure_commit(commit, ref)
        mkdir = self._run(["mkdir", "-p", str(self.parent)], timeout=15)
        if mkdir.returncode != 0:
            raise ContractViolation("failed to create isolated worktree parent directory")
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
            raise ContractViolation("failed to create isolated worktree") from exc
        if completed.returncode != 0 or not self._isdir(path):
            raise ContractViolation("failed to create isolated worktree")
        return path

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
