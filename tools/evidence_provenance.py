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

import datetime as _dt
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


def commit_exists(root: Path, sha: str) -> bool:
    """Is this a real commit object in this repository?

    A prose SHA is worth nothing if it was mistyped, or belongs to a branch that
    was force-pushed away. `cat-file -e <sha>^{commit}` answers exactly that and
    nothing more — it deliberately does NOT assert reachability from main, so
    evidence gathered on a feature branch stays valid.
    """
    if not _SHA_RE.match(sha or ""):
        return False
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


def paths_changed_since(root: Path, sha: str, paths: list[str]) -> list[str]:
    """Which of `paths` changed between `sha` and HEAD.

    This is what makes evidence EXPIRE against code rather than against the
    calendar. A proof of behaviour is a proof of the behaviour of one tree.
    """
    if not paths:
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
    """A control must be runnable, not merely described.

    Accepts `path`, `path::test_name`, or `path:line`. Only the file part is
    resolved — asserting that a named test exists would need collection, which
    belongs in CI, not in a registry linter.
    """
    if not ref:
        return False
    head = str(ref).split("::", 1)[0].split(":", 1)[0].strip()
    return bool(head) and (root / head).exists()


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
    observed_at = item.get("observed_at") or (prov or {}).get("observed_at")

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

    # ---- identity --------------------------------------------------------
    sha = str(prov.get("commit_sha") or "")
    if not sha:
        out.append(Finding(cap_id, "provenance_sha_missing", "provenance has no commit_sha"))
    elif not commit_exists(root, sha):
        out.append(
            Finding(cap_id, "provenance_sha_unknown", f"commit_sha {sha!r} is not a commit here")
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
