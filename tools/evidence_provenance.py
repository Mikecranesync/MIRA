"""Evidence provenance and observation-proof checks for the capability registry.

WHY THIS EXISTS
---------------
`tools/capability_closure.py` already answers "is this capability connected,
CI-exercised, enabled and rolled back?" It checks that each `evidence:` entry
points at a file that EXISTS. That is where it stops, and the stop is the gap.

Today an evidence entry is a path plus prose. The prose may say "production
proof 2026-09-06 ... Hub deployed at main fb60a0102" — but nothing verifies
that `fb60a0102` is a real commit, nothing notices when the capability's code
moves past it, and nothing asks the question that actually decides whether the
evidence means anything:

    Was the mechanism that produced this observation ever shown to work?

Two real defects in this repository motivated these checks, and both looked
correct while encoding a false assumption:

  * an acceptance harness queried an endpoint that did not exist, and a second
    revision queried a real endpoint with an identifier that could never match
    it (`decision_traces.turn_id` is the notebook turn row id, not the caller's
    client request id). Every packet assertion would have failed, and the
    failure would have been charged to the product.
  * a guard enumerated the Unicode characters that had been OBSERVED rather
    than closing the category, so it passed against its own examples.

In both cases the test was green or red for reasons unrelated to the product.
An observation path that has not demonstrated a positive and a negative control
cannot distinguish "the product is broken" from "I cannot see".

WHAT THESE CHECKS ENFORCE
-------------------------
  provenance_missing          evidence for an enabled state has no provenance
  provenance_sha_unknown      commit_sha does not resolve in this repository
  provenance_sha_unreachable  commit_sha exists but only a mutable branch can reach it
  provenance_env_invalid      environment is not a recognised one
  provenance_no_falsifier     no stated experiment that would disprove it
  observation_unproven        no positive AND negative control named
  observation_control_missing a named control does not resolve to a real file
  evidence_inconclusive_as_proof   an INCONCLUSIVE observation used as proof
  evidence_stale_for_code     capability code moved past the evidence commit

NOT RETROACTIVE, ON PURPOSE
---------------------------
Existing records predate this schema. Failing them would either turn main red
or invite a blanket acknowledgement, and a rule everyone silences is not a
rule. `meta.provenance_enforced_from` is an ISO date: evidence `observed_at`
on or after it must carry provenance. Older entries are reported as
informational only. Move the date forward deliberately, never silently.
"""

from __future__ import annotations

import ast
import datetime as _dt
import os
import re
import subprocess
from pathlib import Path

# Environments an observation can come from. `emulator` and `device` are
# deliberately DISTINCT: emulator evidence can never satisfy a physical-device
# requirement, and collapsing them is how that substitution goes unnoticed.
VALID_ENVIRONMENTS = {
    "ci",
    "local",
    "dev",
    "staging",
    "production",
    "emulator",
    "device",
}

# An observation either saw what it claims, saw the opposite, or could not see.
# The third is not a failure of the product and must never be counted as one —
# nor may it be counted as proof.
OUTCOMES = {"pass", "fail", "inconclusive"}

_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")


class Finding:
    """Mirrors capability_closure.Finding so findings merge into one report."""

    __slots__ = ("cap", "rule", "message", "acknowledged")

    def __init__(self, cap: str, rule: str, message: str) -> None:
        self.cap, self.rule, self.message = cap, rule, message
        self.acknowledged = False

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"[{self.rule}] {self.cap}: {self.message}"


