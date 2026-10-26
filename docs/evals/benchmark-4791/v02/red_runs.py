"""Prove the v0.2 tests can fail: break one rule at a time in a COPY of v02/ and run the test that guards it.

    uv run --no-project --python 3.12 --with pytest python v02/red_runs.py

Runs the fast tests only (synthetic inputs; the slow PDF-backed key checks are excluded with -k). The unmutated
control must pass every selected test; each mutation must turn its guard red. Exits 1 otherwise.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
FAST = "not known_fault_rows and not known_index and not every_committed and not byte_for_byte and not robust_set_matches"
MUTATIONS = [
    ("control (no mutation)", None, None, None),
    (
        "fault row kept without its name",
        "oem_truth.py",
        'if not name_ok or not r["strict"]:',
        'if not r["strict"]:',
    ),
    (
        "index entry kept without its words on the page",
        "oem_truth.py",
        "if p in pmap and all(w in pages[pmap[p] - 1].lower() for w in words)",
        "if p in pmap",
    ),
    (
        "'fault F33' becomes 'fault fault 33'",
        "robustness.py",
        'r"(?i)\\bfault\\s+" + re.escape(base_code), q',
        'r"NEVER-MATCHES", q',
    ),
    (
        "V1 discrimination bar loosened",
        "analyze_v02.py",
        "bm >= 0.50 and rnd <= 0.10",
        "bm >= 0.40 and rnd <= 0.10",
    ),
    (
        "V2 needs only one net loss",
        "analyze_v02.py",
        'pd["b_lost"] - pd["c_gained"] >= 2',
        'pd["b_lost"] - pd["c_gained"] >= 1',
    ),
    (
        "GO without significance",
        "analyze_v02.py",
        "pool_c > pool_b and pooled_p < 0.05",
        "pool_c > pool_b",
    ),
    (
        "labeler qualification bar lowered",
        "mike_queue.py",
        "QUALIFY, AUDIT_N, SEED = 0.90, 10, 4791",
        "QUALIFY, AUDIT_N, SEED = 0.80, 10, 4791",
    ),
    (
        "audit sample dropped",
        "mike_queue.py",
        "QUALIFY, AUDIT_N, SEED = 0.90, 10, 4791",
        "QUALIFY, AUDIT_N, SEED = 0.90, 0, 4791",
    ),
    (
        "incomplete labeler qualifies",
        "mike_queue.py",
        '"qualified": n == len(truth) and',
        '"qualified":',
    ),
    (
        "unmetered SimLab call allowed",
        "simlab_run.py",
        "    if pt == 0 and ct == 0:\n        raise BudgetExceeded",
        "    if False:\n        raise BudgetExceeded",
    ),
]


def main() -> None:
    bad = []
    for name, fname, old, new in MUTATIONS:
        d = tempfile.mkdtemp()
        try:
            bench = os.path.join(d, "bench")
            os.makedirs(bench)
            for entry in os.listdir(BENCH):
                if entry != "v02":
                    os.symlink(os.path.join(BENCH, entry), os.path.join(bench, entry))
            shutil.copytree(
                HERE,
                os.path.join(bench, "v02"),
                ignore=shutil.ignore_patterns("labels", "simlab", "__pycache__"),
            )
            if fname:
                p = os.path.join(bench, "v02", fname)
                src = open(p).read()
                if src.count(old) != 1:
                    bad.append(f"{name}: anchor found {src.count(old)} times")
                    continue
                open(p, "w").write(src.replace(old, new))
            r = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "-p",
                    "no:cacheprovider",
                    "-k",
                    FAST,
                    "test_v02_truth.py",
                    "test_analyze_v02.py",
                    "test_mike_queue.py",
                    "test_simlab_meter.py",
                ],
                cwd=os.path.join(bench, "v02"),
                capture_output=True,
                text=True,
            )
        finally:
            shutil.rmtree(d, ignore_errors=True)
        nf = int(m.group(1)) if (m := re.search(r"(\d+) failed", r.stdout)) else 0
        npass = int(m.group(1)) if (m := re.search(r"(\d+) passed", r.stdout)) else 0
        failing = sorted(set(re.findall(r"FAILED \S+::(\w+)", r.stdout)))
        ok = (nf == 0 and npass > 0) if not fname else nf > 0
        print(f"{'OK ' if ok else 'BAD'} {name:45s} failed={nf} passed={npass} {failing}")
        if not ok:
            bad.append(name)
    if bad:
        print("PROBLEMS:", bad)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
