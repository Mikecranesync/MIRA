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
import hashlib
import json
import re
import sys
from pathlib import Path

import yaml

# Sibling module, imported by path rather than by package: `tools/` is not a
# package and this script is run as `python3 tools/capability_closure.py` from
# the repo root AND imported by tests from elsewhere. A bare import works only
# in the first case, which is exactly the kind of "green on my machine" seam
# this change exists to remove.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import evidence_provenance  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_REL = "docs/architecture/convergence/CAPABILITY_CLOSURE.yaml"
CI_REL = ".github/workflows/ci.yml"

# States a capability may occupy. Ordered loosely by progress toward closure.
STATES = {
    "implemented_unconnected",  # code exists, nothing consumes it
    "connected_ci_missing",  # a consumer exists, no named CI job runs its tests
    "canary_enabled",  # opt-in tester delivery; not staging or production default
    "deployed_disabled",  # shipped, flag off everywhere
    "staging_enabled",
    "production_enabled",
    "blocked",
    "deferred",
    "retired",
}

# States that assert the capability is live somewhere.
ENABLED_STATES = {"canary_enabled", "staging_enabled", "production_enabled"}

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


def workflow_job_inventory(root: Path) -> tuple[set[str], set[str]]:
    """Return qualified job ids and display names from every Actions workflow.

    ``ci.yml`` job ids remain the vocabulary used by ``ci-gate.needs``. Jobs
    in standalone workflows are qualified as ``<filename>:<job-id>`` so the
    capability registry can name their source without colliding with another
    workflow. Display names let a dated live branch-protection observation be
    checked against an actual repository-owned producer. This deliberately
    does not claim to read GitHub branch protection; that external state is
    represented by ``required_checks_observed_on`` in the capability record.
    """
    job_refs: set[str] = set()
    check_names: set[str] = set()
    workflow_dir = root / ".github" / "workflows"
    for path in sorted((*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml"))):
        try:
            document = yaml.safe_load(path.read_text(errors="replace")) or {}
        except (OSError, yaml.YAMLError):
            continue
        jobs = document.get("jobs") if isinstance(document, dict) else None
        if not isinstance(jobs, dict):
            continue
        for job_id, job in jobs.items():
            job_refs.add(f"{path.name}:{job_id}")
            if isinstance(job, dict) and isinstance(job.get("name"), str):
                check_names.add(job["name"])
    return job_refs, check_names


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


def check_ci_jobs_exist(
    cap: dict,
    jobs: set[str],
    gated: set[str],
    workflow_check_names: set[str] | None = None,
) -> list[Finding]:
    """Declared CI jobs must be real, and required-check claims sourced.

    A required check outside ``ci-gate`` is accepted only when a repository
    workflow produces that exact display name and the record dates the live
    branch-protection read. The offline validator can prove the producer, not
    GitHub settings; the date keeps that limitation explicit.
    """
    cid = cap.get("id", "<no id>")
    out = []
    workflow_check_names = workflow_check_names or set()
    for j in cap.get("ci_jobs") or []:
        if j not in jobs:
            out.append(
                Finding(
                    cid, "ci_job_missing", f"declares CI job `{j}` which does not exist in ci.yml"
                )
            )
    for j in cap.get("required_checks") or []:
        if j in gated:
            continue
        if j in workflow_check_names:
            observed = cap.get("required_checks_observed_on")
            try:
                if isinstance(observed, str):
                    _dt.date.fromisoformat(observed)
                    continue
            except ValueError:
                pass
            out.append(
                Finding(
                    cid,
                    "required_check_observation_missing",
                    f"external required check `{j}` has a workflow producer but no "
                    "ISO-dated `required_checks_observed_on` live GitHub observation",
                )
            )
        else:
            out.append(
                Finding(
                    cid,
                    "required_check_false",
                    f"claims `{j}` is a required check, but it is neither in ci-gate's "
                    "needs nor the exact display name of a repository workflow job",
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


# `fixed` is not a disposition (#5169 r3 F2): a fixed loss is shown by a newer
# replay in which the case no longer loses, and the listed losses must equal
# the computed ones, so pointing `artifact` at that replay drops it. The
# original artifact stays committed as history.
LOSS_DISPOSITIONS = {"open", "accepted"}
_OFF = {"0", "false", "off", "unset", ""}
_FLAG_RE = re.compile(r"[A-Z][A-Z0-9_]+")
_HUB_ENV_READ = re.compile(
    r"process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*[\"']([A-Z][A-Z0-9_]+)[\"']\s*\])"
)


def hub_env_reads(root: Path) -> set[str]:
    """Environment variables the Hub's production TypeScript reads."""
    out: set[str] = set()
    for p in (root / "mira-hub" / "src").rglob("*.ts*"):
        if "__tests__" in p.parts or p.suffix not in (".ts", ".tsx"):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        out |= {a or b for a, b in _HUB_ENV_READ.findall(text)}
    return out


# An owner decision, and the optional replay discussion link, must be a durable
# record in this repository's GitHub history (an issue or PR, optionally one
# comment), not free text (#5169 r1 F2).
_DURABLE_REF_RE = re.compile(
    r"https://github\.com/Mikecranesync/MIRA/(?:issues|pull)/\d+(?:#issuecomment-\d+)?"
)

# Rules a tracked blocker may NOT silence. An open regression in production is
# cleared by fixing it or by an owner decision on that loss, never by naming an
# issue in `acknowledged_rules` (#5169 F1).
NON_ACKNOWLEDGEABLE_RULES = {"retrieval_promotion_evidence"}


def _is_on(value: object) -> bool:
    return str(value).strip().lower() in _ON


def _live_in_production(cap: dict) -> bool:
    envs = cap.get("environments") or {}
    return _is_on(envs.get("production", "")) or cap.get("state") == "production_enabled"


def check_retrieval_promotion_evidence(
    cap: dict, root: Path, registry: dict, hub_reads: set[str] | None = None
) -> list[Finding]:
    """A retrieval experiment is not promoted on a net score (#5138).

    LEXICAL_V2 ran in staging for two weeks on a net gain measured on a
    different build, while it lost six cases the production path answered. A
    record marked `retrieval_experiment: true` must therefore carry, once it is
    on in staging or production, a `promotion_evidence` block: an independent
    replay of the baseline and the treatment at ONE revision, and every case the
    treatment lost, by id. Staging may run with losses `open`; production may
    not. A loss leaves the list only when the owner accepts it with a linked
    decision (the regression is an owner call, never an implementer's), or when
    a newer replay at a fix revision shows the case no longer loses.
    Thresholds stay in docs/evals/retrieval-eval/release-gates.md; this rule
    only refuses promotion without the evidence those gates are read from.

    The replay is a committed artifact (`promotion_evidence.artifact`, a JSON
    file in this repository) holding per-case hit booleans for the baseline and
    the treatment at one revision. The rule binds it from three sides:

    - the revision: the artifact's capability and revision match the record,
      and the revision is a real commit on main or a tag (the
      evidence_provenance helpers; on a shallow clone they cannot answer, and
      an unanswerable question is not a finding);
    - the cases: the artifact names a case set from the registry's
      `retrieval_case_sets` (path, sha256, count, all checked), and its case
      ids equal that set exactly, so a truncated replay cannot pass
      (#5169 r3 F1);
    - the arms: the baseline's flags are the registry's production state of
      every retrieval experiment, and the treatment differs from it only in
      this record's own `retrieval_flag`, with the settings the record
      declares; a replay of other configurations cannot pass (#5169 r3 F1).

    The listed losses must then EQUAL the losses computed from the artifact. It
    does not prove that the replay ran: that is human review of the artifact
    in an R3 diff (#5169 r2 F1).
    """
    cid = cap.get("id", "<no id>")
    if cap.get("retrieval_experiment") is not True:
        return []
    envs = cap.get("environments") or {}
    prod = _live_in_production(cap)
    live = prod or _is_on(envs.get("staging", "")) or cap.get("state") == "staging_enabled"
    if not live:
        return []

    def bad(msg: str) -> Finding:
        return Finding(cid, "retrieval_promotion_evidence", msg)

    pe = cap.get("promotion_evidence")
    if not isinstance(pe, dict):
        return [bad("on in staging or production with no `promotion_evidence` replay")]
    out = []
    for f in ("baseline", "treatment", "replayed_by"):
        if not str(pe.get(f) or "").strip():
            out.append(bad(f"`promotion_evidence.{f}` is empty"))
    replay = str(pe.get("replay") or "").strip()
    if replay and not _DURABLE_REF_RE.fullmatch(replay):
        out.append(bad(f"`promotion_evidence.replay` {replay!r} is not a MIRA issue or PR link"))
    base_rev, treat_rev = (
        str(pe.get("baseline_revision") or ""),
        str(pe.get("treatment_revision") or ""),
    )
    if not re.fullmatch(r"[0-9a-f]{9,40}", base_rev) or base_rev != treat_rev:
        out.append(
            bad(
                "baseline and treatment must be replayed at the same revision "
                f"(baseline_revision {base_rev!r}, treatment_revision {treat_rev!r})"
            )
        )
    elif not evidence_provenance.commit_exists(root, base_rev):
        out.append(bad(f"replay revision {base_rev!r} is not a commit here"))
    elif evidence_provenance.commit_is_durable(root, base_rev) is False:
        out.append(bad(f"replay revision {base_rev[:12]} is not on main or a tag"))
    if pe.get("independent") is not True:
        out.append(bad("`promotion_evidence.independent` must be true"))

    reads = hub_reads if hub_reads is not None else hub_env_reads(root)
    arms, msgs = _expected_arms(cap, registry, reads)
    out += [bad(m) for m in msgs]
    case_set, msg = _case_set(root, registry, str(pe.get("case_set") or ""))
    if msg:
        out.append(bad(msg))
    computed, msgs = _replay_losses(root, pe, cid, base_rev, case_set, arms)
    out += [bad(m) for m in msgs]

    losses = pe.get("losses")
    if not isinstance(losses, list):
        return out + [
            bad("`promotion_evidence.losses` must list every lost case (an empty list if none)")
        ]
    if computed is not None:
        listed = {str(loss.get("case") or "").strip() for loss in losses if isinstance(loss, dict)}
        for case in sorted(computed - listed):
            out.append(bad(f"the replay artifact loses {case}, which `losses` does not list"))
        for case in sorted(listed - computed - {""}):
            out.append(bad(f"listed loss {case} is not a loss in the replay artifact"))
    for loss in losses:
        case = str((loss or {}).get("case") or "").strip() if isinstance(loss, dict) else ""
        disp = loss.get("disposition") if isinstance(loss, dict) else None
        if disp == "fixed":
            out.append(
                bad(
                    f"loss {case} is marked fixed: a fix is shown by a replay at the fix "
                    "revision in which the case no longer loses; point `artifact` at it"
                )
            )
            continue
        if not case or disp not in LOSS_DISPOSITIONS:
            out.append(
                bad(
                    f"loss {loss!r} needs a `case` and a disposition in {sorted(LOSS_DISPOSITIONS)}"
                )
            )
            continue
        if disp == "open" and prod:
            out.append(bad(f"production with loss {case} still open"))
        owner = str(cap.get("owner") or "").strip()
        if disp == "accepted" and (
            not owner
            or cap.get("owner_missing")
            or str(loss.get("decided_by") or "").strip() != owner
            or not _DURABLE_REF_RE.fullmatch(str(loss.get("decision") or "").strip())
        ):
            out.append(bad(f"loss {case} accepted without a linked decision by the owner"))
    return out


def _expected_arms(cap: dict, registry: dict, reads: set[str]) -> tuple[dict | None, list[str]]:
    """The flags each arm must have run with, derived from the registry.

    Baseline: every OTHER retrieval experiment's `retrieval_flag` at its
    production state, and this record's flag off (the question is always this
    flag against the production path without it, also once production is on).
    Treatment: the same, with this record's flag on. Each flag must be one the
    Hub's production code reads, so a renamed or invented flag cannot stand in
    for the real switch.
    """
    msgs: list[str] = []
    baseline: dict[str, bool] = {}
    for other in registry.get("capabilities") or []:
        if other.get("retrieval_experiment") is not True:
            continue
        flag = str(other.get("retrieval_flag") or "")
        if not _FLAG_RE.fullmatch(flag) or flag not in reads:
            msgs.append(
                f"retrieval experiment {other.get('id')!r} has `retrieval_flag` {flag!r}, "
                "which the Hub's production code does not read"
            )
            continue
        baseline[flag] = _live_in_production(other)
    own = str(cap.get("retrieval_flag") or "")
    if own not in baseline:
        return None, msgs or [f"`retrieval_flag` {own!r} is not a registered experiment flag"]
    if msgs:
        return None, msgs
    settings = (cap.get("promotion_evidence") or {}).get("treatment_settings") or {}
    if not isinstance(settings, dict):
        return None, ["`promotion_evidence.treatment_settings` must be a mapping"]
    return {
        "baseline": {**baseline, own: False},
        "treatment": {**baseline, own: True},
        "settings": {str(k): str(v) for k, v in settings.items()},
    }, []


def _case_set(root: Path, registry: dict, name: str) -> tuple[set[str] | None, str | None]:
    """The case ids of a registered case set, checked against its pinned hash and count."""
    sets = registry.get("retrieval_case_sets") or {}
    entry = sets.get(name) if name else None
    if not isinstance(entry, dict):
        return None, f"`promotion_evidence.case_set` {name!r} is not in `retrieval_case_sets`"
    base = root.resolve()
    path = (base / str(entry.get("path") or "")).resolve()
    if base not in path.parents or not path.is_file():
        return None, f"case set {name!r} file {entry.get('path')!r} is not in this repository"
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != str(entry.get("sha256") or ""):
        return None, f"case set {name!r} does not match its pinned sha256"
    try:
        cases = json.loads(raw).get("cases")
    except (ValueError, AttributeError):
        cases = None
    if not isinstance(cases, list) or not all(isinstance(c, str) and c for c in cases):
        return None, f"case set {name!r} has no list of case ids"
    if len(set(cases)) != len(cases) or len(cases) != entry.get("count"):
        return None, f"case set {name!r} holds {len(set(cases))} distinct ids, not its count"
    return set(cases), None


def _replay_losses(
    root: Path,
    pe: dict,
    cid: str,
    revision: str,
    case_set: set[str] | None,
    arms: dict | None,
) -> tuple[set[str] | None, list[str]]:
    """Cases the baseline hit and the treatment missed, read from the committed
    replay artifact; or (None, why) when the artifact cannot be used."""
    artifact = str(pe.get("artifact") or "")
    if not artifact.strip():
        return None, ["`promotion_evidence.artifact` is empty (a committed per-case replay)"]
    base = root.resolve()
    path = (base / artifact).resolve()
    if base not in path.parents or not path.is_file():
        return None, [f"replay artifact {artifact!r} is not a file in this repository"]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, [f"replay artifact {artifact!r} does not parse: {e}"]
    if not isinstance(data, dict):
        return None, [f"replay artifact {artifact!r} is not a JSON object"]
    if data.get("capability") != cid:
        return None, [
            f"replay artifact {artifact!r} is for {data.get('capability')!r}, not {cid!r}"
        ]
    if data.get("revision") != revision:
        return None, [
            f"replay artifact revision {data.get('revision')!r} is not the replay revision "
            f"{revision!r}"
        ]
    cases = data.get("cases")
    if not isinstance(cases, dict) or not cases:
        return None, [f"replay artifact {artifact!r} has no `cases`"]
    msgs: list[str] = []
    if data.get("case_set") != pe.get("case_set"):
        msgs.append(
            f"replay artifact case set {data.get('case_set')!r} is not the record's "
            f"{pe.get('case_set')!r}"
        )
    if case_set is not None:
        missing, extra = sorted(case_set - set(cases)), sorted(set(cases) - case_set)
        if missing:
            msgs.append(f"replay artifact is missing cases of its case set: {missing}")
        if extra:
            msgs.append(f"replay artifact has cases outside its case set: {extra}")
    if arms is not None:
        for arm in ("baseline", "treatment"):
            msgs += _arm_mismatches(data.get(arm), arm, arms)
    losses = set()
    for case, r in cases.items():
        if not isinstance(r, dict) or not all(
            isinstance(r.get(k), bool) for k in ("baseline_hit", "treatment_hit")
        ):
            return None, msgs + [
                f"replay artifact case {case!r} needs boolean baseline_hit and treatment_hit"
            ]
        if r["baseline_hit"] and not r["treatment_hit"]:
            losses.add(str(case))
    return losses, msgs


def _arm_mismatches(arm_data: object, arm: str, arms: dict) -> list[str]:
    """How a replay arm's recorded configuration differs from the derived one."""
    if not isinstance(arm_data, dict) or not isinstance(arm_data.get("flags"), dict):
        return [f"replay artifact {arm} has no `flags` mapping"]
    flags: dict = arm_data["flags"]
    if not flags:
        return [f"replay artifact {arm} has no `flags` mapping"]
    expected: dict[str, bool] = arms[arm]
    if set(flags) != set(expected):
        return [
            f"replay artifact {arm} flags {sorted(flags)} are not the registered experiment "
            f"flags {sorted(expected)}"
        ]
    msgs = []
    for flag, on in sorted(expected.items()):
        value = str(flags[flag]).strip().lower()
        if value not in _ON | _OFF or (value in _ON) != on:
            want = "on" if on else "off"
            msgs.append(f"replay artifact {arm} ran {flag}={flags[flag]!r}; it must be {want}")
    settings = arm_data.get("settings") or {}
    want_settings = arms["settings"] if arm == "treatment" else {}
    if (
        not isinstance(settings, dict)
        or {str(k): str(v) for k, v in settings.items()} != want_settings
    ):
        msgs.append(f"replay artifact {arm} settings {settings!r} are not {want_settings!r}")
    return msgs


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
    workflow_jobs, workflow_check_names = workflow_job_inventory(root)
    jobs = ci_job_ids(root) | workflow_jobs
    gated = ci_gate_needs(root)
    hub_reads = hub_env_reads(root)

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
        findings += check_ci_jobs_exist(cap, jobs, gated, workflow_check_names)
        findings += check_evidence_paths_exist(cap, root)
        findings += check_production_has_rollback(cap)
        findings += check_retrieval_promotion_evidence(cap, root, registry, hub_reads)
        findings += check_review_not_expired(cap, today)

    # Evidence provenance + observation proof. Kept in a sibling module because
    # it is a distinct question ("can this observation be reproduced, and did
    # its mechanism ever prove itself?") but wired in HERE so the registry keeps
    # exactly one validator, one CI job and one exit code. A second entry point
    # would be a second source of truth about closure.
    findings += evidence_provenance.check_registry(registry, root)

    # A defect that is FILED and TRACKED is a different state from an unknown
    # one. `acknowledged_rules` marks findings that a named issue already
    # covers: they stay visible in the output but do not fail the run. It is
    # per-RULE on purpose — acknowledging `enabled_but_unplumbed` must not also
    # silence a future `production_no_rollback` on the same capability.
    ack: dict[str, set[str]] = {c.get("id"): set(c.get("acknowledged_rules") or []) for c in caps}
    for f in findings:
        if f.rule in ack.get(f.cap, set()) and f.rule not in NON_ACKNOWLEDGEABLE_RULES:
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
