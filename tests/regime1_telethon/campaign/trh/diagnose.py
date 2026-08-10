"""Campaign-level diagnosis: assemble → grade → classify → persist → find.

This is the module `runner.py` calls. It closes the loop the directive
specifies:

    synthetic technician → real MIRA → TurnEvidence → stage grading
    → first broken layer → responsible subsystem → finding → defect report

## Persistence

One `diagnosis` record per turn, appended to the SAME campaign ledger the
runner already writes. Deliberately not a new file: `findings.py`, `report.py`
and `manifest.py` all key off that ledger, and a parallel store would need all
three taught about it — and would drift.

Each record carries everything the directive asks to persist: stage results,
first broken stage, downstream failures, responsible subsystem, oracle used,
supporting evidence, confidence, and — when nothing can be decided — the
explicit reason, never a pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .. import gates, ledger
from . import assemble as assemble_mod
from . import classify as classify_mod
from . import oracles as oracles_mod
from .stages import FAIL, INCONCLUSIVE, NOT_OBSERVED, PASS, GradeContext, Stage, grade_turn


@dataclass
class ConversationDiagnosis:
    conv_id: str
    campaign: str
    diagnoses: list = field(default_factory=list)
    classifications: list = field(default_factory=list)
    assembly: assemble_mod.AssemblyReport | None = None
    oracle_id: str | None = None

    def first_broken(self):
        """The earliest classified failure in the conversation.

        Earliest TURN, not worst turn: c12 found all four `pivot_after_fault`
        failures at turn 2 while the fingerprint named turn 3, and reading the
        last turn hid the cause.
        """
        for c in self.classifications:
            if c.primary is not None:
                return c
        return None

    def unclassifiable(self) -> list:
        return [c for c in self.classifications if c.primary is None and c.confidence == "low"]


def _conversation_violations(conv) -> list:
    """v1's conversation gates over the assembled transcript."""
    try:
        return gates.check_conversation(conv.transcript(), case_id=conv.conv_id)
    except Exception:  # noqa: BLE001 - a gate must never take diagnosis down
        return []


def diagnose_conversation(
    conv,
    assembly: assemble_mod.AssemblyReport | None = None,
    registry: dict | None = None,
    corpus=None,
) -> ConversationDiagnosis:
    reg = registry if registry is not None else oracles_mod.load()
    oracle = oracles_mod.for_case(conv.conv_id, reg)
    violations = _conversation_violations(conv)

    diagnoses = []
    for i, turn in enumerate(conv.turns):
        ctx = GradeContext(
            oracle=oracle,
            corpus=corpus,
            prior_turns=conv.turns[:i],
            conversation_violations=violations,
        )
        diagnoses.append(grade_turn(turn, ctx, conv_id=conv.conv_id))

    return ConversationDiagnosis(
        conv_id=conv.conv_id,
        campaign=conv.source_campaign or "",
        diagnoses=diagnoses,
        classifications=classify_mod.classify_conversation(diagnoses),
        assembly=assembly,
        oracle_id=oracle.id if oracle else None,
    )


def persist(campaign: str, cd: ConversationDiagnosis) -> None:
    """Append one `diagnosis` record per turn to the campaign ledger."""
    for d, c in zip(cd.diagnoses, cd.classifications):
        ledger.append(
            campaign,
            {
                "kind": "diagnosis",
                "conv": cd.conv_id,
                "i": d.turn_index,
                "turn_verdict": d.verdict(),
                "first_broken_stage": c.label,
                "downstream": [s.value for s in c.secondary],
                "subsystem": c.subsystem,
                "oracle": cd.oracle_id,
                "confidence": c.confidence,
                "unobserved": [s.value for s in c.unobserved],
                "unclassifiable_reason": (
                    c.explanation if c.primary is None and c.confidence == "low" else ""
                ),
                "stages": {
                    g.stage.value: {"verdict": g.verdict, "detail": g.detail} for g in d.grades
                },
                "evidence": c.evidence,
            },
        )


