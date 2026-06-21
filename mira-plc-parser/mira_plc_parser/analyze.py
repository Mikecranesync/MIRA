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


# "e[_ -]?stop" matches both the contiguous (EStop) and separated (e_stop / e-stop) spellings; the
# "_" word-break in _kw means a plain "estop" token would otherwise miss the common "e_stop_active".
_FAULT_PAT = _kw(["fault", "trip", "alarm", "e[_ -]?stop", "fail", "error", "err", "overload", "jam"])
_MODE_PAT = _kw(["auto", "manual", "jog", "hand", "maint", "maintenance", "bypass", "reset", "mode"])
_SAFETY_PAT = _kw(["e[_ -]?stop", "emergency", "guard", "safety", "lightcurtain", "interlock", "lockout", "loto"])
_ASSET_PAT = _kw(["motor", "conv", "conveyor", "pump", "valve", "solenoid", "vfd", "drive", "fan",
                  "heater", "horn", "light", "lamp", "cylinder", "gate", "damper", "mixer", "agitator"])
_INPUT_PAT = _kw(["pb", "push", "switch", "sensor", "prox", "photoeye", "limit", "input"])
# sequence/state-machine variable names (a step counter / state register driving CASE-style logic).
_STEP_PAT = _kw(["step", "state", "seq", "sequence", "phase", "stage", "sfc"])

# data types that denote a timer (the timer tag is what an OUTPUT timer instruction drives).
_TIMER_TYPES = {"TIMER", "FBD_TIMER", "TON", "TOF", "TP", "RTO"}
# integer-ish data types a sequence/state register uses (BOOL excluded -- a 2-state flag isn't a sequencer).
_NUMERIC_TYPES = {"SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
                  "BYTE", "WORD", "DWORD", "LWORD"}
_INT_LITERAL = re.compile(r":?=\s*(-?\d+)")

# VFD signal-role hints (mirrors the gateway suggest_for_role vocabulary so the parser and the
# VFD-Analyzer wizard agree on what a "frequency"/"current"/... tag looks like).
# Full words AND abbreviations: "freq" can't match "frequency" (a lowercase run is not a boundary),
# and "dcbus" can't span "dc_bus" -- so include both forms. Real CCW names are bare (no description),
# so the role has to be readable from the identifier alone.
_VFD_ROLES = [
    ("frequency", _kw(["freq", "frequency", "hz", "outputhz", "speedhz"])),
    ("current_a", _kw(["current", "amp", "amps", "iout"])),
    ("fault_code", _kw(["faultcode", "tripcode"])),
    ("dc_bus_v", _kw(["dcbus", "dc[_ -]?bus", "busv", "vdc", "dclink"])),
    ("freq_setpoint", _kw(["setpoint", "freqcmd", "cmdfreq", "freqref", "freqsp"])),
    ("comm_ok", _kw(["comm", "online", "heartbeat", "linkok"])),
]


@dataclass
class Finding:
    kind: str               # "tag" | "routine" | "output" | "fault" | "asset" | "vfd_signal"
    name: str
    detail: str = ""
    confidence: str = Confidence.HIGH.value
    evidence: list[str] = field(default_factory=list)   # IR locators backing the finding
    interlocks: list[str] = field(default_factory=list)  # safety conditions in a permissive chain (REVIEW)
    transitions: int = 0                                 # step-transition count for a sequence finding


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
    permissives: list[Finding] = field(default_factory=list)
    timer_chains: list[Finding] = field(default_factory=list)
    sequences: list[Finding] = field(default_factory=list)
    review_required: list[Finding] = field(default_factory=list)
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
    rep.permissives = _permissives(proj)
    rep.timer_chains = _timer_fault_chains(proj)
    rep.sequences = _sequences(proj)
    rep.review_required = _review_required(proj)

    rep.counts = {
        "controllers": len(proj.controllers),
        "tags": len(proj.all_tags()),
        "programs": sum(len(c.programs) for c in proj.controllers),
        "routines": len(proj.all_routines()),
        "rungs": len(proj.all_rungs()),
        "outputs": len(rep.output_dependencies),
        "fault_candidates": len(rep.fault_candidates),
        "asset_candidates": len(rep.asset_candidates),
        "vfd_signal_candidates": len(rep.vfd_signal_candidates),
        "permissives": len(rep.permissives),
        "timer_chains": len(rep.timer_chains),
        "sequences": len(rep.sequences),
        "review_required": len(rep.review_required),
    }
    return rep


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
        for role, pat in _VFD_ROLES:
            if pat.search(hay):
                out.append(Finding(
                    kind="vfd_signal", name=t.name,
                    detail="candidate role: %s" % role, confidence=Confidence.MEDIUM.value,
                    evidence=[t.provenance.locator] if t.provenance else [],
                ))
                break
    return out


