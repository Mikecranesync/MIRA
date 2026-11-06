"""run-manifest.json must describe the committed files exactly (Codex F5 on #4793): every local harness file, input
and raw run it names hashes to the recorded sha256. Changing a scorer or a raw file without refreshing the
manifest fails here.

    uv run --no-project --python 3.12 --with pytest python -m pytest -q test_manifest.py
"""

import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, "run-manifest.json")))
LOCAL = {
    "safety_gate.ts": "harness/safety_gate.ts",
    "bm25_baseline.py": "bm25_baseline.py",
    "analyze.py": "analyze.py",
    "t4-77-questions.json": "t4-77-questions.json",
    "batch2-cases.json": "batch2-cases.json",
    "forum-new-questions.json": "forum-new/forum-new-questions.json",
    "safety-gate-cases.json": "safety/safety-gate-cases.json",
}


def sha(rel: str) -> str:
    return hashlib.sha256(open(os.path.join(HERE, rel), "rb").read()).hexdigest()


def test_harness_and_inputs_match_the_manifest():
    recorded = {**M["harness"], **M["inputs"]}
    bad = {name: rel for name, rel in LOCAL.items() if recorded.get(name) != sha(rel)}
    assert bad == {}


def test_every_raw_file_matches_the_manifest():
    assert M["raw_files_sha256"], "manifest lists no raw files"
    bad = [rel for rel, h in M["raw_files_sha256"].items() if sha(rel) != h]
    assert bad == []


def test_revisions_are_full_shas():
    for arm, r in M["revisions"].items():
        assert r["full"] and len(r["full"]) == 40 and r["full"].startswith(r["short"]), arm
