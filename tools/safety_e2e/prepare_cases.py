#!/usr/bin/env python3
"""Split a sealed safety set into a BLIND case file and a separate answer key.

The end-to-end harness (mira-hub/tests/safety-e2e/run.e2e.ts) and the grader
(grade.py) only ever see the blind file: an opaque run id, the question, the
bound machine and the retrievable sources. Labels and classes go to key.jsonl,
which only score.py reads. Nothing here is written inside the repository: both
outputs must live outside it (the sealed set never enters git).

Inputs (sealed v0 layout):
  asks.jsonl     {id, class, label: flag|no_flag, rationale, text}
  answers.jsonl  {id, class, label: block|warn|allow, question, answer,
                  bound_machine, sources: [{id, text, applies_to_bound_machine}]}

For answer-stage records only the QUESTION and SOURCES are driven through the
pipeline; the pre-written answer is never shown to the generator (that set
measures the deterministic floor elsewhere). It is kept in the key only so
grader calibration (grade.py --calibrate) can score the grader on known labels.

Usage:
  python3 tools/safety_e2e/prepare_cases.py --sealed ~/.factorylm/sealed-safety-eval/v0 \
      --out /path/outside/repo --limit 0 --seed 20261029 [--select ask-0001,ans-0002]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import sys
from pathlib import Path

EXPECTED_SHA = {
    "answers.jsonl": "93019a8b75af26c0b9dffe92a009840d8639fd07029723f7755c77e3c5dcf460",
    "asks.jsonl": "929c12089834ca3b312a08b8fe3c02e75f659344715edd53a034312e98b46387",
}


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent,
        check=True,
    )
    return Path(out.stdout.strip()).resolve()


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sealed", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--limit", type=int, default=0, help="0 = all; else a seeded stratified sample")
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument("--select", default="", help="comma-separated record ids (overrides --limit)")
    ap.add_argument("--no-verify-sha", action="store_true", help="for a future set version only")
    a = ap.parse_args()

    out = a.out.expanduser().resolve()
    if out == repo_root() or repo_root() in out.parents:
        print(f"refusing: --out {out} is inside the repository", file=sys.stderr)
        return 2
    sealed = a.sealed.expanduser().resolve()
    for name, want in EXPECTED_SHA.items():
        got = sha256(sealed / name)
        if not a.no_verify_sha and got != want:
            print(f"refusing: {name} sha256 {got} != pinned {want}", file=sys.stderr)
            return 2

    cases, key = [], []
    for line in (sealed / "asks.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        cases.append({"id": r["id"], "question": r["text"], "bound_machine": None, "sources": []})
        key.append({"id": r["id"], "stage": "ask", "class": r["class"], "label": r["label"]})
    for line in (sealed / "answers.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        cases.append(
            {
                "id": r["id"],
                "question": r["question"],
                "bound_machine": r.get("bound_machine"),
                "sources": [
                    {
                        "id": s["id"],
                        "text": s["text"],
                        "applies": bool(s.get("applies_to_bound_machine")),
                    }
                    for s in (r.get("sources") or [])
                ],
            }
        )
        key.append(
            {
                "id": r["id"],
                "stage": "answer_question",
                "class": r["class"],
                "label": r["label"],
                "prewritten_answer": r["answer"],
            }
        )

    if a.select:
        want = set(a.select.split(","))
        cases = [c for c in cases if c["id"] in want]
    elif a.limit:
        # Stratified by (stage, class) so a small dry run still touches every class.
        rng = random.Random(a.seed)
        by = {}
        for k in key:
            by.setdefault((k["stage"], k["class"]), []).append(k["id"])
        picked: list[str] = []
        strata = sorted(by)
        rng.shuffle(strata)
        while len(picked) < a.limit and any(by[s] for s in strata):
            for s in strata:
                if by[s] and len(picked) < a.limit:
                    picked.append(by[s].pop(rng.randrange(len(by[s]))))
        sel = set(picked)
        cases = [c for c in cases if c["id"] in sel]
    ids = {c["id"] for c in cases}
    key = [k for k in key if k["id"] in ids]

    out.mkdir(parents=True, exist_ok=True)
    (out / "cases.blind.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cases))
    (out / "key.jsonl").write_text("".join(json.dumps(k) + "\n" for k in key))
    manifest = {
        "sealed_dir": str(sealed),
        "sha256": {n: sha256(sealed / n) for n in EXPECTED_SHA},
        "n_cases": len(cases),
        "seed": a.seed,
        "limit": a.limit,
        "select": a.select or None,
    }
    (out / "prepare.manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({"n_cases": len(cases), "out": str(out)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
