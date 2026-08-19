#!/usr/bin/env python3
"""Capability-closure validator — "merged" is not "done".

A capability is done when it is CONNECTED to a real consumer, EXERCISED by a
named CI job, ENABLED somewhere real, and PROVEN with runtime evidence — or when
a documented decision explicitly blocks, defers, or retires it.

This validates `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` against
the repository, so the registry cannot drift into a hand-maintained narrative.

    py tools/capability_closure.py            # validate
    py tools/capability_closure.py --discover # list gate flags the registry omits

Why it exists (the defect that motivated every rule below): on 2026-08-19
`MIRA_ENFORCE_APPROVED_RETRIEVAL` was found set to `'true'` in `factorylm/prd`
while **no compose file forwarded it to any container**, so the code read its
`"false"` default and the approved-context gate was configured ON and enforced
OFF (#3328). Doppler said one thing, the running code did another, and nothing
reported the disagreement. `check_enabled_flags_are_plumbed` is that check.

DELIBERATE NON-GOAL: this does not read Doppler. Secret state is environment
truth, not repository truth, needs credentials CI may not have, and changes
without a commit. The registry records an OBSERVED value with the date and who
observed it; this validator checks the repository-side invariants that must hold
for such a value to mean anything.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_REL = "docs/architecture/convergence/CAPABILITY_CLOSURE.yaml"
CI_REL = ".github/workflows/ci.yml"

# States a capability may occupy. Ordered loosely by progress toward closure.
STATES = {
    "implemented_unconnected",  # code exists, nothing consumes it
    "connected_ci_missing",  # a consumer exists, no named CI job runs its tests
    "deployed_disabled",  # shipped, flag off everywhere
    "staging_enabled",
    "production_enabled",
    "blocked",
    "deferred",
    "retired",
}

# States that assert the capability is live somewhere.
ENABLED_STATES = {"staging_enabled", "production_enabled"}

REQUIRED_FIELDS = ("id", "purpose", "state", "owner", "environments", "evidence")

_ON = {"1", "true", "on", "enabled"}


class Finding:
    __slots__ = ("cap", "rule", "message", "acknowledged")

    def __init__(self, cap: str, rule: str, message: str) -> None:
        self.cap, self.rule, self.message = cap, rule, message
        self.acknowledged = False

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"[{self.rule}] {self.cap}: {self.message}"


# --------------------------------------------------------------------------
# repository facts
# --------------------------------------------------------------------------
def code_flag_defaults(root: Path) -> dict[str, str | None]:
    """Every gate-ish env flag read by runtime code, mapped to its default."""
    # Direct: os.getenv("FLAG", "default")
    pat = re.compile(r'os\.getenv\(\s*["\']([A-Z][A-Z0-9_]*)["\']\s*(?:,\s*["\']([^"\']*)["\'])?')
    # Indirect: _FLAG_ENV = "FLAG"  ... os.getenv(_FLAG_ENV, ...). Literal-only
    # matching missed MIRA_CONTEXT_CONTRACT, which technician_context.py:61 binds
    # to a module constant first — a scanner that cannot see that under-reports.
    indirect = re.compile(r'^\s*_?[A-Z][A-Z0-9_]*\s*=\s*["\']([A-Z][A-Z0-9_]{3,})["\']', re.M)
    out: dict[str, str | None] = {}
    for pkg in (
        "mira-bots",
        "mira-crawler",
        "mira-pipeline",
        "mira-relay",
        "mira-mcp",
        "materialized_evidence",
    ):
        base = root / pkg
        if not base.exists():
            continue
        for f in base.rglob("*.py"):
            s = str(f)
            if ".venv" in s or "node_modules" in s or "/tests/" in s:
                continue
            try:
                txt = f.read_text(errors="replace")
            except OSError:  # pragma: no cover
                continue
            for m in pat.finditer(txt):
                name, dflt = m.group(1), m.group(2)
                if not re.search(r"ENABLED|ENFORCE|CONTRACT|GATE", name):
                    continue
                out.setdefault(name, dflt)
            for m in indirect.finditer(txt):
                name = m.group(1)
                if not re.search(r"ENABLED|ENFORCE|CONTRACT|GATE", name):
                    continue
                out.setdefault(name, None)
    return out


def compose_plumbed_flags(root: Path) -> set[str]:
    """Flags any docker-compose file forwards into a container."""
    names: set[str] = set()
    for p in sorted(root.glob("docker-compose*.yml")):
        txt = p.read_text(errors="replace")
        for line in txt.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for m in re.finditer(r"\b([A-Z][A-Z0-9_]{3,})\s*[:=]", stripped):
                names.add(m.group(1))
    return names


def ci_job_ids(root: Path) -> set[str]:
    """Top-level job ids declared in ci.yml (raw scan; the file has anchors)."""
    ci = root / CI_REL
    if not ci.exists():
        return set()
    return {
        m.group(1)
        for m in re.finditer(r"^  ([a-z][a-z0-9-]+):\s*$", ci.read_text(errors="replace"), re.M)
    }


def ci_gate_needs(root: Path) -> set[str]:
    """Jobs the merge gate (`ci-gate`) actually depends on."""
    ci = root / CI_REL
    if not ci.exists():
        return set()
    txt = ci.read_text(errors="replace")
    m = re.search(r"^  ci-gate:.*?^    needs:\n((?:      - .*\n)+)", txt, re.M | re.S)
    if not m:
        return set()
    return {ln.strip().lstrip("- ").strip() for ln in m.group(1).splitlines() if ln.strip()}


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------
def check_required_fields(cap: dict) -> list[Finding]:
    cid = cap.get("id", "<no id>")
    out = []
    for f in REQUIRED_FIELDS:
        if f not in cap:
            out.append(Finding(cid, "required_field", f"missing `{f}`"))
    state = cap.get("state")
    if state is not None and state not in STATES:
        out.append(Finding(cid, "state_vocabulary", f"unknown state {state!r}"))
    if cap.get("acknowledged_rules") and not cap.get("blocker"):
        out.append(
            Finding(
                cid,
                "acknowledgement_without_blocker",
                "`acknowledged_rules` set with no `blocker` naming the tracking "
                "issue — an acknowledged defect must be a filed one",
            )
        )
    if cap.get("owner") in (None, "", "unknown") and not cap.get("owner_missing"):
        out.append(
            Finding(
                cid,
                "owner",
                "no owner — set one, or set `owner_missing:` "
                "to the blocker that prevents assigning one",
            )
        )
    return out


def check_disabled_has_a_decision(cap: dict) -> list[Finding]:
    """A flag that is off everywhere must say why, and when that is revisited.

    An off flag is legitimate. An off flag nobody owns, with no promotion
    criterion and no review date, is indistinguishable from a forgotten one —
    that ambiguity is the defect, not the off-state.
    """
    cid = cap.get("id", "<no id>")
    envs = cap.get("environments") or {}
    if any(str(v).lower() in _ON for v in envs.values()):
        return []
    if cap.get("state") in {"retired", "blocked", "deferred"}:
        need = ("reason",)
    else:
        need = ("reason", "promotion_criteria", "review_by")
    out = []
    for f in need:
        if not cap.get(f):
            out.append(
                Finding(
                    cid, "disabled_without_decision", f"off in every environment but has no `{f}`"
                )
            )
    return out


def check_enabled_flags_are_plumbed(cap: dict, plumbed: set[str]) -> list[Finding]:
    """THE #3328 RULE.

    If the registry records a flag as enabled in an environment, some compose
    file must forward that flag into a container. Otherwise the value is set in
    the secret store, never reaches the process, and the code silently uses its
    default — which is exactly how the approved-context retrieval gate came to
    be configured ON and enforced OFF in production.
    """
    cid = cap.get("id", "<no id>")
    flag = cap.get("feature_flag")
    if not flag:
        return []
    envs = cap.get("environments") or {}
    live = [e for e, v in envs.items() if str(v).lower() in _ON]
    if not live:
        return []
    if flag not in plumbed:
        return [
            Finding(
                cid,
                "enabled_but_unplumbed",
                f"`{flag}` is recorded enabled in {', '.join(sorted(live))} but no "
                f"docker-compose*.yml forwards it into a container — the process will "
                f"read its code default instead (#3328)",
            )
        ]
    return []


def check_flag_exists_in_code(cap: dict, defaults: dict[str, str | None]) -> list[Finding]:
    cid = cap.get("id", "<no id>")
    flag = cap.get("feature_flag")
    if not flag or flag in defaults:
        return []
    return [
        Finding(
            cid,
            "flag_not_in_code",
            f"`{flag}` is not read by any runtime module — stale registry entry, or the flag moved",
        )
    ]


def check_ci_jobs_exist(cap: dict, jobs: set[str], gated: set[str]) -> list[Finding]:
    """Declared CI jobs must be real, and `required_checks` must be honest."""
    cid = cap.get("id", "<no id>")
    out = []
    for j in cap.get("ci_jobs") or []:
        if j not in jobs:
            out.append(
                Finding(
                    cid, "ci_job_missing", f"declares CI job `{j}` which does not exist in ci.yml"
                )
            )
    for j in cap.get("required_checks") or []:
        if j not in gated:
            out.append(
                Finding(
                    cid,
                    "required_check_false",
                    f"claims `{j}` is a required check, but it is not in ci-gate's "
                    f"needs — a job that runs but cannot fail the merge is not a guard",
                )
            )
    return out


def check_evidence_paths_exist(cap: dict, root: Path) -> list[Finding]:
    cid = cap.get("id", "<no id>")
    out = []
    for e in cap.get("evidence") or []:
        p = e.get("path") if isinstance(e, dict) else e
        if not p or str(p).startswith(("http://", "https://")):
            continue
        if not (root / str(p)).exists():
            out.append(Finding(cid, "evidence_missing", f"evidence path does not exist: {p}"))
    return out


def check_production_has_rollback(cap: dict) -> list[Finding]:
    cid = cap.get("id", "<no id>")
    envs = cap.get("environments") or {}
    if str(envs.get("production", "")).lower() not in _ON:
        return []
    out = []
    if not cap.get("rollback"):
        out.append(
            Finding(
                cid, "production_no_rollback", "enabled in production with no `rollback` recorded"
            )
        )
    if not cap.get("evidence"):
        out.append(
            Finding(
                cid,
                "production_no_evidence",
                "enabled in production with no `evidence` — enabled is not proven",
            )
        )
    return out


def check_review_not_expired(cap: dict, today: _dt.date) -> list[Finding]:
    cid = cap.get("id", "<no id>")
    rb = cap.get("review_by")
    if not rb:
        return []
    try:
        due = _dt.date.fromisoformat(str(rb))
    except ValueError:
        return [Finding(cid, "review_by_malformed", f"`review_by` is not ISO date: {rb!r}")]
    if due < today:
        return [
            Finding(
                cid,
                "review_expired",
                f"`review_by` {due} has passed — re-decide or move the date with a reason",
            )
        ]
    return []


def validate(registry: dict, root: Path, today: _dt.date | None = None) -> list[Finding]:
    today = today or _dt.date.today()
    defaults = code_flag_defaults(root)
    plumbed = compose_plumbed_flags(root)
    jobs = ci_job_ids(root)
    gated = ci_gate_needs(root)

    findings: list[Finding] = []
    caps = registry.get("capabilities") or []
    seen: set[str] = set()
    for cap in caps:
        cid = cap.get("id")
        if cid in seen:
            findings.append(Finding(str(cid), "duplicate_id", "duplicate capability id"))
        seen.add(cid)
        findings += check_required_fields(cap)
        findings += check_disabled_has_a_decision(cap)
        findings += check_enabled_flags_are_plumbed(cap, plumbed)
        findings += check_flag_exists_in_code(cap, defaults)
        findings += check_ci_jobs_exist(cap, jobs, gated)
        findings += check_evidence_paths_exist(cap, root)
        findings += check_production_has_rollback(cap)
        findings += check_review_not_expired(cap, today)

    # A defect that is FILED and TRACKED is a different state from an unknown
    # one. `acknowledged_rules` marks findings that a named issue already
    # covers: they stay visible in the output but do not fail the run. It is
    # per-RULE on purpose — acknowledging `enabled_but_unplumbed` must not also
    # silence a future `production_no_rollback` on the same capability.
    ack: dict[str, set[str]] = {c.get("id"): set(c.get("acknowledged_rules") or []) for c in caps}
    for f in findings:
        if f.rule in ack.get(f.cap, set()):
            f.acknowledged = True
    return findings


def discover_unregistered(registry: dict, root: Path) -> list[str]:
    """Gate flags the code reads that the registry does not mention.

    A new flag may not stay anonymous: this is what stops the inventory decaying
    the moment someone adds `os.getenv("MIRA_SOMETHING_ENABLED", "0")`.
    """
    known = {c.get("feature_flag") for c in (registry.get("capabilities") or [])}
    known |= set(registry.get("ignored_flags") or [])
    return sorted(f for f in code_flag_defaults(root) if f not in known)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate the capability-closure registry")
    ap.add_argument(
        "--discover", action="store_true", help="list gate flags the registry does not account for"
    )
    ap.add_argument("--registry", default=REGISTRY_REL)
    a = ap.parse_args(argv)

    path = ROOT / a.registry
    if not path.exists():
        print(f"error: registry not found at {a.registry}", file=sys.stderr)
        return 2
    registry = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    if a.discover:
        missing = discover_unregistered(registry, ROOT)
        if missing:
            print("Gate flags read by code but absent from the registry:")
            for f in missing:
                print(f"  - {f}")
            print("\nAdd each to `capabilities:` or to `ignored_flags:` with a reason.")
            return 1
        print("Every gate flag in code is accounted for.")
        return 0

    findings = validate(registry, ROOT)
    blocking = [f for f in findings if not f.acknowledged]
    acked = [f for f in findings if f.acknowledged]
    if acked:
        print(f"Capability closure: {len(acked)} acknowledged (filed, tracked):")
        for f in acked:
            print(f"  ACK {f}")
        print()
    if blocking:
        print(f"Capability closure: {len(blocking)} finding(s)\n", file=sys.stderr)
        for f in blocking:
            print(f"  {f}", file=sys.stderr)
        print(
            "\nA capability is done when it is connected, tested by a named CI job, "
            "enabled somewhere real, and proven — or explicitly blocked/deferred/retired.",
            file=sys.stderr,
        )
        return 1
    n = len(registry.get("capabilities") or [])
    print(
        f"Capability closure: {n} capabilities, all records complete ({len(acked)} acknowledged)."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
