"""Prove test_rescore_human.py can fail: mutate a COPY of rescore_human.py, one guard at a time, and run the tests.

    uv run --no-project --python 3.12 --with pytest --with matplotlib python human-key/red_runs.py

The unmutated control must pass every test; each mutation must turn at least one named test red. Exit 1 otherwise.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MUTATIONS = {
    "control (no mutation)": ("", ""),
    "preview export accepted": ('if manifest.get("source_url") == PREVIEW_URL:', "if False:"),
    "export without provenance accepted": (
        "if not os.path.exists(mpath):\n        raise Refused",
        "if False:\n        raise Refused",
    ),
    "unknown documents accepted": (
        "    if bad:\n        raise Refused",
        "    if False:\n        raise Refused",
    ),
    "half-answered cases scored": (
        'complete = bool(rec and rec.get("overall") and all(str(p) in pages for p in f["pages"]))',
        'complete = bool(rec and rec.get("overall"))',
    ),
    "unsure safety call guessed as protect": (
        '    "answer": "none",\n}',
        '    "answer": "none",\n    "unsure": "protect",\n}',
    ),
    "FINAL without the hazard target": ('and haz["n"] >= HAZARD_TARGET', ""),
    "rescore skips raw-run validation (Codex F4)": (
        "            A.validate_rows(rows, frozen, os.path.relpath(path, BENCH), check_kind=True)",
        "            pass",
    ),
    "queue: consensus overrides Mike": (
        '        if k["source"] != "mike":\n            pages = x["consensus_pages"]',
        '        if True:\n            pages = x["consensus_pages"]',
    ),
    "queue: audit never counts a wrong consensus": (
        "            wrong += 1\n",
        "            wrong += 0\n",
    ),
    "queue: FINAL ignores the queue": ("            if need <= mike_done", "            if True"),
    "frozen review data not checked": ("if sha(review_path) != REVIEW_DATA_SHA256:", "if False:"),
}


def main() -> None:
    src = open(os.path.join(HERE, "rescore_human.py")).read()
    bad = []
    for name, (old, new) in MUTATIONS.items():
        if old and src.count(old) != 1:
            bad.append(f"{name}: anchor found {src.count(old)} times")
            continue
        d = tempfile.mkdtemp()
        try:
            hk = os.path.join(d, "human-key")
            os.makedirs(hk)
            open(os.path.join(hk, "rescore_human.py"), "w").write(
                src.replace(old, new) if old else src
            )
            for f in ("test_rescore_human.py", "review-data.json"):
                shutil.copy(os.path.join(HERE, f), hk)
            for entry in os.listdir(
                os.path.dirname(HERE)
            ):  # the benchmark's frozen inputs, read-only
                if entry != "human-key":
                    os.symlink(os.path.join(os.path.dirname(HERE), entry), os.path.join(d, entry))
            p = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "-p",
                    "no:cacheprovider",
                    "-rf",
                    "test_rescore_human.py",
                ],
                cwd=hk,
                capture_output=True,
                text=True,
            )
        finally:
            shutil.rmtree(d, ignore_errors=True)
        failed = sorted(set(re.findall(r"FAILED test_rescore_human\.py::(\w+)", p.stdout)))
        nf = int(m.group(1)) if (m := re.search(r"(\d+) failed", p.stdout)) else 0
        npass = int(m.group(1)) if (m := re.search(r"(\d+) passed", p.stdout)) else 0
        ok = (nf == 0 and npass > 0) if not old else nf > 0
        print(f"{'OK ' if ok else 'BAD'} {name:40s} failed={nf} passed={npass} {failed}")
        if not ok:
            bad.append(name)
    if bad:
        print("PROBLEMS:", bad)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
