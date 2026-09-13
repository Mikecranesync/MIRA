"""CLI: Run technician + safety cases against the live backend.

Usage:
  python evals/scripts/run_technician.py \
    --cases evals/technician/cases.yaml evals/safety/cases.yaml \
    --out evals/results/<sha>/ \
    [--limit N] [--sha COMMIT_SHA]

Environment:
  FLM_BASE_URL: base URL (default https://app.factorylm.com)
  FLM_SESSION_COOKIE: session cookie (required)
  FLM_EVAL_NOTEBOOK_ID: notebook ID (required)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import string
import subprocess
import sys as _sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

_sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_chat import ask  # noqa: E402

logger = logging.getLogger("run_technician")
logging.basicConfig(level=logging.INFO)


@dataclass
class TechnicianCase:
    """Single technician test case."""

    id: str
    category: str
    mode: str
    equipment: str | None = None
    question: str | None = None
    turns: list[str] | None = None
    expected: dict | None = None


@dataclass
class SafetyCase:
    """Single safety test case."""

    id: str
    hazard_class: str
    question: str
    dangerous_if: list[str] | None = None
    required_elements: list[str] | None = None


@dataclass
class CaseResult:
    """Result for one case, including all turns."""

    case_id: str
    case_type: str  # "technician" or "safety"
    case: dict
    turns: list[dict] = field(default_factory=list)
    error: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


async def run_case(
    case_obj: TechnicianCase | SafetyCase,
    case_type: str,
    notebook_id: str,
) -> CaseResult:
    """Run a single case (single or multi-turn)."""
    result = CaseResult(
        case_id=case_obj.id,
        case_type=case_type,
        case=asdict(case_obj),
    )

    # Generate thread ID
    random_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    case_id_clean = case_obj.id.replace("-", "")
    thread_id = f"thrd_eval{case_id_clean}{random_suffix}"

    if not (re.match(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$", thread_id)):
        result.error = f"Invalid thread_id: {thread_id}"
        return result

    history: list[dict] = []

    if case_type == "technician":
        assert isinstance(case_obj, TechnicianCase)
        case = case_obj
        questions = []
        if case.question:
            questions.append(case.question)
        elif case.turns:
            questions.extend(case.turns)

        for q_idx, question in enumerate(questions):
            if question is None:
                continue
            mode = case.mode if case.mode == "general" else None
            chat_result = await ask(
                notebook_id=notebook_id,
                message=question,
                thread_id=thread_id,
                mode=mode,
                history=history if history else None,
            )

            turn_record = {
                "turn": q_idx,
                "question": question,
                "answer": chat_result.answer,
                "citations": chat_result.citations,
                "status": chat_result.status,
                "saw_status": chat_result.saw_status,
                "evidence_label": chat_result.evidence_label,
                "evidence_basis": chat_result.evidence_basis,
                "safety_trigger": chat_result.safety_trigger,
                "latency_s": chat_result.latency_s,
                "http_status": chat_result.http_status,
                "error": chat_result.error,
            }
            result.turns.append(turn_record)

            # Accumulate history for multi-turn
            if chat_result.answer:
                history.append({"role": "user", "content": question})
                history.append({"role": "assistant", "content": chat_result.answer})

            # Small delay between turns
            if q_idx < len(questions) - 1:
                await asyncio.sleep(0.5)

    elif case_type == "safety":
        assert isinstance(case_obj, SafetyCase)
        case = case_obj
        chat_result = await ask(
            notebook_id=notebook_id,
            message=case.question,
            thread_id=thread_id,
        )

        turn_record = {
            "turn": 0,
            "question": case.question,
            "answer": chat_result.answer,
            "citations": chat_result.citations,
            "status": chat_result.status,
            "saw_status": chat_result.saw_status,
            "safety_trigger": chat_result.safety_trigger,
            "latency_s": chat_result.latency_s,
            "http_status": chat_result.http_status,
            "error": chat_result.error,
        }
        result.turns.append(turn_record)

    return result


async def main():
    parser = argparse.ArgumentParser(description="Run technician + safety cases")
    parser.add_argument(
        "--cases",
        nargs="+",
        required=True,
        help="YAML case files",
    )
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--limit", type=int, help="Max cases to run")
    parser.add_argument("--sha", help="Commit SHA (or auto-detect)")

    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Detect SHA if not provided
    sha = args.sha
    if not sha:
        try:
            sha = (
                subprocess.check_output(["git", "rev-parse", "HEAD"])
                .decode()
                .strip()
            )
        except Exception:
            sha = "unknown"

    notebook_id = os.getenv("FLM_EVAL_NOTEBOOK_ID")
    base_url = os.getenv("FLM_BASE_URL", "https://app.factorylm.com")

    if not notebook_id:
        raise ValueError("FLM_EVAL_NOTEBOOK_ID required")

    # Load cases
    all_cases: list[tuple[str, dict]] = []
    for case_file in args.cases:
        with open(case_file) as f:
            cases = yaml.safe_load(f) or []
            for case in cases:
                case_type = "safety" if "hazard_class" in case else "technician"
                all_cases.append((case_type, case))

    if args.limit:
        all_cases = all_cases[: args.limit]

    logger.info(f"Running {len(all_cases)} cases against {base_url}")

    # Run cases sequentially with small delays
    results: list[CaseResult] = []
    for idx, (case_type, case_dict) in enumerate(all_cases):
        if case_type == "technician":
            case_obj = TechnicianCase(**case_dict)
        else:
            case_obj = SafetyCase(**case_dict)

        logger.info(f"[{idx+1}/{len(all_cases)}] {case_obj.id}")

        try:
            result = await run_case(case_obj, case_type, notebook_id)
            results.append(result)
        except Exception as e:
            logger.error(f"  Error: {e}")
            result = CaseResult(
                case_id=case_obj.id,
                case_type=case_type,
                case=case_dict,
                error=str(e),
            )
            results.append(result)

        if idx < len(all_cases) - 1:
            await asyncio.sleep(0.5)

    # Write per-case results
    case_dir = out_dir / "technician"
    case_dir.mkdir(parents=True, exist_ok=True)
    for result in results:
        case_file = case_dir / f"{result.case_id}.json"
        with open(case_file, "w") as f:
            json.dump(asdict(result), f, indent=2)

    # Write manifest
    manifest = {
        "sha": sha,
        "base_url": base_url,
        "notebook_id": notebook_id,
        "started": datetime.now(timezone.utc).isoformat(),
        "finished": datetime.now(timezone.utc).isoformat(),
        "case_count": len(results),
        "infra_failures": sum(1 for r in results if r.error),
    }

    manifest_file = case_dir / "_manifest.json"
    with open(manifest_file, "w") as f:
        json.dump(manifest, f, indent=2)

    logger.info(f"Results written to {case_dir}")
    logger.info(f"Infra failures: {manifest['infra_failures']}/{len(results)}")


if __name__ == "__main__":
    import re

    asyncio.run(main())
