"""Deterministic analysis over the MIRA PLC IR -- the maintenance-intelligence layer.

Mike's rule: build deterministic analysis FIRST, then (later) let an LLM *explain* the deterministic
results. Do not rely on an LLM to parse raw PLC files. So everything here is rule-based and
traceable; each finding carries a confidence per Mike's grading:
  HIGH    -> read straight from structured IR (e.g. "rung 4 energizes Motor_Run")
  MEDIUM  -> inferred from names/comments/usage (e.g. "Motor_Run looks like an asset output")
  REVIEW  -> safety/bypass/motion/e-stop logic a human MUST check before trusting

Outputs (all read-only): tag dictionary, routine summaries, output dependency candidates, fault
candidates, asset candidates, VFD-signal candidates, and a usage cross-reference. Nothing here
asserts correctness of the customer's logic -- these are extraction + inference, clearly labelled.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .ir import Confidence, PLCProject, Tag

# --- name-pattern vocabularies (MEDIUM-confidence inference) ---
# PLC tag names are underscore/camelCase (Motor_Run, VFD_FaultCode), so a plain \b boundary fails
# (underscore is a \w char). _kw() builds a word matcher whose boundaries are: a non-letter neighbor
# (`_`, digit, space, symbol, start/end) OR a camelCase hump -- a lowercase/digit -> Uppercase
# transition. Without the hump rule, "fault" fused into "FaultRoutine"/"MotorFault" was missed.
# The boundaries only ADD matches (each is a `non-letter OR hump` alternation), so underscore-style
# names behave exactly as before. A keyword buried in a lowercase run ("defaulting") still won't
# match -- there is no boundary on either side.
# Boundaries are case-SENSITIVE (a hump is literally lowercase/digit -> Uppercase), so they must
# not be compiled under re.I -- otherwise [a-z]/[A-Z] would match either case and "defaulting" would
# match "fault". Case-insensitivity is scoped to just the keyword body via an inline (?i:...) group.
_LEFT_BOUND = r"(?:(?<![A-Za-z])|(?<=[a-z0-9])(?=[A-Z]))"
_RIGHT_BOUND = r"(?:(?![A-Za-z])|(?<=[a-z0-9])(?=[A-Z]))"


def _kw(words):
    return re.compile(_LEFT_BOUND + r"(?i:" + "|".join(words) + r")" + _RIGHT_BOUND)


_FAULT_PAT = _kw(["fault", "trip", "alarm", "estop", "fail", "error", "overload", "jam"])
_MODE_PAT = _kw(["auto", "manual", "jog", "hand", "maint", "maintenance", "bypass", "reset", "mode"])
_SAFETY_PAT = _kw(["estop", "emergency", "guard", "safety", "lightcurtain", "interlock", "lockout", "loto"])
_ASSET_PAT = _kw(["motor", "conv", "conveyor", "pump", "valve", "solenoid", "vfd", "drive", "fan",
                  "heater", "horn", "light", "lamp", "cylinder", "gate", "damper", "mixer", "agitator"])
_INPUT_PAT = _kw(["pb", "push", "switch", "sensor", "prox", "photoeye", "limit", "input"])

# VFD signal-role hints (mirrors the gateway suggest_for_role vocabulary so the parser and the
# VFD-Analyzer wizard agree on what a "frequency"/"current"/... tag looks like).
_VFD_ROLES = [
    ("frequency", _kw(["freq", "hz", "outputhz", "speedhz"])),
    ("current_a", _kw(["current", "amp", "amps", "iout"])),
    ("fault_code", _kw(["faultcode", "tripcode"])),
    ("dc_bus_v", _kw(["dcbus", "busv", "dc_bus", "dclink"])),
    ("freq_setpoint", _kw(["setpoint", "freqcmd", "cmdfreq", "freqref", "freqsp"])),
    ("comm_ok", _kw(["comm", "online", "heartbeat", "linkok"])),
]
_VFD_DEVICE_PAT = _kw(["vfd"])


@dataclass
class Finding:
    kind: str               # "tag" | "routine" | "output" | "fault" | "asset" | "vfd_signal"
    name: str
    detail: str = ""
    confidence: str = Confidence.HIGH.value
    evidence: list[str] = field(default_factory=list)   # IR locators backing the finding


@dataclass
class AnalysisReport:
    controller: str = ""
    vendor: str = ""
    counts: dict = field(default_factory=dict)
    tag_dictionary: list[dict] = field(default_factory=list)
    routine_summaries: list[dict] = field(default_factory=list)
    output_dependencies: list[Finding] = field(default_factory=list)
    fault_candidates: list[Finding] = field(default_factory=list)
    asset_candidates: list[Finding] = field(default_factory=list)
    vfd_signal_candidates: list[Finding] = field(default_factory=list)
    review_required: list[Finding] = field(default_factory=list)
    namespace: list[dict] = field(default_factory=list)   # ISA-95 hierarchy (Ignition tag tree etc.)
    warnings: list[str] = field(default_factory=list)


def analyze(proj: PLCProject) -> AnalysisReport:
    rep = AnalysisReport(warnings=list(proj.warnings))
    if proj.controllers:
        c0 = proj.controllers[0]
        rep.controller = c0.name
        rep.vendor = c0.vendor

    usage = _build_usage_index(proj)        # tag name -> [locators]
    _annotate_roles(proj)                   # fill Tag.roles (inferred)

    rep.tag_dictionary = _tag_dictionary(proj, usage)
    rep.routine_summaries = _routine_summaries(proj)
    rep.output_dependencies = _output_dependencies(proj)
    rep.fault_candidates = _fault_candidates(proj)
    rep.asset_candidates = _asset_candidates(proj)
    rep.vfd_signal_candidates = _vfd_signal_candidates(proj)
    rep.review_required = _review_required(proj)

    rep.counts = {
        "controllers": len(proj.controllers),
        "tags": len(proj.all_tags()),
        "programs": sum(len(c.programs) for c in proj.controllers),
        "routines": len(proj.all_routines()),
        "rungs": len(proj.all_rungs()),
        "aoi_definitions": sum(len(c.aoi_definitions) for c in proj.controllers),
        "aoi_parameters": sum(
            len(aoi.parameters) for c in proj.controllers for aoi in c.aoi_definitions
        ),
        "aoi_local_tags": sum(
            len(aoi.local_tags) for c in proj.controllers for aoi in c.aoi_definitions
        ),
        "module_definitions": sum(len(c.module_definitions) for c in proj.controllers),
        "fbd_sheets": sum(
            len(r.rungs) for _, r in proj.all_routines() if r.type == "FBD"
        ),
        "outputs": len(rep.output_dependencies),
        "fault_candidates": len(rep.fault_candidates),
        "asset_candidates": len(rep.asset_candidates),
        "vfd_signal_candidates": len(rep.vfd_signal_candidates),
        "review_required": len(rep.review_required),
    }

    # ISA-95 namespace layer (additive): present only for hierarchical sources (Ignition tag tree).
    # Logic parsers (L5X/CSV/ST) leave proj.namespace empty, so this block is a no-op for them.
    if proj.namespace:
        rep.namespace = [_namespace_node_dict(n) for n in proj.namespace]
        rep.counts.update(_namespace_counts(proj.namespace))
    return rep


def _namespace_node_dict(n) -> dict:
    return {
        "name": n.name, "level": n.level, "path": list(n.path),
        "udt_type": n.udt_type, "data_type": n.data_type, "unit": n.unit,
        "mes_path": n.mes_path, "tag_path": n.tag_path,
        "manufacturer": n.manufacturer, "model": n.model, "serial": n.serial,
        "confidence": (n.provenance.confidence.value if n.provenance else Confidence.HIGH.value),
    }


def _namespace_counts(nodes) -> dict:
    """Per-ISA-95-level counts so the report can state 'N sites, N lines, N assets, N signals'."""
    by: dict[str, int] = {}
    for n in nodes:
        by[n.level] = by.get(n.level, 0) + 1
    return {
        "namespace_nodes": len(nodes),
        "enterprises": by.get("enterprise", 0),
        "sites": by.get("site", 0),
        "areas": by.get("area", 0),
        "lines": by.get("line", 0),
        "assets": by.get("asset", 0),
        "signals": by.get("signal", 0),
    }


# ---- cross-reference + role inference ----

def _build_usage_index(proj: PLCProject) -> dict[str, list[str]]:
    idx: dict[str, list[str]] = {}
    for prog, routine, rung in proj.all_rungs():
        loc = "%s/%s/Rung[%d]" % (prog, routine, rung.number)
        for ref in rung.refs:
            base = ref.split(".")[0].split("[")[0]   # the root tag of a dotted/array ref
            idx.setdefault(base, []).append(loc)
    return idx


def _annotate_roles(proj: PLCProject) -> None:
    output_tags = set()
    for _p, _r, rung in proj.all_rungs():
        for o in rung.outputs:
            output_tags.add(o.split(".")[0].split("[")[0])
    for t in proj.all_tags():
        roles: list[str] = []
        if t.name in output_tags or t.name in {o for _p, _r, rg in proj.all_rungs() for o in rg.outputs}:
            roles.append("output")
        if _FAULT_PAT.search(t.name) or _FAULT_PAT.search(t.description or ""):
            roles.append("fault")
        if _MODE_PAT.search(t.name):
            roles.append("mode")
        if _SAFETY_PAT.search(t.name) or _SAFETY_PAT.search(t.description or ""):
            roles.append("safety")
        if t.data_type.upper() in ("TIMER", "FBD_TIMER"):
            roles.append("timer")
        if t.data_type.upper() in ("COUNTER",):
            roles.append("counter")
        if _looks_like_input(t):
            roles.append("input")
        t.roles = roles


def _looks_like_input(t: Tag) -> bool:
    if t.alias_for and ":I" in t.alias_for:    # Local:1:I... = input module
        return True
    return bool(_INPUT_PAT.search(t.name))


# ---- dictionaries / summaries ----

def _tag_dictionary(proj: PLCProject, usage: dict[str, list[str]]) -> list[dict]:
    out = []
    for t in proj.all_tags():
        locs = usage.get(t.name, [])
        out.append({
            "name": t.name,
            "data_type": t.data_type,
            "scope": t.scope,
            "description": t.description,
            "address": t.address or t.alias_for,
            "roles": t.roles,
            "used_count": len(locs),
            "used_in": locs[:12],
            "confidence": Confidence.HIGH.value,
        })
    out.sort(key=lambda d: (-d["used_count"], d["name"]))
    return out


def _routine_summaries(proj: PLCProject) -> list[dict]:
    out = []
    for prog, r in proj.all_routines():
        out_tags = sorted({o for rung in r.rungs for o in rung.outputs})
        comments = [rung.comment for rung in r.rungs if rung.comment]
        out.append({
            "program": prog,
            "routine": r.name,
            "type": r.type,
            "rungs": len(r.rungs),
            "outputs_controlled": out_tags,
            "comment_digest": comments[:6],
            "purpose_hint": _purpose_hint(r.name, comments),
            "confidence": Confidence.HIGH.value if r.rungs or r.st_text else Confidence.MEDIUM.value,
        })
    return out


def _purpose_hint(name: str, comments: list[str]) -> str:
    blob = (name + " " + " ".join(comments)).lower()
    if _FAULT_PAT.search(blob):
        return "fault / alarm handling"
    if "seq" in blob or "step" in blob or "state" in blob:
        return "sequence / state logic"
    if _SAFETY_PAT.search(blob):
        return "safety / interlock (REVIEW)"
    if _ASSET_PAT.search(blob):
        return "equipment control"
    return ""


# ---- candidate extractions ----

def _output_dependencies(proj: PLCProject) -> list[Finding]:
    """For each driven output, which rung(s) energize it and the condition tags involved."""
    by_output: dict[str, Finding] = {}
    for prog, routine, rung in proj.all_rungs():
        loc = "%s/%s/Rung[%d]" % (prog, routine, rung.number)
        conditions = [r for r in rung.refs if r not in rung.outputs]
        for out in rung.outputs:
            f = by_output.get(out)
            if f is None:
                f = Finding(kind="output", name=out, detail="", confidence=Confidence.HIGH.value)
                by_output[out] = f
            f.evidence.append(loc)
            if conditions:
                extra = "true when: " + ", ".join(conditions[:8])
                f.detail = (f.detail + " | " if f.detail else "") + extra
    return sorted(by_output.values(), key=lambda f: f.name)


def _fault_candidates(proj: PLCProject) -> list[Finding]:
    out = []
    for t in proj.all_tags():
        if "fault" in t.roles:
            conf = Confidence.REVIEW.value if "safety" in t.roles else Confidence.MEDIUM.value
            out.append(Finding(
                kind="fault", name=t.name,
                detail=t.description or "name/desc matches fault/alarm pattern",
                confidence=conf,
                evidence=[t.provenance.locator] if t.provenance else [],
            ))
    return out


def _asset_candidates(proj: PLCProject) -> list[Finding]:
    """Group output-ish tags by equipment keyword + name prefix into candidate assets."""
    groups: dict[str, Finding] = {}
    for t in proj.all_tags():
        m = _ASSET_PAT.search(t.name)
        if not m:
            continue
        key = t.name.split(".")[0].split("_")[0] or m.group(0)
        f = groups.get(key)
        if f is None:
            f = Finding(kind="asset", name=key, detail="candidate asset (keyword: %s)" % m.group(0).lower(),
                        confidence=Confidence.MEDIUM.value)
            groups[key] = f
        f.evidence.append(t.name)
    return sorted(groups.values(), key=lambda f: f.name)


def _vfd_signal_candidates(proj: PLCProject) -> list[Finding]:
    """Tags that look like VFD signals -- feeds straight into the VFD-Analyzer auto-map."""
    out = []
    for t in proj.all_tags():
        hay = t.name + " " + (t.description or "")
        matched = False
        for role, pat in _VFD_ROLES:
            if pat.search(hay):
                out.append(Finding(
                    kind="vfd_signal", name=t.name,
                    detail="candidate role: %s" % role, confidence=Confidence.MEDIUM.value,
                    evidence=[t.provenance.locator] if t.provenance else [],
                ))
                matched = True
                break
        if matched:
            continue
        if _VFD_DEVICE_PAT.search(t.name) or ("fault" in t.roles and _VFD_DEVICE_PAT.search(hay)):
            out.append(Finding(
                kind="vfd_signal", name=t.name,
                detail="candidate role: drive_state", confidence=Confidence.MEDIUM.value,
                evidence=[t.provenance.locator] if t.provenance else [],
            ))
    return out


def _review_required(proj: PLCProject) -> list[Finding]:
    """Anything safety-relevant a human MUST verify before trusting downstream analysis."""
    out = []
    for t in proj.all_tags():
        if "safety" in t.roles:
            out.append(Finding(kind="safety", name=t.name,
                               detail=t.description or "safety/e-stop/guard/bypass pattern",
                               confidence=Confidence.REVIEW.value,
                               evidence=[t.provenance.locator] if t.provenance else []))
    for prog, r in proj.all_routines():
        if _SAFETY_PAT.search(r.name):
            out.append(Finding(kind="safety", name="%s/%s" % (prog, r.name),
                               detail="routine name matches safety pattern",
                               confidence=Confidence.REVIEW.value))
    return out
