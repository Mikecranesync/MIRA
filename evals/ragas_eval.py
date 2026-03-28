"""RAGAS evaluation for FactoryLM RAG pipeline.

Computes standard RAG metrics:
  - faithfulness: Is the answer grounded in the retrieved context?
  - answer_relevancy: Does the answer address the question?
  - context_precision: Are the retrieved contexts relevant?
  - context_recall: Do the retrieved contexts cover the ideal answer?
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Target thresholds for FactoryLM
THRESHOLDS = {
    "faithfulness": 0.85,
    "answer_relevancy": 0.80,
    "context_precision": 0.75,
    "context_recall": 0.75,
}


def run_ragas_eval(
    predictions: list[dict],
    output_dir: Path,
) -> dict:
    """Run RAGAS evaluation on a list of predictions.

    Args:
        predictions: List of dicts with keys:
            - question: str
            - answer: str (model's answer)
            - contexts: list[str] (retrieved contexts)
            - ground_truth: str (ideal answer from golden set)
        output_dir: Directory to write ragas_results.json

    Returns:
        Dict with aggregate scores and per-question breakdown.
    """
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )
    except ImportError as e:
        logger.error(
            "RAGAS not installed. Run: pip install ragas datasets\nError: %s", e
        )
        return {"error": str(e)}

    # Build the dataset in RAGAS expected format
    data = {
        "question": [p["question"] for p in predictions],
        "answer": [p["answer"] for p in predictions],
        "contexts": [p["contexts"] for p in predictions],
        "ground_truth": [p["ground_truth"] for p in predictions],
    }
    dataset = Dataset.from_dict(data)

    logger.info("Running RAGAS evaluation on %d questions...", len(predictions))

    try:
        result = evaluate(
            dataset,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        )
    except Exception as e:
        logger.error("RAGAS evaluation failed: %s", e)
        return {"error": str(e)}

    # Extract aggregate scores
    scores = {
        "faithfulness": float(result["faithfulness"]),
        "answer_relevancy": float(result["answer_relevancy"]),
        "context_precision": float(result["context_precision"]),
        "context_recall": float(result["context_recall"]),
    }

    # Per-question breakdown from the result dataset
    per_question = []
    result_df = result.to_pandas()
    for i, row in result_df.iterrows():
        per_question.append({
            "question": predictions[i]["question"],
            "faithfulness": float(row.get("faithfulness", 0)),
            "answer_relevancy": float(row.get("answer_relevancy", 0)),
            "context_precision": float(row.get("context_precision", 0)),
            "context_recall": float(row.get("context_recall", 0)),
        })

    # Build output
    output = {
        "aggregate_scores": scores,
        "thresholds": THRESHOLDS,
        "per_question": per_question,
        "num_questions": len(predictions),
    }

    # Write to file
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "ragas_results.json"
    output_path.write_text(json.dumps(output, indent=2))
    logger.info("RAGAS results written to %s", output_path)

    return output


def print_ragas_summary(results: dict) -> None:
    """Print a plain-English summary of RAGAS scores."""
    if "error" in results:
        print(f"\nRAGAS ERROR: {results['error']}")
        return

    scores = results["aggregate_scores"]
    print("\n" + "=" * 60)
    print("RAGAS EVALUATION RESULTS")
    print("=" * 60)

    for metric, score in scores.items():
        threshold = THRESHOLDS.get(metric, 0.75)
        status = "PASS" if score >= threshold else "FAIL"
        icon = "+" if score >= threshold else "!"
        label = metric.replace("_", " ").title()
        print(f"  [{icon}] {label}: {score:.2f}  (target >= {threshold:.2f}) — {status}")

    # Overall verdict
    all_pass = all(
        scores[m] >= THRESHOLDS[m] for m in THRESHOLDS if m in scores
    )
    print()
    if all_pass:
        print("  OVERALL: ALL METRICS PASS — ready for technician testing")
    else:
        failing = [m for m in THRESHOLDS if m in scores and scores[m] < THRESHOLDS[m]]
        print(f"  OVERALL: BELOW TARGET on: {', '.join(failing)}")
        print("  Action: review retrieval quality and prompt engineering")
    print("=" * 60)