# ---- analysis depth (Phase 5): permissives, timer->fault chains, sequences ----

def _base(ref: str) -> str:
    """The root tag of a dotted/array/bit reference (Run_Timer.DN -> Run_Timer)."""
    return ref.split(".")[0].split("[")[0]


def _tag_index(proj: PLCProject) -> dict[str, Tag]:
    return {t.name: t for t in proj.all_tags()}


def _permissives(proj: PLCProject) -> list[Finding]:
    """For each equipment output, the conditions that must be satisfied to energize it.

    A permissive is an enabling condition; a *safety* permissive (e-stop / guard / interlock) is an
    interlock and forces the whole finding to REVIEW -- a human must verify a safety chain before any
    downstream advice trusts it. Pure fault latches / timers / counters are NOT equipment outputs and
    are excluded (they have their own fault / timer-chain views).
    """
    tags = _tag_index(proj)

    def is_equipment_output(name: str) -> bool:
        t = tags.get(_base(name))
        roles = t.roles if t else []
        if "output" not in roles:
            return False
        return not ({"fault", "timer", "counter"} & set(roles))

    order: list[str] = []
    conds: dict[str, list[str]] = {}
    locs: dict[str, list[str]] = {}
    for prog, routine, rung in proj.all_rungs():
        loc = "%s/%s/Rung[%d]" % (prog, routine, rung.number)
        out_bases = {_base(o) for o in rung.outputs}
        conditions = [r for r in rung.refs if _base(r) not in out_bases]
        for out in rung.outputs:
            if not is_equipment_output(out):
                continue
            if out not in conds:
                conds[out] = []
                locs[out] = []
                order.append(out)
            locs[out].append(loc)
            for c in conditions:
                if c not in conds[out]:
                    conds[out].append(c)

    out: list[Finding] = []
    for name in order:
        cs = conds[name]
        if not cs:
            continue
        interlocks = [c for c in cs if _SAFETY_PAT.search(c)]
        modes = [c for c in cs if _MODE_PAT.search(c) and c not in interlocks]
        detail = "requires: " + ", ".join(cs)
        if interlocks:
            detail += " | safety interlock (REVIEW): " + ", ".join(interlocks)
        if modes:
            detail += " | mode: " + ", ".join(modes)
        out.append(Finding(
            kind="permissive", name=name, detail=detail,
            confidence=Confidence.REVIEW.value if interlocks else Confidence.MEDIUM.value,
            evidence=locs[name], interlocks=interlocks,
        ))
    return out


