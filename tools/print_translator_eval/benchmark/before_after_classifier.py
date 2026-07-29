"""Deterministic before/after PR #2608 classifier comparison — the headline answerability metric.

NO new inference. For each of the 10 benchmark cases, runs the SAME preserved vision-model
description (`vision.vision_result` from `docs/eval/print-translator-campaign/results/<id>.gate_bypassed.json`,
with `ocr_items=[]`, exactly as it was in the real bounded campaign run — OCR was unreachable on
that box) through:

    OLD  VisionWorker._classify_photo  (mira-bots/shared/workers/vision_worker.py @ 04a62c9c,
                                         the commit immediately BEFORE PR #2608 / c6e7c9b0)
    NEW  VisionWorker._classify_photo  (mira-bots/shared/workers/vision_worker.py @ this
                                         worktree's current HEAD, i.e. the PR #2608 fix)

and records whether each version would have routed the case to ELECTRICAL_PRINT (`triggered`).

This is a classifier-only comparison — it does not call the LLM cascade, does not touch
`print_translator.py`, and produces no new candidate responses. It answers exactly one question:
"of the real prints in this set, how many would the gate have let through, before vs. after
PR #2608's fix?" — on IDENTICAL inputs.

Usage (from repo root):
    python tools/print_translator_eval/benchmark/before_after_classifier.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import types
from pathlib import Path

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_CAMPAIGN_RESULTS = _REPO_ROOT / "docs" / "eval" / "print-translator-campaign" / "results"
_BENCH_DIR = _REPO_ROOT / "docs" / "eval" / "print-translator-benchmark"
_OUT_PATH = _BENCH_DIR / "before_after_classifier.json"

# Commit immediately BEFORE PR #2608 (c6e7c9b0) — the classifier state genuinely active when
# the campaign's gate_bypassed runs executed (verified by run/commit timestamp ordering; see
# build_evidence.py's provenance comment and the benchmark harness build report).
_OLD_CLASSIFIER_COMMIT = "04a62c9c19804140c18796f1cf6c2a1ba1d9b5d1"
_PR_2608_COMMIT = "c6e7c9b015e35d9f105aebf1bd997a9f27585edc"

FIRST_10_IDS = ["03", "05", "07", "09", "13", "14", "17", "18", "20", "25"]


def _git_show(commit: str, path: str, repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def _load_old_vision_worker_class(repo_root: Path):
    """Load the pre-PR#2608 `VisionWorker` by exec'ing the old file source.

    The old file has the same relative import (`from ..inference.router import ...`) as the
    current one. `_classify_photo` never touches `_inference_router` or network I/O, so the
    import + module-level instantiation are neutralized (replaced with `None`) rather than
    resolved for real — this loads a classifier-only snapshot, not a live worker.
    """
    old_source = _git_show(
        _OLD_CLASSIFIER_COMMIT, "mira-bots/shared/workers/vision_worker.py", repo_root
    )
    patched = old_source.replace(
        "from ..inference.router import InferenceRouter as _InferenceRouter",
        "_InferenceRouter = None  # neutralized for offline classifier-only load (before_after_classifier.py)",
    ).replace(
        "_inference_router = _InferenceRouter()",
        "_inference_router = None  # neutralized for offline classifier-only load (before_after_classifier.py)",
    )
    module = types.ModuleType("vision_worker_pre_pr2608")
    exec(  # noqa: S102 — intentional: loading a pinned git-historical source snapshot, not user input
        compile(
            patched,
            f"<git:{_OLD_CLASSIFIER_COMMIT}:mira-bots/shared/workers/vision_worker.py>",
            "exec",
        ),
        module.__dict__,
    )
    return module.VisionWorker


def _load_current_vision_worker_class(repo_root: Path):
    mira_bots = str(repo_root / "mira-bots")
    if mira_bots not in sys.path:
        sys.path.insert(0, mira_bots)
    from shared.workers.vision_worker import VisionWorker  # noqa: E402  (path inserted above)

    return VisionWorker


def main() -> int:
    old_cls = _load_old_vision_worker_class(_REPO_ROOT)
    new_cls = _load_current_vision_worker_class(_REPO_ROOT)

    old_worker = old_cls(openwebui_url="http://unused", api_key="unused", vision_model="unused")
    new_worker = new_cls(openwebui_url="http://unused", api_key="unused", vision_model="unused")

    cases = []
    old_triggered_ids = []
    new_triggered_ids = []

    for case_id in FIRST_10_IDS:
        result_path = _CAMPAIGN_RESULTS / f"{case_id}.gate_bypassed.json"
        record = json.loads(result_path.read_text(encoding="utf-8"))
        vision_result = record["vision"]["vision_result"]
        category = record["category"]

        old_result = old_worker._classify_photo(vision_result, ocr_items=[])
        new_result = new_worker._classify_photo(vision_result, ocr_items=[])

        old_triggered = old_result["type"] == "ELECTRICAL_PRINT"
        new_triggered = new_result["type"] == "ELECTRICAL_PRINT"
        if old_triggered:
            old_triggered_ids.append(case_id)
        if new_triggered:
            new_triggered_ids.append(case_id)

        cases.append(
            {
                "case_id": case_id,
                "category": category,
                "old_classification": old_result["type"],
                "old_confidence": old_result["confidence"],
                "new_classification": new_result["type"],
                "new_confidence": new_result["confidence"],
                "old_triggered": old_triggered,
                "new_triggered": new_triggered,
                "flipped": old_triggered != new_triggered,
            }
        )

    n = len(cases)
    aggregate = {
        "n": n,
        "old_classifier_commit": _OLD_CLASSIFIER_COMMIT,
        "new_classifier_commit_ref": f"HEAD (descendant of {_PR_2608_COMMIT}, PR #2608)",
        "old_trigger_rate": round(len(old_triggered_ids) / n, 4) if n else None,
        "new_trigger_rate": round(len(new_triggered_ids) / n, 4) if n else None,
        "old_triggered_ids": old_triggered_ids,
        "new_triggered_ids": new_triggered_ids,
        "flipped_ids": [c["case_id"] for c in cases if c["flipped"]],
    }

    output = {
        "method": (
            "Deterministic, no-inference comparison of VisionWorker._classify_photo across the "
            "pre-PR#2608 commit and the current worktree HEAD, run on each case's preserved "
            "vision.vision_result (ocr_items=[]) from "
            "docs/eval/print-translator-campaign/results/<id>.gate_bypassed.json. Classifier "
            "logic only — no LLM cascade call, no product/prompt change."
        ),
        "cases": cases,
        "aggregate": aggregate,
    }

    _BENCH_DIR.mkdir(parents=True, exist_ok=True)
    _OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {_OUT_PATH}")
    print(
        f"old_trigger_rate={aggregate['old_trigger_rate']} "
        f"({len(old_triggered_ids)}/{n}, ids={old_triggered_ids})"
    )
    print(
        f"new_trigger_rate={aggregate['new_trigger_rate']} "
        f"({len(new_triggered_ids)}/{n}, ids={new_triggered_ids})"
    )
    print(f"flipped: {aggregate['flipped_ids']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
