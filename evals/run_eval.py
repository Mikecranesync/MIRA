#!/usr/bin/env python3
"""FactoryLM RAG Evaluation Pipeline.

Usage:
    python evals/run_eval.py --use-ragas                          # RAGAS only (dummy data)
    python evals/run_eval.py --use-ragas --use-deepeval           # Both frameworks
    python evals/run_eval.py --use-ragas --live                   # Against real MIRA
    python evals/run_eval.py --use-ragas --csv path/to/custom.csv # Custom test set

Requires:
    pip install ragas datasets deepeval
    OPENAI_API_KEY or ANTHROPIC_API_KEY for LLM-based metric scoring
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from pathlib import Path

# Add evals/ to path so imports work from repo root
sys.path.insert(0, str(Path(__file__).parent))

from query_stub import query_factorylm

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DEFAULT_CSV = Path(__file__).parent.parent / "tests" / "golden_factorylm.csv"
DEFAULT_OUTPUT = Path(__file__).parent.parent / "output"


def load_golden_csv(csv_path: Path) -> list[dict]:
    """Load golden test set from CSV.

    Expected columns: question, ideal_answer, contexts
    The contexts column is pipe-delimited (|) for multiple chunks.
    """
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            contexts_raw = row.get("contexts", "")
            contexts = [c.strip() for c in contexts_raw.split("|") if c.strip()]
            rows.append({
                "question": row["question"].strip(),
                "ideal_answer": row["ideal_answer"].strip(),
                "expected_contexts": contexts,
            })
    return rows


def collect_predictions(golden: list[dict], live: bool = False) -> list[dict]:
    """Run query_factorylm for each golden question and collect predictions."""
    predictions = []
    for i, row in enumerate(golden):
        question = row["question"]
        logger.info("  [%d/%d] %s", i + 1, len(golden), question[:80])

        result = query_factorylm(question, live=live)

        predictions.append({
            "question": question,
            "answer": result["answer"],
            "contexts": result["contexts"],
            "ground_truth": row["ideal_answer"],
            "expected_contexts": row["expected_contexts"],
        })

    return predictions


def main():
    parser = argparse.ArgumentParser(description="FactoryLM RAG Evaluation")
    parser.add_argument("--use-ragas", action="store_true", help="Run RAGAS metrics")
    parser.add_argument("--use-deepeval", action="store_true", help="Run DeepEval checks")
    parser.add_argument("--live", action="store_true", help="Query real MIRA (requires env vars)")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to golden CSV")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output directory")
    args = parser.parse_args()

    if not args.use_ragas and not args.use_deepeval:
        parser.error("Specify at least one of --use-ragas or --use-deepeval")

    # Load golden test set
    if not args.csv.exists():
        logger.error("Golden CSV not found: %s", args.csv)
        sys.exit(1)

    golden = load_golden_csv(args.csv)
    logger.info("Loaded %d golden test cases from %s", len(golden), args.csv)

    # Collect predictions
    mode = "LIVE (real MIRA)" if args.live else "DUMMY (stub responses)"
    logger.info("Collecting predictions in %s mode...", mode)
    predictions = collect_predictions(golden, live=args.live)

    # Save raw predictions
    args.output.mkdir(parents=True, exist_ok=True)
    pred_path = args.output / "predictions.json"
    pred_path.write_text(json.dumps(predictions, indent=2))
    logger.info("Predictions saved to %s", pred_path)

    # Run RAGAS
    if args.use_ragas:
        from ragas_eval import print_ragas_summary, run_ragas_eval
        ragas_results = run_ragas_eval(predictions, args.output)
        print_ragas_summary(ragas_results)

    # Run DeepEval
    if args.use_deepeval:
        from deepeval_eval import print_deepeval_summary, run_deepeval_eval
        deepeval_results = run_deepeval_eval(predictions, args.output)
        print_deepeval_summary(deepeval_results)

    # Final checklist for connecting to real MIRA
    if not args.live:
        print("\n" + "-" * 60)
        print("NEXT STEPS — Connect to Real MIRA:")
        print("-" * 60)
        print("  1. Set env vars: NEON_DATABASE_URL, MIRA_TENANT_ID,")
        print("     OLLAMA_BASE_URL, ANTHROPIC_API_KEY")
        print("  2. Re-run with: python evals/run_eval.py --use-ragas --live")
        print("  3. Add your own questions to tests/golden_factorylm.csv")
        print("  4. Target: Faithfulness >= 0.85 before real technician testing")
        print("-" * 60)


if __name__ == "__main__":
    main()
