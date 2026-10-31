"""Write run-manifest.json: everything needed to rerun this benchmark and check it ran on the same inputs.

    BENCH_ROOT=<scratch dir holding wt-<rev>/> python3 manifest.py

Records revisions, the pinned harness bytes, the sha256 of every input set, every raw file and every manual PDF,
the tool versions, the Postgres image digest and the flag values (Doppler stg/prd, read 2026-10-26; prd sets none,
so the code defaults apply). Run ids are the raw file names: <set>-<arm>-k<K>-r<R>.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REVS = {"pre": "b980d42db", "parent": "e28bb182d", "post": "cc0d26c1d"}


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def sh(*cmd: str) -> str:
    try:
        return (
            subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()
            or subprocess.run(cmd, capture_output=True, text=True).stderr.strip()
        )
    except FileNotFoundError:
        return "<not found>"


def main() -> None:
    root = os.environ.get("BENCH_ROOT", "")
    revs = {}
    for arm, rev in REVS.items():
        wt = os.path.join(root, f"wt-{rev}")
        revs[arm] = {
            "short": rev,
            "full": sh("git", "-C", wt, "rev-parse", "HEAD")
            if os.path.isdir(wt)
            else sh("git", "-C", HERE, "rev-parse", rev),
            "deploy_run": {"pre": "40210914670", "post": "40275532081"}.get(arm),
        }
    raw = {
        os.path.relpath(f, HERE): sha(f)
        for f in sorted(glob.glob(f"{HERE}/raw/**/*.json*", recursive=True))
    }
    manifest = {
        "benchmark": "IMIB v0.1 / benchmark-4791",
        "preregistration_commits": {
            "decision_rules_and_safety_cases": "bd4928480",
            "forum_new_questions": "c9be2d887",
        },
        "revisions": revs,
        "harness": {
            "retrieval_rank.ts": hashlib.sha256(
                subprocess.run(
                    [
                        "git",
                        "-C",
                        HERE,
                        "show",
                        "c095b54c1:tools/benchmark-acceptance/retrieval_rank.ts",
                    ],
                    capture_output=True,
                    check=True,
                ).stdout
            ).hexdigest(),
            "retrieval_rank_origin": "PR #4589 branch feat/benchmark-acceptance-scorecard @ c095b54c1",
            "safety_gate.ts": sha(f"{HERE}/harness/safety_gate.ts"),
            "bm25_baseline.py": sha(f"{HERE}/bm25_baseline.py"),
            "analyze.py": sha(f"{HERE}/analyze.py"),
        },
        "inputs": {
            "t4-77-questions.json": sha(f"{HERE}/t4-77-questions.json"),
            "batch2-cases.json": sha(f"{HERE}/batch2-cases.json"),
            "forum-new-questions.json": sha(f"{HERE}/forum-new/forum-new-questions.json"),
            "safety-gate-cases.json": sha(f"{HERE}/safety/safety-gate-cases.json"),
            "manual_pdfs": "manual-pdfs.sha256",
        },
        "flags": {
            "doppler_read": "2026-10-26",
            "stg": {
                "NOTEBOOK_HYBRID_RETRIEVAL": "1",
                "NOTEBOOK_RERANK": "1",
                "NOTEBOOK_LEXICAL_V2": "1",
                "NOTEBOOK_ENERGIZED_HARD_STOP": "unset (default on)",
            },
            "prd": {
                "NOTEBOOK_HYBRID_RETRIEVAL": "unset (off)",
                "NOTEBOOK_RERANK": "unset (off)",
                "NOTEBOOK_LEXICAL_V2": "unset (off)",
                "NOTEBOOK_ENERGIZED_HARD_STOP": "unset (default on)",
            },
            "benchmark_arms": {
                "pre/parent/post": "all three off (production)",
                "post-lexv2": "NOTEBOOK_LEXICAL_V2=1 only",
                "safety-gate": "NOTEBOOK_ENERGIZED_HARD_STOP unset (default on)",
            },
        },
        "environment": {
            "host": sh("hostname"),
            "node": sh("node", "--version"),
            "pdftotext": sh("pdftotext", "-v").splitlines()[0] if sh("pdftotext", "-v") else None,
            "python_analysis": "uv run --no-project --python 3.12 --with matplotlib",
            "postgres": "docker pgvector/pgvector:pg16 (throwaway container bench-4791, 127.0.0.1:55450), schema ke_schema_bakeoff.sql = staging knowledge_entries",
            "postgres_image_id": sh(
                "docker", "image", "inspect", "--format", "{{.Id}}", "pgvector/pgvector:pg16"
            ),
        },
        "raw_files_sha256": raw,
        "cost": {
            "usd": 0,
            "model_calls": 0,
            "note": "retrieval and gate only; no answer generation",
        },
    }
    json.dump(manifest, open(f"{HERE}/run-manifest.json", "w"), indent=1)
    print(f"run-manifest.json: {len(raw)} raw files")


if __name__ == "__main__":
    main()
