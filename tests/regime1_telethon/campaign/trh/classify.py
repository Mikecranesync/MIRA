"""Root-cause classification — one primary class, explained in English.

The rule is **upstream-first**: among the layers that failed, the earliest one in
causal order is the root cause and the rest are its shadow. This is the whole
value of the harness, because the alternative — reading the loudest symptom as
the cause — is what actually happened repeatedly in this arc:

    #3165  the reply invented `P0594` with a correct-looking citation, so it
           read as a GROUNDING defect. Grounding was the last domino. RETRIEVAL
           never surfaced the fault-clear procedure; the generator was writing
           fiction because it had nothing to write from. A grounding guard built
           on that diagnosis measured 1 TP / 2 FP, because it inherited the
           retrieval defect and suppressed hardest where MIRA was weakest.

    #3160  the fingerprint was named `pivot_after_fault` and every failing turn
           was assumed to be a pivot failure. Per-turn grades showed 4 of 4
           failures were at turn 2, upstream of the pivot — the fix was already
           working under a misleading name.

Two layers are not pipeline positions and are handled specially:

  * **POLICY overrides everything.** If MIRA should have stopped and did not,
    that is the defect, regardless of how retrieval performed. Safety is never
    somebody else's downstream symptom.
  * **INGEST terminates.** If the content is not in the corpus, every
    downstream layer is *expected* to fail and reporting them adds noise. The
    classifier says INGEST, names the ingest gap, and explicitly tells the
    reader not to tune retrieval — the directive's rule, and the GS10 lesson.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .stages import (
    CAUSAL_ORDER,
    FAIL,
    NOT_OBSERVED,
    PASS,
    Stage,
    StageGrade,
    TurnDiagnosis,
)

#: Which subsystem a class points at. The directive's success criterion is that
#: the harness "points Claude toward the correct subsystem" — so the mapping is
#: data, printed in the report, not folklore in someone's head.
SUBSYSTEM = {
    Stage.INGEST: (
        "mira-crawler/ingest/ + the corpus itself — source and ingest the missing "
        "document, and fix model_number tagging. NOT a retrieval change."
    ),
    Stage.SCOPE: (
        "mira-bots/shared/uns_resolver.py (+ .claude/rules/uns-compliance.md) — "
        "vendor/model/fault extraction and the alias table."
    ),
    Stage.DIALOGUE: (
        "mira-bots/shared/engine.py — FSM state carry, severance/pivot bookkeeping, "
        "_prepend_equipment_context, the repeated-answer guards."
    ),
    Stage.RETRIEVAL: (
        "mira-bots/shared/neon_recall.py — streams, ranking and fusion. Measure the "
        "verbatim-quote cosine ceiling BEFORE attempting a query-side fix."
    ),
    Stage.EVIDENCE: (
        "mira-bots/shared/workers/rag_worker.py — the quality gate, cross-vendor "
        "filter and prompt builder decide which retrieved chunks survive."
    ),
    Stage.GENERATION: (
        "the prompt + provider cascade (mira-bots/shared/inference/router.py, "
        "rag_worker prompt builder) — evidence reached the model and was not used."
    ),
    Stage.GROUNDING: (
        "mira-bots/shared/citation_compliance.py + engine._is_grounded / CIT-006 — "
        "claim support and citation validity."
    ),
    Stage.POLICY: (
        "mira-bots/shared/guardrails.py (SAFETY_KEYWORDS / SAFETY_ACTION_PHRASES) "
        "and the safety curriculum in campaign/safety.py."
    ),
}

#: Layers whose failure is fully explained by an upstream failure. Used only for
#: wording — the classifier already picks the upstream layer as primary.
DOWNSTREAM_OF = {
    Stage.INGEST: (Stage.RETRIEVAL, Stage.EVIDENCE, Stage.GROUNDING, Stage.GENERATION),
    Stage.SCOPE: (Stage.RETRIEVAL, Stage.EVIDENCE, Stage.GROUNDING, Stage.GENERATION),
    Stage.DIALOGUE: (Stage.RETRIEVAL, Stage.EVIDENCE, Stage.GROUNDING, Stage.GENERATION),
    Stage.RETRIEVAL: (Stage.EVIDENCE, Stage.GROUNDING, Stage.GENERATION),
    Stage.EVIDENCE: (Stage.GROUNDING, Stage.GENERATION),
    Stage.GROUNDING: (Stage.GENERATION,),
}


@dataclass
class Classification:
    """The diagnosis for one turn."""

    primary: Stage | None
    confidence: str  # "high" | "measured" | "low"
    explanation: str
    subsystem: str = ""
    secondary: list[Stage] = field(default_factory=list)
    unobserved: list[Stage] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    turn_index: int = 0
    conv_id: str = ""

    @property
    def label(self) -> str:
        return self.primary.value if self.primary else "UNCLASSIFIED"

    def as_dict(self) -> dict:
        return {
            "conv_id": self.conv_id,
            "turn": self.turn_index,
            "primary": self.label,
            "confidence": self.confidence,
            "subsystem": self.subsystem,
            "secondary": [s.value for s in self.secondary],
            "unobserved": [s.value for s in self.unobserved],
            "explanation": self.explanation,
            "evidence": self.evidence,
        }


def _causal_sort(stages_: set[Stage]) -> list[Stage]:
    """Order by causal position; anything outside the pipeline (POLICY) goes last."""
    return sorted(
        stages_,
        key=lambda s: CAUSAL_ORDER.index(s) if s in CAUSAL_ORDER else len(CAUSAL_ORDER),
    )


def _fmt_evidence(grade: StageGrade) -> str:
    ev = grade.evidence or {}
    bits: list[str] = []
    if "missing" in ev and ev["missing"]:
        bits.append(f"missing: {ev['missing']}")
    if "hits" in ev and ev["hits"]:
        bits.append(f"found at ranks {[h['rank'] for h in ev['hits']]}")
    if ev.get("polysemy_traps"):
        traps = ev["polysemy_traps"]
        bits.append(
            f"wrong-sense content at ranks {[t['rank'] for t in traps]} ({traps[0].get('match')!r})"
        )
    if ev.get("fabricated_tokens"):
        bits.append(f"fabricated: {ev['fabricated_tokens']}")
    if ev.get("resolved"):
        bits.append(f"resolved: {ev['resolved']!r}")
    if ev.get("warning"):
        bits.append(f"CAVEAT {ev['warning']}")
    return "; ".join(bits)


def classify(diagnosis: TurnDiagnosis) -> Classification:
    """Assign ONE primary root-cause class, with an explanation and evidence."""
    by_stage = diagnosis.by_stage()
    failed = set(diagnosis.failed_stages())
    unobserved = [s for s, g in by_stage.items() if g.verdict == NOT_OBSERVED]

    base = dict(turn_index=diagnosis.turn_index, conv_id=diagnosis.conv_id)

    # -- POLICY overrides ------------------------------------------------
    policy = by_stage.get(Stage.POLICY)
    if policy is not None and policy.verdict == FAIL:
        return Classification(
            primary=Stage.POLICY,
            confidence="high",
            explanation=(
                f"SAFETY/POLICY failure, which outranks every other layer: {policy.detail}. "
                "Whatever else went wrong on this turn, a technician was given an unsafe "
                "or out-of-scope answer, and that is the defect to fix first."
            ),
            subsystem=SUBSYSTEM[Stage.POLICY],
            # POLICY is not a pipeline position, so it has no CAUSAL_ORDER index —
            # sorting `failed` directly used to raise ValueError the moment a
            # POLICY failure coincided with any other failure, i.e. exactly the
            # multi-layer case this branch exists for.
            secondary=_causal_sort(failed - {Stage.POLICY}),
            unobserved=unobserved,
            evidence=policy.evidence,
            **base,
        )

    if not failed:
        decided = [g for g in diagnosis.grades if g.verdict in (PASS, FAIL)]
        if not decided:
            return Classification(
                primary=None,
                confidence="low",
                explanation=(
                    "No layer could be decided. Every stage is NOT_OBSERVED or "
                    "INCONCLUSIVE — this run has no telemetry and no oracle, so it "
                    "says nothing about MIRA. Attach a retrieval probe and register "
                    "an oracle before reading anything into it."
                ),
                unobserved=unobserved,
                **base,
            )
        return Classification(
            primary=None,
            confidence="measured",
            explanation=(
                f"No layer failed ({len(decided)} of {len(diagnosis.grades)} layers "
                "were actually decided). Note this is not proof the turn is good — "
                "a masked defect can pass every guard at once (c6/c7)."
            ),
            unobserved=unobserved,
            **base,
        )

    # -- upstream-first --------------------------------------------------
    primary = next(s for s in CAUSAL_ORDER if s in failed)
    grade = by_stage[primary]
    downstream = [s for s in DOWNSTREAM_OF.get(primary, ()) if s in failed]
    others = sorted(
        (s for s in failed if s != primary and s not in downstream),
        key=lambda s: CAUSAL_ORDER.index(s),
    )

    detail = _fmt_evidence(grade)
    parts = [f"{primary.value} failed: {grade.detail}."]
    if detail:
        parts.append(f"Evidence — {detail}.")

    if primary is Stage.INGEST:
        parts.append(
            "The content is not in the corpus for this vendor, so no retrieval, "
            "ranking or prompt change can surface it. **Do not tune retrieval for "
            "this case** — source and ingest the document, and fix model tagging. "
            "Every downstream layer is expected to fail and is not evidence of "
            "anything else."
        )
    elif downstream:
        names = ", ".join(s.value for s in downstream)
        parts.append(
            f"{names} also failed, but downstream of {primary.value} — expect them "
            f"to clear once {primary.value} is repaired, and do not fix them "
            "separately. (This is the #3165 shape: the fabricated parameter was "
            "GROUNDING's symptom of a RETRIEVAL cause.)"
        )
    if others:
        parts.append(
            f"Independently also failing: {', '.join(s.value for s in others)} — "
            "not explained by the primary cause, so triage separately."
        )
    if unobserved:
        parts.append(f"Not observed (so NOT passing): {', '.join(s.value for s in unobserved)}.")

    confidence = "measured" if grade.evidence else "low"
    if primary in (Stage.INGEST, Stage.RETRIEVAL) and grade.evidence:
        confidence = "high"

    return Classification(
        primary=primary,
        confidence=confidence,
        explanation=" ".join(parts),
        subsystem=SUBSYSTEM[primary],
        secondary=downstream + others,
        unobserved=unobserved,
        evidence=grade.evidence,
        **base,
    )


def classify_conversation(diagnoses: list[TurnDiagnosis]) -> list[Classification]:
    """Classify every turn, worst-first.

    Returns per-TURN classifications rather than one per conversation on
    purpose: the c12 investigation found all four `pivot_after_fault` failures
    were at turn 2 while the fingerprint named turn 3, and only a per-turn
    histogram made that visible. A conversation-level verdict would have hidden
    it again.
    """
    return [classify(d) for d in diagnoses]


def primary_counts(classifications: list[Classification]) -> dict[str, int]:
    """Failures by root-cause category — the report's headline table."""
    counts: dict[str, int] = {}
    for c in classifications:
        if c.primary is None:
            continue
        counts[c.primary.value] = counts.get(c.primary.value, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))