def _timer_fault_chains(proj: PLCProject) -> list[Finding]:
    """Timers whose elapsed (done) bit gates a downstream output -- the watchdog/debounce pattern.

    The classic case is a comm-loss or jam watchdog: a timer runs while a condition holds, and when it
    times out its DN bit latches a fault (the real GS10 5 s vfd_err_timer -> comm fault). We surface
    the timer, the rung that *sets it up*, and the rung(s) where its bit *triggers* something, calling
    out fault targets explicitly. A timer that is only accumulated (its bit gates nothing) is not a
    chain and is skipped.
    """
    tags = _tag_index(proj)
    timer_names = {
        t.name for t in proj.all_tags()
        if t.data_type.upper() in _TIMER_TYPES or "timer" in t.roles
    }
    if not timer_names:
        return []

    out: list[Finding] = []
    for timer in sorted(timer_names):
        setup_locs: list[str] = []
        trigger_locs: list[str] = []
        driven: list[str] = []
        for prog, routine, rung in proj.all_rungs():
            loc = "%s/%s/Rung[%d]" % (prog, routine, rung.number)
            out_bases = {_base(o) for o in rung.outputs}
            ref_bases = {_base(r) for r in rung.refs}
            if timer in out_bases:
                setup_locs.append(loc)
            elif timer in ref_bases:
                targets = [o for o in rung.outputs if _base(o) != timer]
                if targets:
                    trigger_locs.append(loc)
                    for o in targets:
                        if o not in driven:
                            driven.append(o)
        if not trigger_locs:
            continue
        parts = []
        has_fault = has_safety = False
        for o in driven:
            roles = tags[_base(o)].roles if _base(o) in tags else []
            if "fault" in roles:
                has_fault = True
                parts.append("%s (fault)" % o)
            elif "safety" in roles:
                has_safety = True
                parts.append("%s (safety)" % o)
            else:
                parts.append(o)
        detail = "timer elapsed -> energizes " + ", ".join(parts)
        out.append(Finding(
            kind="timer_chain", name=timer, detail=detail,
            confidence=Confidence.REVIEW.value if has_safety else Confidence.MEDIUM.value,
            evidence=setup_locs + trigger_locs,
        ))
        _ = has_fault  # fault targets are annotated inline in `detail`
    return out


def _sequences(proj: PLCProject) -> list[Finding]:
    """Step/state variables and the transitions that drive them (CASE / step-counter logic).

    A sequencer is a numeric state register (Step / State / Phase) that the logic writes step values
    into. We detect the variable, count its transitions (assignment rungs), pull the step values, and
    raise confidence to HIGH when an explicit `CASE <var> OF` is present in the source.
    """
    case_text = " ".join(
        r.st_text for _p, r in proj.all_routines() if r.st_text
    )

    # var name -> (assignment locators, step values)
    assigns: dict[str, list[str]] = {}
    values: dict[str, list[int]] = {}
    for prog, routine, rung in proj.all_rungs():
        loc = "%s/%s/Rung[%d]" % (prog, routine, rung.number)
        for o in rung.outputs:
            base = _base(o)
            if not _STEP_PAT.search(base):
                continue
            assigns.setdefault(base, []).append(loc)
            for m in _INT_LITERAL.finditer(rung.text or ""):
                v = int(m.group(1))
                values.setdefault(base, [])
                if v not in values[base]:
                    values[base].append(v)

    tags = _tag_index(proj)
    out: list[Finding] = []
    for name in sorted(assigns):
        t = tags.get(name)
        numeric = bool(t and t.data_type.upper() in _NUMERIC_TYPES)
        # require either a numeric declaration or an actual numeric step value written -- a name match
        # alone (e.g. a BOOL "Seq_Enable") is not a sequencer.
        if not numeric and not values.get(name):
            continue
        has_case = bool(re.search(r"\bCASE\s+%s\b" % re.escape(name), case_text, re.IGNORECASE))
        vals = sorted(values.get(name, []))
        detail = "state variable with %d transition(s)" % len(assigns[name])
        if vals:
            detail += "; step values: " + ", ".join(str(v) for v in vals)
        detail += "; explicit CASE block" if has_case else "; inferred from assignments"
        out.append(Finding(
            kind="sequence", name=name, detail=detail,
            confidence=Confidence.HIGH.value if has_case else Confidence.MEDIUM.value,
            evidence=assigns[name], transitions=len(assigns[name]),
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