def diagnose_campaign(
    campaign: str,
    use_replay: bool = True,
    only: str | None = None,
    corpus=None,
    persist_records: bool = True,
) -> list[ConversationDiagnosis]:
    reg = oracles_mod.load()
    out: list[ConversationDiagnosis] = []
    for conv, rep in assemble_mod.assemble_campaign(campaign, use_replay=use_replay, only=only):
        if not conv.turns:
            continue
        cd = diagnose_conversation(conv, assembly=rep, registry=reg, corpus=corpus)
        if persist_records:
            persist(campaign, cd)
        out.append(cd)
    return out


# ---------------------------------------------------------------------------
# The technician-style finding
# ---------------------------------------------------------------------------

_SYMPTOM_LIMIT = 220


def finding(cd: ConversationDiagnosis, turn_index: int | None = None) -> str:
    """A concise, GitHub-ready defect note for one classified failure.

    Ordered so that a reader who stops after four lines still knows the symptom,
    the broken layer, and the file to open. "What NOT to fix" is a first-class
    section because the expensive mistakes in this arc were all repairs aimed at
    a downstream symptom.
    """
    cls = cd.first_broken() if turn_index is None else None
    if cls is None and turn_index is not None:
        cls = next((c for c in cd.classifications if c.turn_index == turn_index), None)
    if cls is None:
        return _no_failure_note(cd)

    d = next((x for x in cd.diagnoses if x.turn_index == cls.turn_index), None)
    by_stage = d.by_stage() if d else {}
    turn = None
    for t_i, dg in enumerate(cd.diagnoses):
        if dg.turn_index == cls.turn_index:
            turn = t_i
            break

    ev = cls.evidence or {}
    lines = [
        f"### {cls.label} — `{cd.conv_id}` turn {cls.turn_index}",
        "",
        f"**Responsible subsystem:** {cls.subsystem or 'unknown (no oracle registered)'}",
        f"**Confidence:** {cls.confidence} · **Oracle:** `{cd.oracle_id or 'NONE'}`",
        "",
        "**Observed symptom**",
        "",
    ]

    sym_turn = cd.diagnoses[turn] if turn is not None else None
    if sym_turn is not None:
        lines.append(f"> {_symptom(cd, cls.turn_index)}")
    lines += ["", "**Why this is the FIRST failure**", "", cls.explanation, ""]

    if ev:
        lines += ["**Evidence**", ""]
        for key in ("missing", "hits", "polysemy_traps", "fabricated_tokens", "resolved", "query"):
            if ev.get(key):
                lines.append(f"- `{key}`: {ev[key]}")
        if ev.get("warning"):
            lines.append(f"- ⚠️ {ev['warning']}")
        lines.append("")

    if cls.secondary:
        names = ", ".join(s.value for s in cls.secondary)
        lines += [
            "**Downstream symptoms (visible, NOT root causes)**",
            "",
            f"{names} — expect these to clear once {cls.label} is repaired.",
            "",
        ]

    # "What NOT to fix" is emitted for BOTH an INGEST root cause and any
    # downstream set — earlier this was an either/or, so an INGEST failure that
    # also broke RETRIEVAL (i.e. every real one) printed the generic downstream
    # warning and dropped the one sentence that matters: do not tune retrieval.
    dont: list[str] = []
    if cls.primary is Stage.INGEST:
        dont.append(
            "**Not a retrieval defect.** The content is absent from the corpus for "
            "this vendor, so no ranking, fusion or prompt change can surface it. "
            "Source and ingest the document, and fix model tagging."
        )
    if cls.secondary:
        names = ", ".join(s.value for s in cls.secondary)
        dont.append(
            f"Do not open {names} directly. A repair aimed at a downstream layer "
            "inherits the upstream defect: the measured case is a retrieval-grounded "
            "claim guard that scored 1 TP / 2 FP because it suppressed hardest exactly "
            "where retrieval was weakest (#3168)."
        )
    if dont:
        lines += ["**What NOT to fix**", "", *dont, ""]

    if cls.unobserved:
        lines += [
            "**Not observed (NOT passing)**",
            "",
            ", ".join(s.value for s in cls.unobserved)
            + " — no producer recorded these layers for this turn.",
            "",
        ]

    lines += [
        "**Expected behaviour**",
        "",
        _expected(cls, cd),
        "",
        "**Actual behaviour**",
        "",
        f"{by_stage[cls.primary].detail if cls.primary in by_stage else cls.explanation}",
        "",
        "**Deterministic reproduction**",
        "",
        "```bash",
        "py -3 -m tests.regime1_telethon.campaign.trh.cli diagnose-campaign \\",
        f"    --campaign {cd.campaign} --conv {cd.conv_id}",
        "```",
        "",
        _repro_caveat(cd),
    ]
    return "\n".join(lines)


