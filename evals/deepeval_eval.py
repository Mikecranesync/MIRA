"""DeepEval evaluation for FactoryLM RAG pipeline.

Checks for hallucinations and bias in model responses.
Optional — run with --use-deepeval flag.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def run_deepeval_eval(
    predictions: list[dict],
    output_dir: Path,
) -> dict:
    """Run DeepEval hallucination and bias checks.

    Args:
        predictions: List of dicts with keys:
            - question: str
            - answer: str (model's answer)
            - contexts: list[str] (retrieved contexts)
            - ground_truth: str (ideal answer from golden set)
        output_dir: Directory to write deepeval_results.json

    Returns:
        Dict with per-question scores and overall summary.
    """
    try:
        from deepeval import evaluate
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            BiasMetric,
            HallucinationMetric,
        )
        from deepeval.test_case import LLMTestCase
    except ImportError as e:
        logger.error(
            "DeepEval not installed. Run: pip install deepeval\nError: %s", e
        )
        return {"error": str(e)}

    logger.info("Running DeepEval evaluation on %d questions...", len(predictions))

    # Build test cases
    test_cases = []
    for p in predictions:
        tc = LLMTestCase(
            input=p["question"],
            actual_output=p["answer"],
            expected_output=p["ground_truth"],
            retrieval_context=p["contexts"],
        )
        test_cases.append(tc)

    # Define metrics
    hallucination = HallucinationMetric(threshold=0.5)
    bias = BiasMetric(threshold=0.5)
    relevancy = AnswerRelevancyMetric(threshold=0.7)

    # Evaluate each test case
    per_question = []
    for i, tc in enumerate(test_cases):
        result_entry = {"question": predictions[i]["question"]}

        for metric in [hallucination, bias, relevancy]:
            metric_name = type(metric).__name__.replace("Metric", "").lower()
            try:
                metric.measure(tc)
                result_entry[metric_name] = {
                    "score": float(metric.score),
                    "passed": metric.is_successful(),
                    "reason": metric.reason if hasattr(metric, "reason") else "",
                }
            except Exception as e:
                logger.warning("DeepEval %s failed for Q%d: %s", metric_name, i + 1, e)
                result_entry[metric_name] = {
                    "score": 0.0,
                    "passed": False,
                    "reason": f"Error: {e}",
                }

        per_question.append(result_entry)

    # Aggregate
    hallucination_scores = [
        q["hallucination"]["score"] for q in per_question
        if "hallucination" in q and isinstance(q["hallucination"]["score"], float)
    ]
    bias_scores = [
        q["bias"]["score"] for q in per_question
        if "bias" in q and isinstance(q["bias"]["score"], float)
    ]
    relevancy_scores = [
        q["answerrelevancy"]["score"] for q in per_question
        if "answerrelevancy" in q and isinstance(q["answerrelevancy"]["score"], float)
    ]

    output = {
        "aggregate_scores": {
            "hallucination": sum(hallucination_scores) / len(hallucination_scores) if hallucination_scores else 0,
            "bias": sum(bias_scores) / len(bias_scores) if bias_scores else 0,
            "answer_relevancy": sum(relevancy_scores) / len(relevancy_scores) if relevancy_scores else 0,
        },
        "per_question": per_question,
        "num_questions": len(predictions),
    }

    # Write to file
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "deepeval_results.json"
    output_path.write_text(json.dumps(output, indent=2, default=str))
    logger.info("DeepEval results written to %s", output_path)

    return output


def print_deepeval_summary(results: dict) -> None:
    """Print a plain-English summary of DeepEval scores."""
    if "error" in results:
        print(f"\nDEEPEVAL ERROR: {results['error']}")
        return

    scores = results["aggregate_scores"]
    print("\n" + "=" * 60)
    print("DEEPEVAL EVALUATION RESULTS")
    print("=" * 60)

    thresholds = {
        "hallucination": 0.50,
        "bias": 0.50,
        "answer_relevancy": 0.70,
    }

    for metric, score in scores.items():
        threshold = thresholds.get(metric, 0.50)
        # For hallucination/bias, LOWER is better
        if metric in ("hallucination", "bias"):
            status = "PASS" if score <= threshold else "FAIL"
            icon = "+" if score <= threshold else "!"
            label = metric.title()
            print(f"  [{icon}] {label}: {score:.2f}  (target <= {threshold:.2f}) — {status}")
        else:
            status = "PASS" if score >= threshold else "FAIL"
            icon = "+" if score >= threshold else "!"
            label = metric.replace("_", " ").title()
            print(f"  [{icon}] {label}: {score:.2f}  (target >= {threshold:.2f}) — {status}")

    print("=" * 60)
