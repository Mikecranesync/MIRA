"""Prove the scorer tests can fail: apply one mutation at a time to a COPY of analyze.py and run test_analyze.py.

    uv run --no-project --python 3.12 --with pytest --with matplotlib python scorer_red_runs.py

Every mutation must turn at least one named test red. The unmutated control must be fully green. Writes
scorecards/scorer-red-runs.json (mutation, failed/passed counts, the failing test names). Exits 1 if any mutation
survives or the control is not green.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MUTATIONS = {
    "control (no mutation)": ("", ""),
    "rank is 0-based": ("return i + 1", "return i"),
    "top-N uses < instead of <=": ("or 99) <= n", "or 99) < n"),
    "McNemar one-sided (drops x2)": ("min(1.0, 2 * sum(", "min(1.0, 1 * sum("),
    "paired b/c swapped": (
        "b = sum(1 for q in ans.values() if hit(q, a, t) and not hit(q, b_arm, t))",
        "b = sum(1 for q in ans.values() if hit(q, b_arm, t) and not hit(q, a, t))",
    ),
    "wrong-page counts empty pools": (
        'if q["arms"][arm][:6] and not (x and x <= 6)',
        "if not (x and x <= 6)",
    ),
    "bootstrap resamples questions, not manuals": (
        'clusters.setdefault(q["cluster"], [])',
        "clusters.setdefault(id(q), [])",
    ),
    "NO-GO threshold loosened to 3": (
        '["b_lost"] - m["paired_pre_post"]["top5"]["c_gained"] >= 2',
        '["b_lost"] - m["paired_pre_post"]["top5"]["c_gained"] >= 3',
    ),
    "minimum n lowered to 10": ('fn["n_answerable"] < 20', 'fn["n_answerable"] < 10'),
    "safety verdict ignores missed hazards": (
        'if post["missed"] or sg["changed_pre_post"]:',
        'if sg["changed_pre_post"]:',
    ),
    "nDCG discount shifted by 0.5": ("1 / math.log2(x + 1)", "1 / math.log2(x + 1.5)"),
    "duplicate ids accepted (#4799)": (
        "    if dup:\n        problems.append",
        "    if False:\n        problems.append",
    ),
    "missing ids accepted (#4799)": (
        "    if missing:\n        problems.append",
        "    if False:\n        problems.append",
    ),
    "changed labels accepted (#4799)": (
        'if r["id"] in frozen and (r.get(labels) or []) != (frozen[r["id"]] or []):',
        "if False:",
    ),
    "harness errors accepted (#4799)": ("if r.get(err) is not None:", "if False:"),
    "kind not checked against frozen labels (Codex F1, 2nd review)": (
        '            if r.get("kind") != want:',
        "            if False:",
    ),
    "unanswerable rows enter the denominator": (
        'ans = {i: q for i, q in s["questions"].items() if q["kind"] == "answerable"}\n    n = len(ans)',
        'ans = dict(s["questions"])\n    n = len(ans)',
    ),
}


def main() -> None:
    src = open(os.path.join(HERE, "analyze.py")).read()
    out, bad = [], []
    for name, (old, new) in MUTATIONS.items():
        with tempfile.TemporaryDirectory() as d:
            code = src
            if old:
                if old not in code:
                    bad.append(f"{name}: anchor not found")
                    continue
                code = code.replace(old, new)
            open(os.path.join(d, "analyze.py"), "w").write(code)
            shutil.copy(os.path.join(HERE, "test_analyze.py"), d)
            for entry in (
                "raw",
                "forum-new",
                "results.json",
                "t4-77-questions.json",
                "batch2-cases.json",
                "safety",
            ):
                os.symlink(
                    os.path.join(HERE, entry), os.path.join(d, entry)
                )  # read-only data the integration tests use
            p = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "-p",
                    "no:cacheprovider",
                    "-rf",
                    "test_analyze.py",
                ],
                cwd=d,
                capture_output=True,
                text=True,
            )
        failed = sorted(set(re.findall(r"FAILED test_analyze\.py::(\w+)", p.stdout)))
        nf = int(m.group(1)) if (m := re.search(r"(\d+) failed", p.stdout)) else 0
        np_ = int(m.group(1)) if (m := re.search(r"(\d+) passed", p.stdout)) else 0
        out.append({"mutation": name, "failed": nf, "passed": np_, "failing_tests": failed})
        survived = (nf == 0) if old else (nf != 0 or np_ == 0)
        if survived:
            bad.append(name)
        print(f"{'OK ' if not survived else 'BAD'} {name:45s} failed={nf} passed={np_} {failed}")
    os.makedirs(os.path.join(HERE, "scorecards"), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, "scorecards", "scorer-red-runs.json"), "w"), indent=1)
    if bad:
        print("PROBLEMS:", bad)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
