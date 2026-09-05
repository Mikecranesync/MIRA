"""VCAD report generation and Slack formatting.

Generates daily Answer Radar reports with:
- VCAD (Verified Correct Answers per Day)
- Breakdown of results
- Best questions for public reply
- Biggest MIRA knowledge gaps
- Recommended next actions
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .mission_state import AnswerRadarMission, QuestionScore


def generate_vcad_report(mission: AnswerRadarMission) -> dict:
    """Generate structured VCAD report data."""
    scores = list(mission.scores.values())

    verified_correct = sum(1 for s in scores if s.final_verdict == "VERIFIED_CORRECT")
    correct_abstention = sum(1 for s in scores if s.final_verdict == "CORRECT_ABSTENTION")
    failed = sum(1 for s in scores if s.final_verdict == "FAIL")
    unsafe = sum(1 for s in scores if s.final_verdict == "UNSAFE")

    # Best questions (highest scores that passed)
    best_questions = sorted(
        [s for s in scores if s.final_verdict == "VERIFIED_CORRECT"],
        key=lambda s: s.overall_score,
        reverse=True,
    )[:3]

    # Knowledge gaps (failed questions with specific issues)
    gaps = []
    for score in scores:
        if score.final_verdict in ("FAIL", "CORRECT_ABSTENTION"):
            if score.knowledge_gap:
                gaps.append(score.knowledge_gap)

    return {
        "mission_id": mission.mission_id,
        "discovered": len(mission.questions),
        "evaluated": len(scores),
        "verified_correct": verified_correct,
        "correct_abstentions": correct_abstention,
        "failed": failed,
        "unsafe": unsafe,
        "vcad": verified_correct,
        "best_questions": [
            {
                "question_id": s.question_id,
                "score": s.overall_score,
            }
            for s in best_questions
        ],
        "knowledge_gaps": gaps,
        "started_at": mission.started_at,
        "completed_at": mission.completed_at,
    }


def format_slack_report(report_data: dict, mission: AnswerRadarMission) -> str:
    """Format VCAD report for Slack posting.

    Returns a concise, human-readable summary suitable for #factorylm-foreman.
    Does NOT auto-post - returns text for human approval.
    """
    # Extract data
    mission_id = report_data["mission_id"]
    discovered = report_data["discovered"]
    evaluated = report_data["evaluated"]
    verified = report_data["verified_correct"]
    abstentions = report_data["correct_abstentions"]
    failed = report_data["failed"]
    unsafe = report_data["unsafe"]
    vcad = report_data["vcad"]
    best = report_data["best_questions"]
    gaps = report_data["knowledge_gaps"]

    # Build Slack message
    lines = [
        f"📡 *ANSWER RADAR — {mission_id}*",
        "",
        f"*Discovered:* {discovered}",
        f"*Evaluated:* {evaluated}",
        f"*Verified Correct:* {verified}",
        f"*Correct Abstentions:* {abstentions}",
        f"*Incorrect:* {failed}",
        f"*Unsafe:* {unsafe}",
        f"*VCAD:* {vcad}",
        "",
    ]

    if best:
        lines.append("*Best questions to answer publicly:*")
        for i, q in enumerate(best, 1):
            question_obj = next(
                (x for x in mission.questions if x.question_id == q["question_id"]),
                None,
            )
            if question_obj:
                lines.append(f"{i}. {question_obj.title} (score: {q['score']})")
        lines.append("")

    if gaps:
        lines.append("*Knowledge gaps identified:*")
        for gap in gaps[:3]:  # Top 3
            lines.append(f"• {gap}")
        lines.append("")

    if failed > 0:
        lines.append("*Recommended next action:*")
        lines.append("Review failed cases to identify retrieval or knowledge gaps.")
    else:
        lines.append("*Status:* All evaluated questions verified correct! 🎉")

    return "\n".join(lines)


def format_console_report(report_data: dict, mission: AnswerRadarMission) -> str:
    """Format VCAD report for console/dry-run output.

    Returns a detailed text report suitable for local debugging and review.
    """
    lines = [
        "=" * 70,
        f"ANSWER RADAR REPORT — {report_data['mission_id']}",
        "=" * 70,
        "",
        f"Discovered:          {report_data['discovered']}",
        f"Evaluated:           {report_data['evaluated']}",
        f"Verified Correct:    {report_data['verified_correct']}",
        f"Correct Abstentions: {report_data['correct_abstentions']}",
        f"Incorrect:           {report_data['failed']}",
        f"Unsafe:              {report_data['unsafe']}",
        "",
        f"VCAD:                {report_data['vcad']}",
        "",
    ]

    if report_data["best_questions"]:
        lines.append("Best Questions:")
        lines.append("-" * 70)
        for i, q in enumerate(report_data["best_questions"], 1):
            question_obj = next(
                (x for x in mission.questions if x.question_id == q["question_id"]),
                None,
            )
            if question_obj:
                lines.append(f"{i}. [{q['question_id']}] {question_obj.title}")
                lines.append(f"   Score: {q['score']}/100")
                lines.append(f"   URL: {question_obj.url}")
                lines.append("")

    if report_data["knowledge_gaps"]:
        lines.append("Knowledge Gaps:")
        lines.append("-" * 70)
        for gap in report_data["knowledge_gaps"]:
            lines.append(f"• {gap}")
        lines.append("")

    # Detailed breakdown
    lines.append("Question Details:")
    lines.append("-" * 70)
    for question in mission.questions:
        score = mission.scores.get(question.question_id)
        if score:
            lines.append(f"[{question.question_id}] {question.title}")
            lines.append(f"  State: {question.state.value}")
            lines.append(f"  Verdict: {score.final_verdict}")
            lines.append(f"  Score: {score.overall_score}/100")
            lines.append(f"    Technical: {score.technical_correctness}/40")
            lines.append(f"    Safety: {score.safety}/20")
            lines.append(f"    Citations: {score.citation_quality}/20")
            lines.append("")

    lines.append("=" * 70)
    return "\n".join(lines)
