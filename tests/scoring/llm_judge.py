"""LLM-as-judge scorer extracted from prejudged_benchmark_run.py.

Uses Claude API (via Anthropic SDK) to score response quality on
3 dimensions: Accuracy, Actionability, Grounding. Returns 1.0-5.0 scale.

For multi-turn diagnostic conversations, uses the full 5-dimension
prejudged judge (evidence utilization, path efficiency, GSD compliance,
root cause alignment, expert comparison) on a 0-10 scale.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger("mira-eval.llm-judge")


def judge_single_response(
    question: str,
    response: str,
    ground_truth: dict,
    anthropic_client,
    model: str = "claude-sonnet-4-6",
) -> dict:
    """Score a single response on 3 dimensions (1.0-5.0 each).

    Args:
        question: the user's question
        response: the system's response
        ground_truth: dict with root_cause, fix, keywords
        anthropic_client: anthropic.Anthropic() instance
        model: model to use for judging

    Returns:
        dict with accuracy, actionability, grounding scores + reasoning
    """
    gt_json = json.dumps(ground_truth, indent=2)

    prompt = f"""You are an expert industrial maintenance evaluator. Score this AI diagnostic response.

QUESTION: {question}

RESPONSE: {response}

GROUND TRUTH:
{gt_json}

Score each dimension from 1.0 to 5.0:

1. ACCURACY (weight 0.40): Does the response match ground truth? Is the equipment/fault correctly identified?
2. ACTIONABILITY (weight 0.35): Would a technician standing at the machine know what to do next?
3. GROUNDING (weight 0.25): Is the response grounded in provided context, or does it hallucinate?

Return a JSON object with exactly these fields:
- accuracy: float (1.0-5.0)
- actionability: float (1.0-5.0)
- grounding: float (1.0-5.0)
- reasoning: string (2-3 sentences)

Return ONLY the JSON object, no other text."""

    try:
        resp = anthropic_client.messages.create(
            model=model,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        return _parse_json_response(text, fields=["accuracy", "actionability", "grounding"])
    except Exception as exc:
        logger.warning("LLM judge failed: %s", exc)
        return {
            "accuracy": 0.0,
            "actionability": 0.0,
            "grounding": 0.0,
            "reasoning": f"Judge error: {exc}",
        }


def judge_conversation(
    case: dict,
    transcript: list[dict],
    turn_count: int,
    reached_diagnosis: bool,
    anthropic_client,
    model: str = "claude-sonnet-4-6",
) -> dict:
    """Score a multi-turn diagnostic conversation on 5 dimensions (0-10 each).

    Extracted from prejudged_benchmark_run.py::_judge_conversation().

    Returns dict with evidence_utilization, path_efficiency, gsd_compliance,
    root_cause_alignment, expert_comparison scores + reasoning.
    """
    ground_truth = case.get("ground_truth", {})
    if isinstance(ground_truth, str):
        ground_truth = json.loads(ground_truth)

    gt_json = json.dumps(ground_truth, indent=2)
    transcript_text = "\n".join(
        f"[{t['role'].upper()} (state={t.get('state', '?')})]: {t['content']}"
        for t in transcript
    )

    prompt = f"""You are an expert industrial maintenance trainer evaluating an AI diagnostic assistant's performance. Score the following conversation on 5 dimensions.

CASE: {case.get('title', 'unknown')}
EQUIPMENT: {case.get('equipment_type', 'unknown')}
DIFFICULTY: {case.get('difficulty', 'medium')}
REACHED DIAGNOSIS: {reached_diagnosis}
TURNS USED: {turn_count}

GROUND TRUTH:
{gt_json}

CONVERSATION TRANSCRIPT:
{transcript_text}

Score each dimension from 0.0 to 10.0:

1. EVIDENCE UTILIZATION (weight 0.20): Did MIRA ask for the key evidence mentioned in ground truth keywords? Did it gather the right diagnostic data?

2. PATH EFFICIENCY (weight 0.20): How directly did MIRA reach the root cause? Fewer turns = better. 2-3 turns for easy cases, 3-4 for medium, 4-5 for hard is ideal. Max 8 turns is a timeout penalty.

3. GSD COMPLIANCE (weight 0.25): Did MIRA follow the Socratic diagnostic method? Did it ask focused questions, narrow down possibilities, and guide rather than guess? Did it use the state machine properly (IDLE->Q1->Q2->Q3->DIAGNOSIS)?

4. ROOT CAUSE ALIGNMENT (weight 0.25): Does MIRA's final diagnosis match the ground truth root cause? Partial credit for being in the right area.

5. EXPERT COMPARISON (weight 0.10): Would a master maintenance technician approve of this diagnostic approach? Was it professional, safe, and methodical?

Return a JSON object with exactly these fields:
- evidence_utilization: float (0-10)
- path_efficiency: float (0-10)
- gsd_compliance: float (0-10)
- root_cause_alignment: float (0-10)
- expert_comparison: float (0-10)
- reasoning: string (2-3 sentences explaining the scores)

Return ONLY the JSON object, no other text."""

    try:
        resp = anthropic_client.messages.create(
            model=model,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        return _parse_json_response(text, fields=[
            "evidence_utilization", "path_efficiency", "gsd_compliance",
            "root_cause_alignment", "expert_comparison",
        ])
    except Exception as exc:
        logger.warning("LLM conversation judge failed: %s", exc)
        return {
            "evidence_utilization": 0.0,
            "path_efficiency": 0.0,
            "gsd_compliance": 0.0,
            "root_cause_alignment": 0.0,
            "expert_comparison": 0.0,
            "reasoning": f"Judge error: {exc}",
        }


def compute_conversation_composite(scores: dict) -> float:
    """Compute weighted composite score for a conversation (0-10 scale)."""
    return (
        scores.get("evidence_utilization", 0.0) * 0.20
        + scores.get("path_efficiency", 0.0) * 0.20
        + scores.get("gsd_compliance", 0.0) * 0.25
        + scores.get("root_cause_alignment", 0.0) * 0.25
        + scores.get("expert_comparison", 0.0) * 0.10
    )


def compute_response_composite(scores: dict) -> float:
    """Compute weighted composite score for a single response (1-5 scale)."""
    return (
        scores.get("accuracy", 0.0) * 0.40
        + scores.get("actionability", 0.0) * 0.35
        + scores.get("grounding", 0.0) * 0.25
    )


def _parse_json_response(text: str, fields: list[str]) -> dict:
    """Parse JSON from LLM response, with fallback regex extraction."""
    try:
        if text.startswith("{"):
            return json.loads(text)
        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse judge response: %s", exc)

    return {f: 0.0 for f in fields} | {"reasoning": f"Parse error: {text[:200]}"}