def history_is_complete(root: Path) -> bool:
    """Can this checkout answer "does commit X exist?" at all?

    CI checks out `refs/pull/N/merge` with `fetch-depth: 1`. Git runs fine
    there and `cat-file -e` legitimately reports "no such object" for a commit
    that is perfectly real on the branch — the object was simply never fetched.
    Treating that as a fabricated SHA is precisely the product-vs-observation
    confusion this module exists to prevent, and it is how the FIRST version of
    this check turned a valid record red on its own first CI run.

    So the existence check is only a verdict when history is complete. On a
    shallow or partial clone the observation is INCONCLUSIVE, and an
    inconclusive observation is not a finding.
    """
    try:
        for flag in ("--is-shallow-repository",):
            r = subprocess.run(
                ["git", "-C", str(root), "rev-parse", flag],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if r.returncode == 0 and r.stdout.strip().lower() == "true":
                return False
        # A partial (blobless/treeless) clone can also lack objects.
        r = subprocess.run(
            ["git", "-C", str(root), "config", "--get", "remote.origin.partialclonefilter"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if r.returncode == 0 and r.stdout.strip():
            return False
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def commit_exists(root: Path, sha: str) -> bool:
    """Is this a real commit object in this repository?

    A prose SHA is worth nothing if it was mistyped, or belongs to a branch that
    was force-pushed away. `cat-file -e <sha>^{commit}` answers exactly that and
    nothing more — it deliberately does NOT assert reachability from main, so
    evidence gathered on a feature branch stays valid.

    Returns True when the question cannot be answered here (missing git,
    shallow/partial clone). That is deliberate: see `history_is_complete`.
    """
    if not _SHA_RE.match(sha or ""):
        return False
    if not history_is_complete(root):
        return True
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "cat-file", "-e", f"{sha}^{{commit}}"],
            capture_output=True,
            timeout=15,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        # Cannot tell. Fail OPEN here on purpose: a missing git binary is an
        # environment fault, and turning it into a false "this SHA is fake"
        # would be the very confusion these checks exist to prevent.
        return True


# Refs whose history does not get deleted. A squash-merge repository orphans
# every feature-branch commit the moment the branch is deleted, so a commit that
# merely EXISTS today can vanish tomorrow — and `provenance_sha_unknown` then
# fails the capability-closure job, and with it CI Gate, for every PR (#3974
# post-merge review). Evidence must be pinned to history that stays.
# A tag also anchors evidence, but a tag is only as durable as its protection:
# pin evidence to its squash commit on main once that exists (#4007 review).
DURABLE_BASE_REFS = ("origin/main", "main")


def commit_is_durable(root: Path, sha: str) -> bool | None:
    """Is `sha` reachable from the default branch or from a tag?

    True/False is a verdict; None means "cannot tell here" (shallow/partial
    clone, no base ref fetched, git missing) and is never a finding, for the
    same reason as `commit_exists`. `EVIDENCE_BASE_REF` overrides the base ref
    for tests; CI must not set it (a mutable ref is not durable history).
    """
    if not history_is_complete(root):
        return None
    refs = (
        [os.environ["EVIDENCE_BASE_REF"]]
        if os.environ.get("EVIDENCE_BASE_REF")
        else list(DURABLE_BASE_REFS)
    )
    try:
        base = None
        for ref in refs:
            r = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if r.returncode == 0:
                base = ref
                break
        if base is None:
            return None
        r = subprocess.run(
            ["git", "-C", str(root), "merge-base", "--is-ancestor", sha, base],
            capture_output=True,
            timeout=30,
        )
        if r.returncode == 0:
            return True
        if r.returncode != 1:
            return None  # git error (bad object etc.): not a verdict
        any_tag = subprocess.run(
            ["git", "-C", str(root), "tag", "--list"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if any_tag.returncode != 0 or not any_tag.stdout.strip():
            # No tags fetched at all is a checkout setting, not a defect: a
            # False here would turn every PR red on fetch-tags alone.
            return None
        tags = subprocess.run(
            ["git", "-C", str(root), "tag", "--contains", sha],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return tags.returncode == 0 and bool(tags.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return None


def paths_changed_since(root: Path, sha: str, paths: list[str]) -> list[str]:
    """Which of `paths` changed between `sha` and HEAD.

    This is what makes evidence EXPIRE against code rather than against the
    calendar. A proof of behaviour is a proof of the behaviour of one tree.
    """
    if not paths or not history_is_complete(root):
        # Same reasoning as commit_exists: on a shallow clone `git diff sha..HEAD`
        # cannot be trusted, and a wrong "your evidence is stale" is as bad as a
        # wrong "your evidence is fine".
        return []
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "diff", "--name-only", f"{sha}..HEAD", "--", *paths],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if r.returncode != 0:
            return []
        return [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


def _control_resolves(root: Path, ref: str) -> bool:
    """Resolve files and Python test node names without executing source code."""
    parts = str(ref).split("::")
    path = root / parts[0].split(":", 1)[0].strip()
    if not ref or not path.is_file():
        return False
    if len(parts) == 1:
        return True
    if path.suffix != ".py":
        return False  # Named controls need a supported, inspectable syntax.
    try:
        scope = ast.parse(path.read_text()).body
        for name in parts[1:]:
            node = next(
                (
                    n
                    for n in scope
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                    and n.name == name.split("[", 1)[0]
                ),
                None,
            )
            if node is None:
                return False
            scope = node.body
        return True
    except (OSError, SyntaxError, UnicodeError):
        return False


def check_evidence_item(
    cap_id: str,
    item: dict,
    *,
    root: Path,
    enabled: bool,
    enforced_from: _dt.date | None,
    code_paths: list[str],
) -> list[Finding]:
    """Validate one evidence entry. Returns findings (possibly empty)."""
    out: list[Finding] = []
    if not isinstance(item, dict):
        return out

    prov = item.get("provenance")
    observed_at = (
        item.get("observed_at") or (prov or {}).get("observed_at") or item.get("recorded_at")
    )
    if enabled and enforced_from and not observed_at:
        out.append(
            Finding(
                cap_id,
                "provenance_date_missing",
                "enabled evidence needs an observation date or a historical recorded_at date",
            )
        )

    in_scope = False
    if enforced_from and observed_at:
        try:
            in_scope = _dt.date.fromisoformat(str(observed_at)[:10]) >= enforced_from
        except ValueError:
            out.append(
                Finding(
                    cap_id, "provenance_date_malformed", f"observed_at not ISO: {observed_at!r}"
                )
            )

    if not prov:
        if enabled and in_scope:
            out.append(
                Finding(
                    cap_id,
                    "provenance_missing",
                    f"evidence {item.get('path')!r} backs an enabled state but records no "
                    "provenance — a path plus prose cannot be reproduced or dated to a tree",
                )
            )
        return out

    # ---- outcome ---------------------------------------------------------
    outcome = str(prov.get("outcome", "pass")).lower()
    if outcome not in OUTCOMES:
        out.append(
            Finding(
                cap_id,
                "provenance_outcome_invalid",
                f"outcome {outcome!r} not in {sorted(OUTCOMES)}",
            )
        )
    if outcome == "inconclusive" and enabled:
        out.append(
            Finding(
                cap_id,
                "evidence_inconclusive_as_proof",
                f"evidence {item.get('path')!r} is INCONCLUSIVE — the observation did not "
                "establish anything, so it cannot support an enabled state",
            )
        )

    if outcome == "fail" and enabled:
        out.append(
            Finding(
                cap_id,
                "evidence_failed_as_proof",
                "failed evidence cannot support an enabled state",
            )
        )

    # ---- identity --------------------------------------------------------
    sha = str(prov.get("commit_sha") or "")
    if not sha:
        out.append(Finding(cap_id, "provenance_sha_missing", "provenance has no commit_sha"))
    elif not commit_exists(root, sha):
        out.append(
            Finding(cap_id, "provenance_sha_unknown", f"commit_sha {sha!r} is not a commit here")
        )
    elif commit_is_durable(root, sha) is False:
        out.append(
            Finding(
                cap_id,
                "provenance_sha_unreachable",
                f"commit_sha {sha[:12]} is reachable only from a mutable branch — deleting that "
                "branch (routine after a squash merge) would fail CI for every PR. Stamp a "
                "commit on main or a tag",
            )
        )
    elif code_paths:
        moved = paths_changed_since(root, sha, code_paths)
        if moved:
            out.append(
                Finding(
                    cap_id,
                    "evidence_stale_for_code",
                    f"evidence was observed at {sha[:12]} but {len(moved)} declared code path(s) "
                    f"changed since (e.g. {moved[0]}) — re-observe or narrow the claim",
                )
            )

    env = str(prov.get("environment") or "")
    if env not in VALID_ENVIRONMENTS:
        out.append(
            Finding(
                cap_id,
                "provenance_env_invalid",
                f"environment {env!r} not in {sorted(VALID_ENVIRONMENTS)}",
            )
        )

    # ---- falsification ---------------------------------------------------
    if not str(prov.get("falsified_by") or "").strip():
        out.append(
            Finding(
                cap_id,
                "provenance_no_falsifier",
                "no `falsified_by` — a claim nobody can imagine disproving is not a finding",
            )
        )

    # ---- the observation path must have proved itself --------------------
    obs = prov.get("observation") or {}
    pos, neg = obs.get("positive_control"), obs.get("negative_control")
    if not pos or not neg:
        out.append(
            Finding(
                cap_id,
                "observation_unproven",
                "observation names no positive AND negative control — without both, a green "
                "result cannot be told apart from an observation path that sees nothing",
            )
        )
    else:
        for label, ref in (("positive", pos), ("negative", neg)):
            if not _control_resolves(root, str(ref)):
                out.append(
                    Finding(
                        cap_id,
                        "observation_control_missing",
                        f"{label} control {ref!r} does not resolve to a file in this repo",
                    )
                )
    return out


def check_capability(cap: dict, root: Path, enforced_from: _dt.date | None) -> list[Finding]:
    from_states = {"canary_enabled", "staging_enabled", "production_enabled"}
    cap_id = str(cap.get("id", "<no id>"))
    enabled = str(cap.get("state", "")) in from_states
    code_paths = [str(p) for p in (cap.get("code_paths") or [])]
    out: list[Finding] = []
    for item in cap.get("evidence") or []:
        out += check_evidence_item(
            cap_id,
            item,
            root=root,
            enabled=enabled,
            enforced_from=enforced_from,
            code_paths=code_paths,
        )
    return out


def enforced_from_of(registry: dict) -> _dt.date | None:
    raw = (registry.get("meta") or {}).get("provenance_enforced_from")
    if not raw:
        return None
    try:
        return _dt.date.fromisoformat(str(raw))
    except ValueError:
        return None


def check_registry(registry: dict, root: Path) -> list[Finding]:
    enforced_from = enforced_from_of(registry)
    out: list[Finding] = []
    for cap in registry.get("capabilities") or []:
        out += check_capability(cap, root, enforced_from)
    return out
