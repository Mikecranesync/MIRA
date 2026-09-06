"""The daily VCAD scorecard (PRS §6.3, §20).

VCAD — Verified Correct Answers per Day — is the north-star metric, and this module is the
only thing allowed to compute it.

The report deliberately shows several denominators. PRS §6.2 asks for raw discovery,
qualified, attempted, and correct counts because collapsing them hides exactly the failure
this project exists to avoid: reporting a rate that moved because the *denominator* changed.
That is not hypothetical here — the nightly eval scorecard's binary pass rate was found to
track host latency rather than answer quality, because timed-out turns silently stayed in
the denominator (see `wiki/hot.d/` eval-fixer notes and issue #3085).

So UNS-gate turns are reported on their own line and excluded from the correctness
denominator, rather than being counted as failures. If they were folded in, a chat-surface
mismatch would read as MIRA getting the engineering wrong.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from answer_radar.rubric import RubricResult
from answer_radar.schema import AnswerStatus, EvaluationRecord


@dataclass
class DailyReport:
    """One day's benchmark result. `vcad` is the headline number."""

    date: str
    discovered: int
    unique_after_dedupe: int
    qualified: int
    evaluated: int
    verified_correct: int
    correct_abstentions: int
    correct_refusals: int
    incorrect: int
    unsafe: int
    uns_gate: int
    errors: int
    ungraded: int
    citation_coverage_pct: float
    median_answer_time_ms: int
    failure_classes: Counter
    knowledge_gaps: list[str]

    @property
    def vcad(self) -> int:
        """Verified correct answers, including correct abstentions and correct refusals.

        PRS §7 is explicit that a well-formed "I need X before I can answer safely" is a
        correct answer. Excluding them would make the metric reward guessing.
        """
        return self.verified_correct

    @property
    def scored_denominator(self) -> int:
        """Attempts that the rubric could actually score."""
        return max(self.evaluated - self.uns_gate - self.errors, 0)

    @property
    def correct_rate_pct(self) -> float:
        d = self.scored_denominator
        return round(100.0 * self.verified_correct / d, 1) if d else 0.0

    def render(self) -> str:
        lines = [
            f"MIRA FIELD BENCHMARK — {self.date}",
            "",
            f"Discovered:              {self.discovered:>6}",
            f"Unique after dedupe:     {self.unique_after_dedupe:>6}",
            f"Qualified maintenance:   {self.qualified:>6}",
            f"Evaluated today:         {self.evaluated:>6}",
            "",
            f"Verified correct:        {self.verified_correct:>6}",
            f"  of which abstentions:  {self.correct_abstentions:>6}",
            f"  of which refusals:     {self.correct_refusals:>6}",
            f"Incorrect:               {self.incorrect:>6}",
            f"Unsafe answers:          {self.unsafe:>6}",
            f"Ungraded:                {self.ungraded:>6}",
            "",
            f"UNS-gate turns:          {self.uns_gate:>6}   (excluded from the denominator)",
            f"Engine errors:           {self.errors:>6}   (excluded from the denominator)",
            "",
            f"Scored denominator:      {self.scored_denominator:>6}",
            f"Correct-answer rate:     {self.correct_rate_pct:>5}%",
            f"VCAD:                    {self.vcad:>6}",
            "",
            f"Citation coverage:       {self.citation_coverage_pct:>5}%",
            f"Median answer time:      {self.median_answer_time_ms:>6} ms",
        ]

        if self.failure_classes:
            lines += ["", "TOP FAILURES"]
            lines += [f"  {n:>2}x  {cls}" for cls, n in self.failure_classes.most_common(8)]

        if self.knowledge_gaps:
            lines += ["", "KNOWLEDGE TO ACQUIRE"]
            lines += [f"  - {g}" for g in self.knowledge_gaps]

        if self.unsafe:
            lines += ["", f"!! {self.unsafe} unsafe answer(s) — these never count toward VCAD."]

        return "\n".join(lines)


def build_report(
    graded: list[tuple[EvaluationRecord, RubricResult]],
    *,
    discovered: int,
    unique_after_dedupe: int,
    qualified: int,
    knowledge_gaps: list[str] | None = None,
    date: str | None = None,
) -> DailyReport:
    outcomes = Counter(r.outcome for _, r in graded)
    failure_classes: Counter = Counter()
    for rec, res in graded:
        if not res.verified_correct and res.outcome not in {"uns_gate"}:
            cls = rec.failure_class or (
                rec.grader_verdicts[0].failure_class if rec.grader_verdicts else None
            )
            failure_classes[cls or "unclassified"] += 1

    times = sorted(rec.total_answer_time_ms for rec, _ in graded)
    median = times[len(times) // 2] if times else 0

    scorable = [rec for rec, res in graded if res.counts_as_attempt]
    with_citations = sum(1 for rec in scorable if rec.retrieved_chunk_count > 0)
    coverage = round(100.0 * with_citations / len(scorable), 1) if scorable else 0.0

    verified = sum(1 for _, res in graded if res.verified_correct)

    return DailyReport(
        date=date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        discovered=discovered,
        unique_after_dedupe=unique_after_dedupe,
        qualified=qualified,
        evaluated=len(graded),
        verified_correct=verified,
        correct_abstentions=sum(
            1
            for rec, res in graded
            if res.verified_correct and rec.answer_status is AnswerStatus.ABSTAINED
        ),
        correct_refusals=sum(
            1 for _, res in graded if res.verified_correct and res.outcome == "correct_refusal"
        ),
        # Everything scored but not verified, minus the unsafe bucket. Derived rather than
        # counted from outcome labels so the columns always sum to the scored denominator:
        # a refusal that refused correctly but scored below threshold keeps its
        # `correct_refusal` label and must still appear somewhere in the totals.
        incorrect=max(
            len([1 for _, res in graded if res.counts_as_attempt and res.outcome != "error"])
            - verified
            - outcomes.get("unsafe", 0)
            - outcomes.get("ungraded", 0),
            0,
        ),
        unsafe=outcomes.get("unsafe", 0),
        uns_gate=outcomes.get("uns_gate", 0),
        errors=outcomes.get("error", 0),
        ungraded=outcomes.get("ungraded", 0),
        citation_coverage_pct=coverage,
        median_answer_time_ms=median,
        failure_classes=failure_classes,
        knowledge_gaps=knowledge_gaps or [],
    )
