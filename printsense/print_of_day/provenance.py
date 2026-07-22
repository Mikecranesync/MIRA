"""Runtime provenance for a controlled Print of the Day run.

ADR-0031 §6.6 + FR-7 / FR-8: a controlled POTD run must be reproducible and
its evidence must record exactly what produced it — git SHA, dirty state,
container image revision, and (via the caller) provider/model identity, OCR
state, grader state, and artifact hashes.

Fail-closed for controlled runs:
* Git SHA cannot be determined  -> DIRTY_WORKTREE-adjacent hard stop.
* Working tree is dirty         -> refuse unless ALLOW_DIRTY_POTD=1 (dev).
* Recorded SHA != image label   -> REVISION_MISMATCH.

The image records its build revision as an OCI label AND an env var
(``IMAGE_REVISION`` = the git SHA the image was built from); a container whose
running code does not match the image it claims to be is not reproducible.

Import-safe: no env or subprocess at import; everything runs at call time.
"""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path

from factorylm_ai.capability_codes import (
    DIRTY_WORKTREE,
    REVISION_MISMATCH,
    CapabilityError,
)


@dataclass(frozen=True)
class Provenance:
    git_sha: str | None
    git_dirty: bool | None
    image_revision: str | None
    allow_dirty: bool

    def to_dict(self) -> dict:
        return {
            "git_sha": self.git_sha,
            "git_dirty": self.git_dirty,
            "image_revision": self.image_revision,
            "allow_dirty": self.allow_dirty,
        }


# ── seams (monkeypatched by tests) ──────────────────────────────────────────


def _git(*args: str) -> str | None:
    try:
        return (
            subprocess.run(["git", *args], capture_output=True, timeout=10, check=True)
            .stdout.decode()
            .strip()
        )
    except Exception:  # noqa: BLE001 — absence of git is a state, handled by the caller
        return None


def _git_sha() -> str | None:
    return _git("rev-parse", "HEAD")


def _git_dirty() -> bool | None:
    out = _git("status", "--porcelain")
    return None if out is None else bool(out.strip())


def _env(name: str) -> str | None:
    import os  # noqa: PLC0415 — call-time env read

    val = os.getenv(name)
    return val.strip() if val else None


def collect_provenance() -> Provenance:
    """Gather runtime provenance and ENFORCE the controlled-run gates.

    Two legitimate identity sources:

    * **Live git** (dev / worktree): ``git rev-parse HEAD`` is the SHA and the
      dirty check applies. A dirty tree is refused unless ``ALLOW_DIRTY_POTD=1``.
    * **Built container** (no live ``.git``): the baked ``IMAGE_REVISION`` label
      IS the identity — a built image is immutable, so it is clean by
      construction. This is the reproducible production path.

    Raises ``CapabilityError`` when a controlled run must not proceed:

    * neither a git SHA nor ``IMAGE_REVISION`` is available -> ``DIRTY_WORKTREE``
      (no verifiable identity at all),
    * a dirty git tree without the dev override -> ``DIRTY_WORKTREE``,
    * live git SHA disagrees with ``IMAGE_REVISION`` -> ``REVISION_MISMATCH``
      (the container is not the image it claims to be).
    """
    git_sha = _git_sha()
    image_revision = _env("IMAGE_REVISION")
    allow_dirty = _env("ALLOW_DIRTY_POTD") in {"1", "true", "on"}

    if git_sha is None and image_revision is None:
        raise CapabilityError(
            DIRTY_WORKTREE,
            "no verifiable revision — neither a git SHA nor IMAGE_REVISION is available",
        )

    if git_sha is not None:
        dirty = _git_dirty()
        if dirty and not allow_dirty:
            raise CapabilityError(
                DIRTY_WORKTREE,
                "working tree is dirty — set ALLOW_DIRTY_POTD=1 for a NON-REPRODUCIBLE dev run",
            )
        if image_revision and image_revision != git_sha:
            raise CapabilityError(
                REVISION_MISMATCH,
                f"running code {git_sha[:12]} != image revision {image_revision[:12]} "
                "(the container is not the image it claims to be)",
            )
        return Provenance(
            git_sha=git_sha,
            git_dirty=dirty,
            image_revision=image_revision,
            allow_dirty=allow_dirty,
        )

    # Container path: no live git, so IMAGE_REVISION is the authoritative,
    # immutable identity.
    return Provenance(
        git_sha=image_revision,
        git_dirty=False,
        image_revision=image_revision,
        allow_dirty=allow_dirty,
    )


def sha256_file(path: str | Path) -> str:
    """Content hash of an artifact (FR-7 artifact hashes)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_hashes(paths: list[str | Path]) -> dict[str, str]:
    """{filename: sha256} for every existing artifact in ``paths``."""
    out: dict[str, str] = {}
    for p in paths:
        p = Path(p)
        if p.exists() and p.is_file():
            out[p.name] = sha256_file(p)
    return out