def _symptom(cd: ConversationDiagnosis, turn_index: int) -> str:
    for d in cd.diagnoses:
        if d.turn_index != turn_index:
            continue
        stages = d.by_stage()
        broken = [s.value for s, g in stages.items() if g.verdict == FAIL]
        return f"turn {turn_index} failed at {', '.join(broken) or 'no layer'}"
    return "unavailable"


_EXPECTED = {
    Stage.INGEST: "the expected passage exists in the corpus for this vendor",
    Stage.SCOPE: "MIRA resolves the manufacturer/model the technician is actually on",
    Stage.DIALOGUE: "prior turns do not corrupt this turn's context",
    Stage.RETRIEVAL: "the expected passage enters the retrieved set (rank recorded)",
    Stage.EVIDENCE: "the correct retrieved passage is the one selected and cited",
    Stage.GROUNDING: "every specific claim is supported by a real source",
    Stage.GENERATION: "the answer reflects the evidence it was given",
    Stage.POLICY: "MIRA stops, qualifies, or asks — per the safety curriculum",
}


def _expected(cls, cd: ConversationDiagnosis) -> str:
    base = _EXPECTED.get(cls.primary, "the layer behaves per its contract")
    if cls.primary is Stage.RETRIEVAL and cd.oracle_id:
        return f"{base}. Oracle `{cd.oracle_id}` declares which passages those are."
    return base


def _repro_caveat(cd: ConversationDiagnosis) -> str:
    rep = cd.assembly
    if rep is None:
        return ""
    bits = []
    if rep.with_retrieval == 0:
        bits.append(
            "⚠️ No retrieval snapshot for this conversation — RETRIEVAL/EVIDENCE are "
            "NOT_OBSERVED, not passing. Run `retrieval_probe` before trusting a "
            "non-retrieval classification."
        )
    if rep.replay_error:
        bits.append(f"⚠️ Replay unavailable ({rep.replay_error}); DIALOGUE/SCOPE are weaker.")
    return "\n\n".join(bits)


def _no_failure_note(cd: ConversationDiagnosis) -> str:
    unresolved = cd.unclassifiable()
    if unresolved:
        return (
            f"### UNCLASSIFIABLE — `{cd.conv_id}`\n\n"
            f"{len(unresolved)} turn(s) had no decidable layer. "
            f"{unresolved[0].explanation}\n\n"
            f"Producer coverage: {cd.assembly.coverage_note() if cd.assembly else 'unknown'}"
        )
    return f"### No classified failure — `{cd.conv_id}`\n\nA pass is not a proof of correctness."


def all_findings(cds: list[ConversationDiagnosis]) -> list[str]:
    return [finding(cd) for cd in cds if cd.first_broken() is not None]


def stage_matrix(cds: list[ConversationDiagnosis]) -> dict[str, dict[str, int]]:
    """{stage: {verdict: count}} across every graded turn — the deliverable table."""
    out: dict[str, dict[str, int]] = {}
    for cd in cds:
        for d in cd.diagnoses:
            for g in d.grades:
                row = out.setdefault(
                    g.stage.value, {PASS: 0, FAIL: 0, INCONCLUSIVE: 0, NOT_OBSERVED: 0}
                )
                row[g.verdict] = row.get(g.verdict, 0) + 1
    return out


def classification_counts(cds: list[ConversationDiagnosis]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    unclassifiable = 0
    for cd in cds:
        for c in cd.classifications:
            if c.primary is None:
                if c.confidence == "low":
                    unclassifiable += 1
                continue
            counts[c.primary.value] = counts.get(c.primary.value, 0) + 1
    return {
        "by_class": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "unclassifiable": unclassifiable,
    }
